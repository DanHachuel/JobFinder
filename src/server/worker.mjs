/**
 * JobFinder — background worker (separate process).
 *
 * Spawned by the launcher (scripts/cli.mjs) or on demand by the API
 * (POST /api/worker/start). It keeps processing the automation queues even
 * when the browser tab is closed or the UI is not open at all:
 *
 *   scheduled posts (posts.json)  -> publishPost()
 *   DM cascades (dm-cascades.json) -> cascadeTick()
 *
 * Coordination with the API happens through two JSON files in the data
 * directory (see storage/workerState.mjs), always written through the
 * JsonStore (atomic tmp + rename — atomic-write-guard):
 *
 *   worker-state.json    heartbeat, status, active task, next tick, actions
 *   worker-control.json  desired state ('running' | 'paused') from the UI
 *
 * Environment:
 *   JOBFINDER_DATA_DIR          data directory (default ~/.jobfinder)
 *   JOBFINDER_WORKER_INTERVAL   tick interval in ms (default 30000)
 *
 * Rules honoured here (see .agents/skills/): only atomic JSON writes through
 * the store, dry-run re-checked on every pass against the live config, spawn
 * flags and stdio handled by the launcher, and no unhandled error can kill
 * this process silently (windows-runtime-guard).
 */
import fs from 'node:fs';
import process from 'node:process';

import { createContext } from './context.mjs';
import { resolveDataDir } from './paths.mjs';
import { runWorkerPass } from './services/workers.mjs';
import { syncLiveConfig } from './storage/configSync.mjs';
import {
  appendLog,
  defaultWorkerState,
  readWorkerControl,
  readWorkerState,
} from './storage/workerState.mjs';

const STATE_FILE = 'worker-state.json';

const INTERVAL_MS = Math.max(2_000, Number(process.env.JOBFINDER_WORKER_INTERVAL) || 30_000);
const HEARTBEAT_MS = Math.min(5_000, INTERVAL_MS);

/* ------------------------------------------------------------------ *
 * Process resilience (windows-runtime-guard): never die silently      *
 * ------------------------------------------------------------------ */
let logger = null;

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger?.error('worker', 'unhandled promise rejection ignored', { message });
  console.error(`[jobfinder:worker] unhandled promise rejection ignored: ${message}`);
});

process.on('uncaughtException', (err) => {
  logger?.error('worker', 'uncaught exception - shutting down', { message: err?.message });
  console.error('[jobfinder:worker] uncaught exception:', err);
  process.exit(1);
});

for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err) => {
    if (err?.code === 'EPIPE') return; // terminal/pipe closed: keep working
    console.error(`[jobfinder:worker] stdio error: ${err?.code ?? ''} ${err?.message ?? err}`);
  });
}

/* ------------------------------------------------------------------ *
 * Worker                                                             *
 * ------------------------------------------------------------------ */
let store = null;
let context = null;
let stopping = false;
let timer = null;
let heartbeatTimer = null;
let pass = 0;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Patch worker-state.json. Serialized + atomic (store.update).
 * Used for every normal-path write.
 */
async function patchState(patch) {
  return store.update(
    STATE_FILE,
    (current) => ({ ...defaultWorkerState(), ...(current ?? {}), ...patch }),
    {}
  );
}

/**
 * Synchronous variant (store.write, still tmp + rename) for signal/exit
 * handlers, where awaiting is not possible.
 */
function patchStateSync(patch) {
  const current = store.read(STATE_FILE, {}) ?? {};
  return store.write(STATE_FILE, { ...defaultWorkerState(), ...current, ...patch });
}

/** Append an action line and persist it. */
async function writeLog(level, message, data) {
  const entry = { level, message, ...(data && Object.keys(data).length ? { ...data } : {}) };
  await patchState({ logs: appendLog(readWorkerState(store).logs, entry) });
}

/** Is another live worker already holding the state file? */
function anotherWorkerOwnsState() {
  const state = readWorkerState(store);
  if (!state.pid || state.pid === process.pid || !state.heartbeatAt) return false;
  const age = Date.now() - new Date(state.heartbeatAt).getTime();
  return age >= 0 && age < 12_000;
}

function beatHeartbeat() {
  try {
    patchStateSync({ heartbeatAt: nowIso(), pid: process.pid });
  } catch {
    /* heartbeat is best-effort */
  }
}

