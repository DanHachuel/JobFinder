/**
 * JobFinder — internal cron (scheduler).
 *
 * Replaces node-cron with a small interval loop: every minute it looks
 * for posts with status "scheduled" and scheduledAt <= now and publishes
 * them through the publisher (which itself respects dry-run).
 */
import { publishPost } from './publisher.mjs';

const INTERVAL_MS = 60 * 1000; // check every minute

/** One scheduler pass: publish everything that is due. */
export async function tick(ctx, now = new Date()) {
  const { store, logger } = ctx;
  const due = store
    .list('posts.json')
    .filter((post) => post.status === 'scheduled' && new Date(post.scheduledAt ?? 0).getTime() <= now.getTime());
  const results = [];
  for (const post of due) {
    logger.info('scheduler', 'publishing due post', { postId: post.id, scheduledAt: post.scheduledAt });
    // eslint-disable-next-line no-await-in-loop -- sequential keeps the rate limiter effective
    const outcome = await publishPost(ctx, post.id);
    results.push({ id: post.id, status: outcome.post?.status, error: outcome.error?.message ?? null });
  }
  if (due.length) {
    logger.info('scheduler', 'tick complete', { published: results.filter((r) => r.status === 'published').length });
  }
  return results;
}

/** Start the background loop. Returns a handle with stop(). */
export function startScheduler(ctx) {
  const { logger } = ctx;
  const timer = setInterval(() => {
    tick(ctx).catch((err) => logger.error('scheduler', 'tick failed', { message: err.message }));
  }, INTERVAL_MS);
  timer.unref();
  logger.info('scheduler', 'scheduler started', { intervalMs: INTERVAL_MS });
  return {
    stop() {
      clearInterval(timer);
      logger.info('scheduler', 'scheduler stopped');
    },
  };
}
