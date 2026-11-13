/**
 * JobFinder — Express application factory.
 *
 * Serves:
 *   /api/*          REST API consumed by the React UI
 *   /               the built UI (src/ui/dist) when available
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

import { UI_DIST, REPO_ROOT } from './paths.mjs';
import { createApiRouter } from './routes/index.mjs';
import { authRoutes } from './routes/auth.mjs';
import { requireAuth } from './middleware/auth.mjs';

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.00';
  }
}

export function createApp({ store, logger, config, rateLimiter, dataDir }) {
  const app = express();
  app.disable('x-powered-by');

  app.locals.version = readPkgVersion();
  app.locals.dataDir = dataDir;
  app.locals.config = config;

  app.use(express.json({ limit: '4mb' }));

  // Request log (cheap, useful for the local UI activity feed).
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      logger.info('http', `${req.method} ${req.originalUrl}`);
    }
    next();
  });

  // Public auth routes (login/logout/session) — mounted before the guard.
  app.use('/api/auth', authRoutes({ store, logger, config }));

  // Everything else under /api requires an active local session.
  const api = createApiRouter({ store, logger, config, rateLimiter, dataDir });
  app.use('/api', requireAuth({ store, logger }), api);

  // Static UI (built by Vite). In dev, the Vite server proxies /api here.
  if (fs.existsSync(UI_DIST)) {
    app.use(express.static(UI_DIST, { index: false, maxAge: '1h' }));
    // SPA fallback: any other GET serves index.html.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(`${UI_DIST}/index.html`);
    });
  } else {
    app.get('/', (req, res) => {
      res
        .status(503)
        .type('text/plain')
        .send('JobFinder API is running, but the UI build is missing.\nRun "npm run build" (or "npm run dev" for the dev server).');
    });
  }

  // 404 for unknown API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` } });
  });

  // Central error handler.
  app.use((err, req, res, next) => {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const code = err?.code ?? 'internal_error';
    const message = status >= 500 && !err?.expose ? 'Internal server error' : err?.message ?? 'Unexpected error';
    logger.error('http', 'request failed', { status, message: err?.message, url: req.originalUrl });
    res.status(status).json({
      error: { code, message, ...(err?.details ? { details: err.details } : {}) },
    });
  });

  return app;
}
