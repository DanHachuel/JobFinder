/**
 * Candidaturas — application history + daily quota (§5.3.3).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BriefcaseBusiness, RefreshCw } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { Spinner, EmptyState, QuotaBar, MetricCard } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

export default function Candidaturas() {
  const toast = useToast();
  const [apps, setApps] = useState({ items: [], total: 0, page: 1, limit: 20 });
  const [limits, setLimits] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const [appsData, limitsData] = await Promise.all([
        api.get('/applications', { query: { status, page, limit: 10 } }),
        api.get('/applications/limits'),
      ]);
      setApps(appsData);
      setLimits(limitsData.applications);
    } catch (err) {
      toast.error(`Falha ao carregar candidaturas: ${err.message}`);
    }
  }, [status, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id) => {
    try {
      await api.post(`/applications/${id}/retry`, { dryRun: false });
      toast.info('Nova tentativa iniciada.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const savedIds = (apps.items ?? []).filter((a) => a.status === 'submitted').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Candidaturas" value={apps.total} hint="total registrado" />
        <MetricCard label="Enviadas hoje" value={limits?.used ?? 0} hint={`limite: ${limits?.limit ?? 20}/dia`} />
        <MetricCard label="Enviadas com sucesso" value={savedIds} hint="Easy Apply" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-800">Histórico de candidaturas</h3>
            <select className="input w-auto" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">Todos os status</option>
              <option value="submitted">Enviadas</option>
              <option value="dry_run">Dry-run</option>
              <option value="needs_intervention">Intervenção manual</option>
              <option value="failed">Falhas</option>
              <option value="blocked">Bloqueadas</option>
            </select>
          </div>

          {!apps.items.length ? (
            <EmptyState icon={BriefcaseBusiness} title="Nenhuma candidatura" hint="Candidate-se a partir da tela de Vagas. O modo dry-run é o padrão até você conectar o LinkedIn." />
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4">Vaga</th>
                    <th className="pb-2 pr-4">Score</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Relatório</th>
                    <th className="pb-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.items.map((app) => (
                    <tr key={app.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-700">{app.jobTitle}</p>
                        <p className="text-xs text-gray-400">{app.company}</p>
                      </td>
                      <td className="py-3 pr-4 font-bold text-gray-600">{app.matchScore ?? '—'}</td>
                      <td className="py-3 pr-4"><StatusBadge status={app.status} simulated={app.dryRun} /></td>
                      <td className="max-w-xs py-3 pr-4 text-xs text-gray-500">
                        {app.report?.notes ?? '—'}
                        {app.report?.screenshot && <span className="block text-[10px] text-gray-400">screenshot salvo em ~/.jobfinder/screenshots/</span>}
                      </td>
                      <td className="py-3">
                        {['failed', 'needs_intervention'].includes(app.status) && (
                          <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => retry(app.id)}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Tentar de novo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {apps.total > apps.limit && (
            <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
              <span>Página {apps.page} · {apps.total} registros</span>
              <div className="flex gap-2">
                <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
                <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page * apps.limit >= apps.total} onClick={() => setPage((p) => p + 1)}>Próxima</button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card">
            <h3 className="text-base font-semibold text-gray-800">Limite diário</h3>
            <div className="mt-6">
              {limits && <QuotaBar used={limits.used} limit={limits.limit} label="Candidaturas hoje" tone="bg-emerald-500" />}
            </div>
            <p className="mt-4 text-xs text-gray-400">
              Padrão 20/dia (configurável). Cada candidatura passa pelo rate limiter com delays humanos e reutiliza a sessão do
              navegador com os cookies conectados.
            </p>
          </div>

          <div className="card">
            <h3 className="text-base font-semibold text-gray-800">Sobre o Easy Apply</h3>
            <p className="mt-3 text-xs text-gray-500">
              A automação usa Playwright (opcional). Sem ele instalado — ou com dry-run ativo — o app registra a candidatura como
              <strong> dry-run</strong> e nada é enviado. Formulários complexos retornam <strong>intervenção manual</strong> com
              screenshot salvo no servidor.
            </p>
            <p className="mt-3 text-xs text-gray-400">Instalar sob demanda: npm i -g playwright &amp;&amp; npx playwright install chromium</p>
          </div>
        </div>
      </div>
    </div>
  );
}
