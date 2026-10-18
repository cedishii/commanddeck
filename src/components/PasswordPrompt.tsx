import { useId, useState } from 'react';
import { BackendError } from '../ipc/client';
import { Field, fieldInputClass } from './ui/Field';
import { Modal, buttonStyles } from './ui/Modal';

interface PasswordPromptProps {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel: string;
  /** Called with the password; reject with the backend error to show it next to the field. */
  readonly onSubmit: (password: string) => Promise<unknown>;
  readonly onClose: () => void;
}

/** Asks for the app password for one protected action. */
export function PasswordPrompt({ title, description, confirmLabel, onSubmit, onClose }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className={buttonStyles.primary} disabled={busy || password === ''}>{confirmLabel}</button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          onSubmit(password).then(
            () => { onClose(); },
            (err: unknown) => {
              setBusy(false);
              setError(err instanceof BackendError ? (err.fieldMessage('password') ?? err.message) : String(err));
            },
          );
        }}
      >
        {description ? <p className="text-muted">{description}</p> : null}
        <Field label="App password" error={error}>
          {(control) => (
            <input {...control} type="password" autoFocus className={fieldInputClass} value={password} onChange={(e) => { setPassword(e.target.value); }} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
