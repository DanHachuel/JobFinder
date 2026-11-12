/**
 * Postagens — manual composer (§5.1.3) + history (§5.1.4).
 * Side-by-side preview before publishing, char counter, filters, actions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { PenLine, Trash2, Send, CalendarPlus, XCircle, Sparkles } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { Spinner, EmptyState, MetricCard } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

const LIMIT = 3000;
const STATUS_FILTERS = [
  ['', 'Todos'],
  ['draft', 'Rascunhos'],
  ['scheduled', 'Agendados'],
  ['published', 'Publicados'],
  ['failed', 'Falhas'],
  ['cancelled', 'Cancelados'],
];

export default function Postagens() {
  const toast = useToast();
  const [posts, setPosts] = useState({ items: [], total: 0, page: 1 });
  const [stats, setStats] = useState(null);
  const [topics, setTopics] = useState([]);
  const [status, setStatus] = useState('');
  const [topicId, setTopicId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // composer state
  const [text, setText] = useState('');
  const [publishing, setPublishing] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const [postsData, statsData, topicsData] = await Promise.all([
        api.get('/posts', { query: { status, topicId, page, limit: 10 } }),
        api.get('/posts/stats'),
        api.get('/topics'),
      ]);
      setPosts(postsData);
      setStats(statsData);
      setTopics(topicsData.topics);
    } catch (err) {
      toast.error(`Falha ao carregar postagens: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [status, topicId, page, toast]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const createDraft = async () => {
    if (!text.trim()) {
      toast.error('Escreva o texto do post.');
      return;
    }
    try {
      await api.post('/posts', { text });
      setText('');
      toast.success('Rascunho criado. Publique quando estiver pronto.');
      loadPosts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const publish = async (id) => {
    setPublishing(id);
    try {
      await api.post(`/posts/${id}/publish`);
      toast.success('Postagem publicada!');
      loadPosts();
    } catch (err) {
      toast.error(`Falha ao publicar: ${err.message}`);
    } finally {
      setPublishing(null);
    }
  };

  const cancel = async (id) => {
    try {
      await api.post(`/posts/${id}/cancel`);
      toast.info('Agendamento cancelado.');
      loadPosts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/posts/${id}`);
      toast.info('Postagem removida.');
      loadPosts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const scheduleQuick = async (id) => {
    const value = window.prompt('Agendar para (YYYY-MM-DDTHH:MM):', new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    if (!value) return;
    try {
      await api.post(`/posts/${id}/schedule`, { scheduledAt: new Date(value).toISOString() });
      toast.success('Postagem agendada.');
      loadPosts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <MetricCard label="Publicadas" value={stats?.byStatus?.published ?? 0} hint="total no histórico" />
        <MetricCard label="Agendadas" value={stats?.byStatus?.scheduled ?? 0} hint="próximas 24h+" />
        <MetricCard label="Rascunhos" value={stats?.byStatus?.draft ?? 0} hint="aguardando revisão" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Composer */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Nova postagem manual</h3>
          <p className="mt-1 text-xs text-gray-500">Texto puro — o LinkedIn não aceita markdown. Preview obrigatório antes de publicar.</p>
          <textarea
            className="input mt-4 h-64 resize-y"
            placeholder="Escreva sua postagem aqui…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Limite LinkedIn: {LIMIT}</span>
            <span className={text.length > LIMIT ? 'font-bold text-red-600' : ''}>
              {text.length} / {LIMIT}
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={createDraft} disabled={!text.trim() || text.length > LIMIT}>
              <PenLine className="h-4 w-4" />
              Salvar rascunho
            </button>
            <span className="self-center text-xs text-gray-400">Publique pelo botão no histórico →</span>
          </div>
        </div>

        {/* Preview (Jakob) */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Preview</h3>
          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-700">
            {text || <span className="text-gray-400">O preview aparece aqui conforme você digita.</span>}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">JF</div>
            <div>
              <p className="text-sm font-medium text-gray-700">Você</p>
              <p className="text-xs text-gray-400">Publicar agora · visível para todos</p>
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-gray-800">Histórico</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select className="input w-auto" value={topicId} onChange={(event) => { setTopicId(event.target.value); setPage(1); }}>
              <option value="">Todos os temas</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>{topic.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : posts.items.length === 0 ? (
          <EmptyState icon={PenLine} title="Nenhuma postagem encontrada" hint="Crie um rascunho acima, gere com LLM em Postagens > Agendar ou ajuste os filtros." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="pb-2 pr-4">Tema</th>
                  <th className="pb-2 pr-4">Texto</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Data</th>
                  <th className="pb-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {posts.items.map((post) => (
                  <tr key={post.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 pr-4 text-gray-600">{post.topicName ?? '—'}</td>
                    <td className="max-w-xs py-3 pr-4">
                      <p className="truncate text-gray-700" title={post.text}>{post.text.slice(0, 80)}{post.text.length > 80 ? '…' : ''}</p>
                      {post.error && <p className="mt-1 text-xs text-red-500">{post.error}</p>}
                    </td>
                    <td className="py-3 pr-4"><StatusBadge status={post.status} simulated={post.simulated} /></td>
                    <td className="py-3 pr-4 text-xs text-gray-500">
                      {post.publishedAt ? `Publicado ${formatDateTime(post.publishedAt)}` : post.scheduledAt ? `Agendado ${formatDateTime(post.scheduledAt)}` : formatDateTime(post.createdAt)}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {['draft', 'failed'].includes(post.status) && (
                          <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => publish(post.id)} disabled={publishing === post.id} title="Publicar agora">
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {['draft', 'failed'].includes(post.status) && (
                          <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => scheduleQuick(post.id)} title="Agendar">
                            <CalendarPlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {post.status === 'scheduled' && (
                          <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => cancel(post.id)} title="Cancelar agendamento">
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => remove(post.id)} title="Excluir">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {posts.total > posts.limit && (
          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>
              Página {posts.page} · {posts.total} registros
            </span>
            <div className="flex gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={page * posts.limit >= posts.total} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        )}
      </div>

      <p className="flex items-center gap-1 text-xs text-gray-400">
        <Sparkles className="h-3.5 w-3.5" />
        Para gerar posts com LLM a partir de temas, use a tela Agendar.
      </p>
    </div>
  );
}
