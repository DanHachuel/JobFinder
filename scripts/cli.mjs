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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { ensureDataDir, resolveDataDir, isDataDirHealthy } from '../src/server/storage/bootstrap.mjs';
import { JsonStore } from '../src/server/storage/jsonStore.mjs';
import { spawnWorker } from '../src/server/workerRuntime.mjs';

/**
 * Process resilience for the launcher — installed before anything else runs
 * so the CLI can never vanish silently (terminal back at the prompt with no
 * explanation):
 *
 *  1. unhandledRejection — since Node 15 any unhandled promise rejection
 *     terminates the process immediately. Log it instead of dying without
 *     a trace.
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
  --daemon           Run detached from this terminal (background service)
  --stop             Stop the daemon started with --daemon

Install commands (canonical npm version):
  npx --yes @danhachuel/jobfinder@${NPM_VERSION} install
  npx --yes @danhachuel/jobfinder@${NPM_VERSION}
`;

function parseArgs(argv) {
  const args = { command: null, port: null, host: null, dataDir: null, dryRun: false, daemon: false };
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
      // Daemon mode: the server runs detached from this terminal (background
      // service). The terminal returns to the prompt immediately.
      case '--daemon':
        args.daemon = true;
        break;
      // Shorthand to stop a daemon started with --daemon.
      case '--daemon-stop':
      case '--stop':
        args.command = 'stop';
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

  if (!fs.existsSync(path.join(UI_DIST, 'index.html'))) {
    console.warn(
      '[jobfinder] UI build not found (src/ui/dist). The API will run, but the UI will be blank.\n' +
        '            Build it with:  npm run build   (requires the UI dependencies installed)'
    );
  }

  printBanner();
  const listenPort = port || Number(process.env.JOBFINDER_PORT) || 4040;
  const listenHost = host || process.env.JOBFINDER_HOST || '127.0.0.1';
  const url = `http://${listenHost === '0.0.0.0' ? 'localhost' : listenHost}:${listenPort}`;
  console.log(` Data directory : ${resolved}`);
  console.log(` Mode           : ${dryRun ? 'DRY-RUN (no real actions are sent)' : 'live'}`);
  console.log(` URL            : ${url}`);
  console.log(' Press Ctrl+C to stop.\n');

  // ------------------------------------------------------------------ *
  // ARCHITECTURE (0.1.13): the Express server runs INSIDE this process.
  //
  // `start()` imports src/server/index.mjs in-process and app.listen()
  // opens a real TCP socket on 4040. A listening server socket keeps the
  // Node event loop open MATHEMATICALLY — nothing about the terminal
  // (MobaXterm, the npx wrapper, output redirection, closed pipes) can
  // empty the loop and take the process down anymore. The worker stays a
  // separate child so its heavy tasks never block the server.
  // ------------------------------------------------------------------ *
  process.env.JOBFINDER_DATA_DIR = resolved;
  process.env.JOBFINDER_PORT = String(listenPort);
  process.env.JOBFINDER_HOST = listenHost;
  // Version: read from THIS file's package.json (never cwd) and handed to the
  // server via env. Under npx the cwd is the user's directory, so a server
  // that read its own version from cwd would print 0.0.00.
  process.env.JOBFINDER_VERSION = VISUAL_VERSION;
  if (dryRun) process.env.JOBFINDER_DRY_RUN = '1';

  // Supervisão do worker. O CLI NUNCA depende do worker para viver: ele
  // roda com stdio ['ignore','ignore','ignore'] (logs em arquivo) e, se
  // morrer, o launcher apenas registra e reinicia — o servidor segue.
  let worker = null;
  let workerRestarts = 0;
  let stopping = false;
  let serverRef = null;

  const stopChildren = () => {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill('SIGTERM');
      // Hard deadline: a worker that ignores SIGTERM must not linger.
      setTimeout(() => {
        if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      }, 2000).unref();
    }
  };

  const startWorker = () => {
    // JOBFINDER_TAKEOVER: o launcher acabou de subir (o supervisor anterior
    // já se foi) ou observou a saída do worker — heartbeat velha não pode
    // bloquear este spawn.
    worker = spawnWorker({ env: { JOBFINDER_DATA_DIR: resolved, JOBFINDER_TAKEOVER: '1' } });
    worker.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`\n[jobfinder] worker encerrou (${reason}). O servidor web continua rodando.`);
      const serverAlive = Boolean(serverRef?.listening);
      if (!stopping && serverAlive && workerRestarts < 5) {
        workerRestarts += 1;
        console.error(`[jobfinder] reiniciando o worker (tentativa ${workerRestarts}/5)...`);
        // Re-check `stopping`: um shutdown que começa enquanto este timer
        // está pendente nunca pode deixar um órfão para trás.
        setTimeout(() => {
          if (!stopping) startWorker();
        }, 3000);
      }
    });
    return worker;
  };

  // Keep-alive inquebrável: timer de 24h SEM unref. Segurança extra — o
  // socket do servidor (abaixo) já é a garantia principal. Nunca use unref()
  // aqui: um timer solto é o que permite o loop esvaziar e o processo sumir.
  const keepAliveTimer = setInterval(() => {}, 24 * 60 * 60 * 1000);

  // Forensic trail: se o launcher morrer, o motivo fica visível. `beforeExit`
  // avisa ANTES de o loop esvaziar (com os handles ativos) e permite re-armar
  // o keep-alive; `exit` registra o código final.
  process.on('beforeExit', (code) => {
    const handles = process.getActiveResourcesInfo?.() ?? [];
    console.error(
      `[jobfinder] launcher: event loop esvaziando (beforeExit code=${code}) — ` +
        `handles: ${handles.join(', ') || 'NENHUM'}`
    );
    if (!stopping) {
      console.error('[jobfinder] launcher: re-armando o keep-alive para nao voltar ao prompt.');
      clearInterval(keepAliveTimer);
      setInterval(() => {}, 24 * 60 * 60 * 1000);
    }
  });
  process.on('exit', (code) => {
    console.error(`[jobfinder] launcher exiting with code ${code}.`);
  });

  // Sinais: o primeiro encerra o worker e deixa o shutdown gracioso do
  // servidor (registrado dentro de start(), abaixo) rodar; o segundo força.
  const forward = (signal) => () => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    stopChildren();
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  // Windows-only (Ctrl+Break) — harmless no-op on other platforms.
  process.on('SIGBREAK', forward('SIGBREAK'));

  // No auto-open: the terminal prints the URL and waits for the user.
  // Opening a browser window on the user's machine without being asked
  // is not acceptable for a hosted (SaaS) product.

  // Sobe o servidor Express NO PRÓPRIO PROCESSO (dinâmico: mantém --help,
  // --version e install leves, sem carregar o Express).
  try {
    const { start } = await import('../src/server/index.mjs');
    ({ server: serverRef } = await start());
  } catch (err) {
    console.error('[jobfinder] falha ao iniciar o servidor:', err?.message ?? err);
    stopChildren();
    process.exit(1);
  }

  if (process.env.JOBFINDER_NO_WORKER === '1') {
    console.log(' Worker         : disabled (JOBFINDER_NO_WORKER=1)');
  } else {
    startWorker();
    console.log(` Worker         : automação em segundo plano (pid ${worker.pid})`);
  }
}

/** True when a pid exists (EPERM = alive but owned by another user). */
function isPidAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Daemon mode (0.1.16): the server runs DETACHED from the interactive
 * terminal, so nothing the terminal does afterwards can kill it.
 *
 * A hostile terminal (MobaXterm wrapper, PowerShell, npx) can TerminateProcess
 * the foreground child at any moment; a detached process with its own stdio
 * pointed at a log file is immune to that. The terminal returns to the prompt
 * immediately — that is the expected behaviour of a daemon.
 */
