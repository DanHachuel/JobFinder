/**
 * JobFinder — LinkedIn channels (auth) routes.
 *
 *   GET    /api/channels                 list channels (redacted)
 *   POST   /api/channels/official        register official API credentials
 *   POST   /api/channels/oauth/start     begin the OAuth 2.0 flow (returns URL)
 *   GET    /api/channels/oauth/callback  OAuth callback (exchanges the code)
 *   POST   /api/channels/cookies         upload cookies.txt (raw body, text/plain)
 *   POST   /api/channels/:id/activate    make a channel the active one
 *   DELETE /api/channels/:id             remove a channel
 *   GET    /api/linkedin/status          current auth mode + profile
 *   POST   /api/linkedin/test            re-test the active channel
 */
import express, { Router } from 'express';

import { asyncRoute, badRequest, notFound, conflict } from '../middleware/errors.mjs';
import { newId } from '../storage/jsonStore.mjs';
import { parseCookiesText, looksLikeLinkedinSession } from '../services/linkedin/cookies.mjs';
import { LinkedInOfficialClient } from '../services/linkedin/officialApi.mjs';
import { VoyagerClient } from '../services/linkedin/voyagerClient.mjs';
import {
  createLinkedInClient,
  getActiveChannel,
  buildChannel,
  redactChannel,
} from '../services/linkedin/index.mjs';

/** In-memory OAuth state (single local process, short-lived). */
const oauthStates = new Map();

