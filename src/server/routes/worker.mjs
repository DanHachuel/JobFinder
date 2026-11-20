/**
 * JobFinder — worker control routes (protected by the session guard).
 *
 *   GET  /api/worker/status   live status + last actions (polled by the UI)
 *   POST /api/worker/start    resume (and spawn the worker when it is dead)
 *   POST /api/worker/stop     pause (the process stays alive, idles)
 *   POST /api/worker/tick     force one pass now (tests / manual control)
 *
 * The worker is a separate process: the API only reads worker-state.json and
 * writes worker-control.json (see storage/workerState.mjs), so the UI can
 * observe and steer it without owning it.
 */
import { Router } from 'express';

import { asyncRoute } from '../middleware/errors.mjs';
import { runWorkerPass } from '../services/workers.mjs';
import { spawnWorker } from '../workerRuntime.mjs';
import {
  readWorkerControl,
  readWorkerState,
  isWorkerAlive,
  workerStatusView,
  defaultWorkerControl,
} from '../storage/workerState.mjs';

const CONTROL_FILE = 'worker-control.json';

export function workerRoutes({ store, logger, config, rateLimiter }) {
  const router = Router();
  const ctx = { store, logger, config, rateLimiter };

  router.get(
    '/worker/status',
    asyncRoute((req, res) => {
      const status = workerStatusView(store);
      res.json(status);
    })
  );

  router.post(
    '/worker/start',
    asyncRoute(async (req, res) => {
      await store.update(
        CONTROL_FILE,
        (current) => ({ ...defaultWorkerControl(), ...(current ?? {}), desired: 'running', requestedAt: new Date().toISOString(), requestedBy: req.user?.email ?? null }),
        {}
      );
      const alive = isWorkerAlive(readWorkerState(store));
      let spawned = false;
      if (!alive) {
        try {
          // stdio ignore: o worker escreve logs em arquivo (worker.log,
          // worker-error.log), nunca no pipe do servidor.
          const child = spawnWorker({ env: { JOBFINDER_DATA_DIR: store.dataDir } });
          child.on('exit', (code, signal) => {
            logger.info('worker', 'worker process exited', { reason: signal ? `signal ${signal}` : `code ${code}` });
          });
          spawned = true;
          logger.info('worker', 'worker spawned by the API', { pid: child.pid });
        } catch (err) {
          logger.error('worker', 'failed to spawn the worker', { message: err?.message });
          throw err;
        }
      }
      logger.info('worker', 'worker start requested', { spawned, by: req.user?.email ?? null });
      res.json({ ...workerStatusView(store), spawned });
    })
  );

  router.post(
    '/worker/stop',
    asyncRoute(async (req, res) => {
      await store.update(
        CONTROL_FILE,
        (current) => ({ ...defaultWorkerControl(), ...(current ?? {}), desired: 'paused', requestedAt: new Date().toISOString(), requestedBy: req.user?.email ?? null }),
        {}
      );
      logger.info('worker', 'worker pause requested', { by: req.user?.email ?? null });
      res.json(workerStatusView(store));
    })
  );

  router.post(
    '/worker/tick',
    asyncRoute(async (req, res) => {
      // Runs in the API process: same services, same store, atomic writes.
      const control = readWorkerControl(store);
      if (control.desired === 'paused') {
        return res.json({ ok: false, message: 'Worker pausado — inicie-o antes de forçar um passe.', status: workerStatusView(store) });
      }
      const result = await runWorkerPass(ctx, { now: new Date() });
      logger.info('worker', 'manual tick', { posts: (result.posts ?? []).length, sent: result.cascades?.sent ?? 0 });
      res.json({ ok: true, result: summarize(result), status: workerStatusView(store) });
    })
  );

  return router;
}

/** Compact view of a pass for the API response. */
function summarize(result) {
  return {
    posts: (result.posts ?? []).map((p) => ({ id: p.id, status: p.status, error: p.error ?? null })),
    sent: result.cascades?.sent ?? 0,
    skipped: result.cascades?.skipped ?? 0,
    paused: (result.replies?.paused ?? []).map((p) => p.contactName),
    error: result.cascades?.error ?? null,
  };
}