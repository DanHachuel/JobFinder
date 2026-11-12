/** pt-BR formatting helpers for the UI. */

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatDateShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatRelative(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const units = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(Math.round(diffMs / 60000), 'minute');
}

export function formatPercent(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

/** Score color buckets (von Restorff: failure red is isolated/vibrant). */
export function scoreTone(score) {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  if (score > 0) return 'text-red-600';
  return 'text-gray-400';
}

export function scoreBarColor(score) {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  if (score > 0) return 'bg-red-500';
  return 'bg-gray-300';
}
