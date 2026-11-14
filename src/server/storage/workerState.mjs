/**
 * JobFinder — worker state/control files (cross-process coordination).
 *
 * The background worker (src/server/worker.mjs) is a SEPARATE process from
 * the API. They exchange information through two JSON files in the data
 * directory, always written through the JsonStore (atomic tmp + rename):
 *
 *   worker-state.json    written by the WORKER: heartbeat, status, active
 *                        task, next tick, recent actions, counters.
 *   worker-control.json  written by the API: the desired state
 *                        ('running' | 'paused') requested from the UI.
 *
 * Each process keeps its own JsonStore cache, so both sides invalidate the
 * cache before reading the shared file (the "external editor" case — here
 * the external editor is simply the other process). Writes never race: the
 * worker only writes state, the API only writes control.
 */

const STATE_FILE = 'worker-state.json';
const CONTROL_FILE = 'worker-control.json';

/** Age after which a heartbeat is considered stale (worker presumed dead). */
export const HEARTBEAT_STALE_MS = 20_000;

/** How many action lines the worker keeps in the state file. */
export const LOG_LIMIT = 50;

export function defaultWorkerState() {
  return {
    schemaVersion: 1,
    pid: null,
    status: 'stopped', // running | paused | stopped
    startedAt: null,
    stoppedAt: null,
    heartbeatAt: null,
    lastTickAt: null,
    nextTickAt: null,
    intervalMs: null,
    activeTask: null,
    lastError: null,
    stats: { ticks: 0, postsPublished: 0, dmsSent: 0, cascadesPaused: 0, skipped: 0, failed: 0 },
    logs: [],
  };
}

export function defaultWorkerControl() {
  return {
    schemaVersion: 1,
    desired: 'running', // running | paused
    requestedAt: null,
    requestedBy: null,
  };
}

/** Fresh read of a shared file (cache invalidated: the other process owns it). */
function readShared(store, name, fallback) {
  store.invalidate(name);
  return store.read(name, fallback);
}

export function readWorkerState(store) {
  return { ...defaultWorkerState(), ...(readShared(store, STATE_FILE, null) ?? {}) };
}

export function readWorkerControl(store) {
  return { ...defaultWorkerControl(), ...(readShared(store, CONTROL_FILE, null) ?? {}) };
}

/** Append an action line (kept in memory order, newest last). */
export function appendLog(logs, entry) {
  const line = { ts: new Date().toISOString(), ...entry };
  return [...(Array.isArray(logs) ? logs : []), line].slice(-LOG_LIMIT);
}

/** True when the worker heartbeat is recent enough to consider it alive. */
export function isWorkerAlive(state, now = Date.now()) {
  if (!state?.heartbeatAt) return false;
  const age = now - new Date(state.heartbeatAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < HEARTBEAT_STALE_MS;
}

/**
 * Status consumed by the UI.
 *
 * `desired` (control file, written by the UI) is the source of truth for
 * running/paused: the state file is only refreshed by the worker on its next
 * tick, so trusting `state.status` would show a stale "paused" right after
 * the user pressed start. The worker being alive (heartbeat) is what
 * distinguishes "running/paused" from "stopped".
 */
export function workerStatusView(store, now = Date.now()) {
  const state = readWorkerState(store);
  const control = readWorkerControl(store);
  const alive = isWorkerAlive(state, now);
  const desired = control.desired === 'paused' ? 'paused' : 'running';
  const status = !alive ? 'stopped' : desired;
  return {
    isRunning: status === 'running',
    status,
    desired,
    pid: alive ? state.pid : null,
    activeTask: status === 'running' ? state.activeTask ?? null : null,
    lastTickAt: state.lastTickAt ?? null,
    nextTickAt: state.nextTickAt ?? null,
    intervalMs: state.intervalMs ?? null,
    lastError: state.lastError ?? null,
    stats: state.stats ?? defaultWorkerState().stats,
    logs: (state.logs ?? []).slice(-10).reverse(),
  };
}