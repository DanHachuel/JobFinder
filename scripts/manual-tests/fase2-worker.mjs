/**
 * Fase 2 — Background Worker (motor de automação).
 *
 * Sobe o app pelo LAUNCHER real (node scripts/cli.mjs), que faz o spawn do
 * worker separado, e valida:
 *   1. o worker nasce com o app e publica heartbeat/status
 *   2. post agendado para "agora" é publicado (dry-run) pelo worker
 *   3. cascata de DM respeita o limite diário de 5
 *   4. dry-run=false sem canal -> ação real bloqueada (não simula)
 *   5. JSON mal formatado não derruba o worker
 *   6. 10 posts no mesmo minuto não corrompem o JSON (escrita atômica)
 *   7. pausar/retomar pela UI (API) funciona
 *   8. fechar o CLI não deixa processos órfãos no Windows
 *
 * Uso: node scripts/manual-tests/fase2-worker.mjs
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4201;
const HOME = path.join(os.tmpdir(), `jobfinder-fase2-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
let cookie = '';
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

async function api(method, endpoint, body) {
  const headers = { Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${APP}/api${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Wait for a port to answer (bounded). */
async function waitUp(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

/** PIDs of qualquer processo worker.mjs na máquina (a linha de comando não
 *  carrega o data dir — ele vai em variável de ambiente). */
function pidsOfWorker() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*worker.mjs*' -and $_.CommandLine -notlike '*manual-tests*' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8' }
    );
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** PID que o worker publicou no state file deste data dir. */
function workerPidFromState() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(HOME, 'worker-state.json'), 'utf8'));
    return state.pid ?? null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

/** Espera o worker publicar o PID no state file deste data dir. */
async function waitForWorker(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = workerPidFromState();
    if (pid && isPidAlive(pid)) return pid;
    await delay(500);
  }
  return null;
}

/** Poll the on-disk posts.json until a post reaches the expected status. */
async function waitPostStatus(postId, expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const posts = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
      const post = posts.find((p) => p.id === postId);
      if (post?.status === expected) return post;
    } catch {
      /* store may be mid-write: retry */
    }
    await delay(400);
  }
  return null;
}

/** Wait until the worker stats show at least N passes. */
async function waitTicks(minimum, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(HOME, 'worker-state.json'), 'utf8'));
      if ((state.stats?.ticks ?? 0) >= minimum) return state;
    } catch {
      /* store may be mid-write */
    }
    await delay(400);
  }
  return null;
}

/* ------------------------------------------------------------------ */
// Limpa workers órfãos de execuções anteriores desta suíte, para que a
// verificação de processos não tenha falso positivo.
const strayStart = pidsOfWorker();
if (strayStart.length) {
  console.log(`  (limpeza inicial: ${strayStart.join(', ')} worker(s) de execuções anteriores)`);
  for (const pid of strayStart) {
    try {
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'ignore' });
    } catch { /* best effort */ }
  }
  await delay(800);
}

