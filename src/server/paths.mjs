/**
 * JobFinder — filesystem paths.
 *
 * The data directory lives outside the repository by default (~/.jobfinder)
 * so that updating the app never touches the user's data. Override with
 * JOBFINDER_HOME (env) or JOBFINDER_DATA_DIR (set by the launcher).
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const SERVER_ROOT = path.join(REPO_ROOT, 'src', 'server');
export const UI_DIST = path.join(REPO_ROOT, 'src', 'ui', 'dist');

export function resolveDataDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.JOBFINDER_DATA_DIR) return path.resolve(process.env.JOBFINDER_DATA_DIR);
  if (process.env.JOBFINDER_HOME) return path.resolve(process.env.JOBFINDER_HOME);
  return path.join(os.homedir(), '.jobfinder');
}

export function dataFilePath(dataDir, name) {
  return path.join(dataDir, name);
}

export function logsDir(dataDir) {
  return path.join(dataDir, 'logs');
}
