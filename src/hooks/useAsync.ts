import { useCallback, useEffect, useMemo, useState } from 'react';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: Error }
  | { readonly status: 'ready'; readonly data: T };

const LOADING = { status: 'loading' } as const;

/**
 * Runs `load` on mount and whenever it changes. `retry` re-runs it.
 *
 * Each run is identified by a request object, so stale results are ignored
 * and no synchronous state reset is needed. A new request after an error or
 * on first load reads as "loading". After a success, the previous data stays
 * visible until the refresh settles.
 */
export function useAsync<T>(load: () => Promise<T>): { state: AsyncState<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(() => ({ load, attempt }), [load, attempt]);
  const [settled, setSettled] = useState<{ request: object; state: AsyncState<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    request.load().then(
      (data) => {
        if (!cancelled) setSettled({ request, state: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (!cancelled) {
          const err = error instanceof Error ? error : new Error(String(error));
          setSettled({ request, state: { status: 'error', error: err } });
        }
      },
    );
    return () => { cancelled = true; };
  }, [request]);

  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);
  // While a newer request is in flight, keep showing the last good data (no flash of "loading").
  const state = settled?.request === request || settled?.state.status === 'ready' ? settled.state : LOADING;
  return { state, retry };
}
