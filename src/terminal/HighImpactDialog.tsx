import { TriangleAlert } from 'lucide-react';
import { Modal, buttonStyles } from '../components/ui/Modal';
import type { Finding } from '../ipc/types';

interface HighImpactDialogProps {
  readonly text: string;
  readonly findings: readonly Finding[];
  /** Sends the original text, unchanged. */
  readonly onRunAnyway: () => void;
  /** Closes and puts the cursor back in the command bar. */
  readonly onEdit: () => void;
  /** Closes and clears the command bar. */
  readonly onCancel: () => void;
}

/** The single confirmation for a reliably identified high-impact line (SECURITY.md §6.2). */
export function HighImpactDialog({ text, findings, onRunAnyway, onEdit, onCancel }: HighImpactDialogProps) {
  return (
    <Modal
      title="Check before running"
      onClose={onEdit}
      width="md"
      footer={
        <>
          <button type="button" className={buttonStyles.secondary} onClick={onCancel}>Cancel</button>
          <button type="button" className={buttonStyles.secondary} onClick={onEdit}>Edit</button>
          <button type="button" className={buttonStyles.danger} onClick={onRunAnyway}>Run anyway</button>
        </>
      }
    >
      <ul className="space-y-3 text-sm">
        {findings.map((f) => (
          <li key={`${f.operation}|${f.target}`} className="flex gap-2">
            <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
            <div>
              <p className="font-medium">{f.operation}: <span className="break-all">{f.target}</span></p>
              <p className="text-muted">{f.consequence}</p>
            </div>
          </li>
        ))}
      </ul>
      <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-code-bg p-2 font-mono text-xs text-code-fg">{text}</pre>
      <p className="mt-2 text-xs text-muted">Run anyway sends exactly this text. CommandDeck never changes it.</p>
    </Modal>
  );
}
