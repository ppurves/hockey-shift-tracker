// Backup file format (one JSON file with every game and the settings).

import { normalizeRoster, normalizeSettings, type Settings } from './settings';
import type { GameEvent, GameMeta } from './types';

export const BACKUP_APP = 'hockey-shift-tracker';
/** 2: roster-mode games (mode, players). Version 1 files still restore. */
export const BACKUP_VERSION = 2;

export interface GameBundle {
  meta: GameMeta;
  events: GameEvent[];
}

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  settings: Settings;
  games: GameBundle[];
}

export function makeBackup(games: GameBundle[], settings: Settings, now: number): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date(now).toISOString(), settings, games };
}

const EVENT_TYPES = new Set([
  'periodStart', 'periodEnd', 'pause', 'resume', 'unitOn', 'unitOff',
  'goalFor', 'goalAgainst', 'penaltyFor', 'penaltyAgainst',
]);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Parses and validates a backup file. Throws an Error with a readable message. */
export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const b = data as Partial<Backup>;
  if (!b || b.app !== BACKUP_APP) throw new Error('This is not a Hockey Shift Tracker backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  }
  if (!Array.isArray(b.games)) throw new Error('Backup has no games list.');
  b.games.forEach((g, i) => {
    const where = `Game ${i + 1}`;
    const m = g?.meta;
    if (!m || typeof m.id !== 'string' || !m.id) throw new Error(`${where}: missing id.`);
    if (typeof m.opponent !== 'string' || typeof m.date !== 'string') throw new Error(`${where}: missing opponent/date.`);
    if (!Array.isArray(m.units) || !m.units.every((u) => typeof u?.id === 'string' && typeof u?.name === 'string' && ['F', 'D', 'PP', 'PK'].includes(u?.group))) {
      throw new Error(`${where}: invalid units.`);
    }
    if (m.mode === 'roster') {
      if (!Array.isArray(m.players)) throw new Error(`${where}: roster game without players.`);
      const valid = normalizeRoster(m.players);
      if (valid.length !== m.players.length) throw new Error(`${where}: invalid roster.`);
    } else {
      m.mode = 'lines';
      delete m.players;
    }
    if (!Array.isArray(g.events)) throw new Error(`${where}: missing events.`);
    g.events.forEach((e, j) => {
      if (!e || !EVENT_TYPES.has(e.type) || ![e.seq, e.txn, e.period, e.gameMs, e.wallTs].every(isNum)) {
        throw new Error(`${where}, event ${j + 1}: invalid.`);
      }
    });
    if (!isNum(m.periodLengthMs)) m.periodLengthMs = 15 * 60_000;
    m.score ??= { for: 0, against: 0 };
    m.status = m.status === 'live' ? 'live' : 'final';
  });
  return {
    app: BACKUP_APP,
    version: b.version,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    settings: normalizeSettings(b.settings),
    games: b.games as GameBundle[],
  };
}
