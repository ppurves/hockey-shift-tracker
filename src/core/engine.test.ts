import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UNITS,
  GameEngine,
  computeStats,
  deriveShifts,
  formatClock,
  formatMaybe,
  periodLengths,
  type Command,
  type GameEvent,
  type UnitStats,
} from '.';

const SEC = 1000;
const MIN = 60 * SEC;

// Fake wall clock. Starts at an arbitrary real-looking epoch.
let wall: number;
const now = () => wall;
const advance = (ms: number) => { wall += ms; };

function newGame(events: GameEvent[] = []) {
  return new GameEngine(DEFAULT_UNITS, now, events);
}
function run(g: GameEngine, ...cmds: Command[]) {
  for (const c of cmds) {
    const r = g.dispatch(c);
    if (!r.ok) throw new Error(`${c.type} failed: ${r.reason}`);
  }
}
const tap = (unitId: string): Command => ({ type: 'tapUnit', unitId });
/** Starts period 1 and resumes the clock at game time 0:00. */
function startedGame() {
  const g = newGame();
  run(g, { type: 'startPeriod', period: 1 }, { type: 'resume' });
  return g;
}
const statFor = (stats: UnitStats[], id: string) => stats.find((s) => s.unitId === id)!;
const live = (g: GameEngine, period?: number) =>
  computeStats(DEFAULT_UNITS, g.events, { liveGameMs: g.gameMs(), period });

beforeEach(() => { wall = 1_763_700_000_000; });

describe('format', () => {
  it('formats m:ss and clamps negatives', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_999)).toBe('1:05');
    expect(formatClock(15 * MIN)).toBe('15:00');
    expect(formatClock(-5)).toBe('0:00');
  });
  it('renders null as an em dash', () => {
    expect(formatMaybe(null)).toBe('—');
    expect(formatMaybe(45 * SEC)).toBe('0:45');
  });
});

