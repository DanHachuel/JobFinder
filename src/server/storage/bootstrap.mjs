/**
 * JobFinder — data directory bootstrap.
 *
 * Creates and keeps healthy the local JSON store under ~/.jobfinder (or
 * JOBFINDER_HOME / JOBFINDER_DATA_DIR / --data-dir). Idempotent: existing
 * files are never overwritten, so the user's data is always preserved.
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveDataDir as resolveDataDirPath } from '../paths.mjs';
import { defaultAuthPayload } from './authStore.mjs';

/** Files created on first run, in creation order. */
export const DATA_FILES = [
  'config.json',
  'auth.json',
  'channels.json',
  'topics.json',
  'posts.json',
  'connections.json',
  'dm-cascades.json',
  'jobs.json',
  'applications.json',
  'resume.json',
];

/** Default configuration written to config.json on first run. */
export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  port: 4040,
  host: '127.0.0.1',
  dryRun: true,
  llm: {
    provider: 'ollama',
    model: 'llama3.1',
    temperature: 0.7,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    maxTokens: 1024,
  },
  linkedin: {
    authMode: 'cookie',
    officialClientId: '',
    officialClientSecret: '',
    officialRedirectUri: 'http://127.0.0.1:4040/api/channels/oauth/callback',
  },
  limits: {
    invitationsPerWeek: 100,
    dmsPerDay: 5,
    dmIntervalMinutes: 30,
    applicationsPerDay: 20,
    minDelayMs: 1000,
    maxDelayMs: 4000,
  },
  outreach: {
    autoApproveDms: false,
    pauseOnReply: true,
  },
};

/** Default profile skeleton for resume.json. */
export const DEFAULT_RESUME = {
  uploadedAt: null,
  fileName: null,
  mimeType: null,
  text: '',
  skills: [],
  titles: [],
  yearsExperience: null,
  education: [],
  languages: [],
};

/** Seed topics so the first run is not an empty app. */
export const SEED_TOPICS = [
  {
    id: 'topic-carreira-tech',
    name: 'Carreira em tecnologia',
    prompt:
      'Escreva um post profissional sobre uma lição prática de carreira em tecnologia. Tom: direto, humano, sem jargoes. Termine com uma pergunta para a audiencia.',
    active: true,
    createdAt: null,
  },
  {
    id: 'topic-produtividade',
    name: 'Produtividade sem burnout',
    prompt:
      'Escreva um post sobre um habito de produtividade que respeita limites saudaveis de trabalho. Inclua um exemplo concreto do dia a dia.',
    active: true,
    createdAt: null,
  },
  {
    id: 'topic-lideranca',
    name: 'Lideranca e gestao de times',
    prompt:
      'Escreva um post curto sobre uma decisao de lideranca que deu errado e o que foi aprendido. Vulnerabilidade profissional, sem dramatizar.',
    active: true,
    createdAt: null,
  },
];

/**
 * Resolve the data directory.
 * Priority: explicit CLI flag > JOBFINDER_DATA_DIR > JOBFINDER_HOME > ~/.jobfinder
 */
export function resolveDataDir(explicit) {
  return resolveDataDirPath(explicit);
}

/** Default payload for each data file. */
function initialPayload(file) {
  switch (file) {
    case 'config.json':
      return DEFAULT_CONFIG;
    case 'auth.json':
      return defaultAuthPayload();
    case 'topics.json':
      return SEED_TOPICS.map((t) => ({ ...t, createdAt: new Date().toISOString() }));
    case 'resume.json':
      return DEFAULT_RESUME;
    default:
      return [];
  }
}

/**
 * Ensure the data directory exists with the full skeleton.
 * Never overwrites existing files. Returns a report of what was created.
 */
export function ensureDataDir(dataDir) {
  const created = [];
  const skipped = [];
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

  for (const file of DATA_FILES) {
    const target = path.join(dataDir, file);
    if (fs.existsSync(target)) {
      skipped.push(file);
      continue;
    }
    fs.writeFileSync(target, `${JSON.stringify(initialPayload(file), null, 2)}\n`, 'utf8');
    created.push(file);
  }
  return { dataDir, created, skipped };
}

/** True when the skeleton is complete. */
export function isDataDirHealthy(dataDir) {
  return DATA_FILES.every((file) => fs.existsSync(path.join(dataDir, file)));
}
