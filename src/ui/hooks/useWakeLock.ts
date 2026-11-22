import { useEffect, useState } from 'react';

export type WakeLockStatus = 'off' | 'active' | 'unsupported' | 'failed';

/**
 * Keeps the screen awake while `enabled`. The lock is released by the OS
 * whenever the page is hidden, so it is re-acquired on visibilitychange and,
 * as a fallback, on the next tap (some iOS versions need a user gesture).
 */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('off');
  useEffect(() => {
    if (!enabled) return;
    if (!('wakeLock' in navigator)) {
      setStatus('unsupported');
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) { void sentinel.release(); return; }
        setStatus('active');
        sentinel.addEventListener('release', () => {
          if (!cancelled) setStatus(document.visibilityState === 'visible' ? 'failed' : 'off');
        });
      } catch {
        if (!cancelled) setStatus('failed');
      }
    };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('pointerdown', onVis, true);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('pointerdown', onVis, true);
      void sentinel?.release();
      setStatus('off');
    };
  }, [enabled]);
  return status;
}