describe('shifts', () => {
  it('simple shift: on at 1:00, off at 1:45 → one 0:45 shift', () => {
    const g = startedGame();
    advance(1 * MIN);
    run(g, tap('L1'));
    advance(45 * SEC);
    run(g, tap('L1'));
    const shifts = deriveShifts(g.events);
    expect(shifts).toEqual([{ unitId: 'L1', period: 1, startMs: 1 * MIN, endMs: 1 * MIN + 45 * SEC, open: false }]);
    const s = statFor(computeStats(DEFAULT_UNITS, g.events), 'L1');
    expect(s.shifts).toBe(1);
    expect(s.toiMs).toBe(45 * SEC);
    expect(formatMaybe(s.avgMs)).toBe('0:45');
    expect(g.state.lastShiftMs.L1).toBe(45 * SEC);
  });

  it('pausing mid-shift for 5 minutes real time leaves the shift unchanged, still one shift', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(30 * SEC);
    run(g, { type: 'pause' });
    advance(5 * MIN); // whistle / TV timeout
    expect(g.gameMs()).toBe(30 * SEC);
    expect(statFor(live(g), 'L1').toiMs).toBe(30 * SEC);
    run(g, { type: 'resume' });
    advance(15 * SEC);
    run(g, tap('L1'));
    const s = statFor(computeStats(DEFAULT_UNITS, g.events), 'L1');
    expect(s.shifts).toBe(1);
    expect(s.toiMs).toBe(45 * SEC);
  });

  it('line change in the same group closes the old shift and opens the new one at the same time', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'));
    advance(40 * SEC);
    const before = g.events.length;
    run(g, tap('L2'));
    const added = g.events.slice(before);
    expect(added.map((e) => e.type)).toEqual(['unitOff', 'unitOn']);
    expect(added[0].gameMs).toBe(added[1].gameMs);
    expect(added[0].txn).toBe(added[1].txn);
    expect(Object.keys(g.state.active).sort()).toEqual(['D1', 'L2']); // D pair unaffected
    const shifts = deriveShifts(g.events, g.gameMs());
    expect(shifts.find((s) => s.unitId === 'L1')).toMatchObject({ startMs: 0, endMs: 40 * SEC, open: false });
    expect(shifts.find((s) => s.unitId === 'L2')).toMatchObject({ startMs: 40 * SEC, open: true });
  });

  it('F, D and special teams run concurrently; PP and PK exclude each other', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'), tap('PP1'));
    expect(Object.keys(g.state.active).sort()).toEqual(['D1', 'L1', 'PP1']);
    run(g, tap('PK2'));
    expect(Object.keys(g.state.active).sort()).toEqual(['D1', 'L1', 'PK2']);
    run(g, tap('PP2'));
    expect(Object.keys(g.state.active).sort()).toEqual(['D1', 'L1', 'PP2']);
  });

  it('line change during pause: new shift starts at frozen time, 0:00 until resume, counts once', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(50 * SEC);
    run(g, { type: 'pause' });
    advance(2 * MIN);
    run(g, tap('L2'));
    advance(1 * MIN); // still paused
    let shifts = deriveShifts(g.events, g.gameMs());
    const l2 = shifts.find((s) => s.unitId === 'L2')!;
    expect(l2).toMatchObject({ startMs: 50 * SEC, endMs: 50 * SEC, open: true });
    expect(statFor(live(g), 'L1')).toMatchObject({ shifts: 1, toiMs: 50 * SEC });
    expect(statFor(live(g), 'L2')).toMatchObject({ shifts: 1, toiMs: 0 });
    run(g, { type: 'resume' });
    advance(20 * SEC);
    expect(statFor(live(g), 'L2')).toMatchObject({ shifts: 1, toiMs: 20 * SEC });
  });

  it('period change closes all open shifts and starts the next period paused at 0:00', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D2'), tap('PK1'));
    advance(14 * MIN + 59 * SEC);
    run(g, { type: 'startPeriod', period: 2 });
    expect(g.state).toMatchObject({ period: 2, running: false, accMs: 0, active: {} });
    expect(g.gameMs()).toBe(0);
    advance(10 * MIN); // intermission
    expect(g.gameMs()).toBe(0);
    const shifts = deriveShifts(g.events);
    expect(shifts).toHaveLength(3);
    for (const s of shifts) expect(s).toMatchObject({ period: 1, endMs: 14 * MIN + 59 * SEC, open: false });
    expect(periodLengths(g.events)).toEqual({ 1: 14 * MIN + 59 * SEC });
    // Taps are allowed while paused; the shift starts at the frozen 0:00.
    run(g, tap('L2'), { type: 'resume' });
    advance(30 * SEC);
    expect(statFor(live(g, 2), 'L2').toiMs).toBe(30 * SEC);
    expect(statFor(live(g, 1), 'L2').shifts).toBe(0);
  });

  it('explicit End Period, then next period; earlier or repeated periods are rejected', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(15 * MIN);
    run(g, { type: 'endPeriod' });
    expect(g.state).toMatchObject({ periodEnded: true, running: false, active: {} });
    expect(g.dispatch(tap('L2'))).toMatchObject({ ok: false });
    expect(g.dispatch({ type: 'resume' })).toMatchObject({ ok: false });
    expect(g.dispatch({ type: 'startPeriod', period: 1 })).toMatchObject({ ok: false });
    run(g, { type: 'startPeriod', period: 2 });
    expect(g.dispatch({ type: 'startPeriod', period: 1 })).toMatchObject({ ok: false });
  });

  it('rejects actions before any period has started', () => {
    const g = newGame();
    expect(g.dispatch(tap('L1'))).toMatchObject({ ok: false });
    expect(g.dispatch({ type: 'goalFor' })).toMatchObject({ ok: false });
    expect(g.events).toHaveLength(0);
  });
});

describe('goals and +/-', () => {
  it('credits only units on ice, with strength from PP/PK', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'));
    advance(1 * MIN);
    run(g, { type: 'goalFor' });
    run(g, tap('L2'), tap('PK1'));
    advance(1 * MIN);
    run(g, { type: 'goalAgainst' });
    run(g, tap('PK1'), tap('PP2'));
    advance(1 * MIN);
    run(g, { type: 'goalFor' });

    const goals = g.events.filter((e) => e.type === 'goalFor' || e.type === 'goalAgainst');
    expect(goals.map((e) => 'strength' in e && e.strength)).toEqual(['EV', 'PK', 'PP']);
    expect(g.state.score).toEqual({ for: 2, against: 1 });

    const st = computeStats(DEFAULT_UNITS, g.events, { liveGameMs: g.gameMs() });
    expect(statFor(st, 'L1')).toMatchObject({ gf: 1, ga: 0, plusMinus: 1 });
    expect(statFor(st, 'L2')).toMatchObject({ gf: 1, ga: 1, plusMinus: 0 });
    expect(statFor(st, 'D1')).toMatchObject({ gf: 2, ga: 1, plusMinus: 1 });
    expect(statFor(st, 'PK1')).toMatchObject({ gf: 0, ga: 1, plusMinus: -1 });
    expect(statFor(st, 'PP2')).toMatchObject({ gf: 1, ga: 0, plusMinus: 1 });
    for (const id of ['L3', 'D2', 'PP1', 'PK2']) expect(statFor(st, id)).toMatchObject({ gf: 0, ga: 0, plusMinus: 0 });
  });

  it('penalties are logged and never auto-start PP/PK units', () => {
    const g = startedGame();
    run(g, { type: 'penaltyFor' }, { type: 'penaltyAgainst' });
    expect(g.events.filter((e) => e.type.startsWith('penalty'))).toHaveLength(2);
    expect(g.state.active).toEqual({});
  });
});

describe('undo', () => {
  /** Builds a game to a known state, then returns stats at a fixed later time. */
  function snapshot(g: GameEngine) {
    return { stats: live(g), state: g.state, gameMs: g.gameMs() };
  }

  it('undo of a unitOn (including a line change) restores the exact prior stats', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(40 * SEC);
    const before = snapshot(g);
    run(g, tap('L2')); // line change: L1 off + L2 on
    expect(g.peekUndo()?.label).toBe('Line 2 on');
    const undone = g.undo();
    expect(undone.map((e) => e.type)).toEqual(['unitOff', 'unitOn']);
    expect(snapshot(g)).toEqual(before);
  });

  it('undo of a goal restores the exact prior stats and score', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'));
    advance(1 * MIN);
    const before = snapshot(g);
    run(g, { type: 'goalAgainst' });
    expect(g.peekUndo()?.label).toBe('goal against');
    g.undo();
    expect(snapshot(g)).toEqual(before);
  });

  it('undo of a pause equals never having paused', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(30 * SEC);
    const control = newGame(g.events.slice()); // same log, never paused
    run(g, { type: 'pause' });
    advance(5 * MIN);
    g.undo();
    expect(g.state.running).toBe(true);
    expect(snapshot(g)).toEqual(snapshot(control));
    expect(g.gameMs()).toBe(5 * MIN + 30 * SEC);
  });

  it('multi-level undo walks back to an empty log', () => {
    const g = startedGame();
    run(g, tap('L1'), { type: 'goalFor' });
    while (g.peekUndo()) g.undo();
    expect(g.events).toEqual([]);
    expect(g.state.period).toBeNull();
    expect(g.undo()).toEqual([]);
  });
});

