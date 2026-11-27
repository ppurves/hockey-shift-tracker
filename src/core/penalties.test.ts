import { describe, expect, it } from 'vitest';
import { boxPenalty, conditionOf, GameEngine, type Command } from './engine';
import { deleteMarker } from './edit';
import { newGameMeta } from './game';
import { conditionSegments, conditionTotals, derivePenalties } from './penalties';
import { rosterLines, trackedUnits } from './roster';
import type { GameEvent, Player } from './types';
import { DEFAULT_UNITS } from './units';

const MIN = 60_000;
const P = (id: string, number: string, position: Player['position'], lineId: string | null): Player => ({ id, number, name: '', position, lineId });
const roster: Player[] = [
  P('p1', '9', 'F', 'L1'), P('p2', '17', 'F', 'L1'), P('p3', '22', 'F', 'L1'),
  P('p4', '11', 'F', 'L2'), P('p5', '14', 'F', 'L2'), P('p6', '19', 'F', 'L2'),
  P('p8', '2', 'D', 'D1'), P('p9', '4', 'D', 'D1'),
  P('g1', '30', 'G', null), P('g2', '31', 'G', null),
];

function game(mode: 'lines' | 'roster' = 'roster') {
  const meta = newGameMeta({ opponent: 'x', mode, players: roster }, 'g', 0);
  let wall = 0;
  const g = new GameEngine(mode === 'roster' ? trackedUnits(meta) : DEFAULT_UNITS, () => wall, [], rosterLines(meta));
  const run = (...cmds: Command[]) => {
    for (const c of cmds) {
      const r = g.dispatch(c);
      if (!r.ok) throw new Error(`${c.type}: ${r.reason}`);
    }
  };
  /** Advance the clock by `ms` of wall time. */
  const advance = (ms: number) => { wall += ms; };
  run({ type: 'startPeriod', period: 1 }, { type: 'resume' });
  return { g, run, advance, meta };
}
const last = (g: GameEngine, type: GameEvent['type']) => [...g.events].reverse().find((e) => e.type === type)!;

