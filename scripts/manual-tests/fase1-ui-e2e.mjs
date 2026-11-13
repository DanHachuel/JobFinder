/**
 * Teste E2E da UI (Playwright) da Fase 1: login, proteção de rotas,
 * toggle de dry-run, badge Real Mode, troca de senha e logout.
 *
 * Uso: node scripts/manual-tests/fase1-ui-e2e.mjs
 * (o Playwright é uma dependência opcional do projeto)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = 4111;
const HOME = path.join(os.tmpdir(), `jobfinder-fase1-ui-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
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

const server = spawn(process.execPath, ['src/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_PORT: String(PORT), JOBFINDER_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => console.log('  [server:err]', String(d)));
await waitPortFree(PORT);
await new Promise((resolve) => setTimeout(resolve, 1800));

let browser;
try {
  const { chromium } = await import('playwright');
  // Reuse any chromium build already on the machine (the optional Playwright
  // dependency may not match the browser cache version).
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  const existing = fs
    .readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
    .map((entry) => path.join(cache, entry.name, 'chrome-win64', 'chrome.exe'))
    .filter((candidate) => fs.existsSync(candidate))
    .sort()
    .pop();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(existing ? { executablePath: existing } : {}) });
  console.log(`  (chromium: ${existing ?? 'padrao do playwright'})`);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  console.log('\n== Proteção de rotas ==');
  await page.goto(`${APP}/vagas`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/login', { timeout: 8000 });
  check('acesso sem login redireciona para /login', page.url().endsWith('/login'), page.url());

  const loginVisible = await page.locator('h2', { hasText: 'Bem-vindo de volta!' }).isVisible();
  check('tela de login é exibida', loginVisible);
  const brandVisible = await page.locator('h1', { hasText: 'JobFinder' }).isVisible();
  check('painel de marca JobFinder presente', brandVisible);
  const hintVisible = await page.locator('text=dan.hachuel@gmail.com').isVisible();
  check('dica de primeiro acesso com o usuário padrão', hintVisible);

  console.log('\n== Credenciais inválidas ==');
  await page.fill('#email', 'dan.hachuel@gmail.com');
  await page.fill('#password', 'errada');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { timeout: 8000 });
  check('erro de credencial é exibido', (await page.locator('[role="alert"]').innerText()).includes('inválidos'));
  check('continua na tela de login', page.url().endsWith('/login'));

  console.log('\n== Login válido ==');
  await page.fill('#email', 'dan.hachuel@gmail.com');
  await page.fill('#password', '123456');
  await page.click('button[type="submit"]');
  // Volta para a rota pedida antes do login (/vagas) ou para o Painel.
  await page.waitForURL((url) => url.pathname === '/vagas' || url.pathname === '/', { timeout: 15000 });
  check('login redireciona para a rota pedida', /\/vagas$|\/$/.test(new URL(page.url()).pathname), page.url());

  await page.waitForSelector('aside p:has-text("dan.hachuel@gmail.com")', { timeout: 15000 });
  const sidebarEmail = await page
    .locator('aside p', { hasText: 'dan.hachuel@gmail.com' })
    .count();
  check('sidebar mostra a conta logada', sidebarEmail > 0);

  const dryBadge = page.locator('header span', { hasText: 'dry-run' });
  check('badge dry-run aparece no topo', (await dryBadge.count()) > 0);

  console.log('\n== Configuracoes: execucao e seguranca ==');
  await page.click('aside a[href="/configuracoes"]');
  await page.waitForURL('**/configuracoes', { timeout: 8000 });
  await page.waitForSelector('input[aria-label="Desativar dry-run"]', { timeout: 15000 });
  const warning = await page.locator('text=/Use com responsabilidade/').isVisible();
  check('aviso de modo real está presente', warning);

  await page.click('input[aria-label="Desativar dry-run"]');
  await page.waitForSelector('text=Desativar o dry-run?', { timeout: 8000 });
  check('modal de confirmação é exibido', true);
  await page.click('text=Sim, ativar modo real');
  await page.waitForSelector('header span:has-text("Real Mode")', { timeout: 10000 });
  check('badge Real Mode (vermelho) aparece no topo', true);

  const configOnDisk = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
  check('config.json em disco tem dryRun=false', configOnDisk.dryRun === false);
  const health = await (await fetch(`${APP}/api/health`)).json();
  check('API confirma dryRun=false (sem restart)', health.dryRun === false);

  // Volta para dry-run (toggle agora rotulado "Ativar dry-run").
  await page.click('input[aria-label="Ativar dry-run"]');
  await page.waitForSelector('header span:has-text("dry-run")', { timeout: 10000 });
  check('badge dry-run volta a aparecer', true);

  console.log('\n== Troca de senha ==');
  await page.fill('#currentPassword', '123456');
  await page.fill('#newPassword', 'novaSenha123');
  await page.fill('#confirmPassword', 'novaSenha123');
  await page.click('button:has-text("Alterar senha")');
  await page.waitForSelector('text=Senha alterada', { timeout: 10000 });
  check('toast confirma a troca de senha', true);
  const authFile = JSON.parse(fs.readFileSync(path.join(HOME, 'auth.json'), 'utf8'));
  check('auth.json guarda apenas o hash', authFile.user.passwordHash.startsWith('scrypt$') && !JSON.stringify(authFile).includes('novaSenha123'));

  console.log('\n== Logout e novo login ==');
  await page.click('aside button:has-text("Sair")');
  await page.waitForURL('**/login', { timeout: 10000 });
  check('logout volta para /login', page.url().endsWith('/login'));

  await page.goto(`${APP}/config`, { waitUntil: 'networkidle' });
  await page.waitForURL('**/login', { timeout: 8000 });
  check('rota protegida volta a redirecionar para /login', page.url().endsWith('/login'));

  await page.fill('#email', 'dan.hachuel@gmail.com');
  await page.fill('#password', '123456');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { timeout: 8000 });
  check('senha antiga é rejeitada', (await page.locator('[role="alert"]').innerText()).includes('inválidos'));

  await page.fill('#email', 'dan.hachuel@gmail.com');
  await page.fill('#password', 'novaSenha123');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/config', { timeout: 15000 });
  check('nova senha permite o login', /\/$|\/config$/.test(new URL(page.url()).pathname), page.url());

  const consoleErrors = errors.filter((e) => !e.includes('ResizeObserver'));
  check('sem erros de console relevantes', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} catch (err) {
  failed += 1;
  console.log(`  FAIL exceção no teste: ${err.message}`);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}

console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
process.exit(failed ? 1 : 0);
