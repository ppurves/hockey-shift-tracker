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
}

export const DEFAULT_SETTINGS: Settings = {
  recipientEmail: '',
  defaultPeriodLengthMs: DEFAULT_PERIOD_MS,
  audioTick: false,
  defaultUnits: DEFAULT_UNITS,
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
  };
}
