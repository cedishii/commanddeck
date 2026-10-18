import { X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { categoryLabel } from '../domain/categories';
import { RISK_DESCRIPTION, SHELL_LABEL, type CommandEntry } from '../domain/command';
import { AdminBadge, RiskBadge, ShellBadge } from './ui/Badge';
import { SyntaxPreview } from './SyntaxPreview';

interface DetailPanelProps {
  readonly entry: CommandEntry;
  readonly onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}

/**
 * Modal side panel with full command information.
 * Esc or the close button dismisses it, and focus returns to whatever opened it.
 */
export function DetailPanel({ entry, onClose }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = `detail-title-${entry.id}`;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { previous?.focus(); };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const d = entry.details;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-[var(--cd-overlay)]" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative flex h-full w-[min(560px,92vw)] flex-col border-l border-border bg-surface shadow-[var(--cd-shadow)]"
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <h2 id={titleId} className="text-lg leading-snug font-semibold">{entry.name}</h2>
            <div className="flex flex-wrap gap-1">
              <ShellBadge shell={entry.shell} />
              <RiskBadge risk={entry.risk} />
              {entry.requiresAdmin ? <AdminBadge /> : null}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <p className="text-sm">{entry.summary}</p>

          <Section title="Command">
            <SyntaxPreview syntax={entry.syntax} label={entry.name} variant="full" />
          </Section>

          {d?.whenToUse ? <Section title="When to use it">{d.whenToUse}</Section> : null}

          {d?.syntaxParts && d.syntaxParts.length > 0 ? (
            <Section title="What the syntax means">
              <dl className="space-y-1.5">
                {d.syntaxParts.map((p) => (
                  <div key={p.part} className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-3">
                    <dt><code className="rounded bg-code-bg px-1 font-mono text-[13px] text-code-fg">{p.part}</code></dt>
                    <dd className="text-muted">{p.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section title="Effect on your system">
            <p>{entry.modifies ? `Changes system state. ${RISK_DESCRIPTION[entry.risk]}` : 'Read-only. It does not change anything.'}</p>
            {d?.sideEffects && d.sideEffects.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-5">{d.sideEffects.map((s) => <li key={s}>{s}</li>)}</ul>
            ) : null}
          </Section>

          <Section title="Permissions">
            {entry.requiresAdmin
              ? 'Requires administrator rights. In a standard-user context Windows will refuse it.'
              : 'Works as a standard user.'}
          </Section>

          {d?.expectedOutput ? <Section title="Expected output">{d.expectedOutput}</Section> : null}

          {d?.cautions && d.cautions.length > 0 ? (
            <Section title="Watch out for">
              <ul className="list-disc space-y-1 pl-5">{d.cautions.map((c) => <li key={c}>{c}</li>)}</ul>
            </Section>
          ) : null}

          <p className="border-t border-border pt-3 text-xs text-muted">
            {SHELL_LABEL[entry.shell]} · {categoryLabel(entry.category)}
            {entry.id.startsWith('sample.') ? ' · Sample entry (Phase 1), not yet catalog-verified.' : null}
          </p>
        </div>
      </div>
    </div>
  );
}
