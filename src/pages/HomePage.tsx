import { ArrowDown, ArrowUp, ArrowUpToLine, Pencil, Plus } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { useAppContext } from '../app/context';
import { CommandRow } from '../components/CommandRow';
import { PageHeader } from '../components/PageHeader';
import { Modal, buttonStyles } from '../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StatusMessage';
import { useAsync } from '../hooks/useAsync';
import { useCommandActions } from '../hooks/useCommandActions';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { QuickAction } from '../ipc/types';

function LabelEditor({ item, onClose }: { item: QuickAction; onClose: () => void }) {
  const { invalidate, notify } = useAppContext();
  const [label, setLabel] = useState(item.label ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [error, setError] = useState<BackendError | null>(null);
  const uid = useId();

  const save = async () => {
    try {
      await api.homeUpdate(item.command.id, label.trim() || null, note.trim() || null);
      invalidate();
      notify('Quick action updated');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof BackendError ? e : new BackendError('internal', String(e)));
    }
  };

  return (
    <Modal
      title="Rename quick action"
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonStyles.primary} onClick={() => { void save(); }}>Save</button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="text-sm text-muted">
          Only changes how it appears on Home. The command stays <code className="font-mono">{item.command.syntax.split('\n')[0]}</code>.
        </p>
        <div className="space-y-1">
          <label htmlFor={`${uid}-label`} className="block text-sm font-medium">Display name</label>
          <input
            id={`${uid}-label`}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            placeholder={item.command.name}
            value={label}
            maxLength={80}
            onChange={(e) => { setLabel(e.target.value); }}
          />
          {error?.fieldMessage('label') ? <p className="text-xs text-danger">{error.fieldMessage('label')}</p> : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={`${uid}-note`} className="block text-sm font-medium">Personal description</label>
          <input
            id={`${uid}-note`}
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            placeholder={item.command.summary}
            value={note}
            maxLength={300}
            onChange={(e) => { setNote(e.target.value); }}
          />
          {error?.fieldMessage('note') ? <p className="text-xs text-danger">{error.fieldMessage('note')}</p> : null}
        </div>
        {error && error.fields.length === 0 ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export function HomePage() {
  const { revision, openSearch } = useAppContext();
  const actions = useCommandActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision triggers a refetch after changes
  const load = useCallback(() => api.home(), [revision]);
  const { state, retry } = useAsync(load);
  const [editing, setEditing] = useState<QuickAction | null>(null);

  const home = state.status === 'ready' ? state.data : null;
  const full = home ? home.items.length >= home.limit : false;

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <PageHeader
        title="Home"
        description="Your quick actions: the commands you use most, one click away."
        aside={
          home ? (
            <>
              <span className="text-sm text-muted">{home.items.length} of {home.limit}</span>
              <button
                type="button"
                className={buttonStyles.secondary}
                disabled={full}
                title={full ? 'Home is full. Remove one, or raise the limit to 15 in Settings.' : undefined}
                onClick={() => { openSearch('addToHome'); }}
              >
                <Plus aria-hidden size={15} />
                Add command
              </button>
            </>
          ) : null
        }
      />

      {state.status === 'loading' ? <LoadingState label="Loading quick actions…" /> : null}

      {state.status === 'error' ? (
        <ErrorState title="Couldn't load your quick actions" message={state.error.message} onRetry={retry} />
      ) : null}

      {home && home.items.length === 0 ? (
        <EmptyState title="No quick actions yet">
          <p>Pin the commands you use most so they're one click away.</p>
          <button type="button" className={`${buttonStyles.primary} mt-3`} onClick={() => { openSearch('addToHome'); }}>
            <Plus aria-hidden size={15} />
            Add command
          </button>
        </EmptyState>
      ) : null}

      {home && home.items.length > 0 ? (
        <ol aria-label="Quick actions" className="space-y-2">
          {home.items.map((item, i) => (
            <CommandRow
              key={item.command.id}
              entry={item.command}
              index={i + 1}
              showShell
              label={item.label}
              note={item.note}
              menuItems={[
                { label: 'Move up', icon: <ArrowUp size={15} />, disabled: i === 0, onSelect: () => { void actions.moveOnHome(item.command, i - 1); } },
                {
                  label: 'Move down',
                  icon: <ArrowDown size={15} />,
                  disabled: i === home.items.length - 1,
                  onSelect: () => { void actions.moveOnHome(item.command, i + 1); },
                },
                { label: 'Move to top', icon: <ArrowUpToLine size={15} />, disabled: i === 0, onSelect: () => { void actions.moveOnHome(item.command, 0); } },
                { label: 'Rename…', icon: <Pencil size={15} />, onSelect: () => { setEditing(item); } },
              ]}
            />
          ))}
        </ol>
      ) : null}

      {editing ? <LabelEditor item={editing} onClose={() => { setEditing(null); }} /> : null}
    </div>
  );
}
