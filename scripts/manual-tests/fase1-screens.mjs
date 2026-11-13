/**
 * Capturas de tela da Fase 1 (login, painel, configurações).
 * Uso: node scripts/manual-tests/fase1-screens.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const PORT = 4122;
const HOME = path.join(os.tmpdir(), `jobfinder-fase1-shot-${Date.now()}`);
const APP = `http://127.0.0.1:${PORT}`;
const OUT = path.join(os.tmpdir(), 'opencode', 'jobfinder-fase1');
fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['src/server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, JOBFINDER_HOME: HOME, JOBFINDER_PORT: String(PORT), JOBFINDER_NO_OPEN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', () => {});
await new Promise((r) => setTimeout(r, 1800));

let browser;
try {
  const { chromium } = await import('playwright');
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  const existing = fs
    .readdirSync(cache, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('chromium-'))
    .map((e) => path.join(cache, e.name, 'chrome-win64', 'chrome.exe'))
    .filter((c) => fs.existsSync(c))
    .sort()
    .pop();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(existing ? { executablePath: existing } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, '1-login.png') });

  await page.fill('#email', 'dan.hachuel@gmail.com');
  await page.fill('#password', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname === '/', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '2-painel.png') });

  await page.click('aside a[href="/configuracoes"]');
  await page.waitForSelector('input[aria-label="Desativar dry-run"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '3-configuracoes.png'), fullPage: true });

  await page.click('input[aria-label="Desativar dry-run"]');
  await page.waitForSelector('text=Sim, ativar modo real', { timeout: 8000 });
  await page.screenshot({ path: path.join(OUT, '4-modal-real.png') });

  console.log(`Screenshots em: ${OUT}`);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
}
