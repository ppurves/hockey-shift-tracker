import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNITS as U,
  GameEngine,
  addMarker,
  addShift,
  computeStats,
  deleteMarker,
  deleteShift,
  deriveShifts,
  editShift,
  generateDemoGame,
  parseClock,
  replay,
  type EditResult,
  type GameEvent,
} from '.';

const ok = (r: EditResult): GameEvent[] => {
  if (!r.ok) throw new Error(r.reason);
  return r.events;
};
const stat = (events: GameEvent[], id: string) => computeStats(U, events).find((s) => s.unitId === id)!;

/** P1: L1 0:00–0:40, L2 0:40–1:30, D1 0:00–1:30; goal for at 1:00; period ends 1:30. */
function smallGame() {
  let wall = 0;
  const g = new GameEngine(U, () => wall);
  const run = (...c: Parameters<GameEngine['dispatch']>[0][]) => c.forEach((x) => { const r = g.dispatch(x); if (!r.ok) throw new Error(r.reason); });
  run({ type: 'startPeriod', period: 1 }, { type: 'resume' }, { type: 'tapUnit', unitId: 'L1' }, { type: 'tapUnit', unitId: 'D1' });
  wall += 40_000;
  run({ type: 'tapUnit', unitId: 'L2' });
  wall += 20_000;
  run({ type: 'goalFor' }, { type: 'resume' });
  wall += 30_000;
  run({ type: 'endPeriod' });
  return [...g.events];
}

describe('parseClock', () => {
  it('parses m:ss and seconds, rejects junk', () => {
    expect(parseClock('3:05')).toBe(185_000);
    expect(parseClock(' 12:00 ')).toBe(720_000);
    expect(parseClock('45')).toBe(45_000);
    for (const bad of ['3:5', '3:75', 'abc', '', '-1', '1:2:3']) expect(parseClock(bad)).toBeNull();
  });
});

describe('post-game edits', () => {
  it('edit a shift: times change, log stays sorted and renumbered, goal credit follows the shifts', () => {
    const ev = smallGame();
    expect(stat(ev, 'L2').gf).toBe(1);
    const l1 = deriveShifts(ev).find((s) => s.unitId === 'L1')!;
    // L2 now starts at 1:10, L1 stays on until then → the 1:00 goal moves to L1.
    const l2 = deriveShifts(ev).find((s) => s.unitId === 'L2')!;
    const step1 = ok(editShift(U, ev, l2, 70_000, 90_000));
    const step2 = ok(editShift(U, step1, l1, 0, 70_000));
    expect(deriveShifts(step2).filter((s) => s.unitId.startsWith('L')).map((s) => [s.unitId, s.startMs, s.endMs])).toEqual(
      expect.arrayContaining([['L1', 0, 70_000], ['L2', 70_000, 90_000]]),
    );
    expect(step2.map((e) => e.seq)).toEqual(step2.map((_, i) => i));
    expect(stat(step2, 'L1')).toMatchObject({ gf: 1, toiMs: 70_000 });
    expect(stat(step2, 'L2')).toMatchObject({ gf: 0, toiMs: 20_000 });
    expect(replay(step2).score).toEqual({ for: 1, against: 0 });
  });

  it('rejects overlaps within an exclusion set, bad bounds and end <= start', () => {
    const ev = smallGame();
    const l1 = deriveShifts(ev).find((s) => s.unitId === 'L1')!;
    expect(editShift(U, ev, l1, 0, 50_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/Overlaps Line 2/) });
    expect(editShift(U, ev, l1, 30_000, 20_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/after the start/) });
    expect(editShift(U, ev, l1, 0, 200_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/within 0:00 and 1:30/) });
    expect(addShift(U, ev, 'D2', 1, 10_000, 20_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/Overlaps D 1/) });
    expect(addShift(U, ev, 'L3', 2, 0, 10_000)).toMatchObject({ ok: false, reason: expect.stringMatching(/not played/) });
    // PP and PK share a set; F and PP don't.
    const withPp = ok(addShift(U, ev, 'PP1', 1, 10_000, 30_000));
    expect(addShift(U, withPp, 'PK1', 1, 20_000, 40_000)).toMatchObject({ ok: false });
    expect(stat(withPp, 'PP1').toiMs).toBe(20_000);
  });

  it('back-to-back shifts of one unit are allowed and stay separate', () => {
    const ev = smallGame();
    const l1 = deriveShifts(ev).find((s) => s.unitId === 'L1')!;
    const shorter = ok(editShift(U, ev, l1, 0, 20_000));
    const both = ok(addShift(U, shorter, 'L1', 1, 20_000, 40_000));
    expect(stat(both, 'L1')).toMatchObject({ shifts: 2, toiMs: 40_000 });
  });

  it('delete a shift and add a missed one; adding a goal credits the units on ice', () => {
    const ev = smallGame();
    const l1 = deriveShifts(ev).find((s) => s.unitId === 'L1')!;
    const noL1 = ok(deleteShift(U, ev, l1));
    expect(stat(noL1, 'L1').shifts).toBe(0);
    const l3 = ok(addShift(U, noL1, 'L3', 1, 0, 40_000));
    const g = ok(addMarker(U, l3, 'goalAgainst', 1, 30_000));
    expect(stat(g, 'L3')).toMatchObject({ ga: 1 });
    expect(stat(g, 'D1')).toMatchObject({ gf: 1, ga: 1, plusMinus: 0 });
    expect(replay(g).score).toEqual({ for: 1, against: 1 });
  });

  it('delete a mistaken goal or penalty, but never clock events', () => {
    const ev = smallGame();
    const goal = ev.find((e) => e.type === 'goalFor')!;
    const after = ok(deleteMarker(U, ev, goal.seq));
    expect(replay(after).score.for).toBe(0);
    expect(stat(after, 'L2').gf).toBe(0);
    const pause = ev.find((e) => e.type === 'pause')!;
    expect(deleteMarker(U, ev, pause.seq)).toMatchObject({ ok: false });
  });

  it('an unedited demo log is unchanged by a no-op rebuild (snapshots match live)', () => {
    const demo = generateDemoGame({ id: 'd', startWall: Date.UTC(2026, 10, 21, 19) });
    const pen = demo.events.find((e) => e.type === 'penaltyFor')!;
    const withExtra = ok(addMarker(U, demo.events, 'penaltyFor', pen.period, pen.gameMs));
    const back = ok(deleteMarker(U, withExtra, withExtra.find((e) => e.wallTs === 0)!.seq));
    expect(back.map(({ txn: _t, ...e }) => e)).toEqual(demo.events.map(({ txn: _t, ...e }) => e));
  });
});