/**
 * True when the parent launcher disappeared (orphan guard on Windows).
 *
 * Only ESRCH (the pid does not exist) means the parent is gone. ANY other
 * error — EPERM, EINVAL, anything the host decides to return — means
 * "unknown", and an unknown parent must be treated as ALIVE: on Windows the
 * liveness probe is not a POSIX kill (MobaXterm/npx wrap the real parent),
 * and the previous "any error = gone" rule made the worker suicide for no
 * reason whenever the host answered with an unexpected code.
 */
function parentIsGone() {
  const ppid = process.ppid;
  if (!ppid || ppid <= 1) return false;
  try {
    process.kill(ppid, 0);
    return false;
  } catch (err) {
    return err?.code === 'ESRCH';
  }
}

/** Human description of what this pass is about (UI "activeTask"). */
function describeQueue(now) {
  const parts = [];
  const duePosts = store
    .list('posts.json')
    .filter((post) => post.status === 'scheduled' && new Date(post.scheduledAt ?? 0).getTime() <= now.getTime());
  const activeCascades = store.list('dm-cascades.json').filter((c) => c.status === 'active');
  if (duePosts.length) parts.push(`publicando ${duePosts.length} post(s) agendado(s)`);
  if (activeCascades.length) parts.push(`processando ${activeCascades.length} cascata(s) de DM`);
  return parts.length ? parts.join(' · ') : null;
}

/** stats increment without losing the sibling counters. */
async function bumpStat(key) {
  const current = (await readWorkerStateAsync()).stats ?? {};
  await patchState({ stats: { ...current, [key]: Number(current[key] ?? 0) + 1 } });
}

/** Fresh (cross-process safe) state read. */
async function readWorkerStateAsync() {
  return readWorkerState(store);
}

/** One automation pass over the queues. */
async function tick() {
  const control = readWorkerControl(store);
  const startedAt = new Date();

  if (control.desired === 'paused') {
    await patchState({
      status: 'paused',
      activeTask: null,
      heartbeatAt: nowIso(),
      nextTickAt: new Date(Date.now() + INTERVAL_MS).toISOString(),
    });
    return;
  }

  pass += 1;
  const activeTask = describeQueue(startedAt);
  await patchState({
    status: 'running',
    heartbeatAt: nowIso(),
    activeTask,
    lastTickAt: nowIso(),
    nextTickAt: new Date(startedAt.getTime() + INTERVAL_MS).toISOString(),
  });

  // Always re-read the live config: the user may toggle dry-run in the UI
  // while the worker runs (configSync keeps ctx.config current).
  syncLiveConfig(store, context.config);
  const dryRun = context.config.dryRun !== false;

  try {
    const { posts, cascades, replies } = await runWorkerPass(context, { pass, now: startedAt });

    // ---- scheduled posts ---------------------------------------------
    for (const result of posts ?? []) {
      if (result.error) {
        await bumpStat('failed');
        await writeLog('error', `falha ao publicar post: ${result.error}`, { postId: result.id ?? null });
        continue;
      }
      const record = store.find('posts.json', result.id);
      const simulated = Boolean(record?.simulated) || dryRun;
      await bumpStat('postsPublished');
      await writeLog(
        simulated ? 'info' : 'success',
        `${simulated ? '[dry-run] ' : ''}post publicado (${result.status})`,
        { postId: result.id ?? null, simulated }
      );
    }

    // ---- DM cascades -------------------------------------------------
    for (const result of cascades?.results ?? []) {
      if (result.status === 'sent') {
        const cascade = store.find('dm-cascades.json', result.id);
        await bumpStat('dmsSent');
        await writeLog(
          result.simulated ? 'info' : 'success',
          `${result.simulated ? '[dry-run] ' : ''}DM enviada para ${cascade?.contactName ?? result.id}`,
          { cascadeId: result.id ?? null, simulated: Boolean(result.simulated) }
        );
      } else if (result.status === 'skipped') {
        await bumpStat('skipped');
        await writeLog('warn', `DM nao enviada (${result.reason})`, { cascadeId: result.id ?? null });
      } else if (result.status === 'failed') {
        await bumpStat('failed');
        await writeLog('error', `falha ao enviar DM: ${result.error ?? 'erro desconhecido'}`, { cascadeId: result.id ?? null });
      }
    }

    // ---- inbox monitoring --------------------------------------------
    for (const paused of replies?.paused ?? []) {
      await bumpStat('cascadesPaused');
      await writeLog('info', `cascata pausada (contato respondeu): ${paused.contactName}`, { cascadeId: paused.id });
    }
    if (replies?.error) {
      await writeLog('warn', `checagem de respostas falhou: ${replies.error}`);
    }

    await bumpStat('ticks');
    await patchState({
      status: control.desired === 'paused' ? 'paused' : 'running',
      activeTask: null,
      lastError: null,
      nextTickAt: new Date(Date.now() + INTERVAL_MS).toISOString(),
    });
    logger?.info('worker', `pass #${pass} done (dryRun=${dryRun})`, {
      pass,
      dryRun,
      posts: (posts ?? []).length,
      sent: cascades?.sent ?? 0,
      skipped: cascades?.skipped ?? 0,
    });
  } catch (err) {
    const message = err?.message ?? 'unknown error';
    await bumpStat('failed');
    await patchState({ status: 'running', activeTask: null, lastError: message, nextTickAt: new Date(Date.now() + INTERVAL_MS).toISOString() });
    await writeLog('error', `pass #${pass} falhou: ${message}`, { pass });
    logger?.error('worker', 'pass failed', { pass, message });
  }
}

