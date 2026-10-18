import { Check, ChevronDown, Copy, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';

interface SyntaxPreviewProps {
  /** Canonical command text. Rendered and copied verbatim. */
  readonly syntax: string;
  /** Accessible name of the command, used in button labels. */
  readonly label: string;
  /** `preview`: one line with expand chevron. `full`: always the full text, no chevron (details panel). */
  readonly variant?: 'preview' | 'full';
  /** Called after a successful copy (e.g. to record recent use). */
  readonly onCopied?: () => void;
}

/** Tokens up to this length never break internally; longer ones may break anywhere. */
const UNBREAKABLE_MAX = 32;

/**
 * Renders syntax so lines wrap only at whitespace where possible. Browsers
 * otherwise break after hyphens, turning `-Recurse -File` into "-Recurse -" /
 * "File", which misreads as different parameters. The text content stays
 * byte-identical to `syntax`: only element boundaries are added.
 */
function WrappedSyntax({ syntax }: { syntax: string }) {
  return syntax.split(/(\s+)/).map((piece, i) =>
    piece.length > 0 && piece.length <= UNBREAKABLE_MAX && !/\s/.test(piece) ? (
      <span key={i} className="whitespace-nowrap">{piece}</span>
    ) : (
      piece
    ),
  );
}

const iconButton =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg';

/**
 * One-line preview of a command with an expand chevron and copy action.
 *
 * Truncation is purely visual (CSS ellipsis on the full text), so the DOM,
 * the copied value and later the executed value are always the full syntax.
 */
export function SyntaxPreview({ syntax, label, variant = 'preview', onCopied }: SyntaxPreviewProps) {
  const full = variant === 'full';
  const [toggled, setExpanded] = useState(false);
  const expanded = full || toggled;
  const [overflowing, setOverflowing] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const contentId = useId();
  const { status, copy } = useCopy();
  const multiLine = syntax.includes('\n');

  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const measure = () => { setOverflowing(el.scrollWidth > el.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [syntax, expanded]);

  const canExpand = !full && (toggled || multiLine || overflowing);

  return (
    // `relative` anchors the sr-only live region here; otherwise it is positioned against the
    // document and stretches it, letting focus/scrolling shift the whole app.
    <div className="relative flex min-w-0 items-start gap-1">
      <div id={contentId} className="min-w-0 flex-1 rounded-md bg-code-bg px-2 py-1 text-code-fg">
        {expanded ? (
          <pre className="m-0 font-mono text-[13px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            <WrappedSyntax syntax={syntax} />
          </pre>
        ) : (
          <code ref={previewRef} className="block truncate font-mono text-[13px] leading-5" title={multiLine ? undefined : syntax}>
            {syntax}
          </code>
        )}
      </div>
      {canExpand ? (
        <button
          type="button"
          className={iconButton}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? `Collapse syntax for ${label}` : `Expand syntax for ${label}`}
          title={expanded ? 'Collapse' : 'Show full command'}
          onClick={() => { setExpanded((v) => !v); }}
        >
          <ChevronDown aria-hidden size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      ) : null}
      <button
        type="button"
        className={iconButton}
        aria-label={`Copy command for ${label}`}
        title="Copy command"
        onClick={() => { copy(syntax, onCopied); }}
      >
        {status === 'copied' ? <Check aria-hidden size={15} /> : status === 'failed' ? <X aria-hidden size={15} className="text-danger" /> : <Copy aria-hidden size={15} />}
      </button>
      <span aria-live="polite" className="sr-only">
        {status === 'copied' ? 'Copied to clipboard' : status === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  );
}
