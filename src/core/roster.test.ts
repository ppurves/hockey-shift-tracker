import { describe, expect, it } from 'vitest';
import { generateDemoGame, DEMO_ROSTER } from './demo';
import { GameEngine } from './engine';
import { newGameMeta } from './game';
import {
  lineThreshold,
  nextPlayerId,
  playerLabel,
  playerUnits,
  reportView,
  rosterLines,
  sanitizeRoster,
  statRows,
  trackedUnits,
  withLineEvents,
} from './roster';
import { summaryCsv, shiftsCsv } from './csv';
import { addShift } from './edit';
import { computeStats, toiCheck } from './stats';
import type { Player } from './types';
import { DEFAULT_UNITS } from './units';

const P = (id: string, number: string, position: Player['position'], lineId: string | null, name = ''): Player => ({ id, number, name, position, lineId });
const roster: Player[] = [
  P('p1', '9', 'F', 'L1', 'Avery'), P('p2', '17', 'F', 'L1'), P('p3', '22', 'F', 'L1'),
  P('p4', '11', 'F', 'L2'), P('p5', '14', 'F', 'L2'), P('p6', '19', 'F', 'L2'),
  P('p7', '28', 'F', null),
  P('p8', '2', 'D', 'D1'), P('p9', '4', 'D', 'D1'),
  P('p10', '30', 'G', null),
];

