/**
 * JobFinder — API router aggregator.
 *
 * Mounts every module router under /api. New modules are added here as
 * the etapas progress (topics/posts -> etapa 4, connections/dms, jobs...).
 */
import { Router } from 'express';

import { healthRoutes } from './health.mjs';
import { configRoutes } from './config.mjs';
import { channelsRoutes } from './channels.mjs';
import { topicsRoutes } from './topics.mjs';
import { postsRoutes } from './posts.mjs';
import { outreachRoutes } from './outreach.mjs';
import { dmsRoutes } from './dms.mjs';
import { jobsRoutes } from './jobs.mjs';
import { applicationsRoutes } from './applications.mjs';
import { dashboardRoutes } from './dashboard.mjs';

export function createApiRouter(ctx) {
  const router = Router();

  router.use(healthRoutes(ctx));
  router.use(configRoutes(ctx));
  router.use(channelsRoutes(ctx));
  router.use(topicsRoutes(ctx));
  router.use(postsRoutes(ctx));
  router.use(outreachRoutes(ctx));
  router.use(dmsRoutes(ctx));
  router.use(jobsRoutes(ctx));
  router.use(applicationsRoutes(ctx));
  router.use(dashboardRoutes(ctx));

  return router;
}