async function commandDaemon(args) {
  const resolved = resolveDataDir(args.dataDir);
  ensureDataDir(resolved);

  const store = new JsonStore(resolved);
  const info = store.read('jobfinder-daemon.json', null) ?? {};
  if (isPidAlive(info.pid)) {
    console.log(`JobFinder ja esta rodando em background (pid ${info.pid}).`);
    console.log(` URL : http://${info.host ?? '127.0.0.1'}:${info.port ?? 4040}`);
    console.log(` Log : ${info.logFile ?? path.join(resolved, 'jobfinder.log')}`);
    console.log(` Parar: npx --yes @danhachuel/jobfinder@${NPM_VERSION} stop`);
    return;
  }

  const port = args.port || Number(process.env.JOBFINDER_PORT) || 4040;
  const host = args.host || process.env.JOBFINDER_HOST || '127.0.0.1';
  const logFile = path.join(resolved, 'jobfinder.log');

  printBanner();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logFd = fs.openSync(logFile, 'a');

  const child = spawn(process.execPath, [path.join(__dirname, 'cli.mjs'), 'start', '--port', String(port), '--host', host, ...(args.dryRun ? ['--dry-run'] : [])], {
    detached: true,
    // stdio de arquivo: o daemon NUNCA herda os pipes do terminal. Se o canalho
    // do MobaXterm fechar, o daemon não sente — e o log fica em disco.
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    creationFlags: process.platform === 'win32' ? 0x00000200 : 0,
    env: {
      ...process.env,
      JOBFINDER_MODE: 'daemon',
      JOBFINDER_DATA_DIR: resolved,
      JOBFINDER_PORT: String(port),
      JOBFINDER_HOST: host,
      JOBFINDER_VERSION: VISUAL_VERSION,
    },
  });

  child.on('error', (err) => {
    console.error(`[jobfinder] falha ao iniciar o daemon: ${err?.message ?? err}`);
    process.exit(1);
  });

  // Estado do daemon via JsonStore (atômico) — nunca fs.writeFileSync solto.
  store.write('jobfinder-daemon.json', {
    pid: child.pid,
    port,
    host,
    logFile,
    startedAt: new Date().toISOString(),
    version: VISUAL_VERSION,
    mode: 'daemon',
  });

  child.unref();

  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(` Data directory : ${resolved}`);
  console.log(` Mode           : daemon (background)`);
  console.log(` URL            : http://${shown}:${port}`);
  console.log(` PID            : ${child.pid}`);
  console.log(` Log            : ${logFile}`);
  console.log(`\nRodando em background — este terminal esta livre.`);
  console.log(` Parar com: npx --yes @danhachuel/jobfinder@${NPM_VERSION} stop`);
}

/** Stop the daemon recorded in jobfinder-daemon.json (SIGTERM, then SIGKILL). */
async function commandStop() {
  const resolved = resolveDataDir();
  const store = new JsonStore(resolved);
  const info = store.read('jobfinder-daemon.json', null) ?? {};

  if (!isPidAlive(info.pid)) {
    console.log('Nenhum daemon do JobFinder rodando.');
    store.write('jobfinder-daemon.json', { ...info, pid: null, stoppedAt: new Date().toISOString() });
    return;
  }

  const pid = Number(info.pid);
  console.log(`Parando o JobFinder (pid ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.error(`[jobfinder] falha ao sinalizar o processo: ${err?.message ?? err}`);
  }

  // Espera o encerramento gracioso; força se necessário.
  for (let i = 0; i < 20; i += 1) {
    if (!isPidAlive(pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (isPidAlive(pid)) {
    console.error('[jobfinder] encerramento gracioso expirou — forcando (SIGKILL).');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* best effort */
    }
  }

  store.write('jobfinder-daemon.json', { ...info, pid: null, stoppedAt: new Date().toISOString() });
  console.log('JobFinder parado.');
}

function commandVersion() {
  console.log(`JobFinder v${VISUAL_VERSION} (npm: ${NPM_VERSION})`);
  console.log(`os: ${os.type()} ${os.arch()} • node: ${process.version}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --daemon tem precedência sobre start/null, mas nunca sobre install/help/version.
  if (args.daemon && !['install', 'help', 'version', 'stop'].includes(args.command)) {
    await commandDaemon(args);
    return;
  }
  if (args.command === 'stop') {
    await commandStop();
    return;
  }

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
