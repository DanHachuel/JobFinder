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
 *
 * Uso: node scripts/manual-tests/startup-keepalive.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

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

const dead = (child) => child.exitCode !== null || child.signalCode !== null;

/** Sobe o app e observa por `observeMs` sem enviar nenhum sinal. */
async function bootAndObserve(label, { args, port, observeMs, env = {} }) {
  console.log(`\n== ${label} ==`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-keepalive-'));
  const home = path.join(tmp, 'data');
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

// 1) launcher: o terminal precisa ficar preso rodando o servidor
{
  const { child } = await bootAndObserve('boot via launcher (node scripts/cli.mjs start)', {
    args: [path.join(ROOT, 'scripts', 'cli.mjs'), 'start', '--no-open'],
    port: 4181,
    observeMs: 9000,
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-keepalive-sig-'));
  const home = path.join(tmp, 'data');
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
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3) injeção de falha: unhandledRejection após o boot não pode matar o processo
{
  console.log('\n== boot com unhandledRejection injetado (killer silencioso) ==');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-keepalive-fault-'));
  const home = path.join(tmp, 'data');
  const fault = path.join(tmp, 'fault.cjs');
  fs.writeFileSync(fault, "setTimeout(() => { Promise.reject(new Error('fault-injection: unhandled rejection')); }, 1200);\n");
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), 'start', '--no-open'], {
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
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 4) stdout quebrado (EPIPE) — ex.: pipe fechado, terminal que some,
//    redirecionamento no Windows/MobaXterm. Não pode matar o processo.
{
  console.log('\n== boot com stdout fechado (EPIPE) ==');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-keepalive-epipe-'));
  const home = path.join(tmp, 'data');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'cli.mjs'), 'start', '--no-open'], {
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
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);