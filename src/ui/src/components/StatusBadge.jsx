/** Status badge used across every module. */

const STATUS_TONES = {
  published: 'bg-green-100 text-green-800',
  sent: 'bg-green-100 text-green-800',
  submitted: 'bg-green-100 text-green-800',
  active: 'bg-green-100 text-green-800',
  dry_run: 'bg-indigo-100 text-indigo-700',
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-amber-100 text-amber-800',
  pending: 'bg-gray-100 text-gray-700',
  failed: 'bg-red-100 text-red-700',
  blocked: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
  completed: 'bg-green-100 text-green-800',
  paused: 'bg-amber-100 text-amber-800',
  waiting_reply: 'bg-indigo-100 text-indigo-700',
  needs_intervention: 'bg-amber-100 text-amber-800',
  saved: 'bg-green-100 text-green-800',
  discarded: 'bg-gray-100 text-gray-500',
  applied: 'bg-indigo-100 text-indigo-700',
  untested: 'bg-gray-100 text-gray-500',
  inactive: 'bg-gray-100 text-gray-500',
  simulated: 'bg-indigo-100 text-indigo-700',
};

const STATUS_LABELS = {
  published: 'Publicado',
  sent: 'Enviado',
  submitted: 'Enviada',
  active: 'Ativo',
  dry_run: 'Dry-run',
  draft: 'Rascunho',
  scheduled: 'Agendado',
  pending: 'Pendente',
  failed: 'Falha',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  paused: 'Pausado',
  waiting_reply: 'Aguardando resposta',
  needs_intervention: 'Intervenção manual',
  saved: 'Salva',
  discarded: 'Descartada',
  applied: 'Candidatado',
  untested: 'Não testado',
  inactive: 'Inativo',
  simulated: 'Simulado',
};

export function StatusBadge({ status, simulated }) {
  const tone = STATUS_TONES[status] ?? 'bg-gray-100 text-gray-600';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`badge ${tone}`}>
      {status === 'failed' && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />}
      {label}
      {simulated && status !== 'dry_run' && ' · simulado'}
    </span>
  );
}
