import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { useDialog } from '../../hooks/useDialog';

interface ModalProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'sm' | 'md' | 'lg';
}

const WIDTH = { sm: 'w-[min(420px,92vw)]', md: 'w-[min(560px,92vw)]', lg: 'w-[min(720px,94vw)]' };

/** Centered modal dialog with focus trap, Esc to close and focus return. */
export function Modal({ title, onClose, children, footer, width = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useDialog(ref, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--cd-overlay)]" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={`relative flex max-h-[90vh] flex-col rounded-xl border border-border bg-surface shadow-[var(--cd-shadow)] ${WIDTH[width]}`}
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 id={titleId} className="flex-1 text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

export const buttonStyles = {
  primary: 'inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50',
  secondary:
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-50',
  danger:
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-risk3-bg px-3 text-sm font-medium text-risk3-fg hover:opacity-90 disabled:opacity-50',
  ghostIcon: 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg',
} as const;

interface ConfirmProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="sm"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? buttonStyles.danger : buttonStyles.primary} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm">{children}</div>
    </Modal>
  );
}
