/**
 * Phase 1 data source backed by SAMPLE fixtures.
 *
 * Pages receive these loaders as props, so tests can inject empty/error cases.
 * Phase 2 replaces them with typed IPC calls in `src/ipc/`.
 */
import type { CommandEntry, Shell } from '../domain/command';
import { SAMPLE_COMMANDS, SAMPLE_QUICK_ACTION_IDS } from '../fixtures/sample';

export type QuickActionsLoader = () => Promise<readonly CommandEntry[]>;
export type LibraryLoader = (shell: Shell) => Promise<readonly CommandEntry[]>;

export const loadSampleQuickActions: QuickActionsLoader = () => {
  const byId = new Map(SAMPLE_COMMANDS.map((c) => [c.id, c]));
  const entries = SAMPLE_QUICK_ACTION_IDS.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  return Promise.resolve(entries);
};

export const loadSampleLibrary: LibraryLoader = (shell) =>
  Promise.resolve(SAMPLE_COMMANDS.filter((c) => c.shell === shell));
