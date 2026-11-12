/**
 * JobFinder — unified LinkedIn client factory.
 *
 * Returns a single facade used by every service (posting, outreach, jobs):
 *
 *   mode 'dry-run'  no channel connected, or global dry-run is on
 *                   (the default until the user explicitly disables it)
 *   mode 'official' active channel with OAuth tokens (API oficial)
 *   mode 'cookie'   active channel with session cookies (fallback)
 *
 * The facade methods used by the rest of the app:
 *   getProfile()                    -> member identity (also the auth test)
 *   searchPeople(keyword, opts)     -> [{ profileUrn, profileId, firstName, ... }]
 *   sendInvitation({profileUrn, message, profileId})
 *   sendMessage({ profileUrn, text })
 *   sendMessageToConversation(conversationId, text)
 *   getConversations()              -> [{ conversationId, title, unread, ... }]
 *   getConversationEvents(id)       -> [{ createdAt, body, fromName, ... }]
 *   createPost({ text })            -> official API only
 *   searchJobs(filters)             -> [{ jobId, title, company, ... }]
 *   testAuth()                      -> { ok, mode }
 */
import { DryRunLinkedInClient } from './dryRun.mjs';
import { VoyagerClient } from './voyagerClient.mjs';
import { LinkedInOfficialClient } from './officialApi.mjs';

/** Records of the active channel used across the app. */
export function getActiveChannel(store) {
  const channels = store.list('channels.json');
  return channels.find((c) => c.status === 'active') ?? channels.find((c) => c.status === 'untested') ?? null;
}

export function createLinkedInClient({ store, logger, config, rateLimiter }) {
  const channel = getActiveChannel(store);
  const dryRunEnabled = config?.dryRun !== false;

  if (!channel || dryRunEnabled) {
    const simulated = new DryRunLinkedInClient(logger);
    if (channel && dryRunEnabled) {
      simulated.dryRunReason = 'global-dry-run';
    } else {
      simulated.dryRunReason = 'no-channel';
    }
    return { client: simulated, mode: 'dry-run', channel };
  }

  if (channel.authMode === 'official') {
    const client = new LinkedInOfficialClient(channel, logger);
    const facade = {
      mode: 'official',
      channel,
      async getProfile() {
        return client.getProfile();
      },
      async testAuth() {
        try {
          const profile = await client.getProfile();
          return { ok: true, mode: 'official', profile };
        } catch (err) {
          return { ok: false, mode: 'official', message: err.message };
        }
      },
      async createPost({ text }) {
        return client.createPost({ text });
      },
      async searchPeople() {
        client.outreachUnsupported();
      },
      async sendInvitation() {
        client.outreachUnsupported();
      },
      async sendMessage() {
        client.outreachUnsupported();
      },
      async sendMessageToConversation() {
        client.outreachUnsupported();
      },
      async getConversations() {
        client.outreachUnsupported();
      },
      async getConversationEvents() {
        client.outreachUnsupported();
      },
      async searchJobs() {
        client.outreachUnsupported();
      },
    };
    return { client: facade, mode: 'official', channel };
  }

  const client = new VoyagerClient(channel, logger, rateLimiter);
  const facade = {
    mode: 'cookie',
    channel,
    async getProfile() {
      return client.getProfile();
    },
    async testAuth() {
      try {
        const profile = await client.getProfile();
        return { ok: true, mode: 'cookie', profile };
      } catch (err) {
        return { ok: false, mode: 'cookie', message: err.message };
      }
    },
    async searchPeople(keyword, opts) {
      return client.searchPeople(keyword, opts);
    },
    async sendInvitation(payload) {
      return client.sendInvitation(payload);
    },
    async sendMessage(payload) {
      return client.sendMessage(payload);
    },
    async sendMessageToConversation(conversationId, text) {
      return client.sendMessageToConversation(conversationId, text);
    },
    async getConversations(opts) {
      return client.getConversations(opts);
    },
    async getConversationEvents(id) {
      return client.getConversationEvents(id);
    },
    async createPost({ text }) {
      return client.createPost({ text });
    },
    async searchJobs(filters) {
      return client.searchJobs(filters);
    },
  };
  return { client: facade, mode: 'cookie', channel };
}

/** Build the channel object stored in channels.json (secrets never redacted on disk). */
export function buildChannel({ id, label, authMode, extra = {} }) {
  return {
    id,
    label,
    authMode,
    status: 'inactive',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    lastError: null,
    official: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: null, personId: '', profileName: '' },
    cookies: [],
    profile: null,
    ...extra,
  };
}

/** Redacted view of a channel for API responses. */
export function redactChannel(channel) {
  if (!channel) return null;
  return {
    ...channel,
    cookies: undefined,
    cookieNames: Array.isArray(channel.cookies) ? channel.cookies.map((c) => c.name) : [],
    official: channel.official
      ? {
          clientId: channel.official.clientId ? '***' : '',
          clientSecret: channel.official.clientSecret ? '***' : '',
          hasAccessToken: Boolean(channel.official.accessToken),
          hasRefreshToken: Boolean(channel.official.refreshToken),
          expiresAt: channel.official.expiresAt ?? null,
          personId: channel.official.personId || null,
          profileName: channel.official.profileName || null,
        }
      : null,
    cookiesCount: Array.isArray(channel.cookies) ? channel.cookies.length : 0,
  };
}
