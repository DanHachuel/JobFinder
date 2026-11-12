/**
 * Painel — dashboard (LeadMaster metric cards + charts).
 * One GET /api/dashboard drives the whole screen.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PenLine, Users, MessageSquare, Briefcase, Wifi, RefreshCw, Activity } from 'lucide-react';

import { api } from '../lib/api.js';
import { MetricCard, QuotaBar, Spinner, EmptyState } from '../components/Widgets.jsx';
import { BarsChart, DoughnutChart } from '../components/Charts.jsx';
import { formatDateTime, formatRelative } from '../lib/format.js';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setError(null);
      setData(await api.get('/dashboard'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Spinner label="Carregando painel…" />;
  if (error) return <EmptyState icon={Wifi} title="Servidor indisponível" hint={error} action={<button className="btn-secondary" onClick={load}>Tentar novamente</button>} />;
  if (!data) return null;

  const appStatus = data.applications.byStatus ?? {};
  const postStatus = data.posts.byStatus ?? {};

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Olá 👋 bem-vindo ao seu painel</h1>
        <p className="mt-1 text-sm text-gray-500">
          {data.dryRun
            ? 'Modo dry-run ativo — tudo é simulado até você conectar o LinkedIn em Integrações e desativar o dry-run.'
            : 'Modo ativo — as ações serão enviadas de verdade ao LinkedIn.'}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Conexão LinkedIn"
          value={data.connection.connected ? 'Conectado' : 'Dry-run'}
          hint={`Modo: ${data.connection.mode}${data.connection.channel ? ` · ${data.connection.channel}` : ''}`}
          icon={Wifi}
          tone={data.connection.connected ? 'text-green-600' : 'text-amber-600'}
        />
        <MetricCard label="Postagens publicadas (7d)" value={data.posts.publishedLast7Days} hint={`${postStatus.scheduled ?? 0} agendadas`} icon={PenLine} />
        <MetricCard label="Convites enviados" value={data.connections.sent} hint={`${data.connections.quota.remaining} restantes esta semana`} icon={Users} />
        <MetricCard label="DMs hoje" value={data.dms.daily.used} hint={`limite: ${data.dms.daily.limit}/dia`} icon={MessageSquare} />
      </div>

      {/* Quotas (Goal Gradient) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="card">
          <QuotaBar used={data.connections.quota.used} limit={data.connections.quota.limit} label="Convites esta semana" />
          <p className="mt-3 text-xs text-gray-400">
            Restam <strong className="text-gray-600">{data.connections.quota.remaining}</strong> convites antes do limite semanal.
          </p>
        </div>
        <div className="card">
          <QuotaBar used={data.dms.daily.used} limit={data.dms.daily.limit} label="DMs hoje" tone="bg-purple-500" />
          <p className="mt-3 text-xs text-gray-400">
            {data.dms.stepsPending} mensagens pendentes nas cascatas ativas ({data.dms.activeCascades} ativas).
          </p>
        </div>
        <div className="card">
          <QuotaBar used={data.applications.quota.used} limit={data.applications.quota.limit} label="Candidaturas hoje" tone="bg-emerald-500" />
          <p className="mt-3 text-xs text-gray-400">{data.jobs.saved ?? data.jobs.total} vagas salvas · match médio {data.jobs.averageScore}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Postagens publicadas (7 dias)</h3>
              <p className="mt-1 text-xs text-gray-500">Uma publicação por dia mantém o algoritmo favorável.</p>
            </div>
            <button className="text-xs font-medium text-indigo-600 hover:text-indigo-800" onClick={load}>
              <RefreshCw className="mr-1 inline h-3 w-3" />
              Atualizar
            </button>
          </div>
          <div className="mt-4">
            <BarsChart data={(data.posts.series ?? []).map((item) => ({ label: item.day.slice(5), value: item.count }))} />
          </div>
        </div>

        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-800">Candidaturas por status</h3>
              <p className="mt-1 text-xs text-gray-500">Sucesso, intervenção manual e falhas ficam isolados em vermelho.</p>
            </div>
          </div>
          <div className="mt-4">
            <DoughnutChart
              data={[
                { label: 'Enviadas', value: appStatus.submitted ?? 0, color: '#3b82f6' },
                { label: 'Dry-run', value: appStatus.dry_run ?? 0, color: '#a5b4fc' },
                { label: 'Intervenção', value: appStatus.needs_intervention ?? 0, color: '#f59e0b' },
                { label: 'Falhas', value: appStatus.failed ?? 0, color: '#ef4444' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Quick status + activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="text-base font-semibold text-gray-800">Onboarding (checklist)</h3>
          <div className="mt-4 space-y-3">
            <ChecklistItem done={Boolean(data.connection.connected)} label="Conectar o LinkedIn (API oficial ou cookies)">
              <Link to="/integracoes" className="text-indigo-600 hover:text-indigo-800">Abrir Integrações</Link>
            </ChecklistItem>
            <ChecklistItem done={!data.dryRun} label="Desativar o dry-run em Configurações">
              <Link to="/config" className="text-indigo-600 hover:text-indigo-800">Abrir Configurações</Link>
            </ChecklistItem>
            <ChecklistItem done={Boolean(data.jobs.resumeLoaded)} label="Enviar seu currículo para o match de vagas">
              <Link to="/vagas" className="text-indigo-600 hover:text-indigo-800">Enviar currículo</Link>
            </ChecklistItem>
            <ChecklistItem done={(data.posts.byStatus?.published ?? 0) > 0} label="Publicar ou agendar a primeira postagem">
              <Link to="/postagens" className="text-indigo-600 hover:text-indigo-800">Escrever post</Link>
            </ChecklistItem>
            <ChecklistItem done={data.connections.sent > 0} label="Enviar o primeiro convite de conexão">
              <Link to="/conexoes" className="text-indigo-600 hover:text-indigo-800">Buscar pessoas</Link>
            </ChecklistItem>
          </div>
        </div>

        <div className="card">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800">
            <Activity className="h-4 w-4 text-gray-400" />
            Atividade recente
          </h3>
          <ul className="mt-4 space-y-3">
            {(data.logs ?? []).slice(0, 8).map((entry, index) => (
              <li key={index} className="border-b border-gray-50 pb-2 text-xs last:border-0">
                <span className="font-medium text-gray-600">{entry.module}</span>{' '}
                <span className="text-gray-500">{entry.message}</span>
                <div className="text-[10px] text-gray-400">{formatRelative(entry.ts)}</div>
              </li>
            ))}
            {!data.logs?.length && <li className="text-xs text-gray-400">Nenhuma atividade ainda.</li>}
          </ul>
        </div>
      </div>

      {/* Resume chips */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-semibold uppercase tracking-wide text-gray-400">Resumo</span>
        <span>Postagens: {data.posts.total}</span>
        <span>Conexões: {data.connections.total}</span>
        <span>Cascatas: {data.dms.cascades}</span>
        <span>Vagas: {data.jobs.total}</span>
        <span>Candidaturas: {data.applications.total}</span>
        <span>Atualizado: {formatDateTime(new Date().toISOString())}</span>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
        {done ? '✓' : '•'}
      </span>
      <span className={`flex-1 text-sm ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{label}</span>
      {!done && <span className="text-xs font-medium">{children}</span>}
    </div>
  );
}
