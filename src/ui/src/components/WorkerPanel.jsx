/**
 * Worker Panel (Dashboard): live status of the background worker, the task
 * it is running, when it ticks next and the last actions — plus Start/Stop
 * controls. Backend is the source of truth (react-state-guard): everything
 * here comes from GET /api/worker/status and survives an F5.
 */
import React, { useState } from 'react';
import { Play, Pause, RefreshCw, Loader2, Zap, Clock, ListChecks } from 'lucide-react';

import { useToast } from './Toast.jsx';
import { Spinner } from './Widgets.jsx';
import { useWorkerStatus, setWorkerRunning, tickWorker, relativeTime } from '../lib/useWorkerStatus.js';
import { formatDateTime } from '../lib/format.js';

const LEVEL_TONE = {
  success: 'text-green-700',
  info: 'text-gray-600',
  warn: 'text-amber-700',
  error: 'text-red-700',
};

export function WorkerPanel() {
  const toast = useToast();
  const { status, error, refresh } = useWorkerStatus();
  const [busy, setBusy] = useState(null);

  const running = status?.isRunning === true;
  const stopped = status?.status === 'stopped';

  const control = async (action, label) => {
    setBusy(action);
    try {
      if (action === 'tick') {
        const result = await tickWorker();
        if (result?.ok === false) {
          toast.error(result.message ?? 'Não foi possível executar o passe.');
        } else {
          toast.success(`Passe executado: ${result.result?.sent ?? 0} DM(s), ${result.result?.posts?.length ?? 0} post(s).`);
        }
      } else {
        await setWorkerRunning(action === 'start');
        toast.success(action === 'start' ? 'Worker em execução.' : 'Worker pausado.');
      }
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const stats = status?.stats ?? {};

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`mt-1 flex h-9 w-9 items-center justify-center rounded-lg ${running ? 'bg-green-100 text-green-600' : stopped ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-600'}`}>
            {running ? <Zap className="h-5 w-5" /> : <Loader2 className="h-5 w-5" />}
          </span>
          <div>
            <h3 className="text-base font-semibold text-gray-800">Automação em segundo plano</h3>
            <p className="mt-1 text-xs text-gray-500">
              {running
                ? 'Processando a fila de postagens agendadas e cascatas de DM mesmo com o navegador fechado.'
                : stopped
                  ? 'O worker não está rodando. Inicie-o para que as automações voltem a acontecer.'
                  : 'Worker pausado: as filas continuam salvas, mas nada é enviado.'}
            </p>
            {status?.activeTask && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                <Loader2 className="h-3 w-3 animate-spin" />
                {status.activeTask}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={running ? 'btn-secondary' : 'btn-primary'}
            onClick={() => control(running ? 'stop' : 'start')}
            disabled={busy !== null}
            title={running ? 'Pausar o worker' : 'Iniciar o worker'}
          >
            {busy === 'start' || busy === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? 'Pausar' : stopped ? 'Iniciar worker' : 'Retomar'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => control('tick')}
            disabled={busy !== null || !running}
            title={running ? 'Executar um passe agora' : 'Disponível apenas com o worker em execução'}
          >
            {busy === 'tick' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Executar agora
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-xs text-gray-500 sm:grid-cols-4">
        <div>
          <p className="flex items-center gap-1 font-semibold text-gray-700"><Clock className="h-3.5 w-3.5" /> Próxima verificação</p>
          <p className="mt-1">{status?.nextTickAt ? `${relativeTime(status.nextTickAt)} (${formatDateTime(status.nextTickAt)})` : '—'}</p>
        </div>
        <div>
          <p className="font-semibold text-gray-700">Último passe</p>
          <p className="mt-1">{status?.lastTickAt ? formatDateTime(status.lastTickAt) : '—'}</p>
        </div>
        <div>
          <p className="font-semibold text-gray-700">Publicados / DMs</p>
          <p className="mt-1">{stats.postsPublished ?? 0} posts · {stats.dmsSent ?? 0} DMs</p>
        </div>
        <div>
          <p className="font-semibold text-gray-700">Passes / falhas</p>
          <p className="mt-1">{stats.ticks ?? 0} · {stats.failed ?? 0} falhas</p>
        </div>
      </div>

      {status?.lastError && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Último erro do worker: {status.lastError}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Não foi possível ler o status do worker: {error}
        </p>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <ListChecks className="h-3.5 w-3.5" />
          Últimas ações
        </p>
        {status?.logs?.length ? (
          <ul className="mt-2 space-y-1.5">
            {status.logs.slice(0, 8).map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 font-mono text-[10px] text-gray-400">{formatDateTime(entry.ts)}</span>
                <span className={LEVEL_TONE[entry.level] ?? 'text-gray-600'}>{entry.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-gray-400">Nenhuma ação registrada ainda.</p>
        )}
      </div>
    </div>
  );
}

export default WorkerPanel;