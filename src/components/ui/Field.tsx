import { useId, type ReactNode } from 'react';

export const fieldInputClass =
  'mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm aria-[invalid=true]:border-[var(--cd-danger-fg)]';

interface ControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': 'true' | undefined;
}

/**
 * A labelled form control. The label stays just the label: hint and error are
 * linked with aria-describedby, so an error never changes the field's name.
 */
export function Field({ label, hint, error, children }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="text-sm">
      <label htmlFor={id} className="block font-medium">{label}</label>
      {hint ? <span id={hintId} className="block text-muted">{hint}</span> : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {error ? <span id={errorId} role="alert" className="mt-1 block text-xs text-danger">{error}</span> : null}
    </div>
  );
}

/** A checkbox whose name is just `label`; the description is linked, not part of the name. */
export function Toggle({ label, description, checked, onChange }: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => { onChange(e.target.checked); }}
        aria-describedby={`${id}-description`}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--cd-accent)]"
      />
      <div>
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">{label}</label>
        <span id={`${id}-description`} className="block text-sm text-muted">{description}</span>
      </div>
    </div>
  );
}
