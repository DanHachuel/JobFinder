/**
 * Smoke test: flag dry-run aplicada aos serviços (postagens/convites/DMs).
 * Uso: node scripts/manual-tests/fase1-dryrun-services.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = 4099;
const HOME = path.join(os.tmpdir(), `jobfinder-fase1-svc-${Date.now()}`);
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

async function call(method, endpoint, body) {
  const headers = { Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const server = spawn(process.execPath, ['src/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => console.log('  [server:err]', String(d)));
await waitPortFree(PORT);
await new Promise((r) => setTimeout(r, 1500));

try {
  await call('POST', '/auth/login', { email: 'dan.hachuel@gmail.com', password: '123456' });

  console.log('\n== dry-run ATIVO: ações são simuladas ==');
  const created = await call('POST', '/posts', { text: 'Post de teste do modo dry-run do JobFinder.' });
  check('cria rascunho', created.status === 201, `status ${created.status}`);
  const postId = created.json?.post?.id;

  const published = await call('POST', `/posts/${postId}/publish`, {});
  check('publicação em dry-run -> 200', published.status === 200, `status ${published.status}`);
  check('post fica published + simulated', published.json?.post?.status === 'published' && published.json?.post?.simulated === true);

  const search = await call('POST', '/connections/search', { keyword: 'tech recruiter' });
  check('busca de pessoas em dry-run -> 200', search.status === 200 && Array.isArray(search.json?.profiles));
  check('resultados marcados como simulados', search.json?.profiles?.[0]?.simulated === true);

  const invites = await call('POST', '/connections/invitations', {
    message: 'Olá {{nome}}, vamos nos conectar?',
    profiles: [{ profileId: 'p1', profileUrn: 'urn:li:person:p1', firstName: 'Ana', lastName: 'Silva', headline: 'Recruiter' }],
  });
  check('convite em dry-run -> 200', invites.status === 200 && invites.json?.results?.[0]?.status === 'sent');
  check('convite marcado como simulado', invites.json?.results?.[0]?.simulated === true);

  console.log('\n== dry-run DESATIVADO sem canal: ações reais são bloqueadas ==');
  await call('PUT', '/config', { dryRun: false });
  const created2 = await call('POST', '/posts', { text: 'Segundo post de teste (modo real).' });
  const postId2 = created2.json?.post?.id;
  const publishLive = await call('POST', `/posts/${postId2}/publish`, {});
  check('publicar sem canal em modo real -> erro claro', publishLive.status >= 400, `status ${publishLive.status} · ${publishLive.json?.error?.message ?? ''}`);
  check('mensagem menciona conectar um canal', /canal/i.test(publishLive.json?.error?.message ?? ''));

  const postsFile = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
  const stuck = postsFile.find((p) => p.id === postId2);
  check('post não fica preso em "publishing"', stuck?.status === 'failed', `status ${stuck?.status}`);

  const invitesLive = await call('POST', '/connections/invitations', {
    message: 'Olá {{nome}}, vamos nos conectar?',
    profiles: [{ profileId: 'p2', profileUrn: 'urn:li:person:p2', firstName: 'Bruno', lastName: 'Costa' }],
  });
  check('convite sem canal em modo real -> erro claro', invitesLive.status >= 400, `status ${invitesLive.status} · ${invitesLive.json?.error?.message ?? ''}`);

  const cascade = await call('POST', '/cascades', {
    profileId: 'p3',
    profileUrn: 'urn:li:person:p3',
    contactName: 'Carla Dias',
    sequence: [{ text: 'Oi Carla, tudo bem?' }],
  });
  check('cria cascata de DM', cascade.status === 201, `status ${cascade.status}`);

  const tick = await call('POST', '/cascades/tick', {});
  check('tick de DM sem canal em modo real -> skipped (não simula)', tick.json?.skipped >= 1 && tick.json?.sent === 0, JSON.stringify(tick.json).slice(0, 160));

  const searchLive = await call('POST', '/connections/search', { keyword: 'tech recruiter' });
  check('busca continua funcionando em modo real (leitura)', searchLive.status === 200);

  console.log('\n== volta para dry-run ==');
  await call('PUT', '/config', { dryRun: true });
  const searchDry = await call('POST', '/connections/search', { keyword: 'tech recruiter' });
  check('busca volta a simular', searchDry.json?.profiles?.[0]?.simulated === true);
  const publishDry = await call('POST', `/posts/${postId2}/publish`, {});
  check('publicação volta a ser dry-run (200)', publishDry.status === 200, `status ${publishDry.status}`);
} finally {
  server.kill();
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);
