/**
 * JobFinder — worker pass (one automation cycle).
 *
 * The ticks that used to run on an internal interval inside the API process
 * now live in the standalone background worker (src/server/worker.mjs), so
 * scheduled posts and DM cascades keep running when the browser is closed.
 * This module holds the actual work of one pass and is shared by the worker
 * process and by the manual "tick now" route (used by tests).
 *
 *   posts + cascades   -> every pass
 *   inbox monitoring   -> every REPLIES_EVERY passes (pause on reply)
 *
 * No `setInterval` here on purpose: the loop belongs to the worker process
 * (windows-runtime-guard rule 5). Errors never escape: each engine reports
 * its own failures so one bad queue item cannot kill the worker.
 */
import { tick as postsTick } from './posting/scheduler.mjs';
import { cascadeTick, checkReplies } from './outreach/cascades.mjs';

/** Inbox monitoring runs every N passes. */
export const REPLIES_EVERY = 10;

/**
 * Queue files shared between the API process and the worker process.
 * Each process keeps its own JsonStore cache, so a pass must always read
 * the CURRENT disk state (the API/UI wrote those files in another process).
 * This invalidation is the documented "external writer" case, not a casual
 * cache drop (atomic-write-guard).
 */
const SHARED_QUEUE_FILES = ['posts.json', 'dm-cascades.json', 'connections.json'];

/**
 * Run one worker pass.
 * @param {object} ctx server context (store, logger, config, rateLimiter)
 * @param {{ pass?: number, now?: Date }} [options]
 * @returns {Promise<{ posts: object[], cascades: object, replies?: object }>}
 */
export async function runWorkerPass(ctx, options = {}) {
  const pass = Number(options.pass) || 1;
  const now = options.now instanceof Date ? options.now : new Date();

  for (const name of SHARED_QUEUE_FILES) ctx.store.invalidate(name);

  const posts = await safeTick(ctx, 'posts', () => postsTick(ctx, now));
  const cascades = await safeTick(ctx, 'cascades', () => cascadeTick(ctx, now));
  let replies = null;
  if (pass % REPLIES_EVERY === 0) {
    replies = await safeTick(ctx, 'replies', () => checkReplies(ctx));
  }
  return { posts, cascades, replies };
}

/** Run one engine, converting a throw into a logged, non-fatal result. */
async function safeTick(ctx, name, run) {
  try {
    return await run();
  } catch (err) {
    ctx.logger?.error('workers', `${name} tick failed`, { message: err?.message });
    return { error: err?.message ?? 'unknown error' };
  }
}