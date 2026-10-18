import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useAppContext } from '../app/context';
import type { PageId } from '../app/pages';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import { Field, fieldInputClass } from './ui/Field';
import { Modal, buttonStyles } from './ui/Modal';

interface RestartAdminDialogProps {
  readonly page: PageId;
  /** Why admin rights are needed (e.g. the command that asked for them). */
  readonly reason?: string | undefined;
  /** The app password is required for this (protected-action policy). */
  readonly needsPassword?: boolean;
  readonly onClose: () => void;
}

/** Confirms "Restart as administrator" (ARCHITECTURE.md §7, decision D8). */
export function RestartAdminDialog({ page, reason, needsPassword = false, onClose }: RestartAdminDialogProps) {
  const { notify } = useAppContext();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const restart = () => {
    setBusy(true);
    setPasswordError(null);
    api.restartElevated(page, needsPassword ? password : undefined).then(
      () => { notify('Restarting as administrator…'); },
      (e: unknown) => {
        setBusy(false);
        if (e instanceof BackendError && (e.fieldMessage('password') ?? (e.kind === 'limit' ? e.message : undefined))) {
          setPasswordError(e.fieldMessage('password') ?? e.message);
          return;
        }
        onClose();
        notify(e instanceof Error ? e.message : String(e), 'error');
      },
    );
  };

  return (
    <Modal
      title="Restart as administrator?"
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={buttonStyles.primary} onClick={restart} disabled={busy || (needsPassword && password === '')}>
            <ShieldAlert aria-hidden size={14} />
            {busy ? 'Waiting for Windows…' : 'Restart as administrator'}
          </button>
        </>
      }
    >
      <div className="space-y-2 text-sm">
        {reason ? <p>{reason}</p> : null}
        <p>
          <strong>The whole app</strong> will run with administrator rights until you close it. Everything you run in it, including the terminals, gets those rights.
        </p>
        <p>Open terminal sessions end, and anything still running in them stops.</p>
        <p className="text-muted">Windows will ask for permission. To go back to standard user, close CommandDeck and open it normally.</p>
        {needsPassword ? (
          <Field label="App password" error={passwordError}>
            {(control) => (
              <input {...control} type="password" className={fieldInputClass} value={password} onChange={(e) => { setPassword(e.target.value); }} />
            )}
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
