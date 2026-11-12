/**
 * JobFinder — server entrypoint.
 *
 * Starts the local API + UI server. Normally launched by scripts/cli.mjs
 * (`jobfinder`), but can also be run directly: `node src/server/index.mjs`.
 *
 * Env:
 *   JOBFINDER_DATA_DIR   data directory (default ~/.jobfinder)
 *   JOBFINDER_PORT       port (default 3030, or config.json "port")
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

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return { visual: pkg.version, npm: pkg.version.split('.').map((p) => String(Number(p))).join('.') };
  } catch {
    return { visual: '0.0.00', npm: '0.0.0' };
  }
}

export async function start() {
  const dataDir = resolveDataDir();
  const context = createContext(dataDir);
  const { store, logger, config } = context;

  if (process.env.JOBFINDER_DRY_RUN === '1') {
    context.config.dryRun = true;
    logger.warn('startup', 'dry-run mode forced by JOBFINDER_DRY_RUN=1');
  }

  const app = createApp(context);

  const port = Number(process.env.JOBFINDER_PORT) || Number(config.port) || 3030;
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
    }
  });

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
  startWorkers(context);

  const shutdown = (signal) => {
    logger.info('shutdown', `received ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { app, server, context };
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) {
  await start();
}
