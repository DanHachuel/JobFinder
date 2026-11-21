/**
 * Reprodução do cenário real: `npx @danhachuel/jobfinder@<versão>` rodando a
 * partir de um diretório ESTRANHO (fora do repo), como o usuário faz no
 * MobaXterm / PowerShell.
 *
 * Verifica:
 *   1. a versão impressa é a correta (não 0.0.00)
 *   2. o processo continua vivo depois do banner (event loop retido)
 *   3. o servidor responde HTTP 200
 *   4. o terminal não volta ao prompt sozinho
 *
 * Uso: node scripts/manual-tests/fase4-npx-start.mjs [versao]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const VERSION = process.argv[2] ?? '0.1.14';
const PORT = 4366;
const HOME = path.join(os.tmpdir(), `jobfinder-npx-${Date.now()}`);
// Diretório "estranho": fora do repositório, como a home do MobaXterm.
const FOREIGN_CWD = path.join(os.tmpdir(), `mobaXterm-home-${Date.now()}`);
fs.mkdirSync(FOREIGN_CWD, { recursive: true });

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

console.log(`\n== JobFinder (build local) em ${FOREIGN_CWD} ==`);
console.log('(equivalente ao `npx @danhachuel/jobfinder@<versao>`: mesmo cwd estranho, mesmo binário)');

// Roda o CLI LOCAL a partir de um diretório estranho — reproduz o ambiente do
// npx (cwd != raiz do pacote) sem depender de publicação prévia.
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', '..');
const cli = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'cli.mjs'), 'start', '--port', String(PORT)], {
  cwd: FOREIGN_CWD,
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const npx = cli;

let out = '';
let err = '';
npx.stdout.on('data', (d) => { out += String(d); });
npx.stderr.on('data', (d) => { err += String(d); });

const alive = async () => new Promise((resolve) => {
  if (npx.exitCode !== null || npx.signalCode !== null) return resolve(false);
  npx.kill(0);
  resolve(true);
});

// 1. espera o servidor subir
let httpOk = false;
for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) { httpOk = true; break; }
  } catch { /* ainda subindo */ }
  await delay(1000);
}
check('servidor respondeu HTTP na porta', httpOk);

// 2. versão correta no output (a linha do servidor, não só o banner do CLI)
const serverLine = out.split('\n').find((l) => l.includes('listening on')) ?? '';
const versionLine = out.split('\n').find((l) => /^JobFinder\s+v?\d/.test(l.trim())) ?? '';
check('versão correta (não 0.0.00)', /v0\.1\.\d+/.test(versionLine) && !versionLine.includes('0.0.00'), versionLine.trim());
check('linha do listen traz a versão correta', /0\.1\.\d+/.test(serverLine) && !serverLine.includes('0.0.00'), serverLine.trim());

// 3. o processo PRECISA continuar vivo (não voltar ao prompt)
await delay(8000);
const stillAlive = await alive();
check('processo npx continua vivo após 8s do listen', stillAlive, `exitCode=${npx.exitCode} signal=${npx.signalCode}`);

// 4. HTTP continua respondendo depois (prova que não morreu)
const httpAfter = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok).catch(() => false);
check('HTTP 200 depois da espera', httpAfter);

// 5. rastro forense: se morreu, o motivo tem que estar visível
if (!stillAlive) {
  console.log('--- stdout ---'); console.log(out);
  console.log('--- stderr ---'); console.log(err);
}

check('nenhum "launcher exiting" prematuro no log', !err.includes('launcher exiting') && !out.includes('launcher exiting'), err.split('\n').filter((l) => l.includes('launcher exiting')).slice(0, 1).join(''));

try { npx.kill('SIGTERM'); } catch { /* já morreu */ }
await delay(500);
try { npx.kill('SIGKILL'); } catch { /* já morreu */ }

// ------------------------------------------------------------------ *
// Caminho 2: `node src/server/index.mjs` DIRETO, de um cwd estranho e SEM
// JOBFINDER_VERSION — valida o createRequire(import.meta.url) puro.
// ------------------------------------------------------------------ *
console.log('\n== node src/server/index.mjs direto (sem JOBFINDER_VERSION) ==');
const direct = spawn(process.execPath, [path.join(REPO_ROOT, 'src', 'server', 'index.mjs')], {
  cwd: FOREIGN_CWD,
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_PORT: String(PORT + 1), JOBFINDER_NO_WORKER: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let directOut = '';
direct.stdout.on('data', (d) => { directOut += String(d); });
direct.stderr.on('data', (d) => { directOut += String(d); });
let directHttp = false;
for (let i = 0; i < 40; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT + 1}/api/health`)).ok) { directHttp = true; break; }
  } catch { /* subindo */ }
  await delay(500);
}
check('servidor direto respondeu HTTP', directHttp);
const directLine = directOut.split('\n').find((l) => l.includes('listening on')) ?? '';
check('versão correta sem env override (createRequire)', /0\.1\.\d+/.test(directLine) && !directLine.includes('0.0.00'), directLine.trim());
await delay(3000);
check('servidor direto continua vivo', direct.exitCode === null && direct.signalCode === null, `exitCode=${direct.exitCode}`);
try { direct.kill('SIGTERM'); } catch { /* já morreu */ }
await delay(500);
try { direct.kill('SIGKILL'); } catch { /* já morreu */ }

// ------------------------------------------------------------------ *
// Caminho 3: caminho padrão COMPLETO, com o worker ativo (como o usuário
// really roda) — o worker não pode derrubar o launcher.
// ------------------------------------------------------------------ *
console.log('\n== caminho padrão com worker ativo ==');
const full = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'cli.mjs'), 'start', '--port', String(PORT + 2)], {
  cwd: FOREIGN_CWD,
  env: { ...process.env, JOBFINDER_HOME: HOME },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let fullOut = '';
full.stdout.on('data', (d) => { fullOut += String(d); });
full.stderr.on('data', (d) => { fullOut += String(d); });
let fullHttp = false;
for (let i = 0; i < 40; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT + 2}/api/health`)).ok) { fullHttp = true; break; }
  } catch { /* subindo */ }
  await delay(500);
}
check('app completo (com worker) respondeu HTTP', fullHttp);
await delay(6000);
check('app completo continua vivo', full.exitCode === null && full.signalCode === null, `exitCode=${full.exitCode} signal=${full.signalCode}`);
const workerPids = fullOut.split('\n').filter((l) => l.includes('Worker')).slice(0, 1).join('');
check('worker foi anunciado', /Worker\s+:/.test(fullOut), workerPids.trim());
try { full.kill('SIGTERM'); } catch { /* já morreu */ }
await delay(3000);
try { full.kill('SIGKILL'); } catch { /* já morreu */ }

console.log('\n--- saída capturada ---');
console.log(out.split('\n').filter(Boolean).slice(0, 20).join('\n'));
if (err.trim()) { console.log('--- stderr ---'); console.log(err.split('\n').filter(Boolean).slice(0, 10).join('\n')); }

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);