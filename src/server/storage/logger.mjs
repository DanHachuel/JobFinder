/**
 * JobFinder — daily JSONL logger.
 *
 * Appends one JSON object per line to logs/YYYY-MM-DD.jsonl under the data
 * directory. The UI reads these back to show recent activity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logsDir } from '../paths.mjs';

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export class Logger {
  /** @param {string} dataDir absolute path to the data directory */
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  file(date = new Date()) {
    return path.join(logsDir(this.dataDir), `${dateStamp(date)}.jsonl`);
  }

  /** Append an entry. Never throws — logging must not break the app. */
  write(level, module, message, data = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      module,
      message,
      ...(Object.keys(data).length ? { data: redact(data) } : {}),
    };
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      fs.appendFileSync(this.file(), `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      console.error('[jobfinder:logger] failed to append log:', err.message);
    }
    return entry;
  }

  info(module, message, data) {
    return this.write('info', module, message, data);
  }

  warn(module, message, data) {
    return this.write('warn', module, message, data);
  }

  error(module, message, data) {
    return this.write('error', module, message, data);
  }

  /** Most recent entries of a given day (newest first). */
  tail(count = 100, date = new Date()) {
    const file = this.file(date);
    if (!fs.existsSync(file)) return [];
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      return lines
        .slice(-count)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Available log dates, newest first. */
  dates() {
    const dir = logsDir(this.dataDir);
    try {
      return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => name.replace('.jsonl', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
}

/** Avoid leaking secrets into the logs. */
function redact(data) {
  const SECRET_KEYS = /apikey|api_key|secret|token|password|cookie/i;
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = typeof value === 'string' && value.length ? '***' : value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
