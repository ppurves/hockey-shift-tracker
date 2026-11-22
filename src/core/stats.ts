// Pure derivations from the event log: shifts and per-unit stats.

import type { GameEvent, Shift, UnitDef, UnitStats } from './types';

/**
 * Rebuilds every shift from the log. Shifts still open at the end are returned
 * with `open: true` and endMs = liveGameMs (the current game time), or their
 * start time if liveGameMs isn't given. Any shift left open when a period ends
 * or a new one starts is closed there, in case a post-game edit left it open.
 */
export function deriveShifts(events: readonly GameEvent[], liveGameMs?: number): Shift[] {
  const shifts: Shift[] = [];
  const open = new Map<string, { startMs: number; period: number }>();
  const closeAll = (endMs: number) => {
    for (const [unitId, o] of open) {
      shifts.push({ unitId, period: o.period, startMs: o.startMs, endMs: Math.max(endMs, o.startMs), open: false });
    }
    open.clear();
  };
  let lastGameMs = 0;
  for (const e of events) {
    switch (e.type) {
      case 'unitOn':
        if (!open.has(e.unitId)) open.set(e.unitId, { startMs: e.gameMs, period: e.period });
        break;
      case 'unitOff': {
        const o = open.get(e.unitId);
        if (o) {
          shifts.push({ unitId: e.unitId, period: o.period, startMs: o.startMs, endMs: Math.max(e.gameMs, o.startMs), open: false });
          open.delete(e.unitId);
        }
        break;
      }
      case 'periodEnd':
        closeAll(e.gameMs);
        break;
      case 'periodStart':
        closeAll(lastGameMs);
        break;
    }
    lastGameMs = e.gameMs;
  }
  for (const [unitId, o] of open) {
    const end = liveGameMs ?? o.startMs;
    shifts.push({ unitId, period: o.period, startMs: o.startMs, endMs: Math.max(end, o.startMs), open: true });
  }
  return shifts;
}

export const shiftMs = (s: Shift): number => s.endMs - s.startMs;

/** Per-unit stats, for the whole game or one period. Never divides by zero. */
export function computeStats(
  units: readonly UnitDef[],
  events: readonly GameEvent[],
  opts: { period?: number; liveGameMs?: number } = {},
): UnitStats[] {
  const shifts = deriveShifts(events, opts.liveGameMs).filter(
    (s) => opts.period === undefined || s.period === opts.period,
  );
  const goals = events.filter(
    (e): e is Extract<GameEvent, { type: 'goalFor' | 'goalAgainst' }> =>
      (e.type === 'goalFor' || e.type === 'goalAgainst') && (opts.period === undefined || e.period === opts.period),
  );
  return units.map((u) => {
    const lens = shifts.filter((s) => s.unitId === u.id).map(shiftMs);
    const toiMs = lens.reduce((a, b) => a + b, 0);
    const gf = goals.filter((g) => g.type === 'goalFor' && g.onIce.includes(u.id)).length;
    const ga = goals.filter((g) => g.type === 'goalAgainst' && g.onIce.includes(u.id)).length;
    return {
      unitId: u.id,
      shifts: lens.length,
      toiMs,
      avgMs: lens.length ? Math.round(toiMs / lens.length) : null,
      longestMs: lens.length ? Math.max(...lens) : null,
      shortestMs: lens.length ? Math.min(...lens) : null,
      gf,
      ga,
      plusMinus: gf - ga,
    };
  });
}

/** Final game-clock length of each completed period (from its periodEnd event). */
export function periodLengths(events: readonly GameEvent[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of events) if (e.type === 'periodEnd') out[e.period] = e.gameMs;
  return out;
}
