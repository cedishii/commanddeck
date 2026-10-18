import { CircleAlert, Inbox, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

function Frame({ icon, title, children, role }: { icon: ReactNode; title: string; children?: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span className="text-muted">{icon}</span>
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <Frame role="status" icon={<LoaderCircle aria-hidden className="animate-spin" size={22} />} title={label} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Frame icon={<Inbox aria-hidden size={22} />} title={title}>
      {children}
    </Frame>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <Frame role="alert" icon={<CircleAlert aria-hidden className="text-danger" size={22} />} title={title}>
      <p>{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          Try again
        </button>
      ) : null}
    </Frame>
  );
}
