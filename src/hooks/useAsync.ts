import { useCallback, useEffect, useMemo, useState } from 'react';

export type AsyncState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: Error }
  | { readonly status: 'ready'; readonly data: T };

const LOADING = { status: 'loading' } as const;

/**
 * Runs `load` on mount and whenever it changes. `retry` re-runs it.
 *
 * Each run is identified by a request object. A settled result is shown only
 * while it belongs to the current request, so a new request reads as
 * "loading" without a synchronous state reset, and stale results are ignored.
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
  const state = settled?.request === request ? settled.state : LOADING;
  return { state, retry };
}
