#!/usr/bin/env node
/**
 * JobFinder CLI launcher (npx entrypoint) — runtime permanente + daemon.
 *
 * ARQUITETURA (0.1.17, espelha o @danhachuel/pandanews):
 *
 *   1. RUNTIME PERMANENTE. O código do servidor é copiado para
 *      ~/.jobfinder/runtime (src/server + src/ui/dist + package.json). O
 *      Express NUNCA sobe de dentro do cache do npx: no Windows o npx
 *      renomeia/limpa esse cache ao final e o Windows devolve EBUSY quando
 *      um processo vivo segura arquivos lá dentro — o que derrubava o app.
 *
 *   2. DAEMON. O servidor sobe DESTACADO (detached + windowsHide), com stdio
 *      direto no arquivo ~/.jobfinder/jobfinder.log — não herda o console.
 *      O terminal volta ao prompt na hora; fechar o MobaXterm/PowerShell não
 *      mata o servidor.
 *
 *   3. LOCK DE PID. ~/.jobfinder/jobfinder.pid registra a instância. `stop`
 *      encerra por PID (taskkill /PID /T no Windows) e, como rede de
 *      segurança, por quem estiver dono da porta.
 *
 * Comandos:
 *   jobfinder install          cria o esqueleto ~/.jobfinder/ (idempotente)
 *   jobfinder                  inicia em background (daemon) — padrão
 *   jobfinder start            alias do padrão
 *   jobfinder --foreground     sobe preso a este terminal (depuração)
 *   jobfinder stop | kill      encerra o daemon
 *   jobfinder --version | --help
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { ensureDataDir, isDataDirHealthy } from '../src/server/storage/bootstrap.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');

const VISUAL_VERSION = pkg.version;
const NPM_VERSION = String(pkg.version)
  .split('.')
  .map((part) => String(Number(part)))
  .join('.');

/* ------------------------------------------------------------------ *
 * Caminhos: lar estável, runtime permanente, lock de PID              *
 * ------------------------------------------------------------------ */

/** Raiz de instalação estável: JOBFINDER_HOME > JOBFINDER_DATA_DIR > ~/.jobfinder. */
export function resolveHome() {
  if (process.env.JOBFINDER_HOME) return path.resolve(process.env.JOBFINDER_HOME);
  if (process.env.JOBFINDER_DATA_DIR) return path.resolve(process.env.JOBFINDER_DATA_DIR);
  return path.join(os.homedir(), '.jobfinder');
}

export function runtimeDir(home) {
  return path.join(home, 'runtime');
}

export function serverEntry(home) {
  return path.join(runtimeDir(home), 'src', 'server', 'index.mjs');
}

export function pidFilePath(home) {
  return path.join(home, 'jobfinder.pid');
}

/* ------------------------------------------------------------------ *
 * Resiliência do launcher                                            *
 * ------------------------------------------------------------------ */
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
    if (err?.code === 'EPIPE') return; // terminal/pipe fechado: seguir working
    console.error(`[jobfinder] stdio error: ${err?.code ?? ''} ${err?.message ?? err}`);
  });
}

/* ------------------------------------------------------------------ *
 * USO                                                                *
 * ------------------------------------------------------------------ */
const USAGE = `
JobFinder — LinkedIn automation platform

Uso:
  jobfinder install           Cria o esqueleto JSON em ~/.jobfinder/ (idempotente)
  jobfinder                   Inicia o servidor EM BACKGROUND (daemon)
  jobfinder start             Alias do padrão
  jobfinder --foreground      Sobe preso a este terminal (para depuração)
  jobfinder stop | kill       Encerra o daemon em background

Opcoes:
  --port <n>         Porta (padrão 4040)
  --host <addr>      Endereço (padrão 127.0.0.1)
  --data-dir <path>  Diretório de dados (padrão ~/.jobfinder)
  --dry-run          Força o modo dry-run (nenhuma ação real no LinkedIn)
  --foreground       Não destaca: prende o servidor a este terminal
  --help             Mostra esta ajuda
  --version          Mostra a versão

Instalação (versão canônica do npm):
  npx --yes @danhachuel/jobfinder@${NPM_VERSION} install
  npx --yes @danhachuel/jobfinder@${NPM_VERSION}

Recomendado no Windows (evita o EBUSY do npx, que limpa o próprio cache):
  npm install -g @danhachuel/jobfinder@latest
`;

/** Copia uma pasta sem node_modules (runtime enxuto). */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * RUNTIME PERMANENTE: copia src/server + src/ui/dist para ~/.jobfinder/runtime
 * e instala lá as dependências de produção. Só repovoa quando falta o
 * entrypoint ou quando a versão mudou.
 *
 * As dependências são instaladas DENTRO do runtime (nunca um symlink/junction
 * para o cache do npx): é isso que garante que o daemon não segure arquivos
 * dentro do cache — a causa raiz do EBUSY no Windows.
 *
 * @param {string} home raiz estável
 * @returns {string} caminho do servidor a executar
 */
export function setupRuntime(home) {
  const dest = runtimeDir(home);
  const entry = serverEntry(home);
  const haveVersion = fs.existsSync(path.join(dest, '.version'))
    ? fs.readFileSync(path.join(dest, '.version'), 'utf8').trim()
    : '';
  const missing = !fs.existsSync(entry);

  if (missing || haveVersion !== VISUAL_VERSION) {
    if (missing) {
      console.log('Preparando o runtime permanente (~/.jobfinder/runtime) — o servidor não roda mais do cache do npx...');
    } else {
      console.log(`Runtime defasado (${haveVersion || 'sem versão'} -> ${VISUAL_VERSION}) — atualizando a cópia...`);
    }
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    // Apenas o necessário ao servidor Express: código + UI buildada.
    copyTree(path.join(PKG_ROOT, 'src', 'server'), path.join(tmp, 'src', 'server'));
    const uiDist = path.join(PKG_ROOT, 'src', 'ui', 'dist');
    if (fs.existsSync(uiDist)) {
      copyTree(uiDist, path.join(tmp, 'src', 'ui', 'dist'));
    }
    // package.json enxuto: só o que o servidor precisa. Sem pm2 (ferramenta do
    // launcher, não do runtime) e sem devDependencies.
    const runtimePkg = {
      name: pkg.name,
      version: VISUAL_VERSION,
      private: true,
      type: 'module',
      dependencies: { ...(pkg.dependencies ?? {}) },
      // playwright continua opcional: só o Easy Apply ao vivo o usa.
      ...(pkg.optionalDependencies?.playwright
        ? { optionalDependencies: { playwright: pkg.optionalDependencies.playwright } }
        : {}),
    };
    fs.writeFileSync(path.join(tmp, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(tmp, '.version'), `${VISUAL_VERSION}\n`, 'utf8');
    // Swap atômico: no Windows, rename sobre destino existente falha (EPERM).
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    console.log(`Código copiado para ${dest}`);

    installRuntimeDependencies(dest);
    console.log(`Runtime pronto em ${dest}`);
  }

  return entry;
}

/** Instala as dependências de produção dentro do runtime (silencioso). */
function installRuntimeDependencies(runtimeRoot) {
  const modules = path.join(runtimeRoot, 'node_modules');
  if (fs.existsSync(path.join(modules, 'express', 'package.json'))) return true;

  console.log('Instalando dependências do runtime (express, mammoth, pdfjs-dist)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { NODE_OPTIONS: _appPreloads, ...cleanEnv } = process.env;
  const result = spawnSync(
    npm,
    ['install', '--prefix', runtimeRoot, '--omit=dev', '--no-audit', '--no-fund', '--no-save', '--loglevel=error'],
    // `shell: true` é obrigatório no Windows: .cmd/.bat não executam sem ele
    // desde o Node 18.20 (spawn falha com EINVAL).
    {
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: cleanEnv,
    }
  );
  if (result.error || result.status !== 0) {
    // Falha aqui é fatal: sem dependências o servidor não sobe. Melhor
    // abortar com mensagem clara do que spawnar um processo que vai morrer.
    throw new Error(
      `falha ao instalar as dependências do runtime: ${(result.error?.message ?? result.stderr ?? result.stdout ?? '').trim()
        .split('\n')
        .slice(0, 3)
        .join(' ')} (instale manualmente: npm install --prefix ${runtimeRoot})`
    );
  }
  return true;
}

/** Entrypoint a executar: runtime permanente (padrão) ou o próprio pacote (dev). */
export function resolveServerEntry(home) {
  if (process.env.JOBFINDER_NO_RUNTIME === '1' && fs.existsSync(path.join(PKG_ROOT, 'src', 'server', 'index.mjs'))) {
    return path.join(PKG_ROOT, 'src', 'server', 'index.mjs');
  }
  return setupRuntime(home);
}

/** PID vivo? (EPERM = vivo, mas de outro usuário). */
function isAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/** Mata a árvore de processos por PID — sempre em silêncio (sem janela). */
export function killTree(pid) {
  if (!isAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {
        windowsHide: true, // CREATE_NO_WINDOW — sem tela preta
        detached: true, // grupo isolado, imune a Ctrl+C do console
        stdio: 'ignore', // taskkill não escreve no terminal
      });
    } else {
      try {
        process.kill(-Number(pid), 'SIGKILL'); // grupo: mata os filhos também
      } catch {
        process.kill(Number(pid), 'SIGTERM');
      }
    }
  } catch {
    /* processo já não existia */
  }
}

/** Descobre o PID dono de uma porta em LISTEN (Windows: netstat; Unix: null). */
function pidOfPort(port) {
  if (process.platform !== 'win32') return null;
  try {
    const result = spawnSync('netstat', ['-ano'], {
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status !== 0 || !result.stdout) return null;
    const target = `:${port}`;
    for (const line of result.stdout.toString().split(/\r?\n/)) {
      if (!line.includes(target) || !/LISTENING/i.test(line)) continue;
      const columns = line.trim().split(/\s+/);
      const pid = Number(columns[columns.length - 1]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {
    /* netstat indisponível — seguimos sem a rede de segurança */
  }
  return null;
}

/** Lê o lock de PID (corrompido nunca impede o arranque). */
export function readPidLock(home) {
  try {
    const data = JSON.parse(fs.readFileSync(pidFilePath(home), 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return {
      pid: Number.isInteger(data.pid) ? data.pid : null,
      port: Number.isInteger(data.port) ? data.port : null,
      version: typeof data.version === 'string' ? data.version : null,
    };
  } catch {
    return null;
  }
}

function writePidLock(home, pid, port) {
  try {
    fs.writeFileSync(
      pidFilePath(home),
      `${JSON.stringify({ pid, port, version: VISUAL_VERSION, criado: new Date().toISOString() }, null, 2)}\n`,
      'utf8'
    );
  } catch {
    /* lock é melhor esforço — nunca derruba o arranque */
  }
}

export function clearPidLock(home) {
  try {
    fs.unlinkSync(pidFilePath(home));
  } catch {
    /* já removido */
  }
}

/**
 * Mata instâncias anteriores antes de subir uma nova: PIDs do lock + quem
 * estiver dono da porta (o lock pode ficar obsoleto se o processo foi morto
 * externamente). Sem isso cada start empilhava outro servidor zombie e a
 * UI nova era servida por um backend de versão velha.
 */
export async function killPreviousInstances(home, port) {
  let killed = 0;
  const lock = readPidLock(home);
  if (lock?.pid && lock.pid !== process.pid && isAlive(lock.pid)) {
    killTree(lock.pid);
    killed += 1;
  }
  const owner = pidOfPort(port);
  if (owner && owner !== process.pid) {
    killTree(owner);
    killed += 1;
  }
  if (killed > 0) {
    console.log(`Encerrando instância anterior (${killed} processo(s))...`);
    // 1s para o SO liberar arquivos e portas — sem isso o bind pode falhar.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  clearPidLock(home);
  return killed;
}

/* ------------------------------------------------------------------ *
 * Health poll                                                        *
 * ------------------------------------------------------------------ */
async function waitHealth(port, attempts = 40, intervalMs = 500) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Comandos                                                           *
 * ------------------------------------------------------------------ */
function commandInstall({ dataDir }) {
  const home = resolveHome();
  fs.mkdirSync(home, { recursive: true });
  ensureDataDir(home);
  console.log(` Diretório de dados: ${home}`);
  if (!isDataDirHealthy(home)) {
    console.error('[jobfinder] diretório de dados incompleto. Verifique permissões e tente novamente.');
    process.exitCode = 1;
    return;
  }
  console.log('\nPróximos passos:');
  console.log(`  1. Iniciar:  npx --yes @danhachuel/jobfinder@${NPM_VERSION}`);
  console.log(`  2. Abrir:    http://127.0.0.1:4040`);
  console.log(`  3. Parar:    npx --yes @danhachuel/jobfinder@${NPM_VERSION} stop`);
}

/**
 * Sobe o servidor EM BACKGROUND (daemon), a partir do runtime permanente.
 * O terminal volta ao prompt — é o comportamento correto de um daemon.
 */
async function commandDaemon(args) {
  const home = resolveHome();
  fs.mkdirSync(home, { recursive: true });
  ensureDataDir(home);

  const port = args.port || Number(process.env.JOBFINDER_PORT) || 4040;
  const host = args.host || process.env.JOBFINDER_HOST || '127.0.0.1';
  const logFile = path.join(home, 'jobfinder.log');

  // Runtime permanente: sem ele o servidor não sobe (e não vale a pena
  // spawnar um processo que morreria em seguida).
  let entry;
  try {
    entry = resolveServerEntry(home);
  } catch (err) {
    console.error(`[jobfinder] ${err?.message ?? err}`);
    process.exit(1);
    return;
  }

  await killPreviousInstances(home, port);

  console.log(` Iniciando o JobFinder em background (porta ${port})...`);
  console.log(` Log: ${logFile}`);

  // stdio por FD (obrigatório com detached no Windows) — direto no arquivo,
  // NUNCA herdando o console: um terminal hostil não pode perturbar o daemon.
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [entry], {
    detached: true, // CREATE_NEW_PROCESS_GROUP: imune a Ctrl+C do console
    windowsHide: true, // sem janela de console fantasma
    creationFlags: process.platform === 'win32' ? 0x00000200 : 0,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      JOBFINDER_HOME: home,
      JOBFINDER_DATA_DIR: home,
      JOBFINDER_PORT: String(port),
      JOBFINDER_HOST: host,
      JOBFINDER_MODE: 'daemon',
      JOBFINDER_VERSION: VISUAL_VERSION,
      ...(args.dryRun ? { JOBFINDER_DRY_RUN: '1' } : {}),
      ...(process.env.JOBFINDER_NO_WORKER ? { JOBFINDER_NO_WORKER: process.env.JOBFINDER_NO_WORKER } : {}),
    },
  });
  fs.closeSync(logFd); // o filho tem a sua própria cópia herdada
  child.unref(); // o launcher pode morrer sem levar o servidor junto

  if (!child.pid) {
    console.error('[jobfinder] falha ao iniciar o servidor em background.');
    clearPidLock(home);
    process.exit(1);
  }
  writePidLock(home, child.pid, port);

  const up = await waitHealth(port);
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  if (up) {
    console.log('');
    console.log(`JobFinder iniciado em background (PID: ${child.pid}). Acesse http://${shown}:${port}`);
    console.log(`Para encerrar: npx --yes @danhachuel/jobfinder@${NPM_VERSION} stop`);
    return;
  }
  console.error('');
  console.error(`O servidor não respondeu em http://${shown}:${port}/api/health.`);
  console.error(`Diagnóstico completo em: ${logFile}`);
  process.exit(1);
}

/**
 * Foreground (depuração): sobe o servidor do runtime preso a este terminal,
 * com a saída encaminhada por pipe (nunca `inherit`).
 */
async function commandForeground(args) {
  const home = resolveHome();
  fs.mkdirSync(home, { recursive: true });
  ensureDataDir(home);

  const port = args.port || Number(process.env.JOBFINDER_PORT) || 4040;
  const host = args.host || process.env.JOBFINDER_HOST || '127.0.0.1';
  let entry;
  try {
    entry = resolveServerEntry(home);
  } catch (err) {
    console.error(`[jobfinder] ${err?.message ?? err}`);
    process.exit(1);
    return;
  }

  console.log(` JobFinder v${VISUAL_VERSION} (npm: ${NPM_VERSION}) — modo foreground (depuração)`);
  console.log(` Servidor: ${entry}`);
  console.log(` URL     : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(' Pressione Ctrl+C para encerrar.\n');

  const child = spawn(process.execPath, [entry], {
    windowsHide: true,
    creationFlags: process.platform === 'win32' ? 0x00000200 : 0,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      JOBFINDER_HOME: home,
      JOBFINDER_DATA_DIR: home,
      JOBFINDER_PORT: String(port),
      JOBFINDER_HOST: host,
      JOBFINDER_MODE: 'foreground',
      JOBFINDER_VERSION: VISUAL_VERSION,
      ...(args.dryRun ? { JOBFINDER_DRY_RUN: '1' } : {}),
      ...(process.env.JOBFINDER_NO_WORKER ? { JOBFINDER_NO_WORKER: process.env.JOBFINDER_NO_WORKER } : {}),
    },
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.stdout.on('error', (err) => err?.code !== 'EPIPE' && console.error('[jobfinder] stdout', err?.message));
  child.stderr.on('error', (err) => err?.code !== 'EPIPE' && console.error('[jobfinder] stderr', err?.message));

  let stopping = false;
  const stopChild = (signal) => () => {
    if (stopping) process.exit(1); // segundo Ctrl+C força
    stopping = true;
    killTree(child.pid);
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', stopChild('SIGINT'));
  process.on('SIGTERM', stopChild('SIGTERM'));
  process.on('SIGBREAK', stopChild('SIGBREAK'));

  // Âncora inquebrável do launcher: o filho NÃO é detached, mas ainda assim
  // garantimos um handle ativo (runtime-guard).
  setInterval(() => {}, 2147483647);

  const exit = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  console.error(`[jobfinder] servidor encerrou (${exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`}).`);
  clearPidLock(home);
  process.exit(exit.code ?? (exit.signal ? 1 : 0));
}

/** Encerra o daemon: lock de PID + dono da porta (rede de segurança). */
async function commandStop() {
  const home = resolveHome();
  const lock = readPidLock(home);
  // Porta: env > lock > padrão (o lock sabe em qual porta a instância subiu).
  const port = Number(process.env.JOBFINDER_PORT) || lock?.port || 4040;
  let killed = 0;

  const candidates = [lock?.pid, pidOfPort(port)].filter((pid) => pid && pid !== process.pid);
  for (const pid of candidates) {
    if (isAlive(pid)) {
      killTree(pid);
      killed += 1;
    }
  }

  // Confirma que a porta deixou de responder antes de declarar vitória.
  const down = await new Promise(async (resolve) => {
    for (let i = 0; i < 20; i += 1) {
      let up = false;
      try {
        up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      } catch {
        up = false;
      }
      if (!up) return resolve(true);
      await new Promise((r) => setTimeout(r, 300));
    }
    resolve(false);
  });

  clearPidLock(home);
  if (killed > 0 || down) {
    console.log(`JobFinder encerrado (${killed || 1} processo(s)).`);
    return;
  }
  console.log('Nenhuma instância do JobFinder em execução.');
}

/* ------------------------------------------------------------------ *
 * Argumentos                                                         *
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const args = {
    command: null,
    foreground: false,
    port: null,
    host: null,
    dataDir: null,
    dryRun: false,
    help: false,
    version: false,
  };
  const rest = [...argv];
  const first = rest[0];
  if (first && !first.startsWith('-')) {
    args.command = first;
    rest.shift();
  }
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    switch (token) {
      case '--port': args.port = Number(rest[i + 1]); i += 1; break;
      case '--host': args.host = rest[i + 1]; i += 1; break;
      case '--data-dir': args.dataDir = rest[i + 1]; i += 1; break;
      case '--dry-run': args.dryRun = true; break;
      case '--foreground': case '-f': args.foreground = true; break;
      case '--daemon': break; // comportamento padrão; aceito por compatibilidade
      case '--help': case '-h': args.help = true; break;
      case '--version': case '-v': args.version = true; break;
      case 'stop': case 'kill': args.command = 'stop'; break;
      default:
        if (token.startsWith('-')) console.warn(`[jobfinder] ignorando flag desconhecida: ${token}`);
        break;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE.trim());
    return;
  }
  if (args.version) {
    console.log(`JobFinder v${VISUAL_VERSION} (npm: ${NPM_VERSION})`);
    console.log(`os: ${os.type()} ${os.arch()} • node: ${process.version}`);
    console.log(`home: ${resolveHome()}`);
    return;
  }
  if (args.command === 'install') {
    commandInstall(args);
    return;
  }
  if (args.command === 'stop') {
    await commandStop();
    return;
  }
  if (args.foreground) {
    await commandForeground(args);
    return;
  }
  if (args.command === 'start' || args.command === 'daemon' || args.command === null) {
    await commandDaemon(args);
    return;
  }
  console.error(`[jobfinder] comando desconhecido: ${args.command}`);
  console.log(USAGE.trim());
  process.exit(1);
}

await main();