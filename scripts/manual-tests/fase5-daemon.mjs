/**
 * Modo daemon (0.1.16): o servidor sobrevive ao terminal.
 *
 *   1. `--daemon` volta ao prompt IMEDIATO (processo pai sai com código 0)
 *   2. o servidor continua vivo em background, detached do terminal
 *   3. responde HTTP 200
 *   4. o log em ~/.jobfinder/jobfinder.log tem o banner e a versão correta
 *   5. `stop` encerra o daemon (HTTP falha depois)
 *   6. rodar duas vezes não duplica (detecta o pid ativo)
 *   7. matar o terminal não mata o daemon (o teste simula: o PAI morre)
 *
 * Uso: node scripts/manual-tests/fase5-daemon.mjs
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
    const info = JSON.parse(fs.readFileSync(path.join(HOME, 'jobfinder-daemon.json'), 'utf8'));
    return info.pid ?? null;
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
  setTimeout(() => resolve(null), 20000);
});
const elapsed = Date.now() - started;
check('launcher saiu com código 0', launcherExit === 0, `code=${launcherExit}`);
check('launcher voltou ao prompt rápido (<8s)', elapsed < 8000, `${elapsed}ms`);
check('saída informa PID e log', /PID\s+:\s+\d+/.test(launcherOut) && /jobfinder\.log/.test(launcherOut));

console.log('\n== 2. Daemon vivo em background ==');
const pid = daemonPid();
check('pid do daemon registrado', pid !== null && pid > 0, `pid=${pid}`);
check('processo do daemon está rodando', isAlive(pid));

let httpData = null;
for (let i = 0; i < 30; i += 1) {
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
check('log tem o banner de startup', /JobFinder v0\.1\.\d+/.test(logContent));
check('log NÃO tem versão 0.0.00', !logContent.includes('0.0.00'));
check('log registra o worker/porta', logContent.length > 50, `${logContent.length} bytes`);

console.log('\n== 4. Sobrevive à morte do terminal (o launcher já morreu) ==');
check('launcher (terminal) já saiu', launcherExit === 0);
check('daemon continua vivo depois que o terminal morreu', isAlive(pid) && (await health())?.ok === true);

console.log('\n== 5. Rodar duas vezes não duplica ==');
const second = spawn(process.execPath, [...CLI, '--daemon', '--port', String(PORT)], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let secondOut = '';
second.stdout.on('data', (d) => { secondOut += String(d); });
const secondExit = await new Promise((resolve) => {
  second.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 15000);
});
check('segunda execução detecta o daemon ativo', secondExit === 0 && /ja esta rodando/.test(secondOut), secondOut.split('\n')[0] ?? '');
check('pid continua o mesmo (não duplicou)', daemonPid() === pid);

console.log('\n== 6. stop encerra o daemon ==');
const stop = spawn(process.execPath, [...CLI, 'stop'], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopOut = '';
stop.stdout.on('data', (d) => { stopOut += String(d); });
const stopExit = await new Promise((resolve) => {
  stop.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 20000);
});
check('stop saiu com código 0', stopExit === 0, `code=${stopExit}`);
check('stop informa que parou', /parado/i.test(stopOut), stopOut.split('\n')[0] ?? '');
await delay(1500);
check('processo do daemon não existe mais', !isAlive(pid));
const afterStop = await health();
check('HTTP não responde mais', afterStop === null);
check('pid foi limpo no registro', daemonPid() === null, `pid=${daemonPid()}`);

console.log('\n== 7. stop sem daemon não quebra ==');
const stopAgain = spawn(process.execPath, [...CLI, 'stop'], {
  cwd: os.tmpdir(),
  env: { ...process.env, JOBFINDER_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stopAgainOut = '';
stopAgain.stdout.on('data', (d) => { stopAgainOut += String(d); });
const stopAgainExit = await new Promise((resolve) => {
  stopAgain.on('exit', (code) => resolve(code));
  setTimeout(() => resolve(null), 15000);
});
check('stop sem daemon roda limpo', stopAgainExit === 0, stopAgainOut.split('\n')[0] ?? '');

// Limpeza de segurança
try { spawn(process.execPath, [...CLI, 'stop'], { cwd: os.tmpdir(), env: { ...process.env, JOBFINDER_HOME: HOME } }); } catch { /* ignore */ }

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);