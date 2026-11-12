/**
 * JobFinder — background workers.
 *
 * One internal cron drives every time-based feature (§5.1.2, §5.2.2):
 *   every minute        -> publish due scheduled posts, run the DM cascade engine
 *   every 10 minutes    -> inbox monitoring (pause cascades when a contact replies)
 *
 * No external scheduler dependency (no node-cron): a plain unref'd interval
 * loop is enough for a single-user local app.
 */
import { tick as postsTick } from './posting/scheduler.mjs';
import { cascadeTick, checkReplies } from './outreach/cascades.mjs';

const INTERVAL_MS = 60 * 1000; // one minute
const REPLIES_EVERY = 10; // inbox monitoring every 10 minutes

export function startWorkers(ctx) {
  const { logger } = ctx;
  let runs = 0;
  const timer = setInterval(() => {
    runs += 1;
    postsTick(ctx).catch((err) => logger.error('workers', 'posts tick failed', { message: err.message }));
    cascadeTick(ctx).catch((err) => logger.error('workers', 'cascade tick failed', { message: err.message }));
    if (runs % REPLIES_EVERY === 0) {
      checkReplies(ctx).catch((err) => logger.error('workers', 'reply check failed', { message: err.message }));
    }
  }, INTERVAL_MS);
  timer.unref();
  logger.info('workers', 'background workers started', { intervalMs: INTERVAL_MS });
  return {
    stop() {
      clearInterval(timer);
      logger.info('workers', 'background workers stopped');
    },
  };
}