describe('power play / penalty kill as game conditions', () => {
  it('a penalty for starts a PP; it ends by itself at the exact expiry time', () => {
    const { g, run, advance } = game('lines');
    advance(3 * MIN);
    run({ type: 'penaltyFor', lengthMs: 2 * MIN }, { type: 'resume' });
    expect(conditionOf(g.state)).toBe('PP');
    expect(g.state.running).toBe(true);
    advance(2 * MIN + 7_000); // nothing dispatched for a while
    expect(g.settle()).toEqual([
      expect.objectContaining({ type: 'penaltyEnd', reason: 'expired', period: 1, gameMs: 5 * MIN, auto: true }),
    ]);
    expect(conditionOf(g.state)).toBe('EV');
    expect(g.settle()).toEqual([]);
  });

  it('dispatch settles first, so the expiry is logged before the tap', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(3 * MIN);
    const r = g.dispatch({ type: 'tapUnit', unitId: 'L1' });
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['penaltyEnd', 'unitOn']);
    expect(r.ok && r.events[0].gameMs).toBe(2 * MIN);
  });

  it('PP goal ends the earliest-expiring penalty; goal strength from the condition', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'tapUnit', unitId: 'L1' }, { type: 'tapUnit', unitId: 'D1' });
    run({ type: 'penaltyFor', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(30_000);
    run({ type: 'goalFor' });
    const goal = last(g, 'goalFor');
    expect('strength' in goal && goal.strength).toBe('PP');
    expect(last(g, 'penaltyEnd')).toMatchObject({ reason: 'goal', txn: goal.txn });
    expect(g.state.penalties).toEqual([]);
    // Undo the goal: the power play is back with its time left.
    g.undo();
    expect(conditionOf(g.state)).toBe('PP');
  });

  it('shorthanded goal for does not end our penalty kill; PP goal against does', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(20_000);
    run({ type: 'goalFor' }, { type: 'resume' });
    expect(conditionOf(g.state)).toBe('PK');
    expect(g.events.filter((e) => e.type === 'goalFor').map((e) => 'strength' in e && e.strength)).toEqual(['PK']);
    advance(20_000);
    run({ type: 'goalAgainst' });
    expect(conditionOf(g.state)).toBe('EV');
  });

  it('4-on-4: a goal ends nothing; with two penalties against, a goal ends only the first', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'penaltyFor', lengthMs: 2 * MIN }, { type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(10_000);
    run({ type: 'goalAgainst' }, { type: 'resume' });
    expect(g.state.penalties).toHaveLength(2);
    expect('strength' in last(g, 'goalAgainst') && last(g, 'goalAgainst')).toMatchObject({ strength: 'EV' });
    // Two of ours at different times (5-on-3 vs their 1): goal against ends the earlier.
    const { g: h, run: r2, advance: a2 } = game('lines');
    r2({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    a2(30_000);
    r2({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    const first = h.state.penalties[0].ref;
    a2(10_000);
    r2({ type: 'goalAgainst' });
    expect(h.state.penalties.map((p) => p.ref)).not.toContain(first);
    expect(conditionOf(h.state)).toBe('PK');
  });

  it('a penalty carries over into the next period', () => {
    const { g, run, advance } = game('lines');
    advance(14 * MIN);
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(MIN);
    run({ type: 'startPeriod', period: 2 });
    expect(conditionOf(g.state)).toBe('PK');
    run({ type: 'resume' });
    advance(MIN - 1);
    expect(g.settle()).toEqual([]);
    advance(1);
    expect(g.settle()).toEqual([expect.objectContaining({ period: 2, gameMs: MIN })]);
    const v = derivePenalties(g.events)[0];
    expect(v.pieces).toEqual([{ period: 1, startMs: 14 * MIN, endMs: 15 * MIN }, { period: 2, startMs: 0, endMs: MIN }]);
    expect(v.end).toEqual({ period: 2, gameMs: MIN, reason: 'expired' });
  });

  it('Undo skips automatic expiries and removes the action before them', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'penaltyFor', lengthMs: MIN }, { type: 'resume' });
    advance(30_000);
    run({ type: 'tapUnit', unitId: 'L2' });
    advance(MIN);
    g.settle();
    expect(g.peekUndo()?.label).toBe('L2 on'.replace('L2', 'Line 2'));
    g.undo();
    expect(g.state.active.L2).toBeUndefined();
    expect(g.state.penalties).toHaveLength(1); // expiry gone with it…
    expect(g.settle()).toHaveLength(1); // …and written again
  });

  it('end a penalty early and change its length', () => {
    const { g, run } = game('lines');
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN });
    const ref = g.state.penalties[0].ref;
    run({ type: 'penaltyInfo', ref, lengthMs: 5 * MIN, number: '12' });
    expect(g.state.penalties[0]).toMatchObject({ lengthMs: 5 * MIN, number: '12' });
    expect(g.peekUndo()?.label).toBe('penalty: #12');
    run({ type: 'endPenalty', ref });
    expect(g.state.penalties).toEqual([]);
    expect(g.dispatch({ type: 'endPenalty', ref })).toMatchObject({ ok: false });
  });

  it('untimed penalty (no length) is a marker only', () => {
    const { g, run } = game('lines');
    run({ type: 'penaltyAgainst' });
    expect(g.state.penalties).toEqual([]);
    expect(derivePenalties(g.events)[0]).toMatchObject({ lengthMs: null, end: null, pieces: [] });
  });
});

