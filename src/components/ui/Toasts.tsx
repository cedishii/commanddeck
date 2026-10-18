import { CircleAlert, CircleCheck, X } from 'lucide-react';
import type { ToastTone } from '../../app/context';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

/** Bottom-right notifications. Errors use an assertive live region. */
export function Toasts({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  const politeToasts = toasts.filter((t) => t.tone === 'info');
  const errorToasts = toasts.filter((t) => t.tone === 'error');
  const render = (t: Toast) => (
    <div
      key={t.id}
      className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-[var(--cd-shadow)]"
    >
      {t.tone === 'error' ? (
        <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
      ) : (
        <CircleCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-risk1-fg" />
      )}
      <p className="flex-1">{t.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={() => { onDismiss(t.id); }} className="text-muted hover:text-fg">
        <X aria-hidden size={14} />
      </button>
    </div>
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2">
      <div role="status" aria-live="polite" className="flex flex-col items-end gap-2">{politeToasts.map(render)}</div>
      <div role="alert" aria-live="assertive" className="flex flex-col items-end gap-2">{errorToasts.map(render)}</div>
    </div>
  );
}
