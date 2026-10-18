import type { ReactNode } from 'react';

interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly aside?: ReactNode;
}

/** Page title; receives focus on navigation so screen readers announce the new page. */
export function PageHeader({ title, description, aside }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight focus-visible:outline-none">
          {title}
        </h1>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}
