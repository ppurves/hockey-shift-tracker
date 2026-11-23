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
  const all = deriveShifts(events, opts.liveGameMs);
  const shifts = all.filter((s) => opts.period === undefined || s.period === opts.period);
  // Game-clock offset of each period, so rest can span a period break.
  const lengths = periodLengths(events);
  const started = [...new Set(events.filter((e) => e.type === 'periodStart').map((e) => e.period))].sort((a, b) => a - b);
  const offset: Record<number, number> = {};
  let acc = 0;
  for (const p of started) { offset[p] = acc; acc += lengths[p] ?? 0; }
  const abs = (period: number, ms: number) => (offset[period] ?? 0) + ms;
  const goals = events.filter(
    (e): e is Extract<GameEvent, { type: 'goalFor' | 'goalAgainst' }> =>
      (e.type === 'goalFor' || e.type === 'goalAgainst') && (opts.period === undefined || e.period === opts.period),
  );
  return units.map((u) => {
    const lens = shifts.filter((s) => s.unitId === u.id).map(shiftMs);
    const toiMs = lens.reduce((a, b) => a + b, 0);
    const gf = goals.filter((g) => g.type === 'goalFor' && g.onIce.includes(u.id)).length;
    const ga = goals.filter((g) => g.type === 'goalAgainst' && g.onIce.includes(u.id)).length;
    // Rests: gaps between consecutive shifts, counted in the period the next shift starts in.
    const mine = all
      .filter((s) => s.unitId === u.id)
      .sort((a, b) => abs(a.period, a.startMs) - abs(b.period, b.startMs));
    const rests: number[] = [];
    for (let i = 1; i < mine.length; i++) {
      if (opts.period !== undefined && mine[i].period !== opts.period) continue;
      rests.push(Math.max(0, abs(mine[i].period, mine[i].startMs) - abs(mine[i - 1].period, mine[i - 1].endMs)));
    }
    return {
      unitId: u.id,
      shifts: lens.length,
      toiMs,
      avgMs: lens.length ? Math.round(toiMs / lens.length) : null,
      longestMs: lens.length ? Math.max(...lens) : null,
      shortestMs: lens.length ? Math.min(...lens) : null,
      avgRestMs: rests.length ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null,
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

export interface ToiCheckRow {
  period: number;
  /** Game-clock length of the period (live time for the period in progress). */
  clockMs: number;
  /** Sum of TOI per exclusion set: F, D and special teams (PP + PK). */
  sums: { F: number; D: number; ST: number };
}

/**
 * Sanity check per period: forward TOI and D TOI should each equal the game
 * clock when a line/pair was always on the ice (they can't exceed it).
 * Special teams only play part of the period.
 */
export function toiCheck(units: readonly UnitDef[], events: readonly GameEvent[], liveGameMs?: number): ToiCheckRow[] {
  const lengths = periodLengths(events);
  const started = [...new Set(events.filter((e) => e.type === 'periodStart').map((e) => e.period))].sort((a, b) => a - b);
  const shifts = deriveShifts(events, liveGameMs);
  const setOf = (id: string) => {
    const g = units.find((u) => u.id === id)?.group;
    return g === 'PP' || g === 'PK' ? 'ST' : g;
  };
  return started.map((period) => {
    const sums = { F: 0, D: 0, ST: 0 };
    for (const s of shifts) {
      if (s.period !== period) continue;
      const k = setOf(s.unitId);
      if (k) sums[k] += shiftMs(s);
    }
    return { period, clockMs: lengths[period] ?? liveGameMs ?? 0, sums };
  });
}
