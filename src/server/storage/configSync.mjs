/**
 * JobFinder — live config synchronization.
 *
 * The server context keeps ONE config object (ctx.config) that every
 * service reads at request time (posting, outreach, jobs, LinkedIn
 * facade). The JSON store, however, replaces the cached object on every
 * write — so without this helper a `PUT /api/config` would leave the
 * services looking at a stale snapshot (e.g. toggling dry-run would not
 * change the runtime behavior until a restart).
 *
 * `syncLiveConfig` copies the freshly persisted values into the live
 * object, keeping every reference in sync.
 */

/** Read config.json from the store. */
export function readLiveConfig(store, fallback = {}) {
  return store.read('config.json', fallback);
}

/**
 * Merge the persisted config into the live context object in place.
 *
 * The cache is invalidated first: in the worker process the API is an
 * external writer (the user toggled dry-run in the UI), so a cached read
 * would keep the worker on a stale dry-run value until a restart. This is
 * the documented "external writer" case of atomic-write-guard.
 *
 * @returns the fresh config object
 */
export function syncLiveConfig(store, liveConfig) {
  store.invalidate('config.json');
  const latest = readLiveConfig(store, {});
  if (liveConfig && typeof liveConfig === 'object') {
    Object.assign(liveConfig, latest);
  }
  return latest;
}
