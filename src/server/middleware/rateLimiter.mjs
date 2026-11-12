/**
 * JobFinder — central rate limiter.
 *
 * EVERY LinkedIn action must pass through here. The limiter enforces:
 *  - human-like random delays (minDelayMs..maxDelayMs) between actions;
 *  - a minimum interval per action key (e.g. invitations, dms, applications);
 *  - quota checks per period (daily / weekly) based on config.json limits.
 *
 * Limits are configurable via config.json (`limits` section).
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class RateLimiter {
  /**
   * @param {object} [options]
   * @param {object} [options.config] current config.json contents
   * @param {import('../storage/logger.mjs').Logger} [options.logger]
   */
  constructor({ config = {}, logger } = {}) {
    this.lastRun = new Map(); // key -> timestamp of last action start
    this.config = config;
    this.logger = logger;
  }

  /** Refresh limits after a config change. */
  setConfig(config) {
    this.config = config;
  }

  get limits() {
    return this.config?.limits ?? {};
  }

  /** Human-like random delay between actions. */
  async humanDelay() {
    const { minDelayMs = 1000, maxDelayMs = 4000 } = this.limits;
    const ms = randomBetween(Number(minDelayMs) || 1000, Number(maxDelayMs) || 4000);
    this.logger?.info('rate-limiter', 'human delay', { ms });
    await sleep(ms);
  }

  /**
   * Wait until `key` may run again, then apply the human delay.
   * @param {string} key action key (e.g. 'invitation', 'dm', 'application')
   * @param {number} [minIntervalMs] minimum spacing between two actions
   */
  async gate(key, minIntervalMs = 1500) {
    const last = this.lastRun.get(key) ?? 0;
    const wait = minIntervalMs - (Date.now() - last);
    if (wait > 0) {
      this.logger?.info('rate-limiter', 'throttling action', { key, waitMs: wait });
      await sleep(wait);
    }
    await this.humanDelay();
    this.lastRun.set(key, Date.now());
  }

  /**
   * Execute `fn` through the limiter (throttle + human delay).
   * @param {string} key action key
   * @param {Function} fn action to execute
   * @param {number} [minIntervalMs] minimum spacing between actions
   */
  async run(key, fn, minIntervalMs = 1500) {
    await this.gate(key, minIntervalMs);
    return fn();
  }
}

/** How many items of `file` have their date field today. */
export function countToday(store, file, dateField = 'sentAt') {
  const today = new Date().toISOString().slice(0, 10);
  return store.list(file).filter((item) => (item[dateField] ?? '').startsWith(today)).length;
}

/** How many invitations were sent since Monday 00:00 of the current week. */
export function countThisWeek(store, file, dateField = 'sentAt') {
  const now = new Date();
  const isoDay = now.getUTCDay() || 7; // 1 = Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (isoDay - 1)));
  return store
    .list(file)
    .filter((item) => new Date(item[dateField] ?? 0).getTime() >= monday.getTime()).length;
}
