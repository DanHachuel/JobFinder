/**
 * JobFinder — DM cascades (§5.2.2).
 *
 * Sequences of up to 5 messages/day (hard limit) with configurable
 * interval (default 30 min) and per-step day delays. Replies pause the
 * cascade automatically (optional). Manual approval gate per message.
 * Runs inside the internal scheduler; a manual tick route exists for tests.
 *
 * Ported from EduMMorenolp/linkedin-messaging-bot (batch sending,
 * MySQL -> JSON), prabaljainn/Linkedin-Messaging-Bot (list-driven sends)
 * and davidobbs/linkedin-automation-system (inbox monitoring).
 */
import { HttpError } from '../../middleware/errors.mjs';
import { countToday } from '../../middleware/rateLimiter.mjs';
import { createLinkedInClient } from '../linkedin/index.mjs';

export const MAX_STEPS = 5; // hard limit from the PRD (dmsPorDia)

/** Daily DM state for the UI ("X de 5 mensagens enviadas hoje"). */
export function dailyDmState(store, config) {
  const limit = Math.min(config?.limits?.dmsPerDay ?? 5, MAX_STEPS);
  const used = countDmsSentToday(store);
  return { used, limit, remaining: Math.max(limit - used, 0), percentage: limit ? Math.round((used / limit) * 100) : 0 };
}

/** Count steps sent today across all cascades. */
export function countDmsSentToday(store) {
  const today = new Date().toISOString().slice(0, 10);
  return store
    .list('dm-cascades.json')
    .flatMap((cascade) => cascade.steps ?? [])
    .filter((step) => (step.sentAt ?? '').startsWith(today)).length;
}