function setup() {
  const meta = newGameMeta({ opponent: 'Hawks', mode: 'roster', players: roster }, 'g1', 0);
  let wall = 1_000;
  const g = new GameEngine(trackedUnits(meta), () => wall, [], rosterLines(meta));
  const run = (cmd: Parameters<GameEngine['dispatch']>[0]) => {
    const r = g.dispatch(cmd);
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  const at = (sec: number) => { wall = 1_000 + sec * 1000; };
  return { meta, g, run, at };
}

describe('roster basics', () => {
  it('labels, ids, thresholds', () => {
    expect(playerLabel({ number: '9', name: 'Avery' })).toBe('#9 Avery');
    expect(playerLabel({ number: '9', name: ' ' })).toBe('#9');
    expect(playerLabel({ number: '', name: 'Avery' })).toBe('Avery');
    expect(nextPlayerId([P('p1', '1', 'F', null), P('p3', '3', 'F', null)])).toBe('p4');
    expect([1, 2, 3, 4, 5].map(lineThreshold)).toEqual([1, 2, 2, 3, 3]);
  });

  it('drops line assignments that no longer fit', () => {
    const out = sanitizeRoster([P('a', '1', 'D', 'L1'), P('b', '2', 'F', 'L9'), P('c', '3', 'G', 'L1'), P('d', '4', 'F', 'L2')], DEFAULT_UNITS);
    expect(out.map((p) => p.lineId)).toEqual([null, null, null, 'L2']);
  });

  it('tracks players ordered by line then number, extras, then goalies', () => {
    const meta = newGameMeta({ opponent: 'x', mode: 'roster', players: roster }, 'g', 0);
    const ids = trackedUnits(meta).map((u) => u.id);
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8', 'p9', 'p7', 'p10']);
    expect(trackedUnits(meta).at(-1)).toMatchObject({ group: 'G', kind: 'player', lineId: null });
    expect(playerUnits(meta)[0]).toMatchObject({ name: '#9 Avery', group: 'F', kind: 'player', lineId: 'L1' });
  });

  it('lines mode is unchanged', () => {
    const meta = newGameMeta({ opponent: 'x' }, 'g', 0);
    expect(meta.mode).toBe('lines');
    expect(trackedUnits(meta)).toBe(meta.units);
  });
});

describe('roster engine', () => {
  it('tapLine swaps the whole group, players toggle alone, goalie untouched', () => {
    const { g, run, at } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'resume' });
    run({ type: 'tapLine', lineId: 'L1' });
    run({ type: 'tapLine', lineId: 'D1' });
    run({ type: 'tapUnit', unitId: 'p10' });
    expect(Object.keys(g.state.active).sort()).toEqual(['p1', 'p10', 'p2', 'p3', 'p8', 'p9']);
    // Single swap: extra on for #22; several players can be on at once.
    at(20);
    run({ type: 'tapUnit', unitId: 'p3' });
    run({ type: 'tapUnit', unitId: 'p7' });
    expect(g.state.active.p7).toBeDefined();
    expect(g.state.active.p1).toBeDefined();
    // Line change takes off every forward (incl. the extra) and keeps D and PK on.
    at(40);
    const r = run({ type: 'tapLine', lineId: 'L2' });
    expect(Object.keys(g.state.active).sort()).toEqual(['p10', 'p4', 'p5', 'p6', 'p8', 'p9']);
    expect(r.events.every((e) => e.txn === r.events[0].txn)).toBe(true);
    expect(g.peekUndo()?.label).toBe('Line 2 on');
    // Tapping a line that is fully on takes it off.
    run({ type: 'tapLine', lineId: 'L2' });
    expect(g.state.active.p4).toBeUndefined();
    expect(g.peekUndo()?.label).toBe('Line 2 off');
    expect(g.dispatch({ type: 'tapLine', lineId: 'L3' })).toEqual({ ok: false, reason: 'No players on this line' });
  });

  it('goals snapshot players; line rows get the goal while the line is on', () => {
    const { g, run, at, meta } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'resume' });
    run({ type: 'tapLine', lineId: 'L1' });
    run({ type: 'tapLine', lineId: 'D1' });
    at(30);
    run({ type: 'tapUnit', unitId: 'p3' }); // L1 still on with 2 of 3
    run({ type: 'goalFor' });
    run({ type: 'resume' });
    const goal = g.events.find((e) => e.type === 'goalFor')!;
    expect('onIce' in goal && goal.onIce).toEqual(['p1', 'p2', 'p8', 'p9']);
    const rows = statRows(meta, g.events);
    const row = (id: string) => rows.find((r) => r.unit.id === id)!;
    expect(row('L1')).toMatchObject({ kind: 'line', stats: { gf: 1 } });
    expect(row('D1').stats.gf).toBe(1);
    expect(row('p3').stats.gf).toBe(0);
    expect(row('p1')).toMatchObject({ kind: 'player', stats: { gf: 1, plusMinus: 1 } });
    expect(row('p10')).toMatchObject({ kind: 'player', stats: { gf: 0 } }); // goalie not in net
  });

  it('line TOI = time with a majority of its players on', () => {
    const { g, run, at, meta } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'resume' });
    run({ type: 'tapLine', lineId: 'L1' }); // 0:00 L1 on
    at(20);
    run({ type: 'tapUnit', unitId: 'p1' }); // 2 of 3: still on
    at(30);
    run({ type: 'tapUnit', unitId: 'p2' }); // 1 of 3: off at 0:30
    at(40);
    run({ type: 'tapUnit', unitId: 'p2' }); // back to 2 of 3: on at 0:40
    at(60);
    run({ type: 'tapLine', lineId: 'L2' }); // off at 1:00
    run({ type: 'endPeriod' });
    const rows = statRows(meta, g.events);
    const l1 = rows.find((r) => r.unit.id === 'L1')!.stats;
    expect(l1).toMatchObject({ shifts: 2, toiMs: 50_000, longestMs: 30_000, shortestMs: 20_000 });
    const l2 = rows.find((r) => r.unit.id === 'L2')!.stats;
    expect(l2.toiMs).toBe(0); // on at 1:00, period ended at 1:00
    expect(rows.find((r) => r.unit.id === 'p3')!.stats.toiMs).toBe(60_000);
  });

  it('a line that goes off and on at the same paused moment keeps one shift', () => {
    const { g, run, at, meta } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'resume' });
    run({ type: 'tapLine', lineId: 'L1' });
    at(20);
    run({ type: 'pause' });
    run({ type: 'tapUnit', unitId: 'p1' });
    run({ type: 'tapUnit', unitId: 'p2' }); // 1 of 3: off
    run({ type: 'tapUnit', unitId: 'p2' }); // 2 of 3 again at the same game time
    run({ type: 'resume' });
    at(50);
    run({ type: 'endPeriod' });
    const l1 = statRows(meta, g.events).find((r) => r.unit.id === 'L1')!.stats;
    expect(l1).toMatchObject({ shifts: 1, toiMs: 50_000 });
  });

  it('withLineEvents leaves the log alone with no lines', () => {
    const { g, run } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'tapLine', lineId: 'L1' });
    expect(withLineEvents([], [], g.events)).toEqual(g.events);
  });

  it('post-game edits: players can overlap each other but not themselves', () => {
    const { g, run, at, meta } = setup();
    run({ type: 'startPeriod', period: 1 });
    run({ type: 'resume' });
    run({ type: 'tapLine', lineId: 'L1' });
    at(60);
    run({ type: 'endPeriod' });
    const units = trackedUnits(meta);
    expect(addShift(units, g.events, 'p4', 1, 10_000, 20_000).ok).toBe(true);
    expect(addShift(units, g.events, 'p1', 1, 10_000, 20_000)).toMatchObject({ ok: false });
  });
});

