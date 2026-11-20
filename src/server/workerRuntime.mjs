/**
 * JobFinder — worker process runtime (spawn / ownership).
 *
 * Shared by the launcher (scripts/cli.mjs) and the API (so the UI can start
 * the worker on demand). Both sides must agree on ONE running worker: the
 * state file heartbeat is the ownership token — a new process that finds a
 * fresh heartbeat from a different pid exits immediately instead of
 * creating a duplicate.
 *
 * Spawn flags follow runtime-guard: `windowsHide: true` and
 * CREATE_NEW_PROCESS_GROUP (0x00000200) on Windows.
 *
 * stdio is ALL 'ignore' on purpose: the worker never writes to the
 * launcher's pipes. A hostile terminal (MobaXterm, npx wrappers, output
 * redirection) that chokes on — or closes — those pipes can no longer
 * disturb either process. The worker records everything in files inside
 * the data dir (worker.log, worker-error.log, logs/*.jsonl); its stdin
 * stays a pipe only to carry the "supervisor died" EOF signal.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the worker entrypoint. */
export const WORKER_ENTRY = path.join(__dirname, 'worker.mjs');

export const CREATE_NEW_PROCESS_GROUP = 0x00000200;

/**
 * Spawn the worker as a detached-enough child of the caller.
 * @param {{ env?: object, cwd?: string }} [options]
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnWorker(options = {}) {
  return spawn(process.execPath, [WORKER_ENTRY], {
    cwd: options.cwd ?? path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      // Tells the worker that fd 0 is a REAL pipe to this supervisor (never
      // the NUL device of a manual run): EOF on stdin then means "the
      // supervisor died". A manual run must not arm the detector.
      JOBFINDER_SUPERVISED_STDIN: '1',
      ...(options.env ?? {}),
    },
    // stdin stays a pipe (the EOF orphan signal); stdout/stderr are ignored
    // so a broken terminal can never choke the worker — it logs to files.
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
    creationFlags: process.platform === 'win32' ? CREATE_NEW_PROCESS_GROUP : 0,
  });
}