/**
 * JobFinder — server entrypoint.
 *
 * Starts the local API + UI server. Normally launched by scripts/cli.mjs
 * (`jobfinder`), but can also be run directly: `node src/server/index.mjs`.
 *
 * Env:
 *   JOBFINDER_DATA_DIR   data directory (default ~/.jobfinder)
 *   JOBFINDER_PORT       port (default 4040, or config.json "port")
 *   JOBFINDER_HOST       bind address (default 127.0.0.1, or config.json "host")
 *   JOBFINDER_DRY_RUN=1  force dry-run mode (no real external actions)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.mjs';
import { createContext } from './context.mjs';
import { resolveDataDir, UI_DIST } from './paths.mjs';
import { startWorkers } from './services/workers.mjs';

/**
 * Logger used by the global process handlers below. Assigned by start():
 * the handlers are registered before the context exists, but they only
 * ever fire once the server is running.
 */
let activeLogger = null;
let resilienceInstalled = false;

/**
 * Process resilience — installed before anything else can fail.
 *
 * The server keeps the Node event loop open through its listening socket
 * for as long as it runs. What can still kill the process *silently*
 * (terminal returns to the prompt, no visible reason):
 *
 *  1. unhandledRejection — since Node 15 an unhandled promise rejection
 *     terminates the process immediately (exit 1). Any floating promise
 *     (services, workers, storage) rejecting on the user's machine would
 *     therefore take the whole app down right after the startup banner.
 *  2. EPIPE on stdio — when the shell/pipe behind the inherited
 *     stdout/stderr disappears (Windows terminals, MobaXterm, output
 *     redirection), the next console.log throws an unhandled 'error'
 *     event on process.stdout and the process dies without a message.
 *  3. uncaughtException — must never be swallowed silently; log it and
 *     exit loudly instead of vanishing without a trace.
 */
function installProcessResilience() {
  if (resilienceInstalled) return;
  resilienceInstalled = true;

  // Keep the process alive after a stray async failure instead of dying
  // silently right after startup.
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? `${reason.message}` : String(reason);
    activeLogger?.error('startup', 'unhandled promise rejection ignored', {
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    console.error(`[jobfinder] unhandled promise rejection ignored: ${message}`);
  });

  process.on('uncaughtException', (err) => {
    activeLogger?.error('startup', 'uncaught exception — shutting down', {
      message: err?.message,
      stack: err?.stack,
    });
    console.error('[jobfinder] uncaught exception:', err);
    process.exit(1);
  });

  // A closed/broken stdout (EPIPE) must not kill the server: the server
  // keeps running headless and stays reachable at http://127.0.0.1:PORT.
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', (err) => {
      if (err?.code === 'EPIPE') return;
      activeLogger?.error('startup', 'stdio error', { code: err?.code, message: err?.message });
    });
  }
}

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return { visual: pkg.version, npm: pkg.version.split('.').map((p) => String(Number(p))).join('.') };
  } catch {
    return { visual: '0.0.00', npm: '0.0.0' };
  }
}

/**
 * Module-level handle: start() returns it, but the entrypoint discards it.
 * Keeping the reference here guarantees the http.Server object itself can
 * never be collected while the app is serving.
 */
let moduleScopeServer = null;

export async function start() {
  installProcessResilience();

  const dataDir = resolveDataDir();
  const context = createContext(dataDir);
  const { store, logger, config, auth } = context;
  activeLogger = logger;

  if (process.env.JOBFINDER_DRY_RUN === '1') {
    context.config.dryRun = true;
    logger.warn('startup', 'dry-run mode forced by JOBFINDER_DRY_RUN=1');
  }

  const app = createApp(context);

  const port = Number(process.env.JOBFINDER_PORT) || Number(config.port) || 4040;
  const host = process.env.JOBFINDER_HOST || config.host || '127.0.0.1';

  const { visual, npm } = readPkgVersion();

  const server = app.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    logger.info('startup', 'server listening', { host, port, dataDir, version: visual });
    console.log(`JobFinder v${visual} (npm ${npm}) listening on http://${shown}:${port}`);
    if (!fs.existsSync(path.join(UI_DIST, 'index.html'))) {
      console.log('(UI build not found — run "npm run build" or use "npm run dev")');
    }
    console.log(`Data directory: ${dataDir}`);
    if (context.config.dryRun) {
      console.log('DRY-RUN mode: no real LinkedIn actions will be sent.');
    } else {
      console.log('REAL MODE: live LinkedIn actions are enabled (dry-run is OFF).');
    }
    console.log(`Login: ${auth.getUser().email}${auth.usingDefaultPassword() ? ' / 123456 (troque a senha em Configurações)' : ''}`);
  });

  // Pin the server handle: the listening socket keeps the event loop (and
  // therefore the process) open for as long as the app runs. Holding the
  // reference at module and global scope also guarantees it can never be
  // collected while the app is serving.
  moduleScopeServer = server;
  globalThis.__jobfinder = { app, server, context };

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Start JobFinder with another port:`);
      console.error(`  node scripts/cli.mjs start --port ${port + 1}`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });

  // Background workers: post scheduler + DM cascade engine + inbox monitoring.
  const workers = startWorkers(context);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', `received ${signal}`);
    try {
      workers?.stop?.();
    } catch {
      /* stopping workers is best-effort */
    }
    server.close(() => process.exit(0));
    // Never hang on a stuck keep-alive connection: force the exit.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows-only signal (Ctrl+Break), e.g. MobaXterm terminals. Registering
  // it elsewhere is a harmless no-op.
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));

  return { app, server, context };
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  await start();
}
