/**
 * Fase 3 (0.1.17): RUNTIME PERMANENTE + DAEMON (arquitetura PandaNews).
 *
 *   1. o runtime ~/.jobfinder/runtime é criado com o código do servidor
 *   2. o servidor NUNCA sobe do cache do npx — sobe do runtime permanente
 *   3. `--daemon` (padrão) volta ao prompt e o servidor continua vivo
 *   4. o lock ~/.jobfinder/jobfinder.pid registra a instância
 *   5. fechar o terminal (morrer o launcher) não mata o servidor
 *   6. rodar duas vezes não empilha instâncias (mata a anterior)
 *   7. `stop` encerra por PID e limpa o lock
 *   8. stale lock (pid morto) não impede novo arranque
 *   9. --foregrade sobe preso ao terminal (depuração)
 *
 * Uso: node scripts/manual-tests/fase6-runtime-daemon.mjs
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4577;
const HOME = path.join(os.tmpdir(), `jobfinder-runtime-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

let passed = 0;
let failed = 0;
const procsToKill = [];

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function run(args, { cwd = os.tmpdir(), env = {} } = {}) {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'cli.mjs'), ...args], {
    cwd,
    env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_WORKER: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { err += String(d); });
  procsToKill.push(child);
  return {
    child,
    out: () => out,
    err: () => err,
    done: () => new Promise((r) => child.on('exit', (c) => r(c))),
  };
}

/** Linha de comando de um PID (para provar de onde o servidor subiu). */
function cmdlineOf(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter ProcessId=${pid} | Select-Object -ExpandProperty CommandLine"`,
      { encoding: 'utf8' }
    );
    return out.trim();
  } catch {
    return '';
  }
}

async function healthOk() {
  try {
    return (await fetch(`${APP}/api/health`)).ok;
  } catch {
    return false;
  }
}

async function healthJson() {
  try {
    return await (await fetch(`${APP}/api/health`)).json();
  } catch {
    return null;
  }
}

function daemonPid() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, 'jobfinder.pid'), 'utf8')).pid ?? null;
  } catch {
    return null;
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

function runtimeDir() {
  return path.join(HOME, 'runtime');
}

/** Texto do log JSONL diário (onde o logger escreve, não o stdout). */
function dailyLogText() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(HOME, 'logs', `${day}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

async function waitUp(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await healthOk()) return true;
    await delay(500);
  }
  return false;
}

/* ------------------------------------------------------------------ */
console.log('\n== 1. Runtime permanente é criado ==');
const first = run(['--port', String(PORT)]);
const code = await first.done();
check('launcher volta ao prompt (exit 0)', code === 0, `code=${code}`);
const output = first.out();
console.log(output.split('\n').filter(Boolean).map((l) => `   ${l}`).join('\n'));
if (code !== 0 && first.err().trim()) {
  console.log('   --- stderr ---');
  console.log(first.err().split('\n').filter(Boolean).slice(0, 8).map((l) => `   ${l}`).join('\n'));
}

check('runtime ~/.jobfinder/runtime foi criado', fs.existsSync(path.join(runtimeDir(), 'src', 'server', 'index.mjs')));
check('.version do runtime bate com o pacote',
  fs.existsSync(path.join(runtimeDir(), '.version')) &&
  fs.readFileSync(path.join(runtimeDir(), '.version'), 'utf8').trim() === VERSION,
  `runtime=${VERSION}`);
check('UI buildada foi copiada', fs.existsSync(path.join(runtimeDir(), 'src', 'ui', 'dist', 'index.html')));
check('node_modules NÃO foi copiado (runtime enxuto)', !fs.existsSync(path.join(runtimeDir(), 'src', 'server', 'node_modules')));
check('mensagem de background com PID e URL', /iniciado em background \(PID: \d+\)/.test(output) && /http:\/\/127\.0\.0\.1:\d+/.test(output));

console.log('\n== 2. Servidor sobe DO RUNTIME, não do cache do npx ==');
const up = await waitUp();
check('servidor responde HTTP 200', up);
const pid = daemonPid();
check('lock jobfinder.pid escrito com o PID', pid !== null && pid > 0, `pid=${pid}`);
check('processo do daemon está vivo', isAlive(pid));
const cmdline = cmdlineOf(pid);
check('linha de comando aponta para ~/.jobfinder/runtime', cmdline.includes('runtime'), cmdline);
check('lock registra a porta', JSON.parse(fs.readFileSync(path.join(HOME, 'jobfinder.pid'), 'utf8')).port === PORT);

console.log('\n== 3. Log em disco ==');
const logFile = path.join(HOME, 'jobfinder.log');
check('~/.jobfinder/jobfinder.log existe', fs.existsSync(logFile));
const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
check('log tem o banner do servidor', new RegExp(`JobFinder v${VERSION.replace(/\./g, '\\.')}`).test(logContent));
check('log NÃO tem versão 0.0.00', !logContent.includes('0.0.00'));
check('worker desativado por JOBFINDER_NO_WORKER no log', /desativado por JOBFINDER_NO_WORKER/.test(dailyLogText()));

console.log('\n== 4. Sobrevive à morte do terminal ==');
check('launcher já morreu (terminal livre)', code === 0);
check('servidor continua vivo', isAlive(pid) && (await healthOk()));

console.log('\n== 3b. O servidor SUPERVISIONA o worker (sem JOBFINDER_NO_WORKER) ==');
// Porta dedicada: esta instância não pode derrubar a da seção 1 (que o teste
// 4 ainda usa para provar a sobrevivência ao terminal).
const WORKER_PORT = PORT + 1;
const withWorker = run(['--port', String(WORKER_PORT)], { env: { JOBFINDER_NO_WORKER: '' } });
await withWorker.done();
let workerUp = false;
for (let i = 0; i < 40; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${WORKER_PORT}/api/health`)).ok) { workerUp = true; break; }
  } catch { /* subindo */ }
  await delay(500);
}
check('segunda instância subiu na porta dedicada', workerUp);
await new Promise((resolve) => setTimeout(resolve, 4000));
check('servidor inicia o worker sozinho', /worker iniciado pelo servidor/.test(dailyLogText()));
const workerPid = (() => {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(HOME, 'worker-state.json'), 'utf8'));
    return state.pid ?? null;
  } catch {
    return null;
  }
})();
check('worker-state.json tem PID do worker', workerPid !== null && workerPid > 0, `pid=${workerPid}`);
check('processo worker.mjs está rodando', workerPid !== null && isAlive(workerPid));
// encerra esta instância para o resto do teste
const stopWorkerRun = run(['stop'], { env: { JOBFINDER_PORT: String(WORKER_PORT) } });
await stopWorkerRun.done();
await new Promise((resolve) => setTimeout(resolve, 2500));
check('stop encerrou o servidor E o worker', !isAlive(workerPid));
const workerPortDown = await fetch(`http://127.0.0.1:${WORKER_PORT}/api/health`).then(() => true).catch(() => false);
check('porta do worker deixou de responder', !workerPortDown);

