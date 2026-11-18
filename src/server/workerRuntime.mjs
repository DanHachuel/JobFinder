/**
 * JobFinder — worker process runtime (spawn / ownership).
 *
 * Shared by the launcher (scripts/cli.mjs) and the API (so the UI can start
 * the worker on demand). Both sides must agree on ONE running worker: the
 * state file heartbeat is the ownership token — a new process that finds a
 * fresh heartbeat from a different pid exits immediately instead of
 * creating a duplicate.
 *
 * Spawn flags follow windows-runtime-guard: never `stdio: 'inherit'`
 * (a broken terminal would kill the child with EPIPE), `windowsHide: true`
 * and CREATE_NEW_PROCESS_GROUP (0x00000200) on Windows.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the worker entrypoint. */
export const WORKER_ENTRY = path.join(__dirname, 'worker.mjs');

export const CREATE_NEW_PROCESS_GROUP = 0x00000200;

/**
 * Spawn a long-lived child that the caller supervises (server or worker).
 *
 * windows-runtime-guard: NEVER `stdio: 'inherit'` — a child that writes
 * straight to the terminal dies with EPIPE when the terminal/pipe breaks
 * (MobaXterm, redirection, closed SSH session). Piped stdio keeps the child
 * independent from the terminal: the supervisor forwards the output and its
 * own EPIPE handlers absorb a dead pipe.
 *
 * stdin is a pipe that the supervisor NEVER writes: when the supervisor
 * dies, its end closes and the child sees EOF on stdin — a deterministic
 * "parent is gone" signal that does not depend on pid recycling (which
 * breaks the classic `process.kill(ppid, 0)` check on Windows). The worker
 * uses it to self-terminate; the server ignores it.
 *
 * @param {string} entry absolute path of the child entrypoint
 * @param {{ env?: object, cwd?: string }} [options]
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnSupervised(entry, options = {}) {
  return spawn(process.execPath, [entry], {
    cwd: options.cwd ?? path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      // Tells a supervised worker that fd 0 is a REAL pipe to this supervisor
      // (never the NUL device of a manual run): EOF on stdin then means
      // "the supervisor died". A manual run must not arm the detector.
      JOBFINDER_SUPERVISED_STDIN: '1',
      ...(options.env ?? {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    creationFlags: process.platform === 'win32' ? CREATE_NEW_PROCESS_GROUP : 0,
  });
}

/**
 * Spawn the worker as a detached-enough child of the caller.
 * @param {{ env?: object, cwd?: string }} [options]
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnWorker(options = {}) {
  return spawnSupervised(WORKER_ENTRY, options);
}

/** Pipe a child's output to the console with a prefix (never inherit). */
export function forwardChildOutput(child, prefix, { onLine } = {}) {
  const label = prefix ? `${prefix} ` : '';
  const emit = (stream) => (chunk) => {
    const text = String(chunk);
    if (onLine) {
      for (const line of text.split('\n')) {
        if (line.trim()) onLine(line);
      }
    } else {
      process.stdout.write(`${label}${text}`);
    }
    void stream;
  };
  child.stdout?.on('data', emit('stdout'));
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    if (onLine) {
      for (const line of text.split('\n')) {
        if (line.trim()) onLine(line);
      }
    } else {
      process.stderr.write(`${prefix} ${text}`);
    }
  });
  // A dead pipe must never kill the launcher.
  child.stdout?.on?.('error', (err) => {
    if (err?.code !== 'EPIPE') console.error(`${prefix} stdout error: ${err?.code ?? ''}`);
  });
  child.stderr?.on?.('error', (err) => {
    if (err?.code !== 'EPIPE') console.error(`${prefix} stderr error: ${err?.code ?? ''}`);
  });
}