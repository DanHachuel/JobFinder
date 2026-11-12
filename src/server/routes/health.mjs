/**
 * JobFinder — health/system routes.
 */
import { Router } from 'express';
import fs from 'node:fs';

import { asyncRoute } from '../middleware/errors.mjs';
import { UI_DIST } from '../paths.mjs';
import { isDataDirHealthy } from '../storage/bootstrap.mjs';

export function healthRoutes({ dataDir, logger }) {
  const router = Router();

  router.get(
    '/health',
    asyncRoute((req, res) => {
      res.json({
        ok: true,
        version: req.app.locals.version,
        dataDir,
        dryRun: req.app.locals.config.dryRun,
        uiBuilt: fs.existsSync(`${UI_DIST}/index.html`),
        storageHealthy: isDataDirHealthy(dataDir),
        uptimeSeconds: Math.round(process.uptime()),
        logDates: logger.dates().slice(0, 7),
      });
    })
  );

  router.get(
    '/logs',
    asyncRoute((req, res) => {
      const count = Math.min(Number(req.query.count) || 100, 500);
      res.json({ entries: logger.tail(count) });
    })
  );

  return router;
}
