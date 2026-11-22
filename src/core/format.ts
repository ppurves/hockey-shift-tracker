/** Formats milliseconds as m:ss (e.g. 65000 -> "1:05"). Negative values clamp to 0. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Like formatClock but renders null (no data, e.g. average of 0 shifts) as "—". */
export function formatMaybe(ms: number | null): string {
  return ms === null ? '—' : formatClock(ms);
}