export function channelsRoutes({ store, logger, config, rateLimiter }) {
  const router = Router();

  router.get(
    '/channels',
    asyncRoute((req, res) => {
      const channels = store.list('channels.json');
      const active = getActiveChannel(store);
      res.json({
        channels: channels.map((c) => redactChannel(c)),
        activeId: active?.id ?? null,
      });
    })
  );

  router.get(
    '/linkedin/status',
    asyncRoute(async (req, res) => {
      const { client, mode, channel } = createLinkedInClient({ store, logger, config, rateLimiter });
      let profile = channel?.profile ?? null;
      if (channel && !profile && mode !== 'dry-run') {
        try {
          profile = await client.getProfile();
        } catch {
          profile = null;
        }
      }
      res.json({
        mode,
        connected: Boolean(channel) && mode !== 'dry-run',
        dryRun: config.dryRun !== false,
        dryRunReason: mode === 'dry-run' ? (config.dryRun !== false && channel ? 'global-dry-run' : 'no-channel') : null,
        channel: redactChannel(channel),
        profile,
        officialApiUrl: 'https://www.linkedin.com/help/linkedin/answer/a526048/acesso-as-apis-do-linkedin?lang=pt',
      });
    })
  );

  router.post(
    '/linkedin/test',
    asyncRoute(async (req, res) => {
      const { client, mode } = createLinkedInClient({ store, logger, config, rateLimiter });
      const result = await client.testAuth();
      const channel = getActiveChannel(store);
      if (channel) {
        store.patch('channels.json', channel.id, {
          lastError: result.ok ? null : result.message ?? 'auth test failed',
          lastUsedAt: new Date().toISOString(),
        });
      }
      logger[result.ok ? 'info' : 'warn']('linkedin:auth', 'auth test', { mode, ok: result.ok });
      res.json({ ...result, mode });
    })
  );

  router.post(
    '/channels/official',
    asyncRoute(async (req, res) => {
      const { label, clientId, clientSecret, redirectUri } = req.body ?? {};
      if (!clientId || !clientSecret) {
        throw badRequest('clientId and clientSecret are required');
      }
      const id = newId('chan');
      const channel = buildChannel({
        id,
        label: label || 'LinkedIn (API oficial)',
        authMode: 'official',
        extra: { official: { clientId, clientSecret, redirectUri: redirectUri ?? config.linkedin?.officialRedirectUri } },
      });
      await store.create('channels.json', channel, 'chan');
      store.update('config.json', (current) => ({
        ...current,
        linkedin: { ...current.linkedin, authMode: 'official', officialClientId: clientId, officialClientSecret: clientSecret },
      }));
      logger.info('linkedin:official', 'channel registered', { id });
      res.status(201).json({ channel: redactChannel(store.find('channels.json', id)) });
    })
  );

  router.post(
    '/channels/oauth/start',
    asyncRoute((req, res) => {
      const { channelId, redirectUri } = req.body ?? {};
      let channel = channelId ? store.find('channels.json', channelId) : getActiveChannel(store);
      let creds = channel?.official ?? {};
      if (!creds.clientId && !creds.clientSecret) {
        creds = {
          clientId: config.linkedin?.officialClientId,
          clientSecret: config.linkedin?.officialClientSecret,
        };
      }
      if (!creds.clientId || !creds.clientSecret) {
        throw badRequest(
          'Credenciais oficiais ausentes. Cadastre o canal com POST /api/channels/official (clientId + clientSecret) ou configure-as na tela de Integracoes.'
        );
      }
      const state = newId('oauth');
      const uri = redirectUri ?? creds.redirectUri ?? config.linkedin?.officialRedirectUri ?? 'http://127.0.0.1:4040/api/channels/oauth/callback';
      oauthStates.set(state, { channelId: channel?.id ?? null, redirectUri: uri, createdAt: Date.now() });
      const url = LinkedInOfficialClient.authorizationUrl({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: uri,
        state,
      });
      logger.info('linkedin:oauth', 'authorization URL generated', { channelId: channel?.id ?? null });
      res.json({ url, state, redirectUri: uri });
    })
  );

  router.get(
    '/channels/oauth/callback',
    asyncRoute(async (req, res) => {
      const { code, state, error } = req.query;
      if (error) {
        logger.warn('linkedin:oauth', 'authorization failed', { error: String(error) });
        return res.redirect(`/integracoes?linkedin=error&reason=${encodeURIComponent(String(error))}`);
      }
      const pending = oauthStates.get(String(state));
      if (!code || !pending) {
        throw badRequest('Invalid OAuth callback (state or code missing)');
      }
      oauthStates.delete(String(state));

      let channel = pending.channelId ? store.find('channels.json', pending.channelId) : null;
      let creds = channel?.official ?? config.linkedin ?? {};
      if (!creds.clientId) {
        throw conflict('No official channel found for this OAuth state');
      }

      const token = await LinkedInOfficialClient.exchangeCode({
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        code: String(code),
        redirectUri: pending.redirectUri,
      });

      if (!channel) {
        channel = buildChannel({
          id: newId('chan'),
          label: 'LinkedIn (API oficial)',
          authMode: 'official',
          extra: { official: { clientId: creds.clientId, clientSecret: creds.clientSecret } },
        });
        await store.create('channels.json', channel, 'chan');
      }
      const saved = store.find('channels.json', channel.id);
      const official = {
        ...saved.official,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? saved.official.refreshToken,
        expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
        redirectUri: pending.redirectUri,
      };

      // Fetch the member profile to record who is connected.
      const officialClient = new LinkedInOfficialClient({ official, cookies: [] }, logger);
      let personId = '';
      let profileName = '';
      let profile = null;
      try {
        const profileInfo = await officialClient.getProfile();
        personId = profileInfo.sub ?? '';
        profileName = profileInfo.name ?? '';
        profile = { id: profileInfo.sub ?? null, name: profileInfo.name ?? null, picture: profileInfo.picture ?? null };
      } catch (err) {
        logger.warn('linkedin:oauth', 'profile fetch failed', { message: err.message });
      }
      official.personId = personId;
      official.profileName = profileName;

      await store.update('channels.json', (channels) =>
        channels.map((c) => (c.id === saved.id ? { ...c, status: 'active', official, profile, lastError: null } : { ...c, status: 'inactive' }))
      );
      logger.info('linkedin:oauth', 'channel activated', { id: saved.id, profileName });
      res.redirect(`/integracoes?linkedin=connected&channel=${encodeURIComponent(saved.id)}`);
    })
  );

  // Raw body: cookies.txt exported as text/plain (or octet-stream).
  router.post(
    '/channels/cookies',
    express.raw({ type: () => true, limit: '2mb' }),
    asyncRoute(async (req, res) => {
      const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
      const label = String(req.query.label ?? '') || 'LinkedIn (cookies)';
      if (!text.trim()) throw badRequest('Empty body: send the cookies.txt content as text/plain (raw body)');

      const cookies = parseCookiesText(text);
      if (!cookies.length) {
        throw badRequest('Nenhum cookie reconhecido. Exporte com a extensao "Get cookies.txt LOCALLY" no formato cookies.txt.');
      }
      if (!looksLikeLinkedinSession(cookies)) {
        throw badRequest('Cookies incompletos: sao obrigatorios li_at e JSESSIONID de www.linkedin.com.');
      }

      const id = newId('chan');
      const channel = buildChannel({ id, label, authMode: 'cookie', extra: { cookies } });
      // Test the session before marking active.
      const tester = new VoyagerClient({ ...channel, cookies }, logger, rateLimiter);
      let profile = null;
      let status = 'untested';
      let lastError = null;
      try {
        const me = await tester.getProfile();
        if (me && (me.firstName || me.lastName || me.id)) {
          status = 'active';
          profile = me;
        }
      } catch (err) {
        lastError = err.message;
        logger.warn('linkedin:cookies', 'session test failed', { message: err.message });
      }
      const finalChannel = { ...channel, status, profile, lastError };
      await store.update('channels.json', (channels) =>
        status === 'active'
          ? [...channels.map((c) => ({ ...c, status: 'inactive' })), finalChannel]
          : [...channels, finalChannel]
      );
      logger.info('linkedin:cookies', 'channel saved', { id, status });
      res.status(201).json({
        channel: redactChannel(finalChannel),
        test: status === 'active' ? { ok: true, profile } : { ok: false, message: lastError },
      });
    })
  );

  router.post(
    '/channels/:id/activate',
    asyncRoute(async (req, res) => {
      const channel = store.find('channels.json', req.params.id);
      if (!channel) throw notFound('Channel');
      await store.update('channels.json', (channels) =>
        channels.map((c) => ({ ...c, status: c.id === channel.id ? 'active' : 'inactive' }))
      );
      logger.info('linkedin:channels', 'channel activated', { id: channel.id });
      res.json({ channel: redactChannel(store.find('channels.json', channel.id)) });
    })
  );

  router.delete(
    '/channels/:id',
    asyncRoute(async (req, res) => {
      const removed = await store.remove('channels.json', req.params.id);
      if (!removed) throw notFound('Channel');
      logger.info('linkedin:channels', 'channel removed', { id: req.params.id });
      res.json({ ok: true });
    })
  );

  return router;
}
