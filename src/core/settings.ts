import { LONG_REST_MS, LONG_SHIFT_MS } from './engine';
import { DEFAULT_PERIOD_MS } from './game';
import type { UnitDef } from './types';
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
}

/** Longest value accepted for either alert threshold. */
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
};

/** Fills missing/invalid fields from defaults (settings saved by older versions). */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return {
    recipientEmail: typeof r.recipientEmail === 'string' ? r.recipientEmail : '',
    defaultPeriodLengthMs:
      typeof r.defaultPeriodLengthMs === 'number' && r.defaultPeriodLengthMs > 0 ? r.defaultPeriodLengthMs : DEFAULT_PERIOD_MS,
    audioTick: r.audioTick === true,
    defaultUnits: Array.isArray(r.defaultUnits) && r.defaultUnits.length ? r.defaultUnits : DEFAULT_UNITS,
    longShiftMs: validThreshold(r.longShiftMs) ? r.longShiftMs : LONG_SHIFT_MS,
    longRestMs: validThreshold(r.longRestMs) ? r.longRestMs : LONG_REST_MS,
  };
}
