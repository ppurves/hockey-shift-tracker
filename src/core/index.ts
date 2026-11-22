// Pure domain logic lives in src/core. No React or DOM imports allowed here.
export const APP_NAME = 'Hockey Shift Tracker';

/** Formats milliseconds as m:ss (e.g. 65000 -> "1:05"). Negative values clamp to 0. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
