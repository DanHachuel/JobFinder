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
import { createRequire } from 'node:module';

import { createApp } from './app.mjs';
import { createContext } from './context.mjs';
import { resolveDataDir, UI_DIST } from './paths.mjs';

/** ESM-safe package.json reader: resolved from THIS file, never from cwd. */
const require = createRequire(import.meta.url);

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

/**
 * Version source, in order:
 *   1. JOBFINDER_VERSION (set by the launcher, which reads package.json from
 *      its own location — always correct)
 *   2. package.json resolved relative to THIS module
 *
 * `process.cwd()` is NEVER used: under `npx` the cwd is the user's directory
 * (MobaXterm home, a random PowerShell path), so a cwd-relative read fails and
 * the server silently reports 0.0.00.
 */
function readPkgVersion() {
  const fromEnv = process.env.JOBFINDER_VERSION;
  try {
    const pkg = fromEnv ? { version: fromEnv } : require('../../package.json');
    const resolved = pkg.version;
    if (!resolved || resolved === '0.0.00') throw new Error('versao vazia');
    return { visual: resolved, npm: resolved.split('.').map((p) => String(Number(p))).join('.') };
  } catch {
    const fallback = '0.0.00';
    console.error(`[jobfinder] nao foi possivel ler a versao do package.json (env=${fromEnv ? 'set' : 'unset'}) — usando ${fallback}`);
    return { visual: fallback, npm: '0.0.0' };
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
    // Credentials are NEVER printed to the terminal (security): the local
    // account is managed in the UI (Configurações → Segurança). A dangling
    // `Login:` line here leaked the default e-mail/password to every console.
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

  // Time-based automation (scheduled posts, DM cascades, inbox monitoring)
  // runs in the standalone background worker process (src/server/worker.mjs),
  // spawned by the launcher or by POST /api/worker/start. Keeping it out of
  // this process means closing the browser never pauses the automations.

  let shuttingDown = false;

  /**
   * ULTIMATE keep-alive guard (0.1.15).
   *
   * The listening socket is the primary guarantee. This is the backstop for
   * the case where something empties the event loop without closing the
   * server: Node fires `beforeExit` right before exiting naturally, and
   * scheduling new work there CANCELS the exit. If that ever happens we now
   * (a) leave a loud forensic trail with the active handles and (b) re-arm a
   * referenced timer so the process cannot vanish silently.
   */
  const armKeepAlive = () => setInterval(() => {}, 60_000);
  let keepAlive = armKeepAlive();
  process.on('beforeExit', (code) => {
    const handles = process.getActiveResourcesInfo?.() ?? [];
    const socketAlive = handles.some((handle) => /server|tcp|socket|pipe/i.test(handle));
    if (shuttingDown) return;
    console.error(
      `[jobfinder] event loop esvaziando (beforeExit code=${code}) — ` +
        `socket do servidor ativo: ${socketAlive}; handles: ${handles.join(', ') || 'NENHUM'}`
    );
    if (!socketAlive && server.listening) {
      console.error('[jobfinder] re-armando o keep-alive para evitar encerramento prematuro.');
      clearInterval(keepAlive);
      keepAlive = armKeepAlive();
    }
  });
  process.on('exit', (code) => {
    console.error(`[jobfinder] processo do servidor encerrando (code=${code}).`);
  });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown', `received ${signal}`);
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
