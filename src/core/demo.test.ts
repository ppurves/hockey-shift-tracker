import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, computeStats, deriveShifts, generateDemoGame, periodLengths, replay } from '.';

describe('demo game', () => {
  const demo = generateDemoGame({ id: 'demo', startWall: Date.UTC(2026, 10, 21, 19) });
  const st = computeStats(DEFAULT_UNITS, demo.events);
  const types = demo.events.map((e) => e.type);

  it('is deterministic', () => {
    expect(generateDemoGame({ id: 'demo', startWall: Date.UTC(2026, 10, 21, 19) }).events).toEqual(demo.events);
  });

  it('has 3 complete 15:00 periods and ends with nothing on ice', () => {
    expect(periodLengths(demo.events)).toEqual({ 1: 900_000, 2: 900_000, 3: 900_000 });
    const s = replay(demo.events);
    expect(s.periodEnded).toBe(true);
    expect(s.active).toEqual({});
    expect(deriveShifts(demo.events).every((sh) => !sh.open)).toBe(true);
  });

  it('contains shifts for every unit, pauses, goals both ways and penalties', () => {
    for (const s of st) expect(s.shifts).toBeGreaterThan(0);
    expect(types.filter((t) => t === 'pause').length).toBeGreaterThan(15);
    expect(types).toContain('goalFor');
    expect(types).toContain('goalAgainst');
    expect(types).toContain('penaltyFor');
    expect(types).toContain('penaltyAgainst');
    expect(demo.meta.score.for + demo.meta.score.against).toBeGreaterThanOrEqual(3);
    const strengths = demo.events.flatMap((e) => ('strength' in e ? [e.strength] : []));
    expect(strengths).toEqual(expect.arrayContaining(['EV', 'PP', 'PK']));
  });

  it('sanity: forward TOI and D TOI each equal the full game clock', () => {
    const sum = (g: string) => st.filter((s) => DEFAULT_UNITS.find((u) => u.id === s.unitId)!.group === g).reduce((a, s) => a + s.toiMs, 0);
    expect(sum('F')).toBe(3 * 900_000);
    expect(sum('D')).toBe(3 * 900_000);
  });
});

describe('toiCheck', () => {
  it('reports per-period sums matching the clock for the demo game', async () => {
    const { toiCheck } = await import('.');
    const demo = generateDemoGame({ id: 'demo', startWall: Date.UTC(2026, 10, 21, 19) });
    const rows = toiCheck(DEFAULT_UNITS, demo.events);
    expect(rows.map((r) => r.period)).toEqual([1, 2, 3]);
    for (const r of rows) {
      expect(r.sums.F).toBe(r.clockMs);
      expect(r.sums.D).toBe(r.clockMs);
      expect(r.sums.ST).toBeLessThanOrEqual(r.clockMs);
      expect(r.sums.ST).toBeGreaterThan(0);
    }
  });
});
