/**
 * JobFinder — DM cascade routes (§5.2.2).
 *
 *   GET    /api/cascades               list with per-cascade progress
 *   POST   /api/cascades               create (sequence: up to 5 messages)
 *   DELETE /api/cascades/:id           remove
 *   POST   /api/cascades/:id/status    pause/resume/cancel
 *   POST   /api/cascades/:id/approve   approve a pending step
 *   GET    /api/cascades/stats         daily usage ("X de 5") + status counts
 *   POST   /api/cascades/tick          engine pass (also runs in the scheduler)
 *   POST   /api/cascades/check-replies inbox monitoring -> pauses on reply
 */
import { Router } from 'express';

import { asyncRoute } from '../middleware/errors.mjs';
import {
  createCascade,
  setCascadeStatus,
  approveNextStep,
  cascadeTick,
  checkReplies,
  cascadeStats,
  MAX_STEPS,
} from '../services/outreach/cascades.mjs';

export function dmsRoutes(ctx) {
  const { store, logger, config } = ctx;
  const router = Router();

  router.get(
    '/cascades',
    asyncRoute((req, res) => {
      const cascades = store.list('dm-cascades.json').map((cascade) => {
        const sent = (cascade.steps ?? []).filter((s) => s.status === 'sent').length;
        const pending = (cascade.steps ?? []).filter((s) => s.status === 'pending').length;
        return {
          ...cascade,
          progress: { sent, pending, total: (cascade.steps ?? []).length, percent: Math.round((sent / (cascade.steps ?? []).length) * 100) },
        };
      });
      res.json({ cascades, maxSteps: MAX_STEPS });
    })
  );

  router.post(
    '/cascades',
    asyncRoute(async (req, res) => {
      const cascade = await createCascade(ctx, {
        profile: {
          profileId: req.body?.profileId,
          profileUrn: req.body?.profileUrn,
          firstName: req.body?.contactName?.split(' ')[0] ?? null,
          lastName: req.body?.contactName?.split(' ').slice(1).join(' ') ?? null,
        },
        sequence: req.body?.sequence ?? req.body?.steps,
        approvalRequired: req.body?.approvalRequired,
      });
      res.status(201).json({ cascade });
    })
  );

  router.delete(
    '/cascades/:id',
    asyncRoute(async (req, res) => {
      const removed = await store.remove('dm-cascades.json', req.params.id);
      if (!removed) return res.status(404).json({ error: { code: 'not_found', message: 'Cascade not found' } });
      res.json({ ok: true });
    })
  );

  router.post(
    '/cascades/:id/status',
    asyncRoute(async (req, res) => {
      const cascade = await setCascadeStatus(ctx, req.params.id, req.body?.status);
      res.json({ cascade });
    })
  );

  router.post(
    '/cascades/:id/approve',
    asyncRoute(async (req, res) => {
      const cascade = await approveNextStep(ctx, req.params.id, req.body?.stepIndex);
      res.json({ cascade });
    })
  );

  router.get(
    '/cascades/stats',
    asyncRoute((req, res) => {
      res.json(cascadeStats(ctx));
    })
  );

  router.post(
    '/cascades/tick',
    asyncRoute(async (req, res) => {
      const result = await cascadeTick(ctx);
      res.json(result);
    })
  );

  router.post(
    '/cascades/check-replies',
    asyncRoute(async (req, res) => {
      const result = await checkReplies(ctx);
      res.json(result);
    })
  );

  return router;
}