describe('zero-shift units', () => {
  it('no crash, averages are null and show "—"', () => {
    const g = newGame();
    const st = computeStats(DEFAULT_UNITS, g.events);
    expect(st).toHaveLength(DEFAULT_UNITS.length);
    for (const s of st) {
      expect(s).toMatchObject({ shifts: 0, toiMs: 0, avgMs: null, longestMs: null, shortestMs: null });
      expect(formatMaybe(s.avgMs)).toBe('—');
    }
  });

  it('longest/shortest/average over several shifts', () => {
    const g = startedGame();
    for (const len of [30, 50, 40]) {
      run(g, tap('L3'));
      advance(len * SEC);
      run(g, tap('L3'));
      advance(10 * SEC);
    }
    expect(statFor(computeStats(DEFAULT_UNITS, g.events), 'L3')).toMatchObject({
      shifts: 3, toiMs: 120 * SEC, avgMs: 40 * SEC, longestMs: 50 * SEC, shortestMs: 30 * SEC,
    });
  });
});

describe('restart and background', () => {
  /** Simulates persisting to IndexedDB and relaunching: JSON round-trip + new engine. */
  const relaunch = (g: GameEngine) => newGame(JSON.parse(JSON.stringify(g.events)));

  function playSome() {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'));
    advance(45 * SEC);
    run(g, tap('L2'), { type: 'goalFor' });
    advance(20 * SEC);
    run(g, tap('PP1'), { type: 'penaltyAgainst' });
    advance(10 * SEC);
    return g;
  }

  it('restart while running: identical results, and the time away counts as game time', () => {
    const g = playSome();
    const r = relaunch(g);
    expect(r.state).toEqual(g.state);
    expect(live(r)).toEqual(live(g));
    advance(3 * MIN); // app killed for 3 minutes, clock was running
    const r2 = relaunch(g);
    expect(r2.gameMs()).toBe(75 * SEC + 3 * MIN);
    expect(statFor(live(r2), 'L2').toiMs).toBe(30 * SEC + 3 * MIN);
    expect(live(r2)).toEqual(live(g));
  });

  it('restart while paused: identical results, the time away is not counted', () => {
    const g = playSome();
    run(g, { type: 'pause' });
    const before = live(g);
    advance(10 * MIN);
    const r = relaunch(g);
    expect(r.state.running).toBe(false);
    expect(r.gameMs()).toBe(75 * SEC);
    expect(live(r)).toEqual(before);
    expect(Object.keys(r.state.active).sort()).toEqual(['D1', 'L2', 'PP1']);
  });

  it('background gap: applied while running, not while paused', () => {
    const g = startedGame();
    run(g, tap('L1'));
    advance(5 * MIN); // phone locked, clock running
    expect(g.gameMs()).toBe(5 * MIN);
    expect(statFor(live(g), 'L1').toiMs).toBe(5 * MIN);
    run(g, { type: 'pause' });
    advance(5 * MIN); // phone locked, clock paused
    expect(g.gameMs()).toBe(5 * MIN);
    expect(statFor(live(g), 'L1').toiMs).toBe(5 * MIN);
  });

  it('a device clock moved backwards never runs the game clock backwards', () => {
    const g = startedGame();
    advance(1 * MIN);
    expect(g.gameMs()).toBe(1 * MIN);
    advance(-2 * MIN);
    expect(g.gameMs()).toBe(0);
  });
});

describe('sanity: per-group TOI vs game clock', () => {
  it('forward TOI equals period length when a line was always on', () => {
    const g = startedGame();
    run(g, tap('L1'), tap('D1'));
    advance(50 * SEC);
    run(g, tap('L2'), { type: 'pause' });
    advance(1 * MIN);
    run(g, tap('D2'), { type: 'resume' });
    advance(70 * SEC);
    run(g, tap('L3'));
    advance(60 * SEC);
    run(g, { type: 'endPeriod' });
    const len = periodLengths(g.events)[1];
    const st = computeStats(DEFAULT_UNITS, g.events);
    const sum = (ids: string[]) => ids.reduce((a, id) => a + statFor(st, id).toiMs, 0);
    expect(sum(['L1', 'L2', 'L3'])).toBe(len);
    expect(sum(['D1', 'D2'])).toBe(len);
  });
});
