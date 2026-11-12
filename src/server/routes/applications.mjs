/**
 * JobFinder — applications routes (§5.3.3).
 *
 *   GET  /api/applications        history (status filter, pagination)
 *   GET  /api/applications/limits daily quota ("X de 20")
 *   POST /api/applications        { job, dryRun? } -> apply (dry-run by default)
 *   POST /api/applications/:id/retry re-run a failed/needs-intervention one
 */
import { Router } from 'express';

import { asyncRoute, notFound } from '../middleware/errors.mjs';
import { applyToJob, applicationsQuota } from '../services/jobs/easyApply.mjs';

export function applicationsRoutes(ctx) {
  const { store, logger } = ctx;
  const router = Router();

  router.get(
    '/applications',
    asyncRoute((req, res) => {
      const { status } = req.query;
      const where = (app) => (status ? app.status === status : true);
      res.json(
        store.query('applications.json', {
          where,
          sort: 'appliedAt',
          order: 'desc',
          page: Number(req.query.page) || 1,
          limit: Number(req.query.limit) || 20,
        })
      );
    })
  );

  router.get(
    '/applications/limits',
    asyncRoute((req, res) => {
      res.json({ applications: applicationsQuota(store, ctx.config) });
    })
  );

  router.post(
    '/applications',
    asyncRoute(async (req, res) => {
      const outcome = await applyToJob(ctx, { job: req.body?.job, dryRun: req.body?.dryRun });
      res.status(201).json(outcome);
    })
  );

  router.post(
    '/applications/:id/retry',
    asyncRoute(async (req, res) => {
      const app = store.find('applications.json', req.params.id);
      if (!app) throw notFound('Application');
      const outcome = await applyToJob(ctx, {
        job: { jobId: app.jobId, title: app.jobTitle, company: app.company, url: app.url, matchScore: app.matchScore },
        dryRun: req.body?.dryRun ?? false,
      });
      res.status(201).json(outcome);
    })
  );

  return router;
}
