import { useState } from 'react';
import { CommandList } from '../components/CommandList';
import { DetailPanel } from '../components/DetailPanel';
import { PageHeader } from '../components/PageHeader';
import { SampleBadge } from '../components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StatusMessage';
import { loadSampleQuickActions, type QuickActionsLoader } from '../data/sampleSource';
import type { CommandEntry } from '../domain/command';
import { SAMPLE_QUICK_ACTION_LIMIT } from '../fixtures/sample';
import { useAsync } from '../hooks/useAsync';

interface HomePageProps {
  readonly load?: QuickActionsLoader;
  readonly limit?: number;
}

export function HomePage({ load = loadSampleQuickActions, limit = SAMPLE_QUICK_ACTION_LIMIT }: HomePageProps) {
  const { state, retry } = useAsync(load);
  const [selected, setSelected] = useState<CommandEntry | null>(null);

  const count = state.status === 'ready' ? `${state.data.length} of ${limit}` : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-5">
      <PageHeader
        title="Home"
        description="Your quick actions: the commands you use most, one click away."
        aside={
          <>
            {count ? <span className="text-sm text-muted">{count}</span> : null}
            <SampleBadge />
          </>
        }
      />

      {state.status === 'loading' ? <LoadingState label="Loading quick actions…" /> : null}

      {state.status === 'error' ? (
        <ErrorState title="Couldn't load your quick actions" message={state.error.message} onRetry={retry} />
      ) : null}

      {state.status === 'ready' && state.data.length === 0 ? (
        <EmptyState title="No quick actions yet">
          Add commands from the CMD or PowerShell library to pin them here. (Adding arrives in Phase 2.)
        </EmptyState>
      ) : null}

      {state.status === 'ready' && state.data.length > 0 ? (
        <CommandList entries={state.data} label="Quick actions" showShell onOpenDetails={setSelected} />
      ) : null}

      {selected ? <DetailPanel entry={selected} onClose={() => { setSelected(null); }} /> : null}
    </div>
  );
}
