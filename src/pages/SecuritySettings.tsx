import { KeyRound, Lock, Unlock } from 'lucide-react';
import { useId, useState } from 'react';
import { useAppContext } from '../app/context';
import { useSettings } from '../app/settings';
import { PasswordPrompt } from '../components/PasswordPrompt';
import { Card } from '../components/ui/Card';
import { Field, Toggle, fieldInputClass } from '../components/ui/Field';
import { Modal, buttonStyles } from '../components/ui/Modal';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { PasswordPolicy } from '../ipc/types';

const POLICY_LABELS: readonly { key: keyof PasswordPolicy; label: string }[] = [
  { key: 'highImpact', label: 'High-impact runs (formatting, deleting system folders, …)' },
  { key: 'restartAsAdmin', label: 'Restart as administrator' },
  { key: 'advancedMode', label: 'Turning on Advanced Mode' },
];

/** Set or change the password. Changing needs the current one. */
function PasswordDialog({ change, onClose }: { change: boolean; onClose: () => void }) {
  const { invalidate, notify } = useAppContext();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<{ field: 'current' | 'next' | 'repeat'; message: string } | null>(null);
  const formId = useId();

  const save = () => {
    if (next !== repeat) {
      setError({ field: 'repeat', message: 'The passwords don’t match.' });
      return;
    }
    setError(null);
    api.setPassword(next, change ? current : undefined).then(
      () => {
        invalidate();
        notify(change ? 'Password changed' : 'Password set');
        onClose();
      },
      (e: unknown) => {
        const err = e instanceof BackendError ? e : null;
        const message = err?.fieldMessage('password') ?? (err?.kind === 'limit' ? err.message : String(e));
        // The backend checks the current password first; a "wrong password" refers to it.
        const field = change && (message === 'Wrong password.' || err?.kind === 'limit') ? 'current' : 'next';
        setError({ field, message });
      },
    );
  };

  const field = (name: 'current' | 'next' | 'repeat', label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <Field label={label} error={error?.field === name ? error.message : null}>
      {(control) => (
        <input {...control} type="password" autoFocus={autoFocus} className={fieldInputClass} value={value} onChange={(e) => { set(e.target.value); }} />
      )}
    </Field>
  );

  return (
    <Modal
      title={change ? 'Change app password' : 'Set an app password'}
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className={buttonStyles.primary} disabled={next === '' || repeat === '' || (change && current === '')}>Save</button>
        </>
      }
    >
      <form id={formId} className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {change ? field('current', 'Current password', current, setCurrent, true) : null}
        {field('next', 'New password (at least 6 characters)', next, setNext, !change)}
        {field('repeat', 'Repeat new password', repeat, setRepeat)}
      </form>
    </Modal>
  );
}

type Prompt = null | { kind: 'advanced' } | { kind: 'remove' } | { kind: 'policy'; policy: PasswordPolicy } | { kind: 'set'; change: boolean };

/** Advanced Mode, meaningful-change confirmations and the optional app password (SECURITY.md §6.3, §8). */
export function SecuritySettings() {
  const { security, invalidate, notify } = useAppContext();
  const { settings, update } = useSettings();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const fail = (e: unknown) => { notify(e instanceof Error ? e.message : String(e), 'error'); };

  if (!security) {
    return <Card title="Running commands"><p className="text-sm text-muted">Loading…</p></Card>;
  }

  const setAdvanced = (on: boolean) => {
    if (on && security.passwordSet && security.policy.advancedMode) {
      setPrompt({ kind: 'advanced' });
      return;
    }
    api.setAdvancedMode(on).then(() => {
      invalidate();
      notify(on ? 'Advanced Mode is on' : 'Advanced Mode is off');
    }, fail);
  };

  return (
    <>
      <Card title="Running commands" description="How one-click Run asks before it runs something.">
        <div className="space-y-4">
          <Toggle
            label="Ask before meaningful changes"
            description="One confirmation before commands that change your system, like stopping a service or deleting a file."
            checked={settings.confirmMeaningful}
            onChange={(v) => { update({ confirmMeaningful: v }).then(() => { invalidate(); }, fail); }}
          />
          <Toggle
            label="Advanced Mode"
            description={
              <>
                No confirmations for meaningful changes, and your own multi-step commands and scripts run with one click.
                Formatting drives, deleting system folders and similar high-impact operations still ask.
              </>
            }
            checked={security.advancedMode}
            onChange={setAdvanced}
          />
        </div>
      </Card>

      <Card title="App password" description="Optional. Asked before the actions you choose below.">
        <div className="space-y-4 text-sm">
          <p className="flex items-center gap-2">
            {security.passwordSet ? <Lock aria-hidden size={15} /> : <Unlock aria-hidden size={15} />}
            {security.passwordSet ? 'A password is set.' : 'No password is set.'}
          </p>
          {security.passwordSet ? (
            <fieldset>
              <legend className="mb-2 font-medium">Ask for it before</legend>
              <div className="space-y-1.5">
                {POLICY_LABELS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={security.policy[key]}
                      className="h-4 w-4 accent-[var(--cd-accent)]"
                      onChange={(e) => { setPrompt({ kind: 'policy', policy: { ...security.policy, [key]: e.target.checked } }); }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonStyles.secondary} onClick={() => { setPrompt({ kind: 'set', change: security.passwordSet }); }}>
              <KeyRound aria-hidden size={14} />
              {security.passwordSet ? 'Change password' : 'Set a password'}
            </button>
            {security.passwordSet ? (
              <button type="button" className={buttonStyles.secondary} onClick={() => { setPrompt({ kind: 'remove' }); }}>Remove password</button>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            This guards against mistakes and casual use of an unlocked PC. It isn’t a lock: anyone using this Windows account can open a terminal directly or delete CommandDeck’s data. If you forget it, delete CommandDeck’s data folder to start over.
          </p>
        </div>
      </Card>

      {prompt?.kind === 'set' ? <PasswordDialog change={prompt.change} onClose={() => { setPrompt(null); }} /> : null}
      {prompt?.kind === 'advanced' ? (
        <PasswordPrompt
          title="Turn on Advanced Mode"
          confirmLabel="Turn on"
          onClose={() => { setPrompt(null); }}
          onSubmit={(pw) => api.setAdvancedMode(true, pw).then(() => { invalidate(); notify('Advanced Mode is on'); })}
        />
      ) : null}
      {prompt?.kind === 'remove' ? (
        <PasswordPrompt
          title="Remove the app password"
          description="Nothing will ask for a password afterwards."
          confirmLabel="Remove"
          onClose={() => { setPrompt(null); }}
          onSubmit={(pw) => api.removePassword(pw).then(() => { invalidate(); notify('Password removed'); })}
        />
      ) : null}
      {prompt?.kind === 'policy' ? (
        <PasswordPrompt
          title="Change when the password is asked"
          confirmLabel="Save"
          onClose={() => { setPrompt(null); }}
          onSubmit={(pw) => api.setPasswordPolicy(prompt.policy, pw).then(() => { invalidate(); notify('Saved'); })}
        />
      ) : null}
    </>
  );
}
