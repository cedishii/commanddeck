import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';

export type CopyStatus = 'idle' | 'copied' | 'failed';

const RESET_MS = 1600;

export function useCopy(): { status: CopyStatus; copy: (text: string) => void } {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => { window.clearTimeout(timer.current); }, []);

  const copy = useCallback((text: string) => {
    const settle = (next: CopyStatus) => {
      setStatus(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setStatus('idle'); }, RESET_MS);
    };
    copyText(text).then(
      () => { settle('copied'); },
      () => { settle('failed'); },
    );
  }, []);

  return { status, copy };
}
