/**
 * JobFinder — local JSON store.
 *
 * Single source of truth for every on-disk JSON file under the data
 * directory. Writes are atomic (tmp file + rename) and mutations on the
 * same file are serialized through a promise queue, so concurrent
 * requests can never corrupt or lose data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export class JsonStore {
  /** @param {string} dataDir absolute path to the data directory */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cache = new Map(); // name -> parsed data
    this.queues = new Map(); // name -> promise (serialization)
  }

  path(name) {
    return path.join(this.dataDir, name);
  }

  /** Read a JSON file (cached). Returns `fallback` if missing/corrupt. */
  read(name, fallback = []) {
    if (this.cache.has(name)) return this.cache.get(name);
    const file = this.path(name);
    if (!fs.existsSync(file)) {
      this.cache.set(name, fallback);
      return fallback;
    }
    try {
      // Some editors (e.g. Windows PowerShell Set-Content) write a BOM —
      // strip it before parsing so external edits never look "corrupt".
      const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const data = JSON.parse(raw);
      this.cache.set(name, data);
      return data;
    } catch (err) {
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(file, backup);
      } catch {
        /* best effort */
      }
      console.error(`[jobfinder:store] ${name} is corrupt JSON — backed up to ${backup}, starting fresh`);
      this.cache.set(name, fallback);
      return fallback;
    }
  }

  /** Atomically write a JSON file (pretty-printed, trailing newline). */
  write(name, data) {
    const file = this.path(name);
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    this.cache.set(name, data);
    return data;
  }

  /**
   * Serialized read-modify-write. `mutator` receives the current data and
   * returns the new value (or a Promise resolving to it).
   */
  update(name, mutator, fallback = []) {
    const previous = this.queues.get(name) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = this.read(name, fallback);
      const result = await mutator(structuredClone(current));
      return this.write(name, result);
    });
    this.queues.set(
      name,
      next.catch(() => {}) // keep the chain alive after a failure
    );
    return next;
  }

  /** Drop cached data so the next read hits the disk. */
  invalidate(name) {
    this.cache.delete(name);
  }

  /* ------------------------------------------------------------------ *
   * Collection helpers (arrays of records with an `id`)                *
   * ------------------------------------------------------------------ */

  list(name) {
    const data = this.read(name, []);
    return Array.isArray(data) ? data : [];
  }

  find(name, id) {
    return this.list(name).find((item) => item.id === id) ?? null;
  }

  /**
   * Filtered, sorted, paginated listing.
   * @param {string} name file name (e.g. 'posts.json')
   * @param {object} [options] { where, sort, order, page, limit }
   */
  query(name, options = {}) {
    const { where = () => true, sort = 'createdAt', order = 'desc', page = 1, limit = 20 } = options;
    let items = this.list(name).filter(where);
    items.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (av === bv) return 0;
      return order === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
    });
    const total = items.length;
    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const current = Math.max(Number(page) || 1, 1);
    const start = (current - 1) * size;
    return { items: items.slice(start, start + size), total, page: current, limit: size };
  }

  /** Append a record (id + createdAt injected when absent). Async: persist before returning. */
  async create(name, record, prefix = 'item') {
    const entry = {
      id: record.id ?? newId(prefix),
      createdAt: record.createdAt ?? nowIso(),
      ...record,
    };
    await this.update(name, (items) => [...items, entry]);
    return entry;
  }

  /** Patch a record by id; returns the updated record or null. */
  async patch(name, id, patch) {
    let updated = null;
    await this.update(name, (items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return items;
      updated = { ...items[index], ...patch, updatedAt: nowIso() };
      const next = [...items];
      next[index] = updated;
      return next;
    });
    return updated;
  }

  /** Remove a record by id; returns true when something was removed. */
  async remove(name, id) {
    let removed = false;
    await this.update(name, (items) => {
      const next = items.filter((item) => item.id !== id);
      removed = next.length !== items.length;
      return next;
    });
    return removed;
  }
}