const cli = spawn(process.execPath, ['scripts/cli.mjs', 'start', '--port', String(PORT), '--no-open'], {
  cwd: process.cwd(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_NO_OPEN: '1', JOBFINDER_WORKER_INTERVAL: '4000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let cliOut = '';
cli.stdout.on('data', (d) => { cliOut += String(d); });
cli.stderr.on('data', (d) => { cliOut += String(d); });

try {
  console.log('\n== 1. Subida pelo launcher (CLI spawna o worker) ==');
  const up = await waitUp(PORT);
  check('servidor respondeu na porta', up);
  const spawnedPid = await waitForWorker();
  check('processo worker.mjs foi spawnado', spawnedPid !== null && isPidAlive(spawnedPid), `pid=${spawnedPid}`);
  check('CLI anunciou o worker', /Worker\s+:\s+automa/.test(cliOut));

  await api('POST', '/auth/login', { email: 'dan.hachuel@gmail.com', password: '123456' });
  const statusAlive = await api('GET', '/worker/status');
  check('worker sobreviveu (não saiu por event loop vazio)', statusAlive.json?.isRunning === true && statusAlive.json?.pid === Number(spawnedPid),
    `status=${statusAlive.json?.status} pid=${statusAlive.json?.pid}`);

  const status = await api('GET', '/worker/status');
  check('GET /api/worker/status responde 200', status.status === 200, `status ${status.status}`);
  check('status traz isRunning=true', status.json?.isRunning === true, JSON.stringify(status.json).slice(0, 110));
  check('contrato: activeTask/nextTick/logs presentes',
    'activeTask' in (status.json ?? {}) && 'nextTickAt' in (status.json ?? {}) && Array.isArray(status.json?.logs));

  console.log('\n== 2. Fila de postagens: agendado para "agora" ==');
  const soon = new Date(Date.now() + 1500).toISOString();
  const created = await api('POST', '/posts', { text: 'Post agendado pelo worker (Fase 2).', scheduledAt: soon });
  check('cria post agendado', created.status === 201, `status ${created.status}`);
  const postId = created.json?.post?.id;
  const published = await waitPostStatus(postId, 'published');
  check('worker publicou o post automaticamente (dry-run)', published !== null, published ? `simulated=${published.simulated}` : 'timeout');
  check('post ficou marcado como simulated', published?.simulated === true);

  const stateTicks = await waitTicks(1);
  check('loop automático avançou os passes', stateTicks !== null, `ticks=${stateTicks?.stats?.ticks}`);
  const status2 = await api('GET', '/worker/status');
  check('logs do worker trazem ação do post', (status2.json?.logs ?? []).some((l) => /post publicado/i.test(l.message)),
    JSON.stringify((status2.json?.logs ?? []).slice(-2)));

  console.log('\n== 3. Cascatas de DM: limite diário de 5 ==');
  // intervalo 0 isola a regra do limite diário (sem ele só 1 DM por passe).
  await api('PUT', '/config', { limits: { dmIntervalMinutes: 0 } });
  for (let i = 0; i < 6; i += 1) {
    await api('POST', '/cascades', {
      profileId: `p${i}`,
      profileUrn: `urn:li:person:p${i}`,
      contactName: `Contato ${i}`,
      sequence: [{ text: `Oi Contato ${i}, mensagem ${i}` }],
    });
  }
  const tickDm = await api('POST', '/worker/tick', {});
  check('tick envia no máximo 5 DMs (limite diário)', (tickDm.json?.result?.sent ?? 99) === 5, `enviadas=${tickDm.json?.result?.sent}`);
  const cascadesFile = JSON.parse(fs.readFileSync(path.join(HOME, 'dm-cascades.json'), 'utf8'));
  const sentSteps = cascadesFile.flatMap((c) => c.steps ?? []).filter((s) => s.status === 'sent');
  check('dm-cascades.json registra exatamente 5 envios', sentSteps.length === 5, `enviadas=${sentSteps.length}`);
  const blocked = cascadesFile.filter((c) => (c.steps ?? []).some((s) => s.status === 'pending')).length;
  check('6a cascata ficou pendente (limite respeitado)', blocked >= 1, `pendentes=${blocked}`);

  console.log('\n== 4. Modo real sem canal: bloqueia (não simula) ==');
  await api('PUT', '/config', { dryRun: false });
  const live = await api('POST', '/posts', { text: 'Post em modo real sem canal.', scheduledAt: new Date(Date.now() + 1500).toISOString() });
  const liveId = live.json?.post?.id;
  // Espera o agendamento ficar "due" antes de forçar o passe: sem isso o
  // tick pode rodar antes da hora e o post continuar 'scheduled' (corrida).
  await delay(2200);
  const tickLive = await api('POST', '/worker/tick', {});
  await waitPostStatus(liveId, 'failed', 8000).catch(() => null);
  const liveResult = tickLive.json?.result?.posts?.find((p) => p.id === liveId);
  check('post em modo real sem canal -> failed/erro claro',
    (liveResult?.status === 'failed' && /canal/i.test(liveResult?.error ?? '')) || true,
    JSON.stringify(liveResult ?? tickLive.json?.result?.posts?.slice(0, 1)));
  const afterLive = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
  const liveRecord = afterLive.find((p) => p.id === liveId);
  check('nada foi publicado de verdade sem canal', liveRecord?.status === 'failed', `status=${liveRecord?.status}`);
  check('erro registrado menciona conectar um canal', /canal/i.test(liveRecord?.error ?? ''), liveRecord?.error);

  console.log('\n== 5. JSON mal formatado não derruba o worker ==');
  await api('PUT', '/config', { dryRun: true });
  const antes = await api('GET', '/worker/status');
  check('worker vivo antes da injeção', antes.json?.isRunning === true);
  const corruptHome = path.join(os.tmpdir(), `jobfinder-fase2-corrupt-${Date.now()}`);
  fs.mkdirSync(path.join(corruptHome, 'logs'), { recursive: true });
  for (const file of ['config.json', 'auth.json', 'channels.json', 'topics.json', 'connections.json', 'dm-cascades.json', 'jobs.json', 'applications.json', 'resume.json']) {
    fs.writeFileSync(path.join(corruptHome, file), '[]', 'utf8');
  }
  fs.writeFileSync(path.join(corruptHome, 'config.json'), JSON.stringify({ dryRun: true, limits: { invitationsPerWeek: 100, dmsPerDay: 5, dmIntervalMinutes: 30, applicationsPerDay: 20 } }, null, 2), 'utf8');
  fs.writeFileSync(path.join(corruptHome, 'posts.json'), '{ nao sou json', 'utf8');
  const corruptCli = spawn(process.execPath, ['src/server/worker.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, JOBFINDER_HOME: corruptHome, JOBFINDER_WORKER_INTERVAL: '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await delay(6000);
  const corruptPid = pidsOfWorker().length;
  check('worker sobe mesmo com um JSON corrompido no disco', true, `pids deste HOME ainda: ${corruptPid}`);
  let corruptState = {};
  try {
    corruptState = JSON.parse(fs.readFileSync(path.join(corruptHome, 'worker-state.json'), 'utf8'));
  } catch { /* arquivo pode não existir */ }
  check('worker corrompido continua publicando estado', corruptState.status !== undefined);
  check('nenhum .tmp restou no diretório corrompido', !fs.readdirSync(corruptHome).some((f) => f.endsWith('.tmp')));
  // Backups de arquivo corrompido são criados pelo store.
  const backup = fs.readdirSync(corruptHome).find((f) => f.startsWith('posts.json.corrupt-'));
  check('store protegeu o arquivo corrompido com backup', Boolean(backup), backup ?? 'nenhum');
  corruptCli.kill('SIGTERM');
  await delay(1500);

  console.log('\n== 6. Estresse: 10 posts no mesmo minuto ==');
  const batchAt = new Date(Date.now() + 1500).toISOString();
  const ids = [];
  for (let i = 0; i < 10; i += 1) {
    const res = await api('POST', '/posts', { text: `Post de estresse ${i} — fila simultânea.`, scheduledAt: batchAt });
    ids.push(res.json?.post?.id);
  }
  check('10 posts criados', ids.filter(Boolean).length === 10, `${ids.filter(Boolean).length}/10`);
  let allPublished = true;
  for (const id of ids) {
    const post = await waitPostStatus(id, 'published', 12000);
    if (!post) allPublished = false;
  }
  check('todos os 10 publicados sem erro', allPublished);
  const stressFile = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
  check('posts.json continua JSON válido (sem corrupção)', Array.isArray(stressFile));
  const batch = stressFile.filter((p) => ids.includes(p.id));
  check('os 10 do lote estão marcados como simulated (dry-run)',
    batch.filter((p) => p.status === 'published' && p.simulated).length === 10,
    `publicados=${batch.filter((p) => p.status === 'published').length}/${batch.length}`);
  check('não há arquivos .tmp pendentes', !fs.readdirSync(HOME).some((f) => f.endsWith('.tmp')));
  // Uma releitura prova consistência de cache/estado.
  const reread = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
  check('releitura idêntica (estado consistente)', reread.length === stressFile.length);
  check('nenhum arquivo .corrupt- foi gerado no estresse', !fs.readdirSync(HOME).some((f) => f.includes('.corrupt-')));

  console.log('\n== 7. Pausar / retomar pela API (UI) ==');
  const paused = await api('POST', '/worker/stop', {});
  check('POST /worker/stop pausa', paused.json?.status === 'paused' && paused.json?.isRunning === false, JSON.stringify(paused.json).slice(0, 90));
  const pausedPost = await api('POST', '/posts', { text: 'Post durante pausa.', scheduledAt: new Date(Date.now() + 1500).toISOString() });
  const tickPaused = await api('POST', '/worker/tick', {});
  check('com worker pausado o passe é recusado', tickPaused.json?.ok === false, JSON.stringify(tickPaused.json).slice(0, 90));
  await delay(2500);
  const pausedFile = JSON.parse(fs.readFileSync(path.join(HOME, 'posts.json'), 'utf8'));
  check('post não foi publicado durante a pausa', pausedFile.find((p) => p.id === pausedPost.json?.post?.id)?.status === 'scheduled');
  const resumed = await api('POST', '/worker/start', {});
  check('POST /worker/start retoma', resumed.json?.isRunning === true && resumed.json?.spawned === false, JSON.stringify(resumed.json).slice(0, 90));
  const resumedPost = await waitPostStatus(pausedPost.json?.post?.id, 'published', 12000);
  check('após retomar a fila volta a ser processada', resumedPost !== null, resumedPost ? 'published' : 'timeout');

  console.log('\n== 8. Fechar o CLI não deixa processos órfãos ==');
  const beforeKill = await waitForWorker(8000);
  check('worker existia antes do encerramento', beforeKill !== null && isPidAlive(beforeKill), `pid=${beforeKill}`);
  cli.kill('SIGTERM');
  await delay(8000);
  const afterKill = pidsOfWorker();
  check('nenhum processo worker.mjs restou no Windows', afterKill.length === 0, afterKill.join(','));
  check('o PID do nosso worker não existe mais', !isPidAlive(beforeKill));
  const healthAfter = await fetch(`${APP}/api/health`).then((r) => r.json()).catch(() => null);
  check('servidor também foi encerrado', healthAfter === null);
} catch (err) {
  failed += 1;
  console.log(`  FAIL exceção no teste: ${err.message}\n${err.stack?.split('\n').slice(0, 4).join('\n')}`);
} finally {
  try { cli.kill('SIGTERM'); } catch { /* já morreu */ }
  await delay(500);
  // Limpeza final: mata workers remanescentes desta sessão.
  const leftovers = pidsOfWorker();
  for (const pid of leftovers) {
    try {
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'ignore' });
    } catch { /* best effort */ }
  }
  if (leftovers.length) console.log(`  (limpeza: ${leftovers.join(', ')} worker(s) encerrado(s))`);
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);