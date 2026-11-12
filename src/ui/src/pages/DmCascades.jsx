/**
 * Cascatas de DM — sequences up to 5/day (§5.2.2).
 * Progress bars per cascade (Zeigarnik), daily quota (Goal Gradient),
 * pause on reply, manual approval.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Play, Pause, XCircle, Trash2, Check, RefreshCw } from 'lucide-react';

import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

import { Spinner, EmptyState, QuotaBar, ProgressBar, MetricCard, Modal } from '../components/Widgets.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { formatDateTime } from '../lib/format.js';

const MAX_STEPS = 5;

export default function DmCascades() {
  const toast = useToast();
  const [cascades, setCascades] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  // new cascade form
  const [contact, setContact] = useState('');
  const [profileId, setProfileId] = useState('');
  const [approval, setApproval] = useState(false);
  const [steps, setSteps] = useState([{ text: '', delayDays: 0 }, { text: '', delayDays: 2 }]);

  const load = useCallback(async () => {
    try {
      const [cascadesData, statsData] = await Promise.all([api.get('/cascades'), api.get('/cascades/stats')]);
      setCascades(cascadesData.cascades);
      setStats(statsData);
    } catch (err) {
      toast.error(`Falha ao carregar cascatas: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    try {
      await api.post('/cascades', {
        contactName: contact,
        profileId,
        approvalRequired: approval,
        sequence: steps.filter((step) => step.text.trim()),
      });
      toast.success('Cascata criada.');
      setFormOpen(false);
      setContact('');
      setProfileId('');
      setSteps([{ text: '', delayDays: 0 }, { text: '', delayDays: 2 }]);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeStatus = async (id, status) => {
    try {
      await api.post(`/cascades/${id}/status`, { status });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const approve = async (id) => {
    try {
      await api.post(`/cascades/${id}/approve`);
      toast.success('Mensagem aprovada.');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    try {
      await api.del(`/cascades/${id}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const tick = async () => {
    const result = await api.post('/cascades/tick');
    toast.info(`Processamento: ${result.sent} enviadas, ${result.skipped} aguardando.`);
    load();
  };

  const checkReplies = async () => {
    const result = await api.post('/cascades/check-replies');
    if (result.paused?.length) {
      toast.info(`${result.paused.length} cascata(s) pausada(s) por resposta do contato.`);
    } else {
      toast.info(result.error ? `Verificação falhou: ${result.error}` : 'Nenhuma resposta nova detectada.');
    }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <MetricCard label="DMs hoje" value={stats?.daily.used ?? 0} hint={`limite ${stats?.maxPerDay ?? 5}/dia`} icon={MessageSquare} />
        <MetricCard label="Cascatas ativas" value={stats?.byStatus?.active ?? 0} hint={`${stats?.total ?? 0} no total`} />
        <MetricCard label="Aguardando resposta" value={stats?.byStatus?.waiting_reply ?? 0} hint="pausadas automaticamente" />
        <MetricCard label="Intervalo mínimo" value={`${stats?.intervalMinutes ?? 30} min`} hint="entre mensagens" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">Cascatas em andamento</h3>
            <div className="flex gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={checkReplies} title="Verificar respostas na caixa de entrada">
                <RefreshCw className="h-3.5 w-3.5" />
                Verificar respostas
              </button>
              <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={tick} title="Rodar o motor agora (teste)">
                <Play className="h-3.5 w-3.5" />
                Processar agora
              </button>
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => setFormOpen(true)}>
                + Nova cascata
              </button>
            </div>
          </div>

          {loading ? (
            <Spinner />
          ) : cascades.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Nenhuma cascata criada" hint="Crie uma sequência de até 5 mensagens com delays em dias. Ideal para follow-up após convites aceitos." />
          ) : (
            <ul className="mt-4 space-y-4">
              {cascades.map((cascade) => (
                <li key={cascade.id} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{cascade.contactName}</p>
                      <p className="text-xs text-gray-400">
                        Criada em {formatDateTime(cascade.createdAt)}
                        {cascade.nextStepAt ? ` · próxima mensagem ${formatDateTime(cascade.nextStepAt)}` : ''}
                      </p>
                      {cascade.lastReplyAt && <p className="mt-1 text-xs text-indigo-500">Resposta recebida em {formatDateTime(cascade.lastReplyAt)}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={cascade.status} />
                      {cascade.pendingApprovals?.length > 0 && (
                        <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => approve(cascade.id)}>
                          <Check className="h-3.5 w-3.5" />
                          Aprovar msg {cascade.pendingApprovals[0] + 1}
                        </button>
                      )}
                      {cascade.status === 'active' && (
                        <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => changeStatus(cascade.id, 'paused')}>
                          <Pause className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {cascade.status === 'paused' && (
                        <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => changeStatus(cascade.id, 'active')}>
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {cascade.status !== 'cancelled' && cascade.status !== 'completed' && (
                        <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => changeStatus(cascade.id, 'cancelled')}>
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button className="btn-secondary !px-3 !py-1.5 text-xs !text-red-600" onClick={() => remove(cascade.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <ProgressBar percent={cascade.progress?.percent ?? 0} label={`${cascade.progress?.sent ?? 0} de ${cascade.progress?.total ?? 0} mensagens enviadas`} showPercent={false} />
                  </div>

                  <ol className="mt-3 space-y-2">
                    {(cascade.steps ?? []).map((step) => (
                      <li key={step.stepIndex} className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-xs">
                        <span className="font-bold text-gray-400">{step.stepIndex + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-gray-700">{step.text}</p>
                          <p className="mt-1 text-[10px] text-gray-400">
                            delay: {step.delayDays} dia(s) · {step.sentAt ? `enviada ${formatDateTime(step.sentAt)}` : step.status === 'failed' ? `falha: ${step.error}` : 'pendente'}
                          </p>
                        </div>
                        <StatusBadge status={step.status === 'sent' ? 'sent' : step.status} />
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Daily quota (Goal Gradient) */}
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-base font-semibold text-gray-800">Limite diário</h3>
            <div className="mt-6">
              {stats && <QuotaBar used={stats.daily.used} limit={stats.daily.limit} label="Mensagens enviadas hoje" tone="bg-purple-500" />}
            </div>
            <p className="mt-4 text-xs text-gray-400">
              Hard limit de {MAX_STEPS} mensagens por dia. Entre mensagens o app respeita o intervalo mínimo configurável
              ({stats?.intervalMinutes ?? 30} min) e delays humanos aleatórios.
            </p>
          </div>

          <div className="card">
            <h3 className="text-base font-semibold text-gray-800">Como funciona</h3>
            <ul className="mt-3 space-y-2 text-xs text-gray-500">
              <li>1. Cada mensagem tem um <strong>delay em dias</strong> (ex.: msg 1 hoje, msg 2 em 2 dias).</li>
              <li>2. O motor roda a cada minuto e envia o que estiver devido, respeitando o limite diário.</li>
              <li>3. Se o contato <strong>responder</strong>, a cascata pausa automaticamente.</li>
              <li>4. Ative a <strong>aprovação manual</strong> para revisar cada mensagem antes do envio.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Nova cascata */}
      <Modal
        open={formOpen}
        title="Nova cascata de DM"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setFormOpen(false)}>Cancelar</button>
            <button className="btn-primary" onClick={create}>Criar cascata</button>
          </>
        }
      >
        <label className="label" htmlFor="contact">Nome do contato</label>
        <input id="contact" className="input" placeholder="Ex.: Ana Silva" value={contact} onChange={(event) => setContact(event.target.value)} />

        <label className="label mt-4" htmlFor="profileId">ID do perfil (LinkedIn)</label>
        <input id="profileId" className="input" placeholder="Ex.: demo-0 (perfil aceito no convite)" value={profileId} onChange={(event) => setProfileId(event.target.value)} />

        <p className="label mt-4">Mensagens (máx. {MAX_STEPS})</p>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="rounded-lg border border-gray-100 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
                <span>Mensagem {index + 1}</span>
                <label className="flex items-center gap-1 font-normal">
                  delay (dias)
                  <input
                    type="number"
                    min="0"
                    className="input !w-16 !py-1"
                    value={step.delayDays}
                    onChange={(event) => {
                      const next = [...steps];
                      next[index] = { ...step, delayDays: Number(event.target.value) || 0 };
                      setSteps(next);
                    }}
                  />
                </label>
              </div>
              <textarea
                className="input mt-2 h-20 resize-y"
                placeholder="Texto da mensagem…"
                value={step.text}
                onChange={(event) => {
                  const next = [...steps];
                  next[index] = { ...step, text: event.target.value };
                  setSteps(next);
                }}
              />
            </div>
          ))}
        </div>
        {steps.length < MAX_STEPS && (
          <button className="btn-secondary mt-3" onClick={() => setSteps([...steps, { text: '', delayDays: steps.length * 2 }])}>
            + Adicionar mensagem
          </button>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={approval} onChange={(event) => setApproval(event.target.checked)} />
          Exigir aprovação manual antes de cada envio
        </label>
      </Modal>
    </div>
  );
}
