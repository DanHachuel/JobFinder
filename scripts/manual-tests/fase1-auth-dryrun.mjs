/**
 * Smoke test manual da Fase 1 (auth + dry-run).
 * Uso: node scripts/manual-tests/fase1-auth-dryrun.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = 4077;
const HOME = path.join(os.tmpdir(), `jobfinder-fase1-${Date.now()}`);
const BASE = `http://127.0.0.1:${PORT}/api`;
let cookie = '';
let passed = 0;
let failed = 0;

/** Wait until a previous run released the port. */
async function waitPortFree(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch {
      return;
    }
  }
}

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function call(method, endpoint, { body, useCookie = true, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (useCookie && cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const server = spawn(process.execPath, ['src/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
server.stderr.on('data', (d) => process.stdout.write(`  [server:err] ${d}`));

await waitPortFree(PORT);
await new Promise((resolve) => setTimeout(resolve, 1500));

try {
  console.log('\n== 1. Acesso sem sessão ==');
  const health = await call('GET', '/health');
  check('GET /api/health responde 200 (público)', health.status === 200, `status ${health.status}`);
  check('health reporta dryRun=true', health.json?.dryRun === true);

  const blocked = await call('GET', '/config');
  check('GET /api/config sem login -> 401', blocked.status === 401, `status ${blocked.status}`);
  check('código do erro é "unauthorized"', blocked.json?.error?.code === 'unauthorized');

  const blockedUi = await fetch(`http://127.0.0.1:${PORT}/postagens`);
  check('rota da UI sem login serve o app (SPA -> /login)', blockedUi.status === 200);

  console.log('\n== 2. Login ==');
  const bad = await call('POST', '/auth/login', { body: { email: 'dan.hachuel@gmail.com', password: 'errada' }, useCookie: false });
  check('senha errada -> 401', bad.status === 401 && bad.json?.error?.code === 'invalid_credentials', `status ${bad.status}`);

  const wrongEmail = await call('POST', '/auth/login', { body: { email: 'x@y.com', password: '123456' }, useCookie: false });
  check('e-mail inexistente -> 401', wrongEmail.status === 401);

  const ok = await call('POST', '/auth/login', { body: { email: 'dan.hachuel@gmail.com', password: '123456' }, useCookie: false });
  check('login padrão -> 200', ok.status === 200, `status ${ok.status}`);
  check('cookie de sessão foi setado', cookie.includes('jobfinder_session='), cookie);
  check('resposta traz o usuário', ok.json?.user?.email === 'dan.hachuel@gmail.com');
  check('aviso de senha padrão em uso', ok.json?.session?.defaultPasswordInUse === true);

  const session = await call('GET', '/auth/session');
  check('GET /api/auth/session autenticado', session.json?.authenticated === true);

  const configOk = await call('GET', '/config');
  check('GET /api/config com sessão -> 200', configOk.status === 200);
  check('config.json existe no data dir', fs.existsSync(path.join(HOME, 'auth.json')));

  console.log('\n== 3. Toggle de dry-run ==');
  const live = await call('PUT', '/config', { body: { dryRun: false } });
  check('PUT dryRun=false -> 200', live.status === 200 && live.json?.config?.dryRun === false);

  const healthLive = await call('GET', '/health');
  check('health passa a reportar dryRun=false (sem restart)', healthLive.json?.dryRun === false);

  const statusLive = await call('GET', '/linkedin/status');
  check('linkedin/status reporta modo real', statusLive.json?.dryRun === false);

  const onDisk = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
  check('config.json em disco tem dryRun=false', onDisk.dryRun === false);

  // Sem canal conectado, publicar em modo real deve ser bloqueado (não simulado).
  const posts = await call('GET', '/posts');
  const postId = posts.json?.posts?.[0]?.id ?? null;
  if (postId) {
    const publish = await call('POST', `/posts/${postId}/publish`, { body: {} });
    check('publicar em modo real sem canal -> 503/erro claro', publish.status >= 400, `status ${publish.status} ${publish.json?.error?.message ?? ''}`);
  }

  const backToDry = await call('PUT', '/config', { body: { dryRun: 'sim' } });
  check('PUT dryRun inválido -> 400', backToDry.status === 400, `status ${backToDry.status}`);

  await call('PUT', '/config', { body: { dryRun: true } });
  check('volta para dry-run=true', (await call('GET', '/health')).json?.dryRun === true);

  console.log('\n== 4. Troca de senha ==');
  const badCurrent = await call('PUT', '/auth/password', { body: { currentPassword: 'nao-sei', newPassword: 'nova123', confirmPassword: 'nova123' } });
  check('senha atual incorreta -> 400', badCurrent.status === 400, badCurrent.json?.error?.message);

  const mismatch = await call('PUT', '/auth/password', { body: { currentPassword: '123456', newPassword: 'nova123', confirmPassword: 'diferente' } });
  check('confirmação divergente -> 400', mismatch.status === 400);

  const short = await call('PUT', '/auth/password', { body: { currentPassword: '123456', newPassword: '123', confirmPassword: '123' } });
  check('senha curta -> 400', short.status === 400);

  const changed = await call('PUT', '/auth/password', { body: { currentPassword: '123456', newPassword: 'nova123', confirmPassword: 'nova123' } });
  check('troca de senha -> 200', changed.status === 200, changed.json?.message);

  const authFile = JSON.parse(fs.readFileSync(path.join(HOME, 'auth.json'), 'utf8'));
  check('hash em auth.json não é texto puro', typeof authFile.user.passwordHash === 'string' && authFile.user.passwordHash.startsWith('scrypt$'));
  check('sessionSecret gerado e persistido', typeof authFile.sessionSecret === 'string' && authFile.sessionSecret.length >= 32);

  console.log('\n== 5. Nova senha + logout ==');
  cookie = '';
  const oldLogin = await call('POST', '/auth/login', { body: { email: 'dan.hachuel@gmail.com', password: '123456' }, useCookie: false });
  check('senha antiga não funciona mais', oldLogin.status === 401);

  const newLogin = await call('POST', '/auth/login', { body: { email: 'dan.hachuel@gmail.com', password: 'nova123' }, useCookie: false });
  check('nova senha funciona', newLogin.status === 200, `status ${newLogin.status}`);
  check('aviso de senha padrão desapareceu', newLogin.json?.session?.defaultPasswordInUse === false);

  const logout = await call('POST', '/auth/logout', { body: {} });
  check('logout -> 200', logout.status === 200);

  const afterLogout = await call('GET', '/config', { useCookie: true });
  check('após logout /api/config -> 401', afterLogout.status === 401, `status ${afterLogout.status}`);

  const revoked = await call('POST', '/auth/login', { body: { email: 'dan.hachuel@gmail.com', password: 'nova123' }, useCookie: false });
  check('novo login após logout -> 200', revoked.status === 200);
} finally {
  server.kill();
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);
