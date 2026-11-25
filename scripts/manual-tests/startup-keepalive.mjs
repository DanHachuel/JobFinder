/**
 * Teste de regressão: o processo do JobFinder NÃO pode encerrar sozinho.
 *
 * Cobre:
 *   1. boot via launcher (node scripts/cli.mjs start) — o terminal deve
 *      ficar preso rodando o servidor; a API responde em localhost
 *   2. boot direto (node src/server/index.mjs) — mesmo comportamento
 *   3. injeção de falha: um unhandledRejection proposital após o boot
 *      NÃO pode matar o processo (era o killer silencioso no Node >= 15)
 *   4. SIGTERM encerra de forma limpa — verificado emitindo o sinal dentro
 *      do próprio processo (no Windows, child.kill() sempre vira
 *      TerminateProcess e os handlers graceful nunca rodam)
 *   5. worker: sobe com o app, o CLI sobrevive ao crash dele (e o
 *      reinicia), modo JOBFINDER_NO_WORKER=1
 *   6. worker direto: rejection injetada -> worker-error.log em disco e o
 *      processo continua vivo; pipes quebrados (EPIPE) não o derrubam;
 *      rename sempre EPERM (arquivo travado no Windows) não o derruba
 *   7. ambiente hostil (arquitetura 0.1.13): servidor Express embutido no
 *      processo do CLI, stdout/stderr destruídos (queda do MobaXterm) e
 *      worker morto — o socket do app.listen() mantém tudo vivo e o HTTP
 *      continua 200, com o worker reiniciado
 *
 * Uso: node scripts/manual-tests/startup-keepalive.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ensureDataDir } from '../../src/server/storage/bootstrap.mjs';

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getStatus(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
  });
}

// Home compartilhado: o runtime permanente (~/.jobfinder/runtime) é instalado
// uma única vez e reaproveitado por todas as seções — cada home novo pagaria
// ~20s de npm install e o teste mediria o instalador, não o keep-alive.
const SHARED_HOME = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-keepalive-')), 'data');
// Diretório dos arquivos de injeção (preloads) das seções de falha.
const PRELOAD_DIR = path.join(SHARED_HOME, 'preloads');
fs.mkdirSync(PRELOAD_DIR, { recursive: true });

const dead = (child) => child.exitCode !== null || child.signalCode !== null;

/** Texto do log JSONL diário de um home (onde o logger escreve). */
const jsonlNow = (home) => {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(home, 'logs', `${day}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

/** Sobe o app e observa por `observeMs` sem enviar nenhum sinal. */
async function bootAndObserve(label, { args, port, observeMs, env = {} }) {
  console.log(`\n== ${label} ==`);
  const home = SHARED_HOME;
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: String(port), JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  await wait(observeMs);
  check('processo continua rodando após o startup (event loop aberto)', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : `vivo após ${observeMs}ms`);
  const status = await getStatus(port, '/api/health');
  check('API responde em localhost', status === 200, `HTTP ${status ?? 'sem resposta'}`);
  return { child, out, home };
}

// 0) AQUECIMENTO: o runtime permanente é preparado uma vez. Desde a 0.1.17 o
// launcher copia o código e instala as dependências antes de subir o servidor
// — sem este passo cada seção pagaria ~20s de npm install e o teste mediria o
// instalador, não o keep-alive.
{
  console.log('\n== aquecimento do runtime permanente ==');
  const warm = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--daemon'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_HOME: SHARED_HOME, JOBFINDER_NO_WORKER: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await new Promise((resolve) => {
    warm.on('exit', () => resolve());
    setTimeout(resolve, 120000);
  });
  const warmSrv = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), 'stop'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_HOME: SHARED_HOME },
    stdio: 'ignore',
  });
  await new Promise((resolve) => {
    warmSrv.on('exit', () => resolve());
    setTimeout(resolve, 30000);
  });
  console.log(`  OK   runtime preparado em ${path.join(SHARED_HOME, 'runtime')}`);
}

// 1) launcher: o terminal precisa ficar preso rodando o servidor
{
  const { child } = await bootAndObserve('boot via launcher (node scripts/cli.mjs --foreground)', {
    args: [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground'],
    port: 4181,
    observeMs: 12000,
  });
  child.kill();
  await wait(5000);
  check('processo encerra ao receber sinal (não fica pendurado)', dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'ainda vivo');
}

// 2) boot direto: mesma garantia, com encerramento gracioso verificado
{
  const { child } = await bootAndObserve('boot direto (node src/server/index.mjs)', {
    args: [path.join(ROOT, 'src', 'server', 'index.mjs')],
    port: 4182,
    observeMs: 7000,
  });
  child.kill();
  await wait(500);

  // Sinal emitido dentro do processo (preload): os handlers graceful rodam
  // em qualquer plataforma — no Windows, child.kill() vira TerminateProcess.
  const home = SHARED_HOME;
    const tmp = PRELOAD_DIR;
  const preload = path.join(tmp, 'sigterm.cjs');
  fs.writeFileSync(preload, "setTimeout(() => process.emit('SIGTERM'), 8000);\n");
  const second = spawn(process.execPath, [path.join(ROOT, 'src', 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4182', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', NODE_OPTIONS: `--require ${preload}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await wait(9500);
  check('encerramento gracioso ao receber SIGTERM (exit 0)', second.exitCode === 0, second.exitCode !== null || second.signalCode !== null ? `exitCode=${second.exitCode} signal=${second.signalCode}` : 'ainda vivo');
  const logs = fs.existsSync(path.join(home, 'logs'))
    ? fs.readdirSync(path.join(home, 'logs')).map((f) => fs.readFileSync(path.join(home, 'logs', f), 'utf8')).join('\n')
    : '';
  check('shutdown gracioso registrado no log', /"shutdown"/.test(logs), logs.split('\n').filter((l) => /shutdown/.test(l))[0] ?? '');
  if (second.exitCode === null && second.signalCode === null) second.kill();
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 3) injeção de falha: unhandledRejection após o boot não pode matar o processo
{
  console.log('\n== boot com unhandledRejection injetado (killer silencioso) ==');
  const home = SHARED_HOME;
    const tmp = PRELOAD_DIR;
  const fault = path.join(tmp, 'fault.cjs');
  fs.writeFileSync(fault, "setTimeout(() => { Promise.reject(new Error('fault-injection: unhandled rejection')); }, 1200);\n");
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4183', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', NODE_OPTIONS: `--require ${fault}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  await wait(9000);
  check('processo sobrevive ao unhandledRejection', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('API responde em localhost', (await getStatus(4183, '/api/health')) === 200);
  check('rejeição foi registrada no log (não engolida em silêncio)', /unhandled promise rejection ignored/i.test(out), out.split('\n').filter((l) => /rejection/i.test(l))[0] ?? '');
  child.kill();
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 4) stdout quebrado (EPIPE) — ex.: pipe fechado, terminal que some,
//    redirecionamento no Windows/MobaXterm. Não pode matar o processo.
{
  console.log('\n== boot com stdout fechado (EPIPE) ==');
  const home = SHARED_HOME;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4184', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await wait(3000);
  // Fecha a ponta de leitura: os próximos console.log geram EPIPE.
  child.stdout.destroy();
  child.stderr.destroy();
  await wait(6000);
  check('processo sobrevive ao stdout quebrado', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('API responde em localhost', (await getStatus(4184, '/api/health')) === 200);
  child.kill();
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 5) o worker sobe junto, bate heartbeat e o CLI continua vivo depois
//    dele (regressao 0.1.7: event loop vazio matava o launcher).
{
  console.log('\n== boot com worker: heartbeat + CLI independente do worker ==');
  const home = SHARED_HOME;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4185', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });

  const workerPid = async () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(home, 'worker-state.json'), 'utf8')).pid ?? null;
    } catch {
      return null;
    }
  };

  await wait(3000);
  const pid0 = await workerPid();
  check('worker spawnado publicou o pid no estado', Boolean(pid0), `pid=${pid0}`);
  // Desde a 0.1.17 os eventos do worker são registrados pelo SERVIDOR no
  // log diário (logs/YYYY-MM-DD.jsonl), não no stdout do launcher.
  const jsonl = () => {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(home, 'logs', `${day}.jsonl`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  };
  check('servidor registrou o início do worker', /worker iniciado pelo servidor/.test(jsonl()));

  await wait(4000); // passa de 1 heartbeat (5s): o guardiao de orfaos rodou
  const pid1 = await workerPid();
  check('worker continua vivo apos os heartbeats (sem falso positivo do guardiao)', pid1 === pid0 && (await getStatus(4185, '/api/health')) === 200, `pid=${pid1}`);

  // CRASH do worker: o CLI NAO pode morrer — so logar (e reiniciar o worker).
  try {
    process.kill(Number(pid1), 'SIGTERM');
  } catch {
    /* processo pode ja ter saido */
  }
  await wait(2500);
  check('CLI sobrevive ao crash do worker', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('saida do worker foi registrada no log', /worker encerrou/i.test(jsonl()), jsonl().split('\n').filter((l) => /worker encerrou/i.test(l))[0]?.slice(0, 120) ?? '');
  check('servidor continua respondendo apos o crash do worker', (await getStatus(4185, '/api/health')) === 200);

  // O launcher supervisiona: um worker novo assume a fila.
  await wait(5000);
  const pid2 = await workerPid();
  check('launcher reiniciou o worker automaticamente', pid2 !== null && pid2 !== pid1, `antes=${pid1} depois=${pid2}`);
  check('restart do worker registrado no log', /worker iniciado pelo servidor/.test(jsonl()) && pid2 !== pid1);
  check('CLI continua vivo depois do restart', !dead(child) && (await getStatus(4185, '/api/health')) === 200);
  child.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 7) worker direto: rejection injetada -> worker-error.log + processo vivo
{
  console.log('\n== worker direto: rejection injetada e log em arquivo ==');
  const home = SHARED_HOME;
  ensureDataDir(home); // o worker exige o skeleton (como o launcher faz)
  const tmp = PRELOAD_DIR;
  const fault = path.join(tmp, 'fault.cjs');
  fs.writeFileSync(fault, "setTimeout(() => { Promise.reject(new Error('fault-injection: worker rejection')); }, 1200);\n");
  const worker = spawn(process.execPath, [path.join(ROOT, 'src', 'server', 'worker.mjs')], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', JOBFINDER_WORKER_INTERVAL: '4000', NODE_OPTIONS: `--require ${fault}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  worker.stdout.on('data', (d) => { out += String(d); });
  worker.stderr.on('data', (d) => { out += String(d); });
  await wait(8000);
  check('worker sobrevive a rejection (nao morre silencioso)', !dead(worker), dead(worker) ? `exitCode=${worker.exitCode} signal=${worker.signalCode}` : 'vivo');
  let errorLog = '';
  try {
    errorLog = fs.readFileSync(path.join(home, 'worker-error.log'), 'utf8');
  } catch {
    /* arquivo pode nao existir */
  }
  check('worker-error.log registrou a falha', /fault-injection: worker rejection/.test(errorLog), errorLog.split('\n')[0]?.slice(0, 100) ?? 'vazio');
  check('falha tambem apareceu no console', /unhandled promise rejection ignored/i.test(out));
  worker.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 8) worker direto: stdout/stderr quebrados (EPIPE) -> worker segue vivo
{
  console.log('\n== worker direto: EPIPE nos pipes ==');
  const home = SHARED_HOME;
  ensureDataDir(home); // o worker exige o skeleton (como o launcher faz)
  const worker = spawn(process.execPath, [path.join(ROOT, 'src', 'server', 'worker.mjs')], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', JOBFINDER_WORKER_INTERVAL: '4000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', () => {});
  worker.stderr.on('data', () => {});
  await wait(3000);
  worker.stdout.destroy();
  worker.stderr.destroy();
  await wait(6000);
  check('worker sobrevive ao EPIPE', !dead(worker), dead(worker) ? `exitCode=${worker.exitCode} signal=${worker.signalCode}` : 'vivo');
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(path.join(home, 'worker-state.json'), 'utf8'));
  } catch {
    /* arquivo pode nao existir */
  }
  check('heartbeat continua sendo publicado sem o console', Boolean(state?.pid) && state.pid === worker.pid, `pid=${state?.pid}`);
  worker.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 9) worker direto: rename SEMPRE EPERM (antivirus/arquivo travado no
//    Windows) -> o worker NAO morre; o erro vai para worker-error.log e a
//    escrita é tentada de novo no próximo tick/heartbeat.
{
  console.log('\n== worker direto: EPERM no rename (arquivo travado) ==');
  const home = SHARED_HOME;
  ensureDataDir(home);
    const tmp = PRELOAD_DIR;
  const sabotage = path.join(tmp, 'eperm.cjs');
  fs.writeFileSync(
    sabotage,
    `const fs = require('node:fs');\n` +
    `const real = fs.renameSync.bind(fs);\n` +
    `fs.renameSync = (from, to) => {\n` +
    `  if (String(to).endsWith('worker-state.json')) {\n` +
    `    const err = new Error('EPERM: operation not permitted, rename');\n` +
    `    err.code = 'EPERM';\n` +
    `    throw err;\n` +
    `  }\n` +
    `  return real(from, to);\n` +
    `};\n`
  );
  const worker = spawn(process.execPath, [path.join(ROOT, 'src', 'server', 'worker.mjs')], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', JOBFINDER_WORKER_INTERVAL: '4000', NODE_OPTIONS: `--require ${sabotage}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  worker.stdout.on('data', (d) => { out += String(d); });
  worker.stderr.on('data', (d) => { out += String(d); });
  await wait(9000);
  check('worker sobrevive ao EPERM no rename', !dead(worker), dead(worker) ? `exitCode=${worker.exitCode} signal=${worker.signalCode}` : 'vivo');
  let errorLog = '';
  try {
    errorLog = fs.readFileSync(path.join(home, 'worker-error.log'), 'utf8');
  } catch {
    /* arquivo pode nao existir */
  }
  check('EPERM registrado em worker-error.log', /EPERM/.test(errorLog), errorLog.split('\n')[0]?.slice(0, 100) ?? 'vazio');
  check('worker-state write failed registrado (não engolido em silêncio)', /worker-state write failed/i.test(errorLog));
  worker.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 6) JOBFINDER_NO_WORKER=1: modo sem worker, CLI continua vivo
{
  console.log('\n== boot sem worker (JOBFINDER_NO_WORKER=1) ==');
  const home = SHARED_HOME;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4187', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1', JOBFINDER_NO_WORKER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  await wait(6000);
  check('CLI continua rodando sem worker', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('nenhum worker foi spawnado (desativado no log do servidor)', /desativado por JOBFINDER_NO_WORKER/.test(jsonlNow(home)), jsonlNow(home).split('\n').filter((l) => /JOBFINDER_NO_WORKER/.test(l))[0]?.slice(0, 120) ?? '');
  check('API responde em localhost', (await getStatus(4187, '/api/health')) === 200);
  child.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

// 10) ARQUITETURA 0.1.13: servidor DENTRO do processo do CLI + ambiente
//     hostil. Destrói o stdout/stderr do launcher (simulando a queda do
//     MobaXterm) e mata o worker à força: o socket do app.listen() mantém
//     o processo vivo e respondendo HTTP 200 — e o worker é reiniciado.
{
  console.log('\n== ambiente hostil: stdout destruído + worker morto (servidor embutido) ==');
  const home = SHARED_HOME;
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), '--foreground', '--no-open'], {
    cwd: ROOT,
    env: { ...process.env, JOBFINDER_PORT: '4190', JOBFINDER_DATA_DIR: home, JOBFINDER_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });

  const workerPid = async () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(home, 'worker-state.json'), 'utf8')).pid ?? null;
    } catch {
      return null;
    }
  };

  await wait(5000);
  const pid0 = await workerPid();
  check('servidor embutido subiu pelo CLI (HTTP 200 antes do caos)', (await getStatus(4190, '/api/health')) === 200, `worker pid=${pid0}`);

  // Queda do terminal: a ponta de leitura dos pipes do launcher é destruída.
  child.stdout.destroy();
  child.stderr.destroy();
  await wait(1000);
  check('CLI sobrevive à destruição do stdout/stderr', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('servidor continua respondendo após o stdout cair', (await getStatus(4190, '/api/health')) === 200);

  // Morte forçada do worker (Task Manager / kill externo).
  try {
    process.kill(Number(pid0), 'SIGTERM');
  } catch {
    /* processo pode ja ter saido */
  }
  await wait(6000);
  check('CLI sobrevive à morte do worker', !dead(child), dead(child) ? `exitCode=${child.exitCode} signal=${child.signalCode}` : 'vivo');
  check('servidor continua respondendo após a morte do worker', (await getStatus(4190, '/api/health')) === 200);
  const pid1 = await workerPid();
  check('worker foi reiniciado pelo launcher', pid1 !== null && pid1 !== pid0, `antes=${pid0} depois=${pid1}`);
  child.kill();
  await wait(800);
  /* preloads vivem em PRELOAD_DIR (compartilhado entre as seções) */
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);