/**
 * JobFinder — Easy Apply automation (§5.3.3).
 *
 * DRY-RUN IS THE DEFAULT. applyToJob() never launches a browser unless
 * the global config has dryRun disabled AND a channel is connected.
 *
 * When live, it uses Playwright with the session cookies from the active
 * channel (AmmarAR97/linkedin-job-automation approach: reuse session,
 * human pacing). Complex forms stop at `needs_intervention` instead of
 * guessing, and every outcome is recorded in applications.json.
 */
import fs from 'node:fs';
import path from 'node:path';

import { HttpError } from '../../middleware/errors.mjs';
import { countToday } from '../../middleware/rateLimiter.mjs';
import { createLinkedInClient } from '../linkedin/index.mjs';

/** Daily quota for applications (Goal Gradient: "X de 20 hoje"). */
export function applicationsQuota(store, config) {
  const limit = config?.limits?.applicationsPerDay ?? 20;
  const used = countToday(store, 'applications.json', 'appliedAt');
  return { used, limit, remaining: Math.max(limit - used, 0), percentage: limit ? Math.round((used / limit) * 100) : 0 };
}

const APPLY_TIMEOUT = 45_000;

/**
 * Apply to a job.
 * @param {object} ctx server context
 * @param {object} input { job: {jobId,title,company,url,...}, dryRun?: boolean }
 */
export async function applyToJob(ctx, input) {
  const { store, logger, config, rateLimiter } = ctx;
  const job = input?.job;
  if (!job?.url || !job?.jobId) {
    throw new HttpError(400, 'bad_request', 'job.jobId and job.url are required');
  }

  const quota = applicationsQuota(store, config);
  const dryRun = input?.dryRun ?? config?.dryRun ?? true;
  const { mode } = createLinkedInClient({ store, logger, config, rateLimiter });

  const baseRecord = {
    jobId: job.jobId,
    jobTitle: job.title ?? null,
    company: job.company ?? null,
    url: job.url,
    matchScore: job.matchScore ?? null,
    dryRun,
    authMode: mode,
  };

  if (dryRun) {
    const record = await store.create(
      'applications.json',
      { ...baseRecord, status: 'dry_run', appliedAt: new Date().toISOString(), report: { notes: 'Dry-run: nenhuma candidatura foi enviada.' } },
      'app'
    );
    logger.info('jobs:apply', 'dry-run application', { jobId: job.jobId });
    return { application: record };
  }

  if (mode !== 'cookie' && mode !== 'official') {
    throw new HttpError(503, 'service_unavailable', 'Conecte um canal do LinkedIn (cookies) para candidatar-se de verdade.');
  }
  if (quota.used >= quota.limit) {
    const record = await store.create(
      'applications.json',
      { ...baseRecord, status: 'blocked', appliedAt: new Date().toISOString(), report: { notes: `Limite diario de ${quota.limit} candidaturas atingido.` } },
      'app'
    );
    return { application: record };
  }

  try {
    const report = await runPlaywrightApply(ctx, job);
    const status = report.success ? 'submitted' : report.needsIntervention ? 'needs_intervention' : 'failed';
    const record = await store.create(
      'applications.json',
      {
        ...baseRecord,
        status,
        appliedAt: new Date().toISOString(),
        report,
      },
      'app'
    );
    logger[status === 'submitted' ? 'info' : 'warn']('jobs:apply', `application ${status}`, { jobId: job.jobId, notes: report.notes });
    return { application: record };
  } catch (err) {
    const record = await store.create(
      'applications.json',
      { ...baseRecord, status: 'failed', appliedAt: new Date().toISOString(), report: { notes: err.message } },
      'app'
    );
    logger.error('jobs:apply', 'application failed', { jobId: job.jobId, message: err.message });
    return { application: record, error: err.message };
  }
}

/** Playwright is an optional dependency — loaded on demand. */
async function loadPlaywright() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    throw new HttpError(
      503,
      'service_unavailable',
      'Playwright nao encontrado. Instale com: npm i -g playwright && npx playwright install chromium (ou mantenha dry-run ativo).'
    );
  }
}

async function runPlaywrightApply(ctx, job) {
  const { store, logger, rateLimiter } = ctx;
  const chromium = await loadPlaywright();
  const { getActiveChannel } = await import('../linkedin/index.mjs');
  const channel = getActiveChannel(store);
  if (!channel) {
    throw new HttpError(503, 'service_unavailable', 'Nenhum canal do LinkedIn conectado.');
  }

  await rateLimiter.gate('playwright', 2000);
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  if (Array.isArray(channel.cookies) && channel.cookies.length) {
    await context.addCookies(
      channel.cookies
        .filter((c) => c.name && c.value)
        .map((c) => ({ name: c.name, value: c.value, domain: c.domain || '.www.linkedin.com', path: c.path || '/' }))
    );
  }

  const page = await context.newPage();
  const report = { steps: [], notes: '', success: false, needsIntervention: false, screenshot: null };
  try {
    page.setDefaultTimeout(APPLY_TIMEOUT);
    await page.goto(job.url, { waitUntil: 'domcontentloaded' });
    report.steps.push('opened job page');

    const applyButton = page.locator('button:has-text("Easy Apply"), [data-live-test-job-apply-button], #jobs-apply-button, button.jobs-apply-button').first();
    if (!(await applyButton.count())) {
      report.needsIntervention = true;
      report.notes = 'Botao "Easy Apply" nao encontrado — a vaga pode exigir candidatura externa.';
      await saveScreenshot(page, ctx, report, 'no-apply-button');
      return report;
    }
    await applyButton.click();
    report.steps.push('clicked Easy Apply');

    // Walk through the form (submit/next), keeping human pacing.
    for (let step = 0; step < 6; step += 1) {
      await humanPause(700, 1600);
      const submit = page.locator('button:has-text("Enviar candidatura"), button:has-text("Submit application"), button[aria-label*="Enviar"], button[aria-label*="Submit"]').first();
      if (await submit.count()) {
        await submit.click();
        report.steps.push(`submitted (step ${step + 1})`);
        report.success = true;
        report.notes = 'Candidatura enviada via Easy Apply.';
        break;
      }
      const next = page.locator('button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Next"), button:has-text("Continuar"), button[aria-label*="Avançar"], button[aria-label*="Continue"]').first();
      if (await next.count()) {
        await next.click();
        report.steps.push(`advanced (step ${step + 1})`);
        continue;
      }
      report.needsIntervention = true;
      report.notes = 'Formulario com etapas desconhecidas — intervencao manual necessaria.';
      await saveScreenshot(page, ctx, report, 'needs-intervention');
      break;
    }
  } catch (err) {
    report.success = false;
    report.needsIntervention = false;
    report.notes = `Erro durante a candidatura: ${err.message}`;
    logger.warn('jobs:apply', 'playwright run error', { message: err.message });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return report;
}

async function saveScreenshot(page, ctx, report, tag) {
  try {
    const dir = path.join(ctx.dataDir, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tag}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    report.screenshot = file;
  } catch {
    /* screenshot is best-effort */
  }
}

async function humanPause(min, max) {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