describe('roster reports', () => {
  const demo = generateDemoGame({ id: 'd', startWall: Date.UTC(2026, 10, 21, 19), players: DEMO_ROSTER });

  it('demo is valid: ~3 forwards on the ice (fewer while one is in the box), 2 D', () => {
    for (const c of toiCheck(trackedUnits(demo.meta), demo.events)) {
      expect(c.sums.F).toBeLessThanOrEqual(3 * c.clockMs);
      expect(c.sums.F).toBeGreaterThan(2.85 * c.clockMs);
      expect(c.sums.D).toBe(2 * c.clockMs);
    }
  });

  it('demo has no zero-length player shifts', () => {
    for (const r of statRows(demo.meta, demo.events)) {
      if (r.kind !== 'unit' && r.stats.shifts) expect(r.stats.shortestMs, r.unit.name).toBeGreaterThan(0);
    }
  });

  it('report rows: each line then its players, extras, PP/PK', () => {
    const ids = reportView(demo.meta, demo.events).units.map((u) => u.id);
    expect(ids).toEqual(['L1', 'p1', 'p2', 'p3', 'L2', 'p4', 'p5', 'p6', 'L3', 'p7', 'p8', 'p9', 'D1', 'p11', 'p12', 'D2', 'p13', 'p14', 'p10', 'p15', 'p16', 'p17']);
  });

  it('line rows: TOI ≤ clock per period and the extra played', () => {
    const view = reportView(demo.meta, demo.events);
    const lines = view.units.filter((u) => u.kind !== 'player' && u.group === 'F');
    const total = toiCheck(trackedUnits(demo.meta), demo.events).reduce((a, c) => a + c.clockMs, 0);
    const lineToi = computeStats(lines, view.events).reduce((a, s) => a + s.toiMs, 0);
    expect(lineToi).toBeLessThanOrEqual(total);
    expect(lineToi).toBeGreaterThan(total * 0.9);
    expect(statRows(demo.meta, demo.events).find((r) => r.unit.id === 'p10')!.stats.shifts).toBeGreaterThan(0);
  });

  it('CSV has type, number and line columns', () => {
    const csv = summaryCsv(demo.meta, demo.events).split('\r\n');
    expect(csv[0]).toContain('Scope,Type,Unit,Number,Line,Group,Shifts');
    expect(csv[1]).toMatch(/^Game,Line,Line 1,,,F,/);
    expect(csv[2]).toMatch(/^Game,Player,#9 Avery,9,Line 1,F,/);
    expect(csv.some((l) => l.startsWith('Game,Player,#28 Jones,28,Extra,F,'))).toBe(true);
    const shifts = shiftsCsv(demo.meta, demo.events).split('\r\n');
    expect(shifts[0]).toContain('Unit,Number,Line,Group,Period');
  });
});

describe('roster backup', () => {
  it('round-trips a roster game and rejects a broken roster', async () => {
    const { makeBackup, parseBackup } = await import('./backup');
    const { DEFAULT_SETTINGS } = await import('./settings');
    const demo = generateDemoGame({ id: 'd', startWall: 0, players: DEMO_ROSTER });
    const b = makeBackup([demo], { ...DEFAULT_SETTINGS, defaultMode: 'roster', defaultRoster: DEMO_ROSTER }, 0);
    const back = parseBackup(JSON.stringify(b));
    expect(back.games[0].meta.players).toEqual(demo.meta.players);
    expect(back.settings.defaultMode).toBe('roster');
    expect(back.settings.defaultRoster).toHaveLength(DEMO_ROSTER.length);
    const broken = JSON.parse(JSON.stringify(b));
    broken.games[0].meta.players[0].position = 'X';
    expect(() => parseBackup(JSON.stringify(broken))).toThrow('Game 1: invalid roster.');
  });
});
