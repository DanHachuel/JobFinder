/**
 * JobFinder — LinkedIn OFFICIAL API client (OAuth 2.0 + REST API v2).
 *
 * This is the primary auth method recommended in the UI. The user creates
 * their own LinkedIn app (button "Criar API Oficial do LinkedIn") and the
 * credentials are stored locally in config.json / channels.json only.
 *
 * Scope needed for posting: openid profile w_member_social.
 *
 * NOTE: LinkedIn grants "w_member_social" only to approved partners. The
 * client surfaces the API error verbatim so the user knows they need the
 * product approved, and the app falls back to the cookie-based client.
 */
import { badGateway } from '../../middleware/errors.mjs';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API_BASE = 'https://api.linkedin.com';
const USERINFO_URL = `${API_BASE}/v2/userinfo`;
const POSTS_URL = `${API_BASE}/rest/posts`;
const UGC_POSTS_URL = `${API_BASE}/v2/ugcPosts`;
const DEFAULT_SCOPE = 'openid profile w_member_social';

export class LinkedInOfficialClient {
  /**
   * @param {object} channel active channel record from channels.json
   * @param {import('../../storage/logger.mjs').Logger} logger
   */
  constructor(channel, logger) {
    this.channel = channel;
    this.logger = logger;
  }

  get token() {
    const official = this.channel.official ?? {};
    return official.accessToken ?? null;
  }

  /** Authorization URL for the OAuth code flow. */
  static authorizationUrl({ clientId, redirectUri, state, scope = DEFAULT_SCOPE }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Exchange the authorization code for access + refresh tokens. */
  static async exchangeCode({ clientId, clientSecret, code, redirectUri }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw badGateway('LinkedIn token exchange', { status: res.status, ...data });
    }
    return data; // { access_token, expires_in, refresh_token, refresh_token_expires_in }
  }

  /** Refresh an expired access token. */
  static async refreshToken({ clientId, clientSecret, refreshToken: token }) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw badGateway('LinkedIn token refresh', { status: res.status, ...data });
    }
    return data;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** OpenID profile of the authenticated member. */
  async getProfile() {
    const res = await fetch(USERINFO_URL, { headers: this.headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw badGateway('LinkedIn profile', { status: res.status, ...data });
    return data;
  }

  /** Publish a text post as the authenticated member. */
  async createPost({ text, visibility = 'PUBLIC' }) {
    const payload = {
      author: `urn:li:person:${this.channel.official.personId}`,
      commentary: text,
      visibility: visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    };
    let res = await fetch(POSTS_URL, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) });
    if (res.status === 404 || res.status === 403) {
      // Older apps only have the UGC endpoint.
      res = await fetch(UGC_POSTS_URL, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          author: payload.author,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text },
              shareMediaCategory: 'NONE',
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC' },
        }),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw badGateway('LinkedIn create post', { status: res.status, ...data });
    this.logger?.info('linkedin:official', 'post published', { id: data.id });
    return data;
  }

  /** Outreach features are NOT available on the official API. */
  outreachUnsupported() {
    throw badGateway(
      'LinkedIn outreach via official API',
      {
        hint: 'Convites, DMs e Easy Apply nao existem na API oficial do LinkedIn. Cadastre um canal por cookies de sessao (authMode "cookie") para esses modulos.',
      }
    );
  }
}
