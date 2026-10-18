import { useCallback } from 'react';
import { useAppContext } from '../app/context';
import { api } from '../ipc/api';
import type { CommandView } from '../ipc/types';

/** Shared mutations on a command. Errors become toasts; success refreshes data. */
export function useCommandActions() {
  const { invalidate, notify } = useAppContext();

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      try {
        await action();
        invalidate();
        if (success) notify(success);
        return true;
      } catch (error: unknown) {
        notify(error instanceof Error ? error.message : String(error), 'error');
        return false;
      }
    },
    [invalidate, notify],
  );

  return {
    toggleFavorite: (c: CommandView) =>
      run(() => api.setFavorite(c.id, !c.favorite), c.favorite ? 'Removed from favorites' : 'Added to favorites'),
    addToHome: (c: CommandView) => run(() => api.homeAdd(c.id), `"${c.name}" added to Home`),
    removeFromHome: (c: CommandView) => run(() => api.homeRemove(c.id), `"${c.name}" removed from Home`),
    moveOnHome: (c: CommandView, toIndex: number) => run(() => api.homeMove(c.id, toIndex)),
    /** Best-effort: a failure to record history must not disturb the user. */
    recordUse: (c: CommandView) => {
      api.recordRecent(c.id).then(invalidate, () => undefined);
    },
    run,
  };
}