function clearTimers() {
  if (timer) clearTimeout(timer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  timer = null;
  heartbeatTimer = null;
}

function stop(reason) {
  if (stopping) return;
  stopping = true;
  clearTimers();
  try {
    patchStateSync({
      status: 'stopped',
      pid: null,
      activeTask: null,
      stoppedAt: nowIso(),
      heartbeatAt: null,
      nextTickAt: null,
    });
  } catch {
    /* state is best-effort during shutdown */
  }
  console.error(`[jobfinder:worker] stopped (${reason}).`);
  process.exit(0);
}

/**
 * The tick/heartbeat timers are the KEEP-ALIVE of this process (unlike the
 * internal cron inside the server, they must NOT be unref'd: an unref'd
 * timer lets Node exit immediately with code 0).
 */
function schedule() {
  if (stopping) return;
  beatHeartbeat();
  timer = setTimeout(async () => {
    if (parentIsGone()) {
      stop('parent launcher exited');
      return;
    }
    await tick().catch((err) => {
      logger?.error('worker', 'tick failed', { message: err?.message });
    });
    schedule();
  }, INTERVAL_MS);
  heartbeatTimer = setInterval(() => {
    beatHeartbeat();
    if (parentIsGone()) stop('parent launcher exited');
  }, HEARTBEAT_MS);
}

async function main() {
  const dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) {
    console.error(`[jobfinder:worker] data directory not found: ${dataDir}`);
    process.exit(1);
  }

  context = createContext(dataDir);
  store = context.store;
  logger = context.logger;

  if (anotherWorkerOwnsState()) {
    console.error('[jobfinder:worker] another worker is already running - exiting.');
    process.exit(0);
  }

  patchStateSync({
    pid: process.pid,
    status: 'running',
    startedAt: nowIso(),
    stoppedAt: null,
    heartbeatAt: nowIso(),
    lastTickAt: null,
    nextTickAt: new Date(Date.now() + INTERVAL_MS).toISOString(),
    intervalMs: INTERVAL_MS,
    activeTask: null,
    lastError: null,
    stats: { ticks: 0, postsPublished: 0, dmsSent: 0, cascadesPaused: 0, skipped: 0, failed: 0 },
    logs: [],
  });
  logger?.info('worker', 'worker started', { pid: process.pid, intervalMs: INTERVAL_MS, dataDir });
  console.log(
    `[jobfinder:worker] running (pid ${process.pid}, every ${Math.round(INTERVAL_MS / 1000)}s) - data: ${dataDir}`
  );

  // Idempotent signals: only the first one triggers the graceful stop.
  const onSignal = (signal) => () => stop(`received ${signal}`);
  process.on('SIGINT', onSignal('SIGINT'));
  process.on('SIGTERM', onSignal('SIGTERM'));
  process.on('SIGBREAK', onSignal('SIGBREAK'));

  // Close the state file even on a forced exit path. The heartbeat is
  // cleared so a dead worker is never reported as alive.
  process.on('exit', () => {
    try {
      patchStateSync({ status: 'stopped', pid: null, heartbeatAt: null, nextTickAt: null, activeTask: null });
    } catch {
      /* best effort */
    }
  });

  schedule();
  // First pass shortly after boot so a fresh start does not wait a full
  // interval to process the queue.
  setTimeout(() => {
    tick().catch(() => {});
  }, 1_500);
}

await main();