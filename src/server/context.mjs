/**
 * JobFinder — server context.
 *
 * Builds the singletons shared by every route and service from the
 * resolved data directory: the JSON store, the logger, the rate limiter
 * and the current configuration.
 */
import { JsonStore } from './storage/jsonStore.mjs';
import { Logger } from './storage/logger.mjs';
import { RateLimiter } from './middleware/rateLimiter.mjs';
import { AuthStore } from './storage/authStore.mjs';
import { ensureDataDir } from './storage/bootstrap.mjs';

export function createContext(dataDir) {
  ensureDataDir(dataDir);
  const store = new JsonStore(dataDir);
  const logger = new Logger(dataDir);
  const config = store.read('config.json', {});
  const rateLimiter = new RateLimiter({ config, logger });
  const auth = new AuthStore(store);
  auth.ensure();
  return { dataDir, store, logger, config, rateLimiter, auth };
}
