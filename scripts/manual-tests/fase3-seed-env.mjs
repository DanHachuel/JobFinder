/**
 * Onboarding do primeiro acesso por variável de ambiente (0.1.14).
 *
 * Prova o comportamento real do seed:
 *   1. com JOBFINDER_INITIAL_EMAIL/PASSWORD definidos, o login usa ESSAS credenciais
 *   2. as credenciais do seed embutido NÃO funcionam mais (override real)
 *   3. nenhuma rota/devolve credencial (a rota /auth/defaults deixou de existir)
 *   4. auth.json guarda apenas o hash — nunca a senha em texto puro
 *
 * Uso: node scripts/manual-tests/fase3-seed-env.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4155;
const HOME = path.join(os.tmpdir(), `jobfinder-fase3-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
const ENV_EMAIL = 'operador@empresa.com';
const ENV_PASSWORD = 'senha-inicial-forte';

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

async function api(method, endpoint, body, cookie = '') {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${APP}/api${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function waitUp(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

const server = spawn(process.execPath, ['src/server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    JOBFINDER_HOME: HOME,
    JOBFINDER_PORT: String(PORT),
    JOBFINDER_INITIAL_EMAIL: ENV_EMAIL,
    JOBFINDER_INITIAL_PASSWORD: ENV_PASSWORD,
    JOBFINDER_NO_WORKER: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => { serverOut += String(d); });
server.stderr.on('data', (d) => { serverOut += String(d); });

try {
  console.log('\n== Seed por variável de ambiente ==');
  check('servidor subiu', await waitUp());

  await delay(500);
  const authFile = JSON.parse(fs.readFileSync(path.join(HOME, 'auth.json'), 'utf8'));
  check('auth.json foi criado com o e-mail do ambiente', authFile.user.email === ENV_EMAIL, authFile.user.email);
  check('auth.json NÃO contém a senha em texto puro', !JSON.stringify(authFile).includes(ENV_PASSWORD));

  const loginEnv = await api('POST', '/auth/login', { email: ENV_EMAIL, password: ENV_PASSWORD });
  check('login com as credenciais do ambiente funciona', loginEnv.status === 200, `status ${loginEnv.status}`);

  // Re-login capturing the session cookie for the authenticated calls below.
  const cookieRes = await fetch(`${APP}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ENV_EMAIL, password: ENV_PASSWORD }),
  });
  const cookie = cookieRes.headers.get('set-cookie')?.split(';')[0] ?? '';

  const loginSeed = await api('POST', '/auth/login', { email: 'dan.hachuel@gmail.com', password: '123456' });
  check('credenciais do seed embutido NÃO funcionam mais', loginSeed.status === 401, `status ${loginSeed.status}`);

  console.log('\n== Nenhuma rota expõe credenciais ==');
  const defaults = await api('GET', '/auth/defaults');
  // A rota foi removida: sem sessão ela cai no guard (401) em vez de responder.
  check('GET /api/auth/defaults não expõe mais credenciais', defaults.status === 401 || defaults.status === 404, `status ${defaults.status}`);

  const healthNoAuth = await api('GET', '/health');
  const healthRaw = JSON.stringify(healthNoAuth.json ?? {});
  check('resposta do /health não traz e-mail nem senha', !healthRaw.includes(ENV_EMAIL) && !healthRaw.includes(ENV_PASSWORD));

  const session = await fetch(`${APP}/api/auth/session`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const sessionRaw = JSON.stringify(session);
  check('resposta do /auth/session não traz senha', !sessionRaw.includes(ENV_PASSWORD));

  console.log('\n== Terminal não expõe credenciais ==');
  check('stdout/stderr do servidor sem e-mail do ambiente', !serverOut.includes(ENV_EMAIL), serverOut.split('\n').filter((l) => l.includes(ENV_EMAIL)).slice(0, 1).join(''));
  check('stdout/stderr do servidor sem a senha', !serverOut.includes(ENV_PASSWORD));

  console.log('\n== Troca de senha segue funcionando ==');
  const changed = await api('PUT', '/auth/password', {
    currentPassword: ENV_PASSWORD,
    newPassword: 'nova-senha-2026',
    confirmPassword: 'nova-senha-2026',
  }, cookie);
  check('troca de senha com a senha do ambiente', changed.status === 200, `status ${changed.status}`);
  const loginNew = await api('POST', '/auth/login', { email: ENV_EMAIL, password: 'nova-senha-2026' });
  check('nova senha funciona no login seguinte', loginNew.status === 200);
} catch (err) {
  failed += 1;
  console.log(`  FAIL exceção: ${err.message}`);
} finally {
  server.kill();
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);