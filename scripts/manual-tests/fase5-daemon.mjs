/**
 * Modo daemon (0.1.17): runtime permanente + daemon (arquitetura PandaNews).
 *
 *   1. `--daemon` (agora o PADRÃO) volta ao prompt imediatamente
 *   2. o servidor continua vivo em background, a partir do runtime permanente
 *   3. responde HTTP 200 e grava o log em ~/.jobfinder/jobfinder.log
 *   4. o lock ~/.jobfinder/jobfinder.pid registra a instância
 *   5. rodar duas vezes não duplica (mata a anterior)
 *   6. `stop` encerra o daemon e limpa o lock
 *
 * Uso: node scripts/manual-tests/fase5-daemon.mjs
 * Nota: a cobertura completa do runtime está em fase6-runtime-daemon.mjs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4455;
const HOME = path.join(os.tmpdir(), `jobfinder-fase5-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..');
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

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function daemonPid() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'jobfinder.pid'), 'utf8')).pid ?? null;
  } catch {
    return null;
  }
}

async function health() {
  try {
    const res = await fetch(`${APP}/api/health`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const CLI = [path.join(REPO, 'scripts', 'cli.mjs')];

/* ------------------------------------------------------------------ */
console.log('\n== 1. --daemon volta ao prompt imediatamente ==');
const started = Date.now();
const launcher = spawn(process.execPath, [...CLI, '--daemon', '--port', String(PORT)], {
  cwd: os.tmpdir(), // cwd estranho, como o do usuário
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let launcherOut = '';
launcher.stdout.on('data', (d) => { launcherOut += String(d); });
launcher.stderr.on('data', (d) => { launcherOut += String(d); });

const launcherExit = await new Promise((resolve) => {
  launcher.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 120000);
});
const elapsed = Date.now() - started;
check('launcher saiu com código 0', launcherExit === 0, `code=${launcherExit}`);
check('launcher voltou ao prompt rápido (<60s, inclui preparar o runtime)', elapsed < 60000, `${elapsed}ms`);
check('saída informa PID e URL', /iniciado em background \(PID: \d+\)/.test(launcherOut) && /http:\/\/127\.0\.0\.1:\d+/.test(launcherOut));

console.log('\n== 2. Daemon vivo em background ==');
const pid = daemonPid();
check('pid do daemon registrado no lock', pid !== null && pid > 0, `pid=${pid}`);
check('processo do daemon está rodando', isAlive(pid));

let httpData = null;
for (let i = 0; i < 40; i += 1) {
  httpData = await health();
  if (httpData) break;
  await delay(500);
}
check('daemon responde HTTP 200', httpData?.ok === true, httpData ? `version=${httpData.version}` : 'sem resposta');
check('versão correta no /health (não 0.0.00)', /0\.1\.\d+/.test(httpData?.version ?? ''), httpData?.version);

console.log('\n== 3. Log em disco ==');
const logFile = path.join(HOME, 'jobfinder.log');
check('arquivo de log existe', fs.existsSync(logFile));
const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
check('log tem o banner do servidor', new RegExp('JobFinder v0\\.1\\.\\d+').test(logContent));
check('log NÃO tem versão 0.0.00', !logContent.includes('0.0.00'));
check('runtime permanente existe', fs.existsSync(path.join(HOME, 'runtime', 'src', 'server', 'index.mjs')));

console.log('\n== 4. Rodar duas vezes não duplica ==');
const second = spawn(process.execPath, [...CLI, '--daemon', '--port', String(PORT)], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let secondOut = '';
second.stdout.on('data', (d) => { secondOut += String(d); });
const secondExit = await new Promise((resolve) => {
  second.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 120000);
});
check('segunda execução volta ao prompt', secondExit === 0, `code=${secondExit}`);
check('segunda execução detecta/substitui a instância', /iniciado em background/.test(secondOut) || /ja esta rodando/.test(secondOut), secondOut.split('\n')[0] ?? '');
const pid2 = daemonPid();
check('lock aponta para uma única instância', isAlive(pid2) && (await health())?.ok === true);
check('pid anterior não está mais vivo', !isAlive(pid) || pid === pid2, `antigo=${pid} novo=${pid2}`);
check('servidor responde depois do restart', (await health())?.ok === true);

console.log('\n== 5. stop encerra o daemon ==');
const stop = spawn(process.execPath, [...CLI, 'stop'], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopOut = '';
stop.stdout.on('data', (d) => { stopOut += String(d); });
const stopExit = await new Promise((resolve) => {
  stop.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 60000);
});
const stopAll = stopOut; // lido após o exit
check('stop saiu com código 0', stopExit === 0, `code=${stopExit}`);
check('stop informa o encerramento', /encerrado|Nenhuma instância/i.test(stopAll), stopAll.split('\n')[0] ?? '');
await delay(1500);
check('lock foi limpo', daemonPid() === null, `pid=${daemonPid()}`);
check('porta não responde mais', (await health()) === null);
check('processo do daemon não existe mais', !isAlive(pid2));

console.log('\n== 6. stop sem daemon não quebra ==');
const stopAgain = spawn(process.execPath, [...CLI, 'stop'], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopAgainOut = '';
stopAgain.stdout.on('data', (d) => { stopAgainOut += String(d); });
const stopAgainExit = await new Promise((resolve) => {
  stopAgain.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 30000);
});
check('stop sem daemon roda limpo', stopAgainExit === 0, stopAgainOut.split('\n')[0] ?? '');

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);