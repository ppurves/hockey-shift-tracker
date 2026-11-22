import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, GameEngine, deriveShifts, generateDemoGame, timelineSvg, type UnitDef } from '.';

const demo = generateDemoGame({ id: 'd', startWall: Date.UTC(2026, 10, 21, 19) });
const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;

describe('timelineSvg', () => {
  it('draws one bar per shift in the selected period', () => {
    for (const period of [1, 2, 3] as const) {
      const { svg } = timelineSvg({ units: DEFAULT_UNITS, events: demo.events, period, periodLengthMs: 900_000 });
      expect(count(svg, /class="shift"/g)).toBe(deriveShifts(demo.events).filter((s) => s.period === period).length);
    }
    const all = timelineSvg({ units: DEFAULT_UNITS, events: demo.events, period: 'all', periodLengthMs: 900_000 }).svg;
    expect(count(all, /class="shift"/g)).toBe(deriveShifts(demo.events).length);
  });

  it('bar width is proportional to shift length', () => {
    let wall = 0;
    const g = new GameEngine(DEFAULT_UNITS, () => wall);
    g.dispatch({ type: 'startPeriod', period: 1 });
    g.dispatch({ type: 'resume' });
    g.dispatch({ type: 'tapUnit', unitId: 'L1' });
    wall += 90_000;
    g.dispatch({ type: 'tapUnit', unitId: 'L1' });
    wall += 30_000;
    g.dispatch({ type: 'tapUnit', unitId: 'L1' });
    wall += 45_000;
    g.dispatch({ type: 'endPeriod' });
    const { svg, width } = timelineSvg({ units: DEFAULT_UNITS, events: g.events, period: 1, periodLengthMs: 900_000, width: 1000 });
    const widths = [...svg.matchAll(/class="shift"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    const plotW = width - 96 - 14;
    expect(widths[0]).toBeCloseTo((90 / 900) * plotW, 0);
    expect(widths[1]).toBeCloseTo((45 / 900) * plotW, 0);
  });

  it('marks goals in the top lane and on each on-ice unit, with distinct shapes', () => {
    const { svg } = timelineSvg({ units: DEFAULT_UNITS, events: demo.events, period: 'all', periodLengthMs: 900_000 });
    const goals = demo.events.filter((e) => e.type === 'goalFor' || e.type === 'goalAgainst');
    expect(count(svg, /class="goal (goalFor|goalAgainst)"/g)).toBe(goals.length);
    const onIce = goals.reduce((a, e) => a + ('onIce' in e ? e.onIce.length : 0), 0);
    expect(count(svg, /class="goal-on-ice/g)).toBe(onIce);
    expect(count(svg, /class="penalty /g)).toBe(demo.events.filter((e) => e.type.startsWith('penalty')).length);
    expect(svg).toContain('#0072b2');
    expect(svg).toContain('#d55e00');
  });

  it('escapes unit names and works with no events', () => {
    const units: UnitDef[] = [{ id: 'X', name: '<Smith & "Jones">', group: 'F' }];
    const { svg } = timelineSvg({ units, events: [], period: 'all', periodLengthMs: 900_000 });
    expect(svg).toContain('&lt;Smith &amp; &quot;Jo…');
    expect(svg).not.toContain('<Smith');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});
