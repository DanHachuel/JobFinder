/**
 * JobFinder — connection invitations (§5.2.1).
 *
 * Search by keyword -> select profiles -> send invitations with a
 * personalized message ({{nome}}/{{empresa}}/{{cargo}}). The weekly
 * limit (default 100, configurable) is enforced here, and every action
 * passes through the central rate limiter before reaching LinkedIn.
 *
 * Ported from Isaac-Foster/linkedin_bot (invites + weekly limit) and
 * Gurukishore-G/Linkedin-Automation ({{name}} personalization).
 */
import { HttpError } from '../../middleware/errors.mjs';
import { countThisWeek } from '../../middleware/rateLimiter.mjs';
import { renderTemplate, sanitizeInvitationMessage } from './templates.mjs';
import { createLinkedInClient } from '../linkedin/index.mjs';

/** Weekly quota state for the UI (Goal Gradient: "X de 100"). */
export function invitationsQuota(store, config) {
  const limit = config?.limits?.invitationsPerWeek ?? 100;
  const used = countThisWeek(store, 'connections.json', 'sentAt');
  return { used, limit, remaining: Math.max(limit - used, 0), percentage: limit ? Math.round((used / limit) * 100) : 0 };
}

/** People search through the active client (dry-run when not connected). */
export async function searchProfiles(ctx, keyword, options) {
  const { store, logger, config, rateLimiter } = ctx;
  const { client, mode } = createLinkedInClient({ store, logger, config, rateLimiter });
  if (!keyword || !String(keyword).trim()) {
    throw new HttpError(400, 'bad_request', 'keyword is required');
  }
  const profiles = await client.searchPeople(String(keyword).trim(), options);
  return { profiles, mode };
}

/**
 * Send invitations to the given profiles.
 * @param {object} ctx server context
 * @param {object} input { profiles: [{profileId, profileUrn, firstName, lastName, headline}], message }
 */
export async function sendInvitations(ctx, input) {
  const { store, logger, config, rateLimiter } = ctx;
  const { profiles = [], message } = input ?? {};
  if (!profiles.length) {
    throw new HttpError(400, 'bad_request', 'profiles is required (at least one)');
  }
  if (!message || !String(message).trim()) {
    throw new HttpError(400, 'bad_request', 'message is required');
  }

  const quota = invitationsQuota(store, config);
  const { client, mode } = createLinkedInClient({ store, logger, config, rateLimiter });

  const results = [];
  let sentCount = 0;
  for (const profile of profiles) {
    const rendered = renderTemplate(message, profile);
    const sanitized = sanitizeInvitationMessage(rendered);
    if (sanitized.truncated) {
      logger.warn('outreach', 'invitation message truncated to 300 chars', { profileId: profile.profileId });
    }
    const fullName = `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim();

    if (quota.used + sentCount >= quota.limit) {
      await store.create(
        'connections.json',
        connectionRecord(profile, sanitized.text, mode, {
          status: 'blocked',
          error: `Limite semanal de convites atingido (${quota.limit}).`,
        })
      );
      results.push({ profileId: profile.profileId ?? null, name: fullName, status: 'blocked', error: 'weekly limit reached' });
      continue;
    }

    try {
      // Every LinkedIn action passes through the central rate limiter.
      const result = await rateLimiter.run(
        'invitation',
        () => client.sendInvitation({ profileUrn: profile.profileUrn, profileId: profile.profileId, message: sanitized.text }),
        2500
      );
      sentCount += 1;
      await store.create(
        'connections.json',
        connectionRecord(profile, sanitized.text, mode, { status: 'sent', simulated: Boolean(result?.simulated) })
      );
      logger.info('outreach', `invitation sent (${mode})`, { profileId: profile.profileId, simulated: Boolean(result?.simulated) });
      results.push({ profileId: profile.profileId ?? null, name: fullName, status: 'sent', simulated: Boolean(result?.simulated) });
    } catch (err) {
      const error = err?.message ?? 'unknown error';
      await store.create(
        'connections.json',
        connectionRecord(profile, sanitized.text, mode, { status: 'failed', error })
      );
      logger.error('outreach', 'invitation failed', { profileId: profile.profileId, message: error });
      results.push({ profileId: profile.profileId ?? null, name: fullName, status: 'failed', error });
    }
  }

  return { results, quota: invitationsQuota(store, config), mode };
}

/** Shape of one connections.json record. */
function connectionRecord(profile, message, mode, extra) {
  return {
    profileUrn: profile.profileUrn ?? null,
    profileId: profile.profileId ?? null,
    name: `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim(),
    headline: profile.headline ?? null,
    message,
    source: 'invitation',
    sentAt: new Date().toISOString(),
    simulated: false,
    authMode: mode,
    error: null,
    ...extra,
  };
}
