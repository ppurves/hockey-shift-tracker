// The game engine: a pure reducer over an append-only event log, plus command
// builders that turn a user action into new events. Time comes from an injected
// now() so tests control it. No setInterval anywhere: the game clock is always
// computed from the last clock event's wall timestamp.

import type { EventBody, GameEvent, Strength, UnitDef } from './types';
import { exclusionSet } from './units';

export interface ActiveShift {
  startMs: number;
  period: number;
}

export interface GameState {
  /** Current period, or null before the first period starts. */
  period: number | null;
  periodsStarted: number[];
  /** True after End Period, until the next period starts. */
  periodEnded: boolean;
  running: boolean;
  /** Game ms at the last clock event (periodStart/pause/resume/periodEnd). */
  accMs: number;
  /** Wall time the clock started running at (only meaningful while running). */
  runningSinceWall: number;
  /** unitId -> open shift. */
  active: Record<string, ActiveShift>;
  /** unitId -> length of the unit's most recent completed shift. */
  lastShiftMs: Record<string, number>;
  score: { for: number; against: number };
  lastTxn: number;
}

export const INITIAL_STATE: GameState = {
  period: null,
  periodsStarted: [],
  periodEnded: false,
  running: false,
  accMs: 0,
  runningSinceWall: 0,
  active: {},
  lastShiftMs: {},
  score: { for: 0, against: 0 },
  lastTxn: 0,
};

/** Pure reducer: applies one event to the state. Lenient: it trusts the log. */
export function reduce(s: GameState, e: GameEvent): GameState {
  const next: GameState = { ...s, lastTxn: Math.max(s.lastTxn, e.txn) };
  switch (e.type) {
    case 'periodStart':
      return {
        ...next,
        period: e.period,
        periodsStarted: s.periodsStarted.includes(e.period)
          ? s.periodsStarted
          : [...s.periodsStarted, e.period],
        periodEnded: false,
        running: false,
        accMs: 0,
        runningSinceWall: 0,
        active: {},
      };
    case 'periodEnd':
      return { ...next, periodEnded: true, running: false, accMs: e.gameMs, active: {} };
    case 'pause':
      return { ...next, running: false, accMs: e.gameMs };
    case 'resume':
      return { ...next, running: true, accMs: e.gameMs, runningSinceWall: e.wallTs };
    case 'unitOn':
      return { ...next, active: { ...s.active, [e.unitId]: { startMs: e.gameMs, period: e.period } } };
    case 'unitOff': {
      const open = s.active[e.unitId];
      if (!open) return next;
      const { [e.unitId]: _closed, ...rest } = s.active;
      return {
        ...next,
        active: rest,
        lastShiftMs: { ...s.lastShiftMs, [e.unitId]: Math.max(0, e.gameMs - open.startMs) },
      };
    }
    case 'goalFor':
      return { ...next, score: { ...s.score, for: s.score.for + 1 } };
    case 'goalAgainst':
      return { ...next, score: { ...s.score, against: s.score.against + 1 } };
    case 'penaltyFor':
    case 'penaltyAgainst':
      return next;
  }
}

export function replay(events: readonly GameEvent[]): GameState {
  return events.reduce(reduce, INITIAL_STATE);
}

/**
 * Current game-clock time. While running this includes all wall time since the
 * last resume, including time the phone was locked or the app was killed.
 * While paused it is frozen.
 */
export function gameMsAt(s: GameState, now: number): number {
  if (!s.running) return s.accMs;
  // Clamp so a device clock moved backwards never runs the game clock backwards.
  return s.accMs + Math.max(0, now - s.runningSinceWall);
}

export function strengthOf(onIce: readonly string[], units: readonly UnitDef[]): Strength {
  const groups = new Set(onIce.map((id) => units.find((u) => u.id === id)?.group));
  if (groups.has('PP')) return 'PP';
  if (groups.has('PK')) return 'PK';
  return 'EV';
}

// ---------------------------------------------------------------------------
// Commands

export type Command =
  | { type: 'tapUnit'; unitId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'togglePause' }
  | { type: 'startPeriod'; period: number }
  | { type: 'endPeriod' }
  | { type: 'goalFor' }
  | { type: 'goalAgainst' }
  | { type: 'penaltyFor' }
  | { type: 'penaltyAgainst' };

export type CommandResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; reason: string };

/**
 * Turns a command into the events it produces (it doesn't apply them).
 * All events from one command share a new txn id, so Undo reverses the whole action.
 */
export function plan(
  events: readonly GameEvent[],
  state: GameState,
  units: readonly UnitDef[],
  cmd: Command,
  now: number,
): CommandResult {
  const txn = state.lastTxn + 1;
  const out: GameEvent[] = [];
  const gameMs = gameMsAt(state, now);
  const push = (body: EventBody, period = state.period ?? 0, ms = gameMs) => {
    out.push({ ...body, seq: events.length + out.length, txn, period, gameMs: ms, wallTs: now } as GameEvent);
  };
  const fail = (reason: string): CommandResult => ({ ok: false, reason });
  const inLivePeriod = state.period !== null && !state.periodEnded;

  /** Closes all shifts, pauses, and ends the current period. */
  const closePeriod = () => {
    for (const unitId of Object.keys(state.active)) push({ type: 'unitOff', unitId });
    if (state.running) push({ type: 'pause' });
    push({ type: 'periodEnd' });
  };

  switch (cmd.type) {
    case 'tapUnit': {
      const unit = units.find((u) => u.id === cmd.unitId);
      if (!unit) return fail(`Unknown unit ${cmd.unitId}`);
      if (!inLivePeriod) return fail('Start a period first');
      if (state.active[unit.id]) {
        push({ type: 'unitOff', unitId: unit.id });
      } else {
        const set = exclusionSet(unit.group);
        for (const other of units) {
          if (other.id !== unit.id && state.active[other.id] && exclusionSet(other.group) === set) {
            push({ type: 'unitOff', unitId: other.id });
          }
        }
        push({ type: 'unitOn', unitId: unit.id });
      }
      break;
    }
    case 'pause':
      if (!inLivePeriod) return fail('No period in progress');
      if (!state.running) return fail('Already paused');
      push({ type: 'pause' });
      break;
    case 'resume':
      if (!inLivePeriod) return fail('Start a period first');
      if (state.running) return fail('Already running');
      push({ type: 'resume' });
      break;
    case 'togglePause':
      return plan(events, state, units, { type: state.running ? 'pause' : 'resume' }, now);
    case 'startPeriod':
      if (!Number.isInteger(cmd.period) || cmd.period < 1) return fail('Invalid period');
      if (state.periodsStarted.includes(cmd.period)) return fail(`Period ${cmd.period} already played`);
      if (state.period !== null && cmd.period < state.period) return fail('Cannot go back to an earlier period');
      if (inLivePeriod) closePeriod();
      push({ type: 'periodStart' }, cmd.period, 0);
      break;
    case 'endPeriod':
      if (!inLivePeriod) return fail('No period in progress');
      closePeriod();
      break;
    case 'goalFor':
    case 'goalAgainst': {
      if (!inLivePeriod) return fail('No period in progress');
      const onIce = units.filter((u) => state.active[u.id]).map((u) => u.id);
      push({ type: cmd.type, onIce, strength: strengthOf(onIce, units) });
      break;
    }
    case 'penaltyFor':
    case 'penaltyAgainst':
      if (!inLivePeriod) return fail('No period in progress');
      push({ type: cmd.type });
      break;
  }
  return { ok: true, events: out };
}

/** Removes the last action (all events of the last txn). */
export function undoLast(events: readonly GameEvent[]): { events: GameEvent[]; undone: GameEvent[] } {
  if (events.length === 0) return { events: [], undone: [] };
  const txn = events[events.length - 1].txn;
  let cut = events.length;
  while (cut > 0 && events[cut - 1].txn === txn) cut--;
  return { events: events.slice(0, cut), undone: events.slice(cut) };
}

/** Short human description of an action, for the Undo toast. */
export function describeTxn(txnEvents: readonly GameEvent[], units: readonly UnitDef[]): string {
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const main =
    txnEvents.find((e) => e.type === 'periodStart') ??
    txnEvents.find((e) => e.type === 'periodEnd') ??
    txnEvents.find((e) => e.type === 'unitOn') ??
    txnEvents[txnEvents.length - 1];
  if (!main) return 'nothing';
  switch (main.type) {
    case 'periodStart': return `start of period ${main.period}`;
    case 'periodEnd': return `end of period ${main.period}`;
    case 'pause': return 'pause';
    case 'resume': return 'resume';
    case 'unitOn': return `${name(main.unitId)} on`;
    case 'unitOff': return `${name(main.unitId)} off`;
    case 'goalFor': return 'goal for';
    case 'goalAgainst': return 'goal against';
    case 'penaltyFor': return 'penalty for';
    case 'penaltyAgainst': return 'penalty against';
  }
}

// ---------------------------------------------------------------------------
// Convenience wrapper used by the UI hook. Holds the log and units; every
// read is derived from the log, so restoring = constructing with the saved log.

export class GameEngine {
  private _events: GameEvent[];
  private _state: GameState;

  constructor(
    readonly units: readonly UnitDef[],
    private readonly now: () => number,
    events: readonly GameEvent[] = [],
  ) {
    this._events = [...events];
    this._state = replay(this._events);
  }

  get events(): readonly GameEvent[] { return this._events; }
  get state(): GameState { return this._state; }
  gameMs(): number { return gameMsAt(this._state, this.now()); }

  /** Runs a command; on success appends and returns the new events (for persistence). */
  dispatch(cmd: Command): CommandResult {
    const r = plan(this._events, this._state, this.units, cmd, this.now());
    if (r.ok) {
      this._events.push(...r.events);
      this._state = r.events.reduce(reduce, this._state);
    }
    return r;
  }

  /** What Undo would remove, or null if there is nothing to undo. */
  peekUndo(): { label: string; events: GameEvent[] } | null {
    const { undone } = undoLast(this._events);
    return undone.length ? { label: describeTxn(undone, this.units), events: undone } : null;
  }

  undo(): GameEvent[] {
    const { events, undone } = undoLast(this._events);
    this._events = events;
    this._state = replay(events);
    return undone;
  }
}