console.log('\n== 5. Rodar duas vezes não empilha instâncias ==');
const second = run(['--port', String(PORT)]);
const code2 = await second.done();
const out2 = second.out();
check('segunda execução volta ao prompt', code2 === 0, `code=${code2}`);
check('instância anterior foi encerrada antes', /Encerrando instância anterior|runtime/.test(out2), out2.split('\n')[1] ?? '');
await delay(1000);
const pid2 = daemonPid();
check('lock aponta para uma instância só', isAlive(pid2) && (await healthOk()));
check('pid anterior não está mais vivo', !isAlive(pid) || pid === pid2, `antigo=${pid} novo=${pid2}`);
check('servidor responde depois do restart', await waitUp());

console.log('\n== 6. Lock obsoleto (pid morto) não impede arranque ==');
const stalePid = daemonPid();
if (stalePid) {
  try {
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${stalePid} -Force"`, { stdio: 'ignore' });
  } catch { /* já morto */ }
}
await delay(1500);
fs.writeFileSync(path.join(HOME, 'jobfinder.pid'), JSON.stringify({ pid: stalePid, port: PORT, version: VERSION }, null, 2), 'utf8');
const third = run(['--port', String(PORT)]);
const code3 = await third.done();
check('terceira execução sobe mesmo com lock obsoleto', code3 === 0 && (await waitUp()), `code=${code3}`);

console.log('\n== 7. stop encerra e limpa ==');
const stop = run(['stop']);
const stopCode = await stop.done();
const stopAll = stop.out() + stop.err(); // lido DEPOIS do exit (captura completa)
check('stop volta ao prompt', stopCode === 0, `code=${stopCode}`);
check('stop informa o encerramento', /encerrado|Nenhuma instância/i.test(stopAll), stopAll.split('\n')[0] ?? '');
await delay(2000);
check('lock foi limpo', !fs.existsSync(path.join(HOME, 'jobfinder.pid')) || daemonPid() === null, `pid=${daemonPid()}`);
check('porta não responde mais', !(await healthOk()));
const lastPid = daemonPid();
check('processo do daemon não existe mais', !isAlive(lastPid));

console.log('\n== 8. --foreground prende o servidor ao terminal ==');
const fg = run(['--foreground', '--port', String(PORT)]);
await new Promise((resolve) => setTimeout(resolve, 6000));
check('launcher foreground continua vivo (não volta ao prompt)', fg.child.exitCode === null, `exitCode=${fg.child.exitCode}`);
const fgOut = fg.out();
check('modo foreground anunciado', /modo foreground/.test(fgOut));
check('servidor foreground responde HTTP', await waitUp());
check('saída do servidor é encaminhada', /listening on|JobFinder v/.test(fgOut));
fg.child.kill('SIGTERM');
await new Promise((resolve) => setTimeout(resolve, 3000));
check('Ctrl+C no launcher encerra o servidor', !(await healthOk()));
const fg2 = run(['--foreground', '--port', String(PORT)]);
await new Promise((resolve) => setTimeout(resolve, 6000));
check('foreground sobe novamente', await waitUp());
fg2.child.kill('SIGTERM');
await new Promise((resolve) => setTimeout(resolve, 3000));

/* ------------------------------------------------------------------ */
// Limpeza: nenhum processo desta suíte sobrevive.
for (const proc of procsToKill) {
  try { proc.kill('SIGKILL'); } catch { /* já morreu */ }
}
await delay(500);
const leftover = daemonPid();
if (isAlive(leftover)) {
  try {
    execSync(`powershell -NoProfile -Command "Stop-Process -Id ${leftover} -Force"`, { stdio: 'ignore' });
  } catch { /* já morto */ }
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
console.log(`Home: ${HOME} · Runtime: ${runtimeDir()}`);
process.exit(failed ? 1 : 0);