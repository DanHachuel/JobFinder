/**
 * JobFinder — worker status hook.
 *
 * The background worker is a separate Node process: the UI only observes it
 * by polling GET /api/worker/status. Following react-state-guard, the poll
 * is a `setTimeout` chain with an `AbortController` and a proper cleanup —
 * never a bare `setInterval`, and never state updated without a stop
 * condition. The backend stays the source of truth (an F5 rebuilds the
 * whole card from the API).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api.js';

const POLL_MS = 5000;

/** Poll the worker status while `enabled` is true. */
export function useWorkerStatus(enabled = true, { intervalMs = POLL_MS } = {}) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(
    async (signal) => {
      try {
        const data = await api.get('/worker/status', signal ? { signal } : undefined);
        if (signal?.aborted) return;
        setStatus(data);
        setError(null);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setError(err.message);
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      await load(controller.signal);
      if (cancelled) return;
      timerRef.current = setTimeout(poll, intervalMs);
    };
    poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enabled, intervalMs, load]);

  /** Force a fresh read now (used after start/stop so the badge reacts fast). */
  const refresh = useCallback(async () => {
    const controller = new AbortController();
    await load(controller.signal);
  }, [load]);

  return { status, error, refresh, loading: status === null && !error };
}

/** Start / stop (pause) the worker. Returns the fresh status. */
export async function setWorkerRunning(running) {
  const data = await api.post(`/worker/${running ? 'start' : 'stop'}`, {});
  return data;
}

/** Force one automation pass now. */
export async function tickWorker() {
  return api.post('/worker/tick', {});
}

/** "há 12s" / "em 25s" — small helper for the card. */
export function relativeTime(iso) {
  if (!iso) return '—';
  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);
  const suffix = abs >= 60_000
    ? `${Math.round(abs / 60_000)} min`
    : `${Math.round(abs / 1000)}s`;
  return delta >= 0 ? `em ${suffix}` : `há ${suffix}`;
}