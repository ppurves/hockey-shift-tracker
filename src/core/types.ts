// Domain types. Pure TypeScript: no React or DOM imports anywhere in src/core.

export type Group = 'F' | 'D' | 'PP' | 'PK';

export interface UnitDef {
  id: string;
  name: string;
  group: Group;
}

export type Strength = 'EV' | 'PP' | 'PK';

/** Fields every event carries. */
export interface EventBase {
  /** Position in the log (0-based). */
  seq: number;
  /** Events created by one user action share a txn; Undo removes a whole txn. */
  txn: number;
  period: number;
  /** Game-clock time within `period`, in ms. */
  gameMs: number;
  /** Wall-clock timestamp (Date.now()) when the event was recorded. */
  wallTs: number;
}

export type EventBody =
  | { type: 'periodStart' }
  | { type: 'periodEnd' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'unitOn'; unitId: string }
  | { type: 'unitOff'; unitId: string }
  | { type: 'goalFor' | 'goalAgainst'; onIce: string[]; strength: Strength }
  | { type: 'penaltyFor' | 'penaltyAgainst' };

export type GameEvent = EventBase & EventBody;
export type EventType = GameEvent['type'];

export interface Shift {
  unitId: string;
  period: number;
  startMs: number;
  endMs: number;
  /** True while the unit is still on the ice (endMs is the live game time). */
  open: boolean;
}

export interface UnitStats {
  unitId: string;
  shifts: number;
  toiMs: number;
  /** null when there are no shifts (display as "—"). */
  avgMs: number | null;
  longestMs: number | null;
  shortestMs: number | null;
  gf: number;
  ga: number;
  plusMinus: number;
}

export type GameStatus = 'live' | 'final';

/** Everything about a game except its event log. */
export interface GameMeta {
  id: string;
  opponent: string;
  /** YYYY-MM-DD (local date). */
  date: string;
  homeAway: 'home' | 'away';
  periodLengthMs: number;
  units: UnitDef[];
  status: GameStatus;
  score: { for: number; against: number };
  createdAt: number;
  updatedAt: number;
}
