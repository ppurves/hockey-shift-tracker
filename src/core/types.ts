// Domain types. Pure TypeScript: no React or DOM imports anywhere in src/core.

export type Group = 'F' | 'D' | 'PP' | 'PK';

export interface UnitDef {
  id: string;
  name: string;
  group: Group;
  /** Set on roster players tracked as units (roster mode). Players have no exclusion set. */
  kind?: 'player';
  /** Player only: the F line / D pair they're assigned to (null = extra). */
  lineId?: string | null;
  /** Player only: jersey number. */
  number?: string;
}

/** How a game is tracked: whole lines/pairs, or individual players from a roster. */
export type TrackMode = 'lines' | 'roster';

/** Skater position. Goalies are on the roster but not tracked on the ice. */
export type Position = 'F' | 'D' | 'G';

export interface Player {
  id: string;
  /** Jersey number as typed (kept as text: "07" and "7" differ to some teams). */
  number: string;
  name: string;
  position: Position;
  /** F line or D pair unit id, or null for an extra / spare. */
  lineId: string | null;
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
  /** Average game-clock time between consecutive shifts (null with fewer than 2). */
  avgRestMs: number | null;
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
  /** Lines and pairs (and PP/PK units). In roster mode the F/D units are the lines players belong to. */
  units: UnitDef[];
  /** Missing on games made before roster mode: treat as 'lines'. */
  mode?: TrackMode;
  /** Roster mode only. */
  players?: Player[];
  status: GameStatus;
  score: { for: number; against: number };
  createdAt: number;
  updatedAt: number;
}