/** Create a cascade for one contact. */
export async function createCascade(ctx, input) {
  const { store, logger } = ctx;
  const { profile, sequence, approvalRequired = false } = input ?? {};
  if (!profile?.profileId) {
    throw new HttpError(400, 'bad_request', 'profile.profileId is required');
  }
  if (!Array.isArray(sequence) || sequence.length < 1) {
    throw new HttpError(400, 'bad_request', 'sequence must have at least one message');
  }
  if (sequence.length > MAX_STEPS) {
    throw new HttpError(400, 'bad_request', `sequence cannot exceed ${MAX_STEPS} messages (hard limit)`);
  }

  const steps = sequence.map((step, index) => {
    const raw = step?.delayDays;
    const delayDays = raw === undefined || raw === null ? (index === 0 ? 0 : 2) : Number(raw);
    return {
      stepIndex: index,
      text: String(step.text ?? '').slice(0, 8000),
      delayDays: Math.max(Number.isFinite(delayDays) ? delayDays : 0, 0),
      status: 'pending',
      sentAt: null,
      conversationId: step.conversationId ?? null,
      error: null,
    };
  });

  const cascade = await store.create(
    'dm-cascades.json',
    {
      profileId: profile.profileId,
      profileUrn: profile.profileUrn ?? null,
      contactName: `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || profile.profileId,
      status: 'active',
      steps,
      pendingApprovals: approvalRequired ? [0] : [],
      approvalRequired: Boolean(approvalRequired),
      nextStepAt: steps[0].delayDays > 0 ? addDays(new Date(), steps[0].delayDays).toISOString() : new Date().toISOString(),
      lastReplyAt: null,
      lastCheckedAt: null,
    },
    'casc'
  );
  logger.info('cascades', 'cascade created', { id: cascade.id, contact: cascade.contactName, steps: steps.length });
  return cascade;
}

/** Update flow controls: pause / resume / cancel. */
export async function setCascadeStatus(ctx, id, status) {
  const { store, logger } = ctx;
  const allowed = ['active', 'paused', 'waiting_reply', 'cancelled', 'completed'];
  if (!allowed.includes(status)) {
    throw new HttpError(400, 'bad_request', `status must be one of ${allowed.join(', ')}`);
  }
  const cascade = store.find('dm-cascades.json', id);
  if (!cascade) throw new HttpError(404, 'not_found', 'Cascade not found');
  const updated = await store.patch('dm-cascades.json', id, { status, updatedAt: new Date().toISOString() });
  logger.info('cascades', 'cascade status changed', { id, status });
  return updated;
}

/** Approve the next pending step (manual approval mode). */
export async function approveNextStep(ctx, id, stepIndex) {
  const { store, logger } = ctx;
  const cascade = store.find('dm-cascades.json', id);
  if (!cascade) throw new HttpError(404, 'not_found', 'Cascade not found');
  const target = stepIndex ?? cascade.pendingApprovals?.[0];
  const pending = cascade.pendingApprovals ?? [];
  if (target === undefined || !pending.includes(target)) {
    throw new HttpError(400, 'bad_request', 'No pending approval for this step');
  }
  const updated = await store.patch('dm-cascades.json', id, {
    pendingApprovals: pending.filter((idx) => idx !== target),
    nextStepAt: new Date().toISOString(),
  });
  logger.info('cascades', 'step approved', { id, stepIndex: target });
  return updated;
}

/**
 * Main engine pass: for every active cascade, send due messages.
 * Rules: max 5 messages/day (global), min interval between messages,
 * steps delayed by `delayDays`, replies pause (checked by checkReplies).
 */
export async function cascadeTick(ctx, now = new Date()) {
  const { store, logger, config, rateLimiter } = ctx;
  const cascades = store.list('dm-cascades.json').filter((c) => c.status === 'active');
  if (!cascades.length) return { processed: 0, sent: 0, skipped: 0, results: [] };

  const { client } = createLinkedInClient({ store, logger, config, rateLimiter });
  const daily = dailyDmState(store, config);
  const intervalMs = (config?.limits?.dmIntervalMinutes ?? 30) * 60 * 1000;
  let lastSentAt = lastGlobalSend(store);

  const results = [];
  let sent = 0;
  let skipped = 0;

  for (const cascade of cascades) {
    if (daily.used + sent >= daily.limit) {
      skipped += 1;
      results.push({ id: cascade.id, status: 'skipped', reason: `limite diario de ${daily.limit} DMs atingido` });
      continue;
    }
    if (lastSentAt && now.getTime() - lastSentAt.getTime() < intervalMs && sent > 0) {
      skipped += 1;
      results.push({ id: cascade.id, status: 'skipped', reason: 'intervalo minimo entre mensagens' });
      continue;
    }
    const nextStep = (cascade.steps ?? []).find((step) => step.status === 'pending');
    if (!nextStep) {
      await store.patch('dm-cascades.json', cascade.id, { status: 'completed' });
      results.push({ id: cascade.id, status: 'completed' });
      continue;
    }
    if (new Date(cascade.nextStepAt ?? 0).getTime() > now.getTime()) {
      skipped += 1;
      results.push({ id: cascade.id, status: 'skipped', reason: 'ainda nao chegou a hora da proxima mensagem' });
      continue;
    }
    if ((cascade.pendingApprovals ?? []).includes(nextStep.stepIndex)) {
      skipped += 1;
      results.push({ id: cascade.id, status: 'skipped', reason: 'aguardando aprovacao manual' });
      continue;
    }

    try {
      const result = await rateLimiter.run(
        'dm',
        () => client.sendMessage({ profileUrn: cascade.profileUrn, text: nextStep.text }),
        1500
      );
      sent += 1;
      lastSentAt = now;
      await store.update('dm-cascades.json', (cascades) =>
        cascades.map((c) => {
          if (c.id !== cascade.id) return c;
          const steps = c.steps.map((step) =>
            step.stepIndex === nextStep.stepIndex
              ? { ...step, status: 'sent', sentAt: now.toISOString(), conversationId: result?.conversationId ?? step.conversationId, error: null }
              : step
          );
          const following = steps.find((step) => step.status === 'pending');
          const finished = !following;
          return {
            ...c,
            steps,
            status: finished ? 'completed' : c.status,
            nextStepAt: following ? addDays(now, following.delayDays).toISOString() : null,
            lastMessageAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
        })
      );
      logger.info('cascades', `dm sent (${cascade.id})`, { step: nextStep.stepIndex, simulated: Boolean(result?.simulated) });
      results.push({ id: cascade.id, status: 'sent', step: nextStep.stepIndex, simulated: Boolean(result?.simulated) });
    } catch (err) {
      await store.update('dm-cascades.json', (cascades) =>
        cascades.map((c) =>
          c.id === cascade.id
            ? {
                ...c,
                steps: c.steps.map((step) =>
                  step.stepIndex === nextStep.stepIndex ? { ...step, status: 'failed', error: err.message } : step
                ),
                lastError: err.message,
              }
            : c
        )
      );
      logger.error('cascades', 'dm failed', { id: cascade.id, message: err.message });
      results.push({ id: cascade.id, status: 'failed', error: err.message });
    }
  }

  return { processed: cascades.length, sent, skipped, results };
}

/**
 * Check conversations for replies; pause cascades whose contact answered
 * (davidobbs inbox-monitoring logic). Returns the paused cascades.
 */
export async function checkReplies(ctx) {
  const { store, logger, config, rateLimiter } = ctx;
  const cascades = store.list('dm-cascades.json');
  const active = cascades.filter((c) => c.status === 'active' && config?.outreach?.pauseOnReply !== false);
  if (!active.length) return { paused: [], checked: 0 };

  const { client } = createLinkedInClient({ store, logger, config, rateLimiter });
  const paused = [];
  let conversations = [];
  try {
    conversations = await client.getConversations({ count: 50 });
  } catch (err) {
    logger.warn('cascades', 'reply check failed', { message: err.message });
    return { paused: [], checked: 0, error: err.message };
  }

  for (const cascade of active) {
    try {
      const conversation =
        conversations.find((conv) => conv.conversationId && cascade.steps?.some((s) => s.conversationId === conv.conversationId))
        ?? conversations.find((conv) => (conv.title ?? '').toLowerCase() === cascade.contactName.toLowerCase());
      if (!conversation?.conversationId) continue;
      const events = await client.getConversationEvents(conversation.conversationId);
      const sentAt = lastStepSentAt(cascade);
      const reply = events.find(
        (ev) => ev.createdAt && sentAt && new Date(ev.createdAt).getTime() > new Date(sentAt).getTime() && (ev.fromName === null || ev.fromName !== 'JobFinder')
      );
      if (reply) {
        await store.patch('dm-cascades.json', cascade.id, {
          status: 'waiting_reply',
          lastReplyAt: reply.createdAt,
          lastCheckedAt: new Date().toISOString(),
        });
        paused.push({ id: cascade.id, contactName: cascade.contactName, replyPreview: (reply.body ?? '').slice(0, 120) });
        logger.info('cascades', 'cascade paused (reply detected)', { id: cascade.id });
      } else {
        await store.patch('dm-cascades.json', cascade.id, { lastCheckedAt: new Date().toISOString() });
      }
    } catch (err) {
      logger.warn('cascades', 'reply check failed for cascade', { id: cascade.id, message: err.message });
    }
  }
  return { paused, checked: active.length };
}

/** Aggregate stats for the DM cascades page. */
export function cascadeStats(ctx) {
  const { store, config } = ctx;
  const cascades = store.list('dm-cascades.json');
  const byStatus = {};
  for (const cascade of cascades) byStatus[cascade.status] = (byStatus[cascade.status] ?? 0) + 1;
  return {
    total: cascades.length,
    byStatus,
    daily: dailyDmState(store, config),
    intervalMinutes: config?.limits?.dmIntervalMinutes ?? 30,
    maxPerDay: Math.min(config?.limits?.dmsPerDay ?? 5, MAX_STEPS),
  };
}

/* ------------------------------------------------------------------ */

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function lastGlobalSend(store) {
  const sent = store
    .list('dm-cascades.json')
    .flatMap((c) => c.steps ?? [])
    .filter((step) => step.sentAt)
    .map((step) => new Date(step.sentAt).getTime());
  return sent.length ? new Date(Math.max(...sent)) : null;
}

function lastStepSentAt(cascade) {
  const sent = (cascade.steps ?? []).filter((step) => step.sentAt).map((step) => new Date(step.sentAt).getTime());
  return sent.length ? new Date(Math.max(...sent)) : null;
}
