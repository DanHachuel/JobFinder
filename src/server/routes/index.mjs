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

export function createApiRouter(ctx) {
  const router = Router();

  router.use(healthRoutes(ctx));
  router.use(configRoutes(ctx));
  router.use(channelsRoutes(ctx));

  return router;
}
