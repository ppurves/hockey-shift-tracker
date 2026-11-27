// Post-game edits. The live log is append-only; once a game is final, edits
// rewrite it through these pure functions, which keep it valid: sorted per
// period, renumbered, no overlapping shifts in an exclusion set, and every
// goal's on-ice snapshot/strength recomputed from the edited shifts.

import { reduce, INITIAL_STATE, strengthOf } from './engine';
import { formatClock } from './format';
import { deriveShifts, periodLengths } from './stats';
import type { EventBody, GameEvent, Shift, UnitDef } from './types';
import { exclusionKey } from './units';

export type EditResult = { ok: true; events: GameEvent[] } | { ok: false; reason: string };

/** Parses "m:ss", "mm:ss" or plain seconds into ms. Returns null if invalid. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  if (/^\d{1,4}$/.test(t)) return Number(t) * 1000;
  return null;
}

/** Tie placement among events at the same game time. */
type Place = 'first' | 'stable' | 'last';
interface Item { e: GameEvent; idx: number; place: Place }

const PLACE_RANK: Record<Place, number> = { first: -1, stable: 0, last: 1 };
const typeRank = (e: GameEvent) => (e.type === 'periodStart' ? -1 : e.type === 'periodEnd' ? 1 : 0);

/**
 * Sorts, renumbers and recomputes goal snapshots. Edited unitOff events go
 * first among ties and edited unitOn events last, so a shift ending at t and
 * another starting at t never overlap.
 */
function rebuild(units: readonly UnitDef[], items: Item[]): GameEvent[] {
  items.sort(
    (a, b) =>
      a.e.period - b.e.period ||
      typeRank(a.e) - typeRank(b.e) ||
      a.e.gameMs - b.e.gameMs ||
      PLACE_RANK[a.place] - PLACE_RANK[b.place] ||
      a.idx - b.idx,
  );
  let state = INITIAL_STATE;
  return items.map(({ e }, seq) => {
    let out: GameEvent = { ...e, seq };
    if (out.type === 'goalFor' || out.type === 'goalAgainst') {
      const onIce = units.filter((u) => state.active[u.id]).map((u) => u.id);
      out = { ...out, onIce, strength: strengthOf(onIce, units) };
    }
    state = reduce(state, out);
    return out;
  });
}

const itemsOf = (events: readonly GameEvent[]): Item[] => events.map((e, idx) => ({ e, idx, place: 'stable' }));
const nextTxn = (events: readonly GameEvent[]) => events.reduce((m, e) => Math.max(m, e.txn), 0) + 1;

/** Game-clock bounds of a period: [0, its final length]. */
function periodEndMs(events: readonly GameEvent[], period: number): number | null {
  if (!events.some((e) => e.type === 'periodStart' && e.period === period)) return null;
  const ended = periodLengths(events)[period];
  if (ended !== undefined) return ended;
  return Math.max(0, ...events.filter((e) => e.period === period).map((e) => e.gameMs));
}

/** Checks a proposed shift against the period bounds and other shifts. */
function validateShift(
  units: readonly UnitDef[],
  events: readonly GameEvent[],
  unitId: string,
  period: number,
  startMs: number,
  endMs: number,
  ignore?: Shift,
): string | null {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return 'Unknown unit.';
  const end = periodEndMs(events, period);
  if (end === null) return `Period ${period} was not played.`;
  if (!(endMs > startMs)) return 'The end must be after the start.';
  if (startMs < 0 || endMs > end) return `Times must be within 0:00 and ${formatClock(end)}.`;
  const set = exclusionKey(unit);
  for (const s of deriveShifts(events)) {
    if (s.period !== period) continue;
    if (ignore && s.unitId === ignore.unitId && s.startMs === ignore.startMs && s.period === ignore.period) continue;
    const other = units.find((u) => u.id === s.unitId);
    if (!other || exclusionKey(other) !== set) continue;
    if (startMs < s.endMs && s.startMs < endMs) {
      return `Overlaps ${other.name} ${formatClock(s.startMs)}–${formatClock(s.endMs)}.`;
    }
  }
  return null;
}

/** Index of the unitOn that opened `shift`, and of the unitOff that closed it (-1 if closed by periodEnd). */
function findShiftEvents(events: readonly GameEvent[], shift: Pick<Shift, 'unitId' | 'period' | 'startMs'>) {
  const on = events.findIndex(
    (e) => e.type === 'unitOn' && e.unitId === shift.unitId && e.period === shift.period && e.gameMs === shift.startMs,
  );
  if (on < 0) return null;
  const off = events.findIndex((e, i) => i > on && e.type === 'unitOff' && e.unitId === shift.unitId);
  const offInPeriod = off >= 0 && events[off].period === shift.period ? off : -1;
  return { on, off: offInPeriod };
}

function makeEvent(body: EventBody, period: number, gameMs: number, txn: number): GameEvent {
  return { ...body, seq: 0, txn, period, gameMs, wallTs: 0 } as GameEvent;
}

export function editShift(
  units: readonly UnitDef[],
  events: readonly GameEvent[],
  shift: Shift,
  startMs: number,
  endMs: number,
): EditResult {
  const found = findShiftEvents(events, shift);
  if (!found) return { ok: false, reason: 'Shift not found.' };
  const err = validateShift(units, events, shift.unitId, shift.period, startMs, endMs, shift);
  if (err) return { ok: false, reason: err };
  const items = itemsOf(events);
  items[found.on] = { e: { ...events[found.on], gameMs: startMs }, idx: found.on, place: 'last' };
  if (found.off >= 0) {
    items[found.off] = { e: { ...events[found.off], gameMs: endMs }, idx: found.off, place: 'first' };
  } else {
    items.push({ e: makeEvent({ type: 'unitOff', unitId: shift.unitId }, shift.period, endMs, nextTxn(events)), idx: events.length, place: 'first' });
  }
  return { ok: true, events: rebuild(units, items) };
}

export function deleteShift(units: readonly UnitDef[], events: readonly GameEvent[], shift: Shift): EditResult {
  const found = findShiftEvents(events, shift);
  if (!found) return { ok: false, reason: 'Shift not found.' };
  const drop = new Set([found.on, found.off]);
  return { ok: true, events: rebuild(units, itemsOf(events).filter((it) => !drop.has(it.idx))) };
}

export function addShift(
  units: readonly UnitDef[],
  events: readonly GameEvent[],
  unitId: string,
  period: number,
  startMs: number,
  endMs: number,
): EditResult {
  const err = validateShift(units, events, unitId, period, startMs, endMs);
  if (err) return { ok: false, reason: err };
  const txn = nextTxn(events);
  const items = itemsOf(events);
  items.push(
    { e: makeEvent({ type: 'unitOn', unitId }, period, startMs, txn), idx: events.length, place: 'last' },
    { e: makeEvent({ type: 'unitOff', unitId }, period, endMs, txn), idx: events.length + 1, place: 'first' },
  );
  return { ok: true, events: rebuild(units, items) };
}

type Marker = 'goalFor' | 'goalAgainst' | 'penaltyFor' | 'penaltyAgainst';

/** Adds a missed goal or penalty. Goals are credited to the units on ice at that time. */
export function addMarker(units: readonly UnitDef[], events: readonly GameEvent[], type: Marker, period: number, gameMs: number): EditResult {
  const end = periodEndMs(events, period);
  if (end === null) return { ok: false, reason: `Period ${period} was not played.` };
  if (gameMs < 0 || gameMs > end) return { ok: false, reason: `Time must be within 0:00 and ${formatClock(end)}.` };
  const body: EventBody = type === 'goalFor' || type === 'goalAgainst' ? { type, onIce: [], strength: 'EV' } : { type };
  const items = itemsOf(events);
  items.push({ e: makeEvent(body, period, gameMs, nextTxn(events)), idx: events.length, place: 'last' });
  return { ok: true, events: rebuild(units, items) };
}

/** Deletes a goal or penalty by seq. Clock and shift events can't be deleted here. */
export function deleteMarker(units: readonly UnitDef[], events: readonly GameEvent[], seq: number): EditResult {
  const e = events.find((x) => x.seq === seq);
  if (!e || !['goalFor', 'goalAgainst', 'penaltyFor', 'penaltyAgainst'].includes(e.type)) {
    return { ok: false, reason: 'Only goals and penalties can be deleted here.' };
  }
  return { ok: true, events: rebuild(units, itemsOf(events).filter((it) => it.e.seq !== seq)) };
}
