/**
 * JobFinder — configuration routes.
 *
 * GET  /api/config   -> current config (secrets redacted)
 * PUT  /api/config   -> partial merge into config.json
 */
import { Router } from 'express';

import { asyncRoute, badRequest } from '../middleware/errors.mjs';

/** Hide secrets before sending anything to the browser. */
function redactConfig(config) {
  return {
    ...config,
    llm: {
      ...config.llm,
      apiKey: config.llm?.apiKey ? '***' : '',
    },
    linkedin: {
      ...config.linkedin,
      officialClientId: config.linkedin?.officialClientId ? '***' : '',
      officialClientSecret: config.linkedin?.officialClientSecret ? '***' : '',
    },
  };
}

export function configRoutes({ store, logger, rateLimiter }) {
  const router = Router();

  router.get(
    '/config',
    asyncRoute((req, res) => {
      const config = store.read('config.json', {});
      res.json({ config: redactConfig(config), dataDir: req.app.locals.dataDir });
    })
  );

  router.put(
    '/config',
    asyncRoute(async (req, res) => {
      const patch = req.body?.config ?? req.body;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw badRequest('Body must be a JSON object with the fields to update');
      }
      if (patch.port !== undefined && (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535)) {
        throw badRequest('port must be an integer between 1 and 65535');
      }
      if (patch.limits) {
        for (const key of ['invitationsPerWeek', 'dmsPerDay', 'applicationsPerDay', 'dmIntervalMinutes']) {
          const value = patch.limits[key];
          if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
            throw badRequest(`limits.${key} must be a non-negative integer`);
          }
        }
      }
      if (patch.llm && patch.llm.provider) {
        const allowed = ['openai', 'anthropic', 'deepseek', 'ollama'];
        if (!allowed.includes(patch.llm.provider)) {
          throw badRequest(`llm.provider must be one of ${allowed.join(', ')}`);
        }
      }
      if (patch.linkedin && patch.linkedin.authMode) {
        const allowed = ['official', 'cookie'];
        if (!allowed.includes(patch.linkedin.authMode)) {
          throw badRequest(`linkedin.authMode must be one of ${allowed.join(', ')}`);
        }
      }

      await store.update('config.json', (current) => ({ ...current, ...deepMerge(current, patch) }));
      const updated = store.read('config.json', {});
      rateLimiter.setConfig(updated);
      req.app.locals.config = updated;
      logger.info('config', 'configuration updated', { keys: Object.keys(patch) });
      res.json({ config: redactConfig(updated) });
    })
  );

  return router;
}

/** Shallow merge for nested objects (llm, linkedin, limits, outreach). */
function deepMerge(current, patch) {
  const out = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && current[key] && typeof current[key] === 'object') {
      out[key] = { ...current[key], ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}