describe('penalized player', () => {
  it('goes off the ice, cannot be put on, is skipped by line taps, and is free after', () => {
    const { g, run, advance } = game();
    run({ type: 'tapLine', lineId: 'L1' }, { type: 'tapLine', lineId: 'D1' });
    advance(20_000);
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN, playerId: 'p2' });
    expect(g.state.active.p2).toBeUndefined();
    expect(boxPenalty(g.state, 'p2')).toBeDefined();
    expect(g.dispatch({ type: 'tapUnit', unitId: 'p2' })).toMatchObject({ ok: false, reason: '#17 is in the penalty box' });
    run({ type: 'resume' }, { type: 'tapLine', lineId: 'L2' }, { type: 'tapLine', lineId: 'L1' });
    expect(Object.keys(g.state.active).filter((id) => ['p1', 'p2', 'p3'].includes(id)).sort()).toEqual(['p1', 'p3']);
    advance(2 * MIN);
    run({ type: 'tapUnit', unitId: 'p2' }); // settles the expiry first, then p2 is free
    expect(g.state.active.p2).toBeDefined();
  });

  it('can be chosen after the call (penaltyInfo), which sends them off', () => {
    const { g, run } = game();
    run({ type: 'tapLine', lineId: 'L1' });
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN });
    const ref = g.state.penalties[0].ref;
    run({ type: 'penaltyInfo', ref, playerId: 'p1' });
    expect(g.state.active.p1).toBeUndefined();
    expect(derivePenalties(g.events)[0].playerId).toBe('p1');
    g.undo(); // back on the ice, no player in the box
    expect(g.state.active.p1).toBeDefined();
    expect(boxPenalty(g.state, 'p1')).toBeUndefined();
  });

  it('post-game delete of a penalty removes its details and end', () => {
    const { g, run, advance, meta } = game();
    run({ type: 'penaltyAgainst', lengthMs: MIN, playerId: 'p1' }, { type: 'resume' });
    advance(2 * MIN);
    run({ type: 'endPeriod' });
    const pen = g.events.find((e) => e.type === 'penaltyAgainst')!;
    const r = deleteMarker(trackedUnits(meta), g.events, pen.seq);
    expect(r.ok && r.events.some((e) => e.type.startsWith('penalty'))).toBe(false);
  });
});

describe('goalies', () => {
  it('one goalie in net at a time; the goalie returns in net at the next period start', () => {
    const { g, run, advance } = game();
    run({ type: 'tapUnit', unitId: 'g1' });
    run({ type: 'tapUnit', unitId: 'g2' });
    expect(g.state.active.g1).toBeUndefined();
    expect(g.state.active.g2).toBeDefined();
    advance(MIN);
    run({ type: 'startPeriod', period: 2 });
    expect(Object.keys(g.state.active)).toEqual(['g2']);
    // Pulled goalie at the end of P2 still comes back for P3.
    run({ type: 'resume' });
    advance(MIN);
    run({ type: 'tapUnit', unitId: 'g2' }, { type: 'endPeriod' }, { type: 'startPeriod', period: 3 });
    expect(Object.keys(g.state.active)).toEqual(['g2']);
  });

  it('goalie gets goals against while in net', () => {
    const { g, run } = game();
    run({ type: 'tapUnit', unitId: 'g1' }, { type: 'goalAgainst' });
    expect('onIce' in last(g, 'goalAgainst') && last(g, 'goalAgainst')).toMatchObject({ onIce: ['g1'] });
  });
});

describe('condition segments', () => {
  it('PP, then 4-on-4 overlap, then PK', () => {
    const { g, run, advance } = game('lines');
    run({ type: 'penaltyFor', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(MIN);
    run({ type: 'penaltyAgainst', lengthMs: 2 * MIN }, { type: 'resume' });
    advance(3 * MIN);
    run({ type: 'endPeriod' });
    const segs = conditionSegments(derivePenalties(g.events));
    expect(segs.map((s) => [s.condition, s.startMs / 1000, s.endMs / 1000])).toEqual([
      ['PP', 0, 60], ['EVEN', 60, 120], ['PK', 120, 180],
    ]);
    expect(conditionTotals(derivePenalties(g.events))).toEqual({ PP: MIN, PK: MIN, EVEN: MIN });
  });
});
