/**
 * Worker Status Badge (Header): green pulsing dot when the background worker
 * is running, amber when paused, gray when stopped. Reads its own state by
 * polling GET /api/worker/status (react-state-guard: AbortController +
 * setTimeout chain, never a bare setInterval).
 */
import React from 'react';
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react';

import { useWorkerStatus } from '../lib/useWorkerStatus.js';

const TONES = {
  running: { dot: 'bg-green-500', text: 'text-green-800', bg: 'bg-green-100', label: 'Worker ativo' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-800', bg: 'bg-amber-100', label: 'Worker pausado' },
  stopped: { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-100', label: 'Worker parado' },
};

export default function WorkerBadge({ refreshKey }) {
  const { status, loading } = useWorkerStatus();
  const state = status?.status ?? 'stopped';
  const tone = TONES[state] ?? TONES.stopped;
  const Icon = state === 'running' ? PlayCircle : state === 'paused' ? PauseCircle : Loader2;

  return (
    <span
      key={refreshKey}
      className={`badge ${tone.bg} ${tone.text}`}
      title={
        state === 'running'
          ? 'Worker em execução: filas de postagens e cascatas de DM processadas em segundo plano'
          : state === 'paused'
            ? 'Worker pausado: as automações não serão executadas até você retomar'
            : 'Worker parado: inicie-o em Configurações → Execução'
      }
    >
      <span className="relative mr-1.5 flex h-2 w-2">
        {state === 'running' && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone.dot} opacity-75`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      {loading && !status ? 'Worker…' : tone.label}
      <Icon className="ml-1 h-3 w-3" />
    </span>
  );
}