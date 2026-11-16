#!/usr/bin/env node
/**
 * JobFinder CLI launcher (npx entrypoint).
 *
 * Commands:
 *   jobfinder install          create ~/.jobfinder/ skeleton (safe to re-run)
 *   jobfinder                  start the local server (backend + UI) on localhost:4040
 *   jobfinder start            alias of the default command
 *   jobfinder --version        print version info
 *   jobfinder --help           print usage
 *
 * Flags:
 *   --port <n>         override the API/UI port (default: 4040)
 *   --host <addr>      bind address (default: 127.0.0.1)
 *   --data-dir <path>  override the data directory (default: ~/.jobfinder or $JOBFINDER_HOME)
 *   --open / --no-open open/do not open the browser on start
 *   --dry-run          start with automation in dry-run mode (nothing is really sent)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureDataDir, resolveDataDir, isDataDirHealthy } from '../src/server/storage/bootstrap.mjs';
import { spawnWorker, spawnSupervised, forwardChildOutput } from '../src/server/workerRuntime.mjs';

/**
 * Process resilience for the launcher — installed before anything else runs
 * so the CLI can never vanish silently (terminal back at the prompt with no
 * explanation):
 *
 *  1. unhandledRejection — since Node 15 any unhandled promise rejection
 *     terminates the process immediately. Log it and keep supervising the
 *     server child instead of dying without a trace.
 *  2. EPIPE on stdio — when the shell behind stdout disappears (Windows
 *     terminals, MobaXterm, redirection), the next console.log throws an
 *     unhandled 'error' and kills the launcher.
 *  3. uncaughtException — log loudly and exit with a visible reason.
 */
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[jobfinder] unhandled promise rejection ignored: ${message}`);
});
process.on('uncaughtException', (err) => {
  console.error('[jobfinder] uncaught exception:', err);
  process.exit(1);
});
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err) => {
    if (err?.code === 'EPIPE') return;
    console.error(`[jobfinder] stdio error: ${err?.code ?? ''} ${err?.message ?? err}`);
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT, 'src', 'server', 'index.mjs');
const UI_DIST = path.join(ROOT, 'src', 'ui', 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VISUAL_VERSION = pkg.version;
const NPM_VERSION = normalizeNpmVersion(pkg.version);

/** npm normalizes SemVer: 0.0.01 -> 0.0.1, 0.1.00 -> 0.1.0 */
function normalizeNpmVersion(v) {
  return v
    .split('.')
    .map((part) => String(Number(part)))
    .join('.');
}

const USAGE = `
JobFinder — LinkedIn automation platform

Usage:
  jobfinder install           Create the JSON data store (~/.jobfinder/)
  jobfinder [start] [flags]   Start the app at http://localhost:4040
  jobfinder --version         Show version
  jobfinder --help            Show this help

Flags:
  --port <n>         Port to listen on (default 4040)
  --host <addr>      Bind address (default 127.0.0.1)
  --data-dir <path>  Data directory (default ~/.jobfinder, override with JOBFINDER_HOME)
  --dry-run          Run with automations in dry-run mode (no real LinkedIn actions)

Install commands (canonical npm version):
  npx --yes @danhachuel/jobfinder@${NPM_VERSION} install
  npx --yes @danhachuel/jobfinder@${NPM_VERSION}
`;

function parseArgs(argv) {
  const args = { command: null, port: null, host: null, dataDir: null, dryRun: false };
  const rest = [...argv];
  const first = rest[0];
  if (first && !first.startsWith('-')) {
    args.command = first;
    rest.shift();
  }
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    switch (token) {
      case '--port':
        args.port = Number(rest[i + 1]);
        i += 1;
        break;
      case '--host':
        args.host = rest[i + 1];
        i += 1;
        break;
      case '--data-dir':
        args.dataDir = rest[i + 1];
        i += 1;
        break;
      // Deprecated no-ops: the browser is never opened automatically.
      // The flags are still accepted so existing commands keep working.
      case '--open':
      case '--no-open':
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.command = 'help';
        break;
      case '--version':
      case '-v':
        args.command = 'version';
        break;
      default:
        if (token.startsWith('-')) {
          console.warn(`[jobfinder] ignoring unknown flag: ${token}`);
        }
        break;
    }
  }
  return args;
}

function printBanner() {
  const line = '-'.repeat(58);
  console.log(line);
  console.log(` JobFinder v${VISUAL_VERSION}  (npm: ${NPM_VERSION})`);
  console.log(' LinkedIn Automation • Intelligent Workflows');
  console.log(line);
}

function commandInstall({ dataDir }) {
  const resolved = resolveDataDir(dataDir);
  printBanner();
  const report = ensureDataDir(resolved);
  console.log(` Data directory: ${resolved}`);
  if (report.created.length) {
    console.log(` Created: ${report.created.join(', ')}`);
  } else {
    console.log(' Already initialized — no files were changed.');
  }
  if (!isDataDirHealthy(resolved)) {
    console.error('[jobfinder] data directory is incomplete. Check permissions and try again.');
    process.exitCode = 1;
    return;
  }
  console.log('\nNext steps:');
  console.log(`  1. Connect LinkedIn in the app (Integracoes) — official API or cookies.txt fallback`);
  console.log(`  2. Pick an LLM provider (OpenAI, Anthropic, DeepSeek or local Ollama) in Config`);
  console.log(`  3. Start the app:  npx --yes @danhachuel/jobfinder@${NPM_VERSION}`);
}

async function commandStart({ port, host, dataDir, dryRun }) {
  const resolved = resolveDataDir(dataDir);
  ensureDataDir(resolved);

  if (!fs.existsSync(SERVER_ENTRY)) {
    console.error(`[jobfinder] server entry not found at ${SERVER_ENTRY}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(UI_DIST, 'index.html'))) {
    console.warn(
      '[jobfinder] UI build not found (src/ui/dist). The API will run, but the UI will be blank.\n' +
        '            Build it with:  npm run build   (requires the UI dependencies installed)'
    );
  }

  const env = {
    ...process.env,
    JOBFINDER_DATA_DIR: resolved,
    JOBFINDER_DRY_RUN: dryRun ? '1' : process.env.JOBFINDER_DRY_RUN || '',
  };
  if (port) env.JOBFINDER_PORT = String(port);
  if (host) env.JOBFINDER_HOST = host;

  printBanner();
  const listenPort = port || Number(process.env.JOBFINDER_PORT) || 4040;
  const listenHost = host || process.env.JOBFINDER_HOST || '127.0.0.1';
  const url = `http://${listenHost === '0.0.0.0' ? 'localhost' : listenHost}:${listenPort}`;
  console.log(` Data directory : ${resolved}`);
  console.log(` Mode           : ${dryRun ? 'DRY-RUN (no real actions are sent)' : 'live'}`);
  console.log(` URL            : ${url}`);
  console.log(' Press Ctrl+C to stop.\n');

  // The server is a supervised child: piped stdio (never 'inherit' — a
  // broken terminal must not kill it), windowsHide + a new process group.
  // Its output is forwarded below; the CLI relays it to the terminal.
  const child = spawnSupervised(SERVER_ENTRY, { env, cwd: ROOT });
  forwardChildOutput(child, '');

  // Background worker: a SEPARATE process so the automation queues keep
  // running when the browser is closed (or was never opened). Spawn follows
  // runtime-guard: windowsHide + new process group + piped stdio (never
  // 'inherit'). Disable with JOBFINDER_NO_WORKER=1.
  let worker = null;
  let workerRestarts = 0;
  let stopping = false;

  /**
   * Supervise the worker.
   *
   * THE LAUNCHER NEVER DIES BECAUSE OF THE WORKER. An exit here only logs
   * (the server keeps serving) and, while the server is still up, starts a
   * fresh worker so the automation queues never stop silently. process.exit
   * is NEVER called on this path.
   */
  const startWorker = () => {
    worker = spawnWorker({ env: { JOBFINDER_DATA_DIR: resolved } });
    forwardChildOutput(worker, '[worker]');
    worker.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`\n[jobfinder] worker encerrou (${reason}). O servidor web continua rodando.`);
      const serverAlive = child.exitCode === null && child.signalCode === null;
      if (!stopping && serverAlive && workerRestarts < 5) {
        workerRestarts += 1;
        console.error(`[jobfinder] reiniciando o worker (tentativa ${workerRestarts}/5)...`);
        // Re-check `stopping`: a shutdown that starts while this timer is
        // pending must never leave an orphan behind.
        setTimeout(() => {
          if (!stopping) startWorker();
        }, 3000);
      }
    });
    return worker;
  };

  if (process.env.JOBFINDER_NO_WORKER === '1') {
    console.log(' Worker         : disabled (JOBFINDER_NO_WORKER=1)');
  } else {
    startWorker();
    console.log(` Worker         : automação em segundo plano (pid ${worker.pid})`);
  }

  // The `child` handle keeps this launcher's event loop open for as long as
  // the server runs: the CLI stays in the foreground and the terminal only
  // returns to the prompt when the server itself exits (or on Ctrl+C).
  //
  // Independent keep-alive: the launcher must NEVER depend on a child handle
  // to stay alive (regression 0.1.7 — an empty event loop makes Node exit
  // with code 0, silently, right after the startup banner). This referenced
  // timer holds the loop open by itself; explicit process.exit() calls in
  // the signal/exit handlers below still terminate immediately.
  const keepAlive = setInterval(() => {}, 60_000);
  void keepAlive;

  // Forensic trail: if the launcher ever dies, the reason is visible.
  process.on('exit', (code) => {
    console.error(`[jobfinder] launcher exiting with code ${code}.`);
  });

  const stopChildren = () => {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM');
      // Hard deadline: a worker that ignores SIGTERM must not linger.
      setTimeout(() => {
        if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      }, 2000).unref();
    }
  };
  const forward = (signal) => () => {
    // A second Ctrl+C must never be ignored: force the exit if the graceful
    // path is stuck.
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    stopChildren();
    if (child.exitCode !== null || child.signalCode !== null) {
      process.exit(child.exitCode ?? (child.signalCode ? 1 : 0));
      return;
    }
    child.kill(signal);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  // Windows-only (Ctrl+Break) — harmless no-op on other platforms.
  process.on('SIGBREAK', forward('SIGBREAK'));

  // No auto-open: the terminal prints the URL and waits for the user.
  // Opening a browser window on the user's machine without being asked
  // is not acceptable for a hosted (SaaS) product.

  child.on('exit', (code, signal) => {
    // Loud, visible reason: the server ending must never look like a silent
    // crash back at the prompt.
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`\n[jobfinder] server exited (${reason}).`);
    stopChildren();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function commandVersion() {
  console.log(`JobFinder v${VISUAL_VERSION} (npm: ${NPM_VERSION})`);
  console.log(`os: ${os.type()} ${os.arch()} • node: ${process.version}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'install':
      commandInstall(args);
      break;
    case 'help':
      console.log(USAGE.trim());
      break;
    case 'version':
      commandVersion();
      break;
    case 'start':
    case null:
      await commandStart(args);
      break;
    default:
      console.error(`[jobfinder] unknown command: ${args.command}`);
      console.log(USAGE.trim());
      process.exit(1);
  }
}

await main();
