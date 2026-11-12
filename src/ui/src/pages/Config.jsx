/**
 * Configurações — LLM provider, rate limits, server + temas.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Save, Plus, Trash2, FlaskConical, ShieldCheck } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Spinner, Modal } from '../components/Widgets.jsx';

const PROVIDERS = [
  ['ollama', 'Ollama (local, sem chave)'],
  ['openai', 'OpenAI'],
  ['deepseek', 'DeepSeek'],
  ['anthropic', 'Anthropic'],
];

export default function ConfigPage() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [topicModal, setTopicModal] = useState(false);
  const [topicDraft, setTopicDraft] = useState({ name: '', prompt: '' });

  const load = useCallback(async () => {
    try {
      const [configData, topicsData] = await Promise.all([api.get('/config'), api.get('/topics')]);
      setConfig(configData.config);
      setTopics(topicsData.topics);
    } catch (err) {
      toast.error(`Falha ao carregar configuração: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const { llm, limits, outreach, linkedin, ...rest } = config;
      // apiKey/official secrets stay as '***' — only send if the user retyped them.
      const payload = { ...rest, llm: { ...llm, apiKey: llm.apiKey === '***' ? '' : llm.apiKey }, limits, outreach, linkedin };
      if (!payload.llm.apiKey) delete payload.llm.apiKey;
      const result = await api.put('/config', payload);
      setConfig(result.config);
      toast.success('Configuração salva.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createTopic = async () => {
    if (!topicDraft.name.trim()) {
      toast.error('Dê um nome ao tema.');
      return;
    }
    try {
      await api.post('/topics', topicDraft);
      toast.success('Tema criado.');
      setTopicModal(false);
      setTopicDraft({ name: '', prompt: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleTopic = async (topic) => {
    try {
      await api.put(`/topics/${topic.id}`, { active: !topic.active });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeTopic = async (id) => {
    try {
      await api.del(`/topics/${id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading || !config) return <Spinner label="Carregando configuração…" />;

  return (
    <div className="space-y-6">
      {/* Dry-run switch (von Restorff: estado claro) */}
      <div className={`card flex flex-wrap items-center justify-between gap-4 ${config.dryRun ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex items-center gap-3">
          {config.dryRun ? <FlaskConical className="h-6 w-6 text-amber-500" /> : <ShieldCheck className="h-6 w-6 text-green-500" />}
          <div>
            <p className="text-sm font-semibold text-gray-800">{config.dryRun ? 'Modo dry-run ativo' : 'Modo ativo (ações reais)'}</p>
            <p className="text-xs text-gray-500">
              {config.dryRun
                ? 'Nenhuma chamada real ao LinkedIn é feita. Desative quando estiver tudo configurado e testado.'
                : 'As automações vão agir de verdade na sua conta. Respeite os limites abaixo.'}
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            className="h-5 w-5 accent-indigo-500"
            checked={!config.dryRun}
            onChange={(event) => setConfig({ ...config, dryRun: !event.target.checked })}
          />
          {config.dryRun ? 'Ativar envios reais' : 'Voltar para dry-run'}
        </label>
      </div>

      {/* LLM */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Provedor de LLM</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label" htmlFor="provider">Provedor</label>
            <select id="provider" className="input" value={config.llm.provider} onChange={(event) => setConfig({ ...config, llm: { ...config.llm, provider: event.target.value } })}>
              {PROVIDERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="model">Modelo</label>
            <input id="model" className="input" value={config.llm.model} onChange={(event) => setConfig({ ...config, llm: { ...config.llm, model: event.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="baseUrl">Base URL</label>
            <input id="baseUrl" className="input" value={config.llm.baseUrl} onChange={(event) => setConfig({ ...config, llm: { ...config.llm, baseUrl: event.target.value } })} />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="apiKey">API Key (vazio = usar Ollama local sem chave)</label>
            <input id="apiKey" type="password" className="input" placeholder={config.llm.apiKey === '***' ? '•••• (já configurada — digite uma nova para trocar)' : ''} value={config.llm.apiKey === '***' ? '' : config.llm.apiKey} onChange={(event) => setConfig({ ...config, llm: { ...config.llm, apiKey: event.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="temperature">Temperatura ({config.llm.temperature})</label>
            <input id="temperature" type="range" min="0" max="1" step="0.1" className="w-full accent-indigo-500" value={config.llm.temperature} onChange={(event) => setConfig({ ...config, llm: { ...config.llm, temperature: Number(event.target.value) } })} />
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Limites de rate (proteção da conta)</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <NumberField label="Convites por semana" value={config.limits.invitationsPerWeek} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, invitationsPerWeek: value } })} />
          <NumberField label="DMs por dia (máx. 5)" value={config.limits.dmsPerDay} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, dmsPerDay: value } })} />
          <NumberField label="Intervalo entre DMs (min)" value={config.limits.dmIntervalMinutes} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, dmIntervalMinutes: value } })} />
          <NumberField label="Candidaturas por dia" value={config.limits.applicationsPerDay} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, applicationsPerDay: value } })} />
          <NumberField label="Delay mínimo entre ações (ms)" value={config.limits.minDelayMs} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, minDelayMs: value } })} />
          <NumberField label="Delay máximo entre ações (ms)" value={config.limits.maxDelayMs} onChange={(value) => setConfig({ ...config, limits: { ...config.limits, maxDelayMs: value } })} />
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={config.outreach?.pauseOnReply !== false} onChange={(event) => setConfig({ ...config, outreach: { ...config.outreach, pauseOnReply: event.target.checked } })} />
            Pausar cascatas de DM automaticamente quando o contato responder
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={Boolean(config.outreach?.autoApproveDms)} onChange={(event) => setConfig({ ...config, outreach: { ...config.outreach, autoApproveDms: event.target.checked } })} />
            Aprovar mensagens de DM automaticamente (sem revisão manual)
          </label>
        </div>
      </div>

      {/* Server */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800">Servidor local</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <NumberField label="Porta" value={config.port} onChange={(value) => setConfig({ ...config, port: value })} />
          <div>
            <label className="label" htmlFor="host">Host</label>
            <input id="host" className="input" value={config.host} onChange={(event) => setConfig({ ...config, host: event.target.value })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-400">A porta só muda na próxima inicialização: npx --yes @danhachuel/jobfinder@&lt;versão&gt; start --port {config.port}</p>
      </div>

      {/* Topics */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Temas de postagem</h3>
          <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setTopicModal(true)}>
            <Plus className="h-3.5 w-3.5" />
            Novo tema
          </button>
        </div>
        <ul className="mt-4 divide-y divide-gray-50">
          {topics.map((topic) => (
            <li key={topic.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800">{topic.name}</p>
                <p className="text-xs text-gray-400">{topic.prompt || 'Sem diretriz'}</p>
              </div>
              <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-500">
                <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={topic.active} onChange={() => toggleTopic(topic)} />
                ativo
              </label>
              <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => removeTopic(topic.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <button className="btn-primary" onClick={save} disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? 'Salvando…' : 'Salvar configuração'}
        </button>
      </div>

      <Modal open={topicModal} title="Novo tema" onClose={() => setTopicModal(false)} footer={<>
        <button className="btn-secondary" onClick={() => setTopicModal(false)}>Cancelar</button>
        <button className="btn-primary" onClick={createTopic}>Criar</button>
      </>}>
        <label className="label" htmlFor="topicName">Nome</label>
        <input id="topicName" className="input" placeholder="Ex.: Inteligência Artificial no trabalho" value={topicDraft.name} onChange={(event) => setTopicDraft({ ...topicDraft, name: event.target.value })} />
        <label className="label mt-4" htmlFor="topicPrompt">Diretriz para a LLM</label>
        <textarea id="topicPrompt" className="input h-24 resize-y" placeholder="Ex.: explique um conceito de IA com exemplo prático do dia a dia" value={topicDraft.prompt} onChange={(event) => setTopicDraft({ ...topicDraft, prompt: event.target.value })} />
      </Modal>
    </div>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" className="input" value={value ?? 0} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </div>
  );
}
