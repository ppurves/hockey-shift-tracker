// The game engine: a pure reducer over an append-only event log, plus command
// builders that turn a user action into new events. Time comes from an injected
// now() so tests control it. No setInterval anywhere: the game clock is always
// computed from the last clock event's wall timestamp.

import type { EventBody, GameEvent, PenaltySide, Strength, UnitDef } from './types';
import { exclusionKey } from './units';

export interface ActiveShift {
  startMs: number;
  period: number;
}

/** A timed penalty that hasn't ended yet. */
export interface ActivePenalty {
  /** txn of the penalty event: its id. */
  ref: number;
  side: PenaltySide;
  /** Game-clock time across periods (priorPeriodsMs + gameMs) when it was called. */
  startAbs: number;
  lengthMs: number;
  /** Roster: player in the box. */
  playerId?: string;
  /** Lines mode: number of the player in the box. */
  number?: string;
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
  /** Game-clock time of all periods before the current one. */
  priorPeriodsMs: number;
  /** unitId -> game-clock time (priorPeriodsMs + gameMs) when its last shift ended. */
  lastOffTotalMs: Record<string, number>;
  score: { for: number; against: number };
  lastTxn: number;
  /** Running penalties (for and against), in the order they were called. */
  penalties: ActivePenalty[];
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
  priorPeriodsMs: 0,
  lastOffTotalMs: {},
  score: { for: 0, against: 0 },
  lastTxn: 0,
  penalties: [],
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
        priorPeriodsMs: s.period === null ? 0 : s.priorPeriodsMs + s.accMs,
        lastOffTotalMs: closeActive(s, s.accMs),
      };
    case 'periodEnd':
      return { ...next, periodEnded: true, running: false, accMs: e.gameMs, active: {}, lastOffTotalMs: closeActive(s, e.gameMs) };
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
        lastOffTotalMs: { ...s.lastOffTotalMs, [e.unitId]: s.priorPeriodsMs + e.gameMs },
      };
    }
    case 'goalFor':
      return { ...next, score: { ...s.score, for: s.score.for + 1 } };
    case 'goalAgainst':
      return { ...next, score: { ...s.score, against: s.score.against + 1 } };
    case 'penaltyFor':
    case 'penaltyAgainst': {
      if (!e.lengthMs || e.lengthMs <= 0) return next; // pre-M7 penalty: marker only
      const p: ActivePenalty = {
        ref: e.txn,
        side: e.type === 'penaltyFor' ? 'for' : 'against',
        startAbs: s.priorPeriodsMs + e.gameMs,
        lengthMs: e.lengthMs,
        ...(e.playerId ? { playerId: e.playerId } : {}),
        ...(e.number ? { number: e.number } : {}),
      };
      return { ...next, penalties: [...s.penalties, p] };
    }
    case 'penaltyInfo':
      return {
        ...next,
        penalties: s.penalties.map((p) => {
          if (p.ref !== e.ref) return p;
          const out = { ...p };
          if (e.playerId !== undefined) { if (e.playerId) out.playerId = e.playerId; else delete out.playerId; }
          if (e.number !== undefined) { if (e.number) out.number = e.number; else delete out.number; }
          if (e.lengthMs && e.lengthMs > 0) out.lengthMs = e.lengthMs;
          return out;
        }),
      };
    case 'penaltyEnd':
      return { ...next, penalties: s.penalties.filter((p) => p.ref !== e.ref) };
  }
}

/** Marks every open shift as ended at `gameMs` of the current period. */
function closeActive(s: GameState, gameMs: number): Record<string, number> {
  const ids = Object.keys(s.active);
  if (!ids.length) return s.lastOffTotalMs;
  const out = { ...s.lastOffTotalMs };
  for (const id of ids) out[id] = s.priorPeriodsMs + gameMs;
  return out;
}

/** Default: shifts longer than this are flagged on the capture screen (editable in Settings). */
export const LONG_SHIFT_MS = 90_000;
/** Default: rest (time since last shift) longer than this is flagged (editable in Settings). */
export const LONG_REST_MS = 300_000;

/**
 * Game-clock time since the unit's last shift ended, counting across periods
 * (intermissions and pauses don't count). null if it hasn't had a shift or is on.
 */
export function restMsAt(s: GameState, unitId: string, gameMs: number): number | null {
  const off = s.lastOffTotalMs[unitId];
  if (off === undefined || s.active[unitId]) return null;
  return Math.max(0, s.priorPeriodsMs + gameMs - off);
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

/** Game-clock time across periods (pauses and intermissions excluded). */
export function absMsAt(s: GameState, now: number): number {
  return s.priorPeriodsMs + gameMsAt(s, now);
}

export const penaltyExpiryAbs = (p: ActivePenalty): number => p.startAbs + p.lengthMs;

export function penaltyRemainingMs(s: GameState, p: ActivePenalty, now: number): number {
  return Math.max(0, penaltyExpiryAbs(p) - absMsAt(s, now));
}

/** PP when more of our opponents' penalties are running, PK when more of ours are, else EV (incl. 4-on-4). */
export function conditionOf(s: Pick<GameState, 'penalties'>): Strength {
  const f = s.penalties.filter((p) => p.side === 'for').length;
  const a = s.penalties.length - f;
  return f > a ? 'PP' : a > f ? 'PK' : 'EV';
}

/** The running penalty that has this player in the box, if any. */
export function boxPenalty(s: Pick<GameState, 'penalties'>, unitId: string): ActivePenalty | undefined {
  return s.penalties.find((p) => p.side === 'against' && p.playerId === unitId);
}

/**
 * Goal strength. A legacy PP/PK unit on the ice decides it (games from before
 * M7); otherwise it's the game condition from running penalties.
 */
export function strengthOf(onIce: readonly string[], units: readonly UnitDef[], s?: Pick<GameState, 'penalties'>): Strength {
  const groups = new Set(onIce.map((id) => units.find((u) => u.id === id)?.group));
  if (groups.has('PP')) return 'PP';
  if (groups.has('PK')) return 'PK';
  return s ? conditionOf(s) : 'EV';
}

/** Earliest-expiring running penalty on one side. */
function firstToExpire(s: GameState, side: PenaltySide): ActivePenalty | undefined {
  return s.penalties
    .filter((p) => p.side === side)
    .sort((a, b) => penaltyExpiryAbs(a) - penaltyExpiryAbs(b))[0];
}

// ---------------------------------------------------------------------------
// Commands

export type Command =
  | { type: 'tapUnit'; unitId: string }
  /** Roster mode: puts a line's players on (taking every other player of that group off), or off if all are on. */
  | { type: 'tapLine'; lineId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'togglePause' }
  | { type: 'startPeriod'; period: number }
  | { type: 'endPeriod' }
  | { type: 'goalFor' }
  | { type: 'goalAgainst' }
  /** lengthMs > 0 starts a power play (for) or penalty kill (against) on the game clock. */
  | { type: 'penaltyFor' | 'penaltyAgainst'; lengthMs?: number; playerId?: string; number?: string }
  /** Set who is in the box and/or the length of a running penalty (ref = its txn). */
  | { type: 'penaltyInfo'; ref: number; playerId?: string | null; number?: string | null; lengthMs?: number }
  /** End a running penalty now. */
  | { type: 'endPenalty'; ref: number };

export type CommandResult =
  | { ok: true; events: GameEvent[] }
  /** `events`: penalty expiries applied before the command was refused (still need saving). */
  | { ok: false; reason: string; events?: GameEvent[] };

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
      if (!state.active[unit.id] && boxPenalty(state, unit.id)) return fail(`${unit.name} is in the penalty box`);
      if (state.active[unit.id]) {
        push({ type: 'unitOff', unitId: unit.id });
      } else {
        const set = exclusionKey(unit);
        for (const other of units) {
          if (other.id !== unit.id && state.active[other.id] && exclusionKey(other) === set) {
            push({ type: 'unitOff', unitId: other.id });
          }
        }
        push({ type: 'unitOn', unitId: unit.id });
      }
      break;
    }
    case 'tapLine': {
      const all = units.filter((u) => u.kind === 'player' && u.lineId === cmd.lineId);
      if (!all.length) return fail('No players on this line');
      if (!inLivePeriod) return fail('Start a period first');
      // Players in the penalty box stay off; the rest of the line goes out.
      const members = all.filter((u) => state.active[u.id] || !boxPenalty(state, u.id));
      if (!members.length) return fail('Every player on this line is in the penalty box');
      const group = members[0].group;
      if (members.every((u) => state.active[u.id])) {
        for (const u of members) push({ type: 'unitOff', unitId: u.id });
      } else {
        for (const u of units) {
          if (u.kind === 'player' && u.group === group && state.active[u.id] && u.lineId !== cmd.lineId) {
            push({ type: 'unitOff', unitId: u.id });
          }
        }
        for (const u of members) if (!state.active[u.id]) push({ type: 'unitOn', unitId: u.id });
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
      {
        // The goalie in net (or the last one) starts the new period in net.
        const goalies = units.filter((u) => u.kind === 'player' && u.group === 'G');
        const last = goalies.find((u) => state.active[u.id]) ??
          goalies
            .filter((u) => state.lastOffTotalMs[u.id] !== undefined)
            .sort((a, b) => state.lastOffTotalMs[b.id] - state.lastOffTotalMs[a.id])[0];
        if (last) push({ type: 'unitOn', unitId: last.id }, cmd.period, 0);
      }
      break;
    case 'endPeriod':
      if (!inLivePeriod) return fail('No period in progress');
      closePeriod();
      break;
    case 'goalFor':
    case 'goalAgainst': {
      if (!inLivePeriod) return fail('No period in progress');
      const onIce = units.filter((u) => state.active[u.id]).map((u) => u.id);
      const strength = strengthOf(onIce, units, state);
      push({ type: cmd.type, onIce, strength });
      // A goal by the team with more skaters ends the shorter-handed side's
      // earliest-expiring penalty (minor rule). Not at 4-on-4.
      const cond = conditionOf(state);
      const ended = cmd.type === 'goalFor' && cond === 'PP' ? firstToExpire(state, 'for')
        : cmd.type === 'goalAgainst' && cond === 'PK' ? firstToExpire(state, 'against') : undefined;
      if (ended) push({ type: 'penaltyEnd', ref: ended.ref, reason: 'goal' });
      // Play stops for a goal: auto-pause in the same txn, so Undo reverts both.
      if (state.running) push({ type: 'pause' });
      break;
    }
    case 'penaltyFor':
    case 'penaltyAgainst': {
      if (!inLivePeriod) return fail('No period in progress');
      const len = cmd.lengthMs && cmd.lengthMs > 0 ? Math.round(cmd.lengthMs) : undefined;
      const player = cmd.playerId ? units.find((u) => u.id === cmd.playerId) : undefined;
      if (cmd.playerId && !player) return fail(`Unknown player ${cmd.playerId}`);
      push({
        type: cmd.type,
        ...(len ? { lengthMs: len } : {}),
        ...(player ? { playerId: player.id } : {}),
        ...(cmd.number?.trim() ? { number: cmd.number.trim() } : {}),
      });
      // The penalized player goes to the box.
      if (player && state.active[player.id]) push({ type: 'unitOff', unitId: player.id });
      // Play stops for a penalty call: auto-pause in the same txn.
      if (state.running) push({ type: 'pause' });
      break;
    }
    case 'penaltyInfo': {
      if (state.period === null) return fail('No period in progress');
      const pen = state.penalties.find((p) => p.ref === cmd.ref);
      if (!pen) return fail('That penalty is over');
      const player = cmd.playerId ? units.find((u) => u.id === cmd.playerId) : undefined;
      if (cmd.playerId && !player) return fail(`Unknown player ${cmd.playerId}`);
      const body: EventBody = { type: 'penaltyInfo', ref: cmd.ref };
      if (cmd.playerId !== undefined) body.playerId = cmd.playerId;
      if (cmd.number !== undefined) body.number = cmd.number?.trim() || null;
      if (cmd.lengthMs && cmd.lengthMs > 0) body.lengthMs = Math.round(cmd.lengthMs);
      push(body);
      if (player && state.active[player.id] && !state.periodEnded) push({ type: 'unitOff', unitId: player.id });
      break;
    }
    case 'endPenalty':
      if (state.period === null) return fail('No period in progress');
      if (!state.penalties.some((p) => p.ref === cmd.ref)) return fail('That penalty is over');
      push({ type: 'penaltyEnd', ref: cmd.ref, reason: 'manual' });
      break;
  }
  return { ok: true, events: out };
}

/**
 * Penalties whose time ran out, as `penaltyEnd` events (auto, one txn) at the
 * exact game time each expired. Empty when nothing is due or no period is live.
 */
export function planSettle(events: readonly GameEvent[], state: GameState, now: number): GameEvent[] {
  if (state.period === null || state.periodEnded || !state.penalties.length) return [];
  const nowAbs = absMsAt(state, now);
  const due = state.penalties
    .filter((p) => penaltyExpiryAbs(p) <= nowAbs)
    .sort((a, b) => penaltyExpiryAbs(a) - penaltyExpiryAbs(b));
  const txn = state.lastTxn + 1;
  return due.map((p, i) => ({
    type: 'penaltyEnd',
    ref: p.ref,
    reason: 'expired',
    seq: events.length + i,
    txn,
    period: state.period!,
    gameMs: Math.max(0, penaltyExpiryAbs(p) - state.priorPeriodsMs),
    wallTs: now,
    auto: true,
  }));
}

/**
 * Removes the last action (all events of the last txn the user made), plus
 * any automatic events after it (they're re-created if still due).
 */
export function undoLast(events: readonly GameEvent[]): { events: GameEvent[]; undone: GameEvent[] } {
  let end = events.length;
  while (end > 0 && events[end - 1].auto) end--;
  if (end === 0) return { events: [...events], undone: [] };
  const txn = events[end - 1].txn;
  let cut = end;
  while (cut > 0 && events[cut - 1].txn === txn) cut--;
  return { events: events.slice(0, cut), undone: events.slice(cut) };
}

/**
 * Short human description of an action, for the Undo toast. `lines` (roster
 * mode) names a line change ("Line 2 on") instead of its first player.
 */
export function describeTxn(allEvents: readonly GameEvent[], units: readonly UnitDef[], lines: readonly UnitDef[] = []): string {
  const txnEvents = allEvents.some((e) => !e.auto) ? allEvents.filter((e) => !e.auto) : allEvents;
  const name = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const ons = txnEvents.filter((e): e is Extract<GameEvent, { type: 'unitOn' }> => e.type === 'unitOn');
  const offs = txnEvents.filter((e): e is Extract<GameEvent, { type: 'unitOff' }> => e.type === 'unitOff');
  const lineOf = (id: string) => units.find((u) => u.id === id)?.lineId;
  const sameLine = (evs: { unitId: string }[]) => {
    const l = evs.length ? lineOf(evs[0].unitId) : undefined;
    return l && evs.every((e) => lineOf(e.unitId) === l) ? lines.find((x) => x.id === l)?.name : undefined;
  };
  // A player tap is a single event, so a multi-event shift txn is a line tap.
  if (txnEvents.length > 1 && txnEvents.every((e) => e.type === 'unitOn' || e.type === 'unitOff')) {
    const on = sameLine(ons);
    if (on) return `${on} on`;
    const off = !ons.length ? sameLine(offs) : undefined;
    if (off) return `${off} off`;
  }
  const main =
    txnEvents.find((e) => e.type === 'periodStart') ??
    txnEvents.find((e) => e.type === 'periodEnd') ??
    txnEvents.find((e) => e.type.startsWith('goal') || e.type === 'penaltyFor' || e.type === 'penaltyAgainst') ??
    txnEvents.find((e) => e.type.startsWith('penalty')) ??
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
    case 'penaltyInfo': return main.playerId || main.number ? `penalty: ${main.playerId ? name(main.playerId) : `#${main.number}`}` : 'penalty details';
    case 'penaltyEnd': return main.reason === 'expired' ? 'penalty expired' : 'penalty ended';
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
    /** Roster mode: the lines players belong to (for Undo labels). */
    readonly lines: readonly UnitDef[] = [],
  ) {
    this._events = [...events];
    this._state = replay(this._events);
  }

  get events(): readonly GameEvent[] { return this._events; }
  get state(): GameState { return this._state; }
  gameMs(): number { return gameMsAt(this._state, this.now()); }

  private apply(events: GameEvent[]) {
    this._events.push(...events);
    this._state = events.reduce(reduce, this._state);
  }

  /** Writes the end of any penalty whose time ran out. Returns the new events (for persistence). */
  settle(): GameEvent[] {
    const ev = planSettle(this._events, this._state, this.now());
    if (ev.length) this.apply(ev);
    return ev;
  }

  /**
   * Settles expired penalties, then runs a command. Returns every new event
   * (expiries + the command's) for persistence, also when the command fails.
   */
  dispatch(cmd: Command): CommandResult {
    const settled = this.settle();
    const r = plan(this._events, this._state, this.units, cmd, this.now());
    if (!r.ok) return settled.length ? { ...r, events: settled } : r;
    this.apply(r.events);
    return { ok: true, events: [...settled, ...r.events] };
  }

  /** What Undo would remove, or null if there is nothing to undo. */
  peekUndo(): { label: string; events: GameEvent[] } | null {
    const { undone } = undoLast(this._events);
    return undone.length ? { label: describeTxn(undone, this.units, this.lines), events: undone } : null;
  }

  undo(): GameEvent[] {
    const { events, undone } = undoLast(this._events);
    this._events = events;
    this._state = replay(events);
    return undone;
  }
}
