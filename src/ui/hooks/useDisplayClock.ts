import { useEffect, useState } from 'react';

/**
 * Re-renders about 4 times a second while `active`, for display only. No timing
 * depends on this; values are always computed from timestamps. Uses
 * requestAnimationFrame, so it stops in the background and catches up
 * as soon as the page is visible again.
 */
export function useDisplayClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    const loop = () => {
      const t = Date.now();
      if (Math.floor(t / 250) !== last) {
        last = Math.floor(t / 250);
        setNow(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);
  return now;
}
