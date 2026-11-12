/**
 * Agendar — LLM generation from themes (§5.1.1) + scheduling (§5.1.2).
 * Preview is mandatory; the scheduling queue shows progress (Zeigarnik).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, CalendarPlus, XCircle, Trash2, Wand2 } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { EmptyState, ProgressBar } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

export default function Agendar() {
  const toast = useToast();
  const [topics, setTopics] = useState([]);
  const [queue, setQueue] = useState([]);
  const [draft, setDraft] = useState(null);
  const [topicId, setTopicId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');

  const load = useCallback(async () => {
    try {
      const [topicsData, postsData] = await Promise.all([
        api.get('/topics'),
        api.get('/posts', { query: { status: 'scheduled', limit: 20 } }),
      ]);
      setTopics(topicsData.topics);
      setQueue(postsData.items);
    } catch (err) {
      toast.error(`Falha ao carregar: ${err.message}`);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    if (!topicId) {
      toast.error('Selecione um tema.');
      return;
    }
    setGenerating(true);
    try {
      const result = await api.post('/posts/generate', { topicId, instructions });
      setDraft(result.post);
      toast.success(`Texto gerado (${result.generated.provider}/${result.generated.model}, ${result.generated.chars} caracteres). Revise o preview.`);
    } catch (err) {
      toast.error(`Geração falhou: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const publishNow = async () => {
    if (!draft) return;
    try {
      await api.post(`/posts/${draft.id}/publish`);
      toast.success('Postagem publicada!');
      setDraft(null);
      load();
    } catch (err) {
      toast.error(`Falha ao publicar: ${err.message}`);
    }
  };

  const schedule = async () => {
    if (!draft) return;
    if (!scheduleAt) {
      toast.error('Escolha data e hora.');
      return;
    }
    try {
      await api.post(`/posts/${draft.id}/schedule`, { scheduledAt: new Date(scheduleAt).toISOString() });
      toast.success('Postagem agendada com sucesso.');
      setDraft(null);
      setScheduleAt('');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cancel = async (id) => {
    try {
      await api.post(`/posts/${id}/cancel`);
      toast.info('Agendamento cancelado.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/posts/${id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Themes */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Temas pré-definidos</h3>
        <p className="mt-1 text-xs text-gray-500">A LLM escreve o post a partir do tema e das diretrizes. Gerencie a lista em Configurações › Temas.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {topics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => setTopicId(topic.id)}
              className={`rounded-xl border p-4 text-left transition ${topicId === topic.id ? 'border-indigo-400 bg-indigo-50' : 'border-gray-100 bg-white hover:border-gray-300'}`}
            >
              <p className="text-sm font-semibold text-gray-800">{topic.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">{topic.prompt || 'Sem diretriz adicional'}</p>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">{topic.postsCount ?? 0} posts gerados</p>
            </button>
          ))}
        </div>
      </div>

      {/* Generator */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Gerar post com LLM</h3>
          <label className="label mt-4" htmlFor="topic">Tema</label>
          <select id="topic" className="input" value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">Selecione…</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.name}</option>
            ))}
          </select>

          <label className="label mt-4" htmlFor="instructions">Instruções adicionais (opcional)</label>
          <textarea
            id="instructions"
            className="input h-24 resize-y"
            placeholder="Ex.: mencione que estou contratando para a vaga de dev sênior"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />

          <button className="btn-primary mt-4" onClick={generate} disabled={generating || !topicId}>
            <Wand2 className="h-4 w-4" />
            {generating ? 'Gerando…' : 'Gerar e revisar'}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            A publicação só acontece após a sua aprovação no preview. Provedor configurado em Configurações › LLM.
          </p>
        </div>

        {/* Draft preview */}
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800">Preview do rascunho</h3>
          {draft ? (
            <>
              <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-700">
                {draft.text}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {draft.text.length} caracteres · gerado por {draft.generatedBy?.provider ?? 'LLM'} / {draft.generatedBy?.model ?? '—'}
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div>
                  <label className="label" htmlFor="scheduleAt">Agendar para</label>
                  <input id="scheduleAt" type="datetime-local" className="input" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
                </div>
                <button className="btn-secondary" onClick={schedule}>
                  <CalendarPlus className="h-4 w-4" />
                  Agendar
                </button>
                <button className="btn-primary" onClick={publishNow}>
                  <Sparkles className="h-4 w-4" />
                  Publicar agora
                </button>
              </div>
            </>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-6 text-center text-xs text-gray-400">
              Gere um texto para visualizar o preview aqui.
            </p>
          )}
        </div>
      </div>

      {/* Queue */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Fila de agendamentos</h3>
          <span className="text-xs text-gray-400">{queue.length} pendentes</span>
        </div>
        {queue.length === 0 ? (
          <EmptyState icon={CalendarPlus} title="Nenhum agendamento" hint="Gere um post com LLM e agende a publicação para uma data futura." />
        ) : (
          <ul className="mt-4 space-y-3">
            {queue.map((post) => (
              <li key={post.id} className="rounded-lg border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-700">{post.text.slice(0, 90)}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {post.topicName ?? 'Manual'} · {formatDateTime(post.scheduledAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={post.status} simulated={post.simulated} />
                    <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => cancel(post.id)} title="Cancelar">
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                    <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => remove(post.id)} title="Excluir">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <ProgressBar
                    percent={Math.max(0, Math.min(100, 100 - ((new Date(post.scheduledAt) - Date.now()) / (60 * 60 * 1000)) * 10))}
                    label="Tempo até a publicação"
                    showPercent={false}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
