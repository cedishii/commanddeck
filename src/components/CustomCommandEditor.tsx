import { useId, useState, type ReactNode } from 'react';
import { useAppContext, type EditorTarget } from '../app/context';
import { categoriesFor } from '../domain/categories';
import { RISK_LABEL, SHELL_LABEL, type Shell } from '../domain/command';
import { api } from '../ipc/api';
import { BackendError } from '../ipc/client';
import type { CategoryId, CustomDraft, Placeholder, RiskLevel } from '../ipc/types';
import { Modal, buttonStyles } from './ui/Modal';

interface EditorProps {
  readonly target: EditorTarget;
  readonly onClose: () => void;
}

const inputClass = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm aria-[invalid=true]:border-[var(--cd-danger-fg)]';

/** Placeholder names used as <Name> in the syntax, in order of appearance. */
export function placeholderNames(syntax: string): string[] {
  const names: string[] = [];
  for (const m of syntax.matchAll(/<([A-Za-z][A-Za-z0-9]*)>/g)) {
    const name = m[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function splitList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

/**
 * Create or edit a custom command. The backend validates everything; this form
 * only collects input and shows the backend's field messages.
 */
export function CustomCommandEditor({ target, onClose }: EditorProps) {
  const { invalidate, notify, openDetails } = useAppContext();
  const existing = target.mode === 'edit' ? target.command : null;
  const [shell, setShell] = useState<Shell>(existing?.shell ?? (target.mode === 'create' ? target.shell : 'cmd'));
  const [name, setName] = useState(existing?.name ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [category, setCategory] = useState<CategoryId>(existing?.category ?? (categoriesFor(shell)[0]?.id ?? 'files'));
  const [syntax, setSyntax] = useState(existing?.syntax ?? '');
  const [keywords, setKeywords] = useState(existing?.keywords.join(', ') ?? '');
  const [aliases, setAliases] = useState(existing?.aliases.join(', ') ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [requiresAdmin, setRequiresAdmin] = useState(existing?.requiresAdmin ?? false);
  const [modifies, setModifies] = useState(existing?.modifies ?? false);
  const [risk, setRisk] = useState<RiskLevel>(existing?.risk ?? 'L1');
  const [placeholderText, setPlaceholderText] = useState<Record<string, string>>(
    Object.fromEntries((existing?.placeholders ?? []).map((p) => [p.name, p.description])),
  );
  const [error, setError] = useState<BackendError | null>(null);
  const [saving, setSaving] = useState(false);
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const fieldError = (field: string) => error?.fieldMessage(field);
  const aria = (field: string) => ({
    id: id(field),
    'aria-invalid': fieldError(field) ? true : undefined,
    'aria-describedby': fieldError(field) ? `${id(field)}-error` : `${id(field)}-hint`,
  });

  const placeholders = placeholderNames(syntax);
  const categories = categoriesFor(shell);

  const save = async () => {
    setSaving(true);
    setError(null);
    const placeholderList: Placeholder[] = placeholders.map((p) => ({ name: p, description: placeholderText[p]?.trim() || p }));
    const draft: CustomDraft = {
      shell,
      name,
      summary,
      category,
      syntax: syntax.trim(),
      keywords: splitList(keywords),
      aliases: splitList(aliases),
      notes: notes.trim() || null,
      requiresAdmin,
      modifies: modifies || risk !== 'L1',
      risk,
      placeholders: placeholderList,
    };
    try {
      const saved = existing ? await api.updateCustom(existing.id, draft) : await api.createCustom(draft);
      invalidate();
      notify(existing ? 'Custom command saved' : 'Custom command created');
      onClose();
      if (!existing) openDetails(saved.id);
    } catch (e: unknown) {
      setError(e instanceof BackendError ? e : new BackendError('internal', String(e)));
    } finally {
      setSaving(false);
    }
  };

  const unmatched = error?.fields.filter(
    (f) => !['name', 'summary', 'category', 'syntax', 'keywords', 'aliases', 'notes', 'risk', 'shell', 'placeholders'].some((k) => f.field.startsWith(k)),
  );

  return (
    <Modal
      title={existing ? 'Edit custom command' : 'New custom command'}
      onClose={onClose}
      width="lg"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonStyles.primary} disabled={saving} onClick={() => { void save(); }}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create command'}
          </button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field id={id('shell')} label="Shell" hint={existing ? 'The shell of an existing command can’t change.' : 'CMD and PowerShell syntax are different languages.'} error={fieldError('shell')}>
          <select
            {...aria('shell')}
            className={inputClass}
            value={shell}
            disabled={existing !== null}
            onChange={(e) => {
              const next = e.target.value as Shell;
              setShell(next);
              setCategory(categoriesFor(next)[0]?.id ?? 'files');
            }}
          >
            <option value="cmd">{SHELL_LABEL.cmd}</option>
            <option value="powershell">{SHELL_LABEL.powershell}</option>
          </select>
        </Field>

        <Field id={id('category')} label="Category" error={fieldError('category')}>
          <select {...aria('category')} className={inputClass} value={category} onChange={(e) => { setCategory(e.target.value as CategoryId); }}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>

        <Field id={id('name')} label="Name" hint="What it does, in plain words." error={fieldError('name')}>
          <input {...aria('name')} className={inputClass} value={name} onChange={(e) => { setName(e.target.value); }} maxLength={80} />
        </Field>

        <Field id={id('summary')} label="Description" error={fieldError('summary')}>
          <input {...aria('summary')} className={inputClass} value={summary} onChange={(e) => { setSummary(e.target.value); }} maxLength={300} />
        </Field>

        <div className="md:col-span-2">
          <Field
            id={id('syntax')}
            label="Command"
            hint="Saved exactly as typed. Use <Name> for values to fill in later. Chaining, pipes and scripts are allowed and are labeled as multi-step."
            error={fieldError('syntax')}
          >
            <textarea
              {...aria('syntax')}
              className={`${inputClass} min-h-24 font-mono`}
              value={syntax}
              onChange={(e) => { setSyntax(e.target.value); }}
              spellCheck={false}
            />
          </Field>
        </div>

        {placeholders.length > 0 ? (
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="text-sm font-medium">Describe the values to fill in</legend>
            {placeholders.map((p) => (
              <div key={p} className="flex items-center gap-2">
                <code className="w-32 shrink-0 truncate font-mono text-sm">{`<${p}>`}</code>
                <input
                  aria-label={`Description of ${p}`}
                  className={inputClass}
                  value={placeholderText[p] ?? ''}
                  onChange={(e) => { setPlaceholderText((t) => ({ ...t, [p]: e.target.value })); }}
                />
              </div>
            ))}
            {fieldError('placeholders') ? <p className="text-xs text-danger">{fieldError('placeholders')}</p> : null}
          </fieldset>
        ) : null}

        <Field id={id('keywords')} label="Search keywords" hint="Comma-separated." error={fieldError('keywords')}>
          <input {...aria('keywords')} className={inputClass} value={keywords} onChange={(e) => { setKeywords(e.target.value); }} />
        </Field>

        <Field id={id('aliases')} label="Aliases" hint="Short names to find it fast, comma-separated." error={fieldError('aliases')}>
          <input {...aria('aliases')} className={inputClass} value={aliases} onChange={(e) => { setAliases(e.target.value); }} />
        </Field>

        <Field id={id('risk')} label="How risky is it?" hint="Your own description. CommandDeck won’t treat a custom command as safe just because of this label." error={fieldError('risk')}>
          <select {...aria('risk')} className={inputClass} value={risk} onChange={(e) => { setRisk(e.target.value as RiskLevel); }}>
            {(['L1', 'L2', 'L3'] as const).map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
          </select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Behavior</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={modifies || risk !== 'L1'} disabled={risk !== 'L1'} onChange={(e) => { setModifies(e.target.checked); }} />
            Changes the system
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresAdmin} onChange={(e) => { setRequiresAdmin(e.target.checked); }} />
            Needs administrator rights
          </label>
        </fieldset>

        <div className="md:col-span-2">
          <Field id={id('notes')} label="Notes (optional)" error={fieldError('notes')}>
            <textarea {...aria('notes')} className={`${inputClass} min-h-16`} value={notes} onChange={(e) => { setNotes(e.target.value); }} maxLength={1000} />
          </Field>
        </div>

        {error && (error.fields.length === 0 || (unmatched && unmatched.length > 0)) ? (
          <div role="alert" className="rounded-md bg-risk3-bg px-3 py-2 text-sm text-risk3-fg md:col-span-2">
            {error.fields.length === 0 ? error.message : unmatched?.map((f) => `${f.field}: ${f.message}`).join(' · ')}
          </div>
        ) : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
