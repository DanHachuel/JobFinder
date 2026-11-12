/**
 * Shared widgets: metric cards, progress/quotas (Zeigarnik + Goal
 * Gradient), spinner, empty state and modal.
 */
import React from 'react';
import { Loader2, X } from 'lucide-react';

export function MetricCard({ label, value, hint, icon: Icon, tone = 'text-gray-800', extra }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {Icon && <Icon className="h-5 w-5 text-gray-300" />}
      </div>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {extra}
    </div>
  );
}

/** Progress bar (Zeigarnik effect). */
export function ProgressBar({ percent, tone = 'bg-indigo-500', label, showPercent = true }) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent ?? 0)));
  return (
    <div>
      {(label || showPercent) && (
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>{label}</span>
          {showPercent && <span className="font-medium text-gray-700">{clamped}%</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/** Goal Gradient quota bar: "X de Y". */
export function QuotaBar({ used, limit, label, tone = 'bg-indigo-500', warning = 80 }) {
  const safeLimit = limit ?? 0;
  const percent = safeLimit ? Math.round((used / safeLimit) * 100) : 0;
  const barTone = percent >= warning ? 'bg-red-500' : tone;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span className="font-semibold text-gray-700">
          {used} de {safeLimit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${barTone} transition-all duration-500`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

export function Spinner({ label = 'Carregando…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white/50 px-6 py-12 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-gray-300" />}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-gray-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}
