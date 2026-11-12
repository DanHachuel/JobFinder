/**
 * JobFinder — networking/outreach routes (§5.2.1).
 *
 *   POST /api/connections/search       { keyword } -> profiles to select
 *   POST /api/connections/invitations  { profiles, message } -> send invites
 *   GET  /api/connections              history (status filter, pagination)
 *   GET  /api/connections/limits       weekly quota (X de 100)
 */
import { Router } from 'express';

import { asyncRoute } from '../middleware/errors.mjs';
import { searchProfiles, sendInvitations, invitationsQuota } from '../services/outreach/invitations.mjs';

export function outreachRoutes(ctx) {
  const { store, logger, config, rateLimiter } = ctx;
  const router = Router();

  router.post(
    '/connections/search',
    asyncRoute(async (req, res) => {
      const { keyword } = req.body ?? {};
      const { profiles, mode } = await searchProfiles(ctx, keyword, { count: 25 });
      logger.info('outreach', 'profiles search requested', { keyword, found: profiles.length, mode });
      res.json({ profiles, mode, simulated: profiles.some((p) => p.simulated) });
    })
  );

  router.post(
    '/connections/invitations',
    asyncRoute(async (req, res) => {
      const outcome = await sendInvitations(ctx, req.body ?? {});
      res.json(outcome);
    })
  );

  router.get(
    '/connections',
    asyncRoute((req, res) => {
      const { status, source } = req.query;
      const where = (conn) => {
        if (status && conn.status !== status) return false;
        if (source && conn.source !== source) return false;
        return true;
      };
      res.json(
        store.query('connections.json', {
          where,
          sort: 'sentAt',
          order: 'desc',
          page: Number(req.query.page) || 1,
          limit: Number(req.query.limit) || 20,
        })
      );
    })
  );

  router.get(
    '/connections/limits',
    asyncRoute((req, res) => {
      res.json({ invitations: invitationsQuota(store, config) });
    })
  );

  return router;
}
