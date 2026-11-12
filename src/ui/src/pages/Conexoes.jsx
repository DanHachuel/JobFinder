/**
 * Conexões — keyword search + invitations with {{variáveis}} (§5.2.1).
 * Weekly quota bar (Goal Gradient) + history.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Search, Send, UserPlus, CheckCircle2 } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { Spinner, EmptyState, QuotaBar, MetricCard } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

const DEFAULT_MESSAGE = 'Oi {{nome}}, acompanho seu trabalho na {{empresa}}. Adorei sua atuação como {{cargo}} — vamos conectar?';

export default function Conexoes() {
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState({ items: [], total: 0, page: 1, limit: 20 });
  const [limits, setLimits] = useState(null);
  const [page, setPage] = useState(1);

  const loadHistory = useCallback(async () => {
    try {
      const [historyData, limitsData] = await Promise.all([
        api.get('/connections', { query: { page, limit: 10 } }),
        api.get('/connections/limits'),
      ]);
      setHistory(historyData);
      setLimits(limitsData.invitations);
    } catch (err) {
      toast.error(`Falha ao carregar histórico: ${err.message}`);
    }
  }, [page, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const search = async () => {
    if (!keyword.trim()) {
      toast.error('Digite uma palavra-chave (cargo, empresa, skill ou localização).');
      return;
    }
    setSearching(true);
    try {
      const data = await api.post('/connections/search', { keyword });
      setProfiles(data.profiles);
      setSelected(new Set());
      if (data.simulated) toast.info('Dry-run: resultados simulados para você explorar a interface.');
    } catch (err) {
      toast.error(`Busca falhou: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (!selected.size) {
      toast.error('Selecione ao menos um perfil.');
      return;
    }
    setSending(true);
    try {
      const chosen = profiles.filter((profile) => selected.has(profile.profileId));
      const outcome = await api.post('/connections/invitations', { profiles: chosen, message });
      const sent = outcome.results.filter((r) => r.status === 'sent').length;
      const blocked = outcome.results.filter((r) => r.status === 'blocked').length;
      const failed = outcome.results.filter((r) => r.status === 'failed').length;
      toast.success(`Convites enviados: ${sent}${blocked ? ` · bloqueados: ${blocked}` : ''}${failed ? ` · falhas: ${failed}` : ''}`);
      setSelected(new Set());
      loadHistory();
    } catch (err) {
      toast.error(`Falha no envio: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Convites enviados" value={history.total} hint="total no histórico" />
        <MetricCard label="Restam esta semana" value={limits?.remaining ?? '—'} hint={`limite: ${limits?.limit ?? 100}`} />
        <MetricCard label="Perfis na busca" value={profiles.length} hint={`${selected.size} selecionados`} />
      </div>

      {/* Search + selection */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Networking por palavra-chave</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="input max-w-md"
            placeholder="Ex.: tech recruiter, engenheiro de dados, product manager São Paulo"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && search()}
          />
          <button className="btn-primary" onClick={search} disabled={searching}>
            <Search className="h-4 w-4" />
            {searching ? 'Buscando…' : 'Buscar perfis'}
          </button>
          <button className="btn-secondary" onClick={() => setSelected(new Set(profiles.map((p) => p.profileId)))} disabled={!profiles.length}>
            <CheckCircle2 className="h-4 w-4" />
            Selecionar todos
          </button>
          <button className="btn-secondary" onClick={() => setSelected(new Set())} disabled={!selected.size}>
            Limpar seleção
          </button>
        </div>

        {searching && <Spinner label="Buscando perfis…" />}
        {!searching && profiles.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-50">
            {profiles.map((profile) => (
              <li key={profile.profileId} className="flex items-center gap-3 py-3">
                <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={selected.has(profile.profileId)} onChange={() => toggle(profile.profileId)} />
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                  {(profile.firstName?.[0] ?? '?')}{(profile.lastName?.[0] ?? '')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{profile.firstName} {profile.lastName}</p>
                  <p className="truncate text-xs text-gray-500">{profile.headline} · {profile.location}</p>
                </div>
                {profile.simulated && <span className="badge bg-indigo-50 text-indigo-500">simulado</span>}
              </li>
            ))}
          </ul>
        )}
        {!searching && profiles.length === 0 && (
          <p className="mt-4 text-xs text-gray-400">Nenhuma busca ainda. Os resultados aparecem aqui para seleção individual ou em lote.</p>
        )}
      </div>

      {/* Message + send (Fitts: CTA grande) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Mensagem do convite</h3>
          <p className="mt-1 text-xs text-gray-500">Variáveis suportadas: <code className="rounded bg-gray-100 px-1">{'{{nome}}'}</code>, <code className="rounded bg-gray-100 px-1">{'{{empresa}}'}</code>, <code className="rounded bg-gray-100 px-1">{'{{cargo}}'}</code> · limite de 300 caracteres do LinkedIn.</p>
          <textarea className="input mt-4 h-40 resize-y" value={message} onChange={(event) => setMessage(event.target.value)} />
          <div className="mt-2 text-right text-xs text-gray-500">{message.length} / 300</div>
          <button className="btn-primary mt-2 w-full" onClick={send} disabled={sending || !selected.size}>
            <UserPlus className="h-4 w-4" />
            {sending ? 'Enviando…' : `Enviar convite (${selected.size})`}
          </button>
        </div>

        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Limite semanal (Goal Gradient)</h3>
          <div className="mt-6">
            {limits && <QuotaBar used={limits.used} limit={limits.limit} label="Convites esta semana" />}
          </div>
          <p className="mt-6 text-xs text-gray-400">
            Padrão 100 convites por semana (configurável em Configurações). Os envios passam pelo rate limiter central com delays humanos
            entre cada ação. Dry-run + sem conexão = envio simulado.
          </p>
        </div>
      </div>

      {/* History */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Histórico de convites</h3>
        {history.items.length === 0 ? (
          <EmptyState icon={Send} title="Nenhum convite enviado" hint="Faça uma busca, selecione perfis e envie convites personalizados." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4">Contato</th>
                  <th className="pb-2 pr-4">Mensagem</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((conn) => (
                  <tr key={conn.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-700">{conn.name}</p>
                      <p className="text-xs text-gray-400">{conn.headline}</p>
                    </td>
                    <td className="max-w-xs py-3 pr-4 text-xs text-gray-500" title={conn.message}>{conn.message?.slice(0, 70)}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={conn.status} simulated={conn.simulated} />
                      {conn.error && <p className="mt-1 text-xs text-red-500">{conn.error}</p>}
                    </td>
                    <td className="py-3 text-xs text-gray-500">{formatDateTime(conn.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {history.total > history.limit && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>Página {history.page} · {history.total} registros</span>
            <div className="flex gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page * history.limit >= history.total} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
