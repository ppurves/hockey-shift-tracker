import { LONG_REST_MS, LONG_SHIFT_MS } from './engine';
import { DEFAULT_PERIOD_MS } from './game';
import type { Player, TrackMode, UnitDef } from './types';
import { DEFAULT_UNITS } from './units';

export interface Settings {
  recipientEmail: string;
  defaultPeriodLengthMs: number;
  /** Short click sound on taps. Off by default (iOS has no haptics). */
  audioTick: boolean;
  /** Unit set copied into each new game (rename, add Line 4, etc.). */
  defaultUnits: UnitDef[];
  /** Active line/D tile turns red when its shift is longer than this. */
  longShiftMs: number;
  /** Inactive line/D tile text turns red when it has been off longer than this. */
  longRestMs: number;
  /** Length of a new penalty (power play / penalty kill) on the game clock. */
  defaultPenaltyMs: number;
  /** Tracking mode preselected for new games. */
  defaultMode: TrackMode;
  /** Roster copied into each new roster-mode game. */
  defaultRoster: Player[];
}

/** A minor: 2:00. */
export const DEFAULT_PENALTY_MS = 2 * 60_000;

/** Longest value accepted for the alert thresholds and penalty length. */
export const MAX_THRESHOLD_MS = 60 * 60_000;
const validThreshold = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_THRESHOLD_MS;

export const DEFAULT_SETTINGS: Settings = {
  recipientEmail: '',
  defaultPeriodLengthMs: DEFAULT_PERIOD_MS,
  audioTick: false,
  defaultUnits: DEFAULT_UNITS,
  longShiftMs: LONG_SHIFT_MS,
  longRestMs: LONG_REST_MS,
  defaultMode: 'lines',
  defaultRoster: [],
  defaultPenaltyMs: DEFAULT_PENALTY_MS,
};

const isPlayer = (p: unknown): p is Player => {
  const x = p as Partial<Player> | null;
  return !!x && typeof x.id === 'string' && !!x.id && typeof x.number === 'string' && typeof x.name === 'string' &&
    (x.position === 'F' || x.position === 'D' || x.position === 'G') && (x.lineId === null || typeof x.lineId === 'string');
};

/** Keeps the valid players of a stored roster (drops malformed entries and duplicate ids). */
export function normalizeRoster(raw: unknown): Player[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((p): p is Player => isPlayer(p) && !seen.has(p.id) && !!seen.add(p.id));
}

/** Fills missing/invalid fields from defaults (settings saved by older versions). */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return {
    recipientEmail: typeof r.recipientEmail === 'string' ? r.recipientEmail : '',
    defaultPeriodLengthMs:
      typeof r.defaultPeriodLengthMs === 'number' && r.defaultPeriodLengthMs > 0 ? r.defaultPeriodLengthMs : DEFAULT_PERIOD_MS,
    audioTick: r.audioTick === true,
    // PP/PK units from before M7 are dropped: they're game conditions now.
    defaultUnits: Array.isArray(r.defaultUnits) && r.defaultUnits.some((u) => u?.group === 'F')
      ? r.defaultUnits.filter((u) => u.group === 'F' || u.group === 'D')
      : DEFAULT_UNITS,
    defaultPenaltyMs: validThreshold(r.defaultPenaltyMs) ? r.defaultPenaltyMs : DEFAULT_PENALTY_MS,
    longShiftMs: validThreshold(r.longShiftMs) ? r.longShiftMs : LONG_SHIFT_MS,
    longRestMs: validThreshold(r.longRestMs) ? r.longRestMs : LONG_REST_MS,
    defaultMode: r.defaultMode === 'roster' ? 'roster' : 'lines',
    defaultRoster: normalizeRoster(r.defaultRoster),
  };
}
