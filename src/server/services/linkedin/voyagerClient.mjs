/**
 * JobFinder — LinkedIn Voyager (cookie) client.
 *
 * Ported/adapted from the open-source references in the PRD (§3):
 *  - cv-cat/LinkedinApis          (DM via cookie, FastAPI -> Node)
 *  - EduMMorenolp/linkedin-messaging-bot (Puppeteer batch DMs, MySQL -> JSON)
 *  - prabaljainn/Linkedin-Messaging-Bot (batch sends from a list)
 *  - davidobbs/linkedin-automation-system (inbox monitoring + anti-detection)
 *  - Isaac-Foster/linkedin_bot   (invitations with weekly limit)
 *
 * This is the FALLBACK auth path: the user exports cookies with the
 * "Get cookies.txt LOCALLY" extension. All requests carry the session
 * cookies from channels.json; nothing is sent to any JobFinder server.
 *
 * Anti-detection follows davidobbs: realistic desktop headers, csrf-token
 * from JSESSIONID, and human-like pacing handled by the central RateLimiter.
 */
import { getJsessionId, cookieHeader } from './cookies.mjs';
import { badGateway } from '../../middleware/errors.mjs';

const VOYAGER = 'https://www.linkedin.com/voyager/api';

// Rotating realistic desktop UAs (davidobbs-style anti-detection).
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export class VoyagerClient {
  /**
   * @param {object} channel active channel record (authMode 'cookie')
   * @param {import('../../storage/logger.mjs').Logger} logger
   * @param {import('../../middleware/rateLimiter.mjs').RateLimiter} rateLimiter
   */
  constructor(channel, logger, rateLimiter) {
    this.channel = channel;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
    this.cookies = channel.cookies ?? [];
    this.csrf = getJsessionId(this.cookies);
  }

  /** Update the cookie jar (e.g. after a rotated JSESSIONID). */
  setCookies(cookies) {
    this.cookies = cookies;
    this.channel.cookies = cookies;
    this.csrf = getJsessionId(cookies);
  }

  headers() {
    return {
      'User-Agent': pickUserAgent(),
      Accept: 'application/vnd.linkedin.normalized+json+2.1',
      'Accept-Language': 'en-US,en;q=0.9',
      'csrf-token': this.csrf ?? '',
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'x-li-track': JSON.stringify({ clientVersion: '1.13.0', mpVersion: '1.13.0', osName: 'web', timezoneOffset: 0 }),
      Cookie: cookieHeader(this.cookies),
      Referer: 'https://www.linkedin.com/feed/',
    };
  }

  /** Voyager GET. */
  async get(path, { actionKey = 'voyager-get' } = {}) {
    await this.rateLimiter.gate(actionKey, 800);
    const res = await fetch(`${VOYAGER}${path}`, { headers: this.headers() });
    if (res.status === 403) {
      await this.refreshSession();
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** Voyager POST (JSON body). */
  async post(path, body, { actionKey = 'voyager-post' } = {}) {
    await this.rateLimiter.gate(actionKey, 1200);
    const res = await fetch(`${VOYAGER}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  /** Re-fetch the homepage to rotate JSESSIONID and li_at cookies. */
  async refreshSession() {
    this.logger?.warn('linkedin:voyager', 'session returned 403 — attempting cookie refresh');
    try {
      const res = await fetch('https://www.linkedin.com/feed/', {
        headers: { ...this.headers(), Accept: 'text/html' },
      });
      const setCookie = res.headers.get('set-cookie') ?? '';
      const rotated = parseSetCookieHeader(setCookie);
      if (rotated.length) {
        const names = new Set(rotated.map((c) => c.name));
        const merged = [...this.cookies.filter((c) => !names.has(c.name)), ...rotated];
        this.setCookies(merged);
        this.logger?.info('linkedin:voyager', 'session cookies rotated', { count: rotated.length });
      }
    } catch (err) {
      this.logger?.error('linkedin:voyager', 'session refresh failed', { message: err.message });
    }
    return this.cookies;
  }

  /* ------------------------------------------------------------------ *
   * Profile                                                            *
   * ------------------------------------------------------------------ */

  /** Lightweight auth test: who am I? */
  async getProfile() {
    const { status, data } = await this.get('/voyagerIdentityDashProfiles?q=memberIdentity&viewType=CURRENT', { actionKey: 'voyager-profile' });
    if (status === 401 || status === 403) {
      throw badGateway('LinkedIn session invalid', { hint: 'Re-exporte os cookies com a extensao "Get cookies.txt LOCALLY".' });
    }
    const profile = data?.elements?.[0] ?? data?.data ?? {};
    const mini = profile['miniProfile'] ?? profile;
    return {
      id: mini.publicIdentifier ?? mini.entityUrn?.split(':').pop() ?? null,
      firstName: mini.firstName ?? null,
      lastName: mini.lastName ?? null,
      headline: mini.occupation ?? mini.headline ?? null,
      entityUrn: mini.entityUrn ?? null,
    };
  }

  /* ------------------------------------------------------------------ *
   * People search + invitations (Isaac-Foster / Gurukishore-G logic)   *
   * ------------------------------------------------------------------ */

  /**
   * Search people by keyword (cargo, empresa, skill, localizacao).
   * Returns normalized profiles.
   */
  async searchPeople(keyword, { count = 25 } = {}) {
    const params = new URLSearchParams({
      count: String(count),
      origin: 'GLOBAL_SEARCH_HEADER',
      q: 'all',
      keywords: keyword,
      start: '0',
      queryContext: 'List(spellCorrectionEnabled->true,relatedSearchesEnabled->true)',
    });
    const { status, data } = await this.get(`/search/hits?${params.toString()}`);
    const people = extractPeople(data);
    this.logger?.info('linkedin:voyager', 'people search', { keyword, found: people.length });
    return people;
  }

  /** Send a connection invitation with an optional message (max 300 chars). */
  async sendInvitation({ profileUrn, message, profileId }) {
    const body = {
      inviteeProfileUrn: profileUrn,
      trackingId: trackingId(),
    };
    const text = (message ?? '').slice(0, 300);
    if (text) body.message = { body: text };
    const { status, data } = await this.post('/growth/normInvitations', body, { actionKey: 'invitation' });
    if (status >= 400) {
      throw badGateway('LinkedIn invitation', {
        status,
        hint: 'Pode ser limite semanal, convite pendente ou sessao expirada.',
        ...data,
      });
    }
    return { ok: true, profileId, status };
  }

  /* ------------------------------------------------------------------ *
   * Messaging (cv-cat/LinkedinApis + EduMMorenolp logic)               *
   * ------------------------------------------------------------------ */

  /** List conversations (for reply detection / inbox monitoring). */
  async getConversations({ count = 20 } = {}) {
    const { status, data } = await this.get(`/messaging/conversations?count=${count}`);
    if (status >= 400) throw badGateway('LinkedIn conversations', { status });
    return normalizeConversations(data);
  }

  /** Events (messages) of a conversation, oldest -> newest. */
  async getConversationEvents(conversationId) {
    const { status, data } = await this.get(`/messaging/conversations/${encodeURIComponent(conversationId)}/events`);
    if (status >= 400) throw badGateway('LinkedIn conversation events', { status });
    return normalizeEvents(data);
  }

  /** Create (or reuse) a conversation with a profile and send the first message. */
  async sendMessage({ profileUrn, text }) {
    const create = await this.post(
      '/messaging/conversations?action=create',
      {
        conversationCreate: { recipients: { MemberEntities: [profileUrn] } },
        message: { body: { text } },
      },
      { actionKey: 'dm' }
    );
    if (create.status >= 400) {
      throw badGateway('LinkedIn DM create conversation', { status: create.status, ...create.data });
    }
    const conversationId = findConversationId(create.data);
    if (!conversationId) return { ok: true, conversationId: null };
    return this.sendMessageToConversation(conversationId, text);
  }

  /** Send a message inside an existing conversation. */
  async sendMessageToConversation(conversationId, text) {
    const { status, data } = await this.post(
      `/messaging/conversations/${encodeURIComponent(conversationId)}/events`,
      { eventcreate: { value: { 'com.linkedin.voyager.messaging.create.MessageCreate': { body: text, attributedBody: null, attachments: [] } } } },
      { actionKey: 'dm' }
    );
    if (status >= 400) {
      throw badGateway('LinkedIn DM send', { status, ...data });
    }
    return { ok: true, conversationId };
  }

  /* ------------------------------------------------------------------ *
   * Posting (cookie fallback)                                          *
   * ------------------------------------------------------------------ */

  /** Publish a text post via the Voyager share endpoint. */
  async createPost({ text }) {
    const { status, data } = await this.post(
      '/growth/shares',
      {
        visibleToConnectionsOnly: false,
        originalUrl: null,
        commentary: { text },
        harvestedContext: null,
      },
      { actionKey: 'post' }
    );
    if (status >= 400) {
      throw badGateway('LinkedIn share (cookie)', { status, ...data });
    }
    this.logger?.info('linkedin:voyager', 'post published', { id: data?.value?.entityUrn ?? null });
    return data;
  }

  /* ------------------------------------------------------------------ *
   * Jobs                                                               *
   * ------------------------------------------------------------------ */

  /** Job search (unofficial Voyager endpoint; best-effort, dry-run safe). */
  async searchJobs(filters = {}) {
    const params = new URLSearchParams({
      count: String(Math.min(filters.count ?? 25, 50)),
      q: 'jobSearch',
      start: '0',
      keywords: filters.title ?? filters.keywords ?? '',
      queryContext: 'List(spellCorrectionEnabled->true,relatedSearchesEnabled->true)',
    });
    if (filters.location) params.set('filters', `List(location->${filters.location})`);
    const { status, data } = await this.get(`/search/hits?${params.toString()}`, { actionKey: 'voyager-jobs' });
    if (status >= 400) {
      throw badGateway('LinkedIn job search', { status, hint: 'A API interna do LinkedIn pode mudar; exporte cookies novos e tente novamente.' });
    }
    return extractJobs(data);
  }
}

/* -------------------------------------------------------------------- *
 * Helpers                                                              *
 * -------------------------------------------------------------------- */

function trackingId() {
  return `jobfinder-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
}

/** Find the conversation id inside a create-conversation response. */
function findConversationId(data) {
  const urns = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.entityUrn === 'string') urns.push(node.entityUrn);
    if (typeof node.dashEntityUrn === 'string') urns.push(node.dashEntityUrn);
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  const match = urns.find((urn) => urn.includes('conversation'));
  if (!match) return null;
  return match.split('conversation:').pop();
}

function parseSetCookieHeader(header) {
  if (!header) return [];
  // Node fetch merges set-cookie into one string separated by ", ".
  return header.split(/,\s+(?=[a-zA-Z0-9_-]+=)/).map((part) => {
    const [pair, ...attrs] = part.split(';').map((s) => s.trim());
    const [name, ...value] = pair.split('=');
    const cookie = {
      name: name?.trim(),
      value: value.join('=').replace(/"/g, ''),
      domain: '.www.linkedin.com',
      path: '/',
      secure: attrs.some((a) => a.toLowerCase().startsWith('secure')),
      expires: 0,
    };
    const domainAttr = attrs.find((a) => a.toLowerCase().startsWith('domain='));
    if (domainAttr) cookie.domain = domainAttr.split('=')[1].replace(/^\./, '.');
    return cookie;
  }).filter((c) => c.name);
}

/** Extract people from the Voyager hits payload. */
function extractPeople(data) {
  const included = data?.included ?? [];
  const people = [];
  for (const entity of included) {
    const entityType = entity?.$type ?? '';
    if (!entityType.includes('people.hit')) continue;
    const hit = entity?.hit?.com?.linkedin?.voyager?.search?.SearchProfile ?? entity?.hit ?? {};
    const profile = hit?.miniProfile ?? {};
    if (!profile.publicIdentifier && !profile.entityUrn) continue;
    people.push({
      profileUrn: profile.entityUrn ?? `urn:li:fsd_profile:${profile.publicIdentifier}`,
      profileId: profile.publicIdentifier ?? String(hit.trackingId ?? hit.objectUrn ?? people.length),
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      headline: profile.occupation ?? '',
      location: profile.locationName ?? '',
      vanityName: profile.publicIdentifier ?? null,
    });
  }
  return people;
}

/** Extract jobs from the Voyager hits payload (best-effort). */
function extractJobs(data) {
  const included = data?.included ?? [];
  const jobs = [];
  for (const entity of included) {
    const entityType = entity?.$type ?? '';
    if (!entityType.includes('voyager.jobs.JobPosting') && !entityType.includes('jobs.Job')) continue;
    const companyName =
      entity?.companyDetails?.['com.linkedin.voyager.deco.jobs.web.shared.WebJobCompany']?.companyName
      ?? entity?.companyName
      ?? null;
    jobs.push({
      jobId: entity.entityUrn?.split(':').pop() ?? String(jobs.length),
      title: entity.title ?? null,
      company: companyName,
      location: entity.formattedLocation ?? entity.locationName ?? null,
      listedAt: entity.listedAt ? new Date(entity.listedAt).toISOString() : null,
      easyApply: 'applyMethod' in (entity ?? {}) ? entity.applyMethod?.value === 'EASY_APPLY' : null,
      url: entity?.navigationUrl ?? null,
      description: entity?.description?.text ?? entity?.jobDescription?.text ?? '',
      simulated: false,
    });
  }
  return jobs;
}

function normalizeConversations(data) {
  const elements = data?.elements ?? [];
  return elements.map((conv) => ({
    conversationId: String(conv.entityUrn ?? conv.dashEntityUrn ?? '').replace('urn:li:msg_conversation:', ''),
    title: conv.title ?? null,
    unread: Boolean(conv.unreadCount),
    lastActivityAt: conv.lastActivityAt ? new Date(conv.lastActivityAt).toISOString() : null,
    participants: (conv.participants ?? []).map((p) => ({
      urn: p.entityUrn ?? p['*participant']?.entityUrn ?? null,
      name: p.participantType?.member?.name?.firstName
        ? `${p.participantType.member.name.firstName} ${p.participantType.member.name.lastName ?? ''}`.trim()
        : null,
    })),
  }));
}

function normalizeEvents(data) {
  const elements = data?.elements ?? [];
  return elements.map((ev) => {
    const content = ev?.subElement?.messageEvent ?? ev;
    const from = content?.from?.messagingParticipant?.participantType?.member ?? {};
    return {
      eventId: content.entityUrn ?? null,
      createdAt: content.createdAt ? new Date(content.createdAt).toISOString() : null,
      body: content?.body?.text ?? content?.attributedBody?.text ?? '',
      fromName: `${from.firstName ?? ''} ${from.lastName ?? ''}`.trim() || null,
      fromUrn: from.entityUrn ?? null,
    };
  });
}
