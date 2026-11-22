// IndexedDB persistence. Every event is written as soon as it happens
// (write-through), so a crash loses at most the tap in flight.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameEvent, GameMeta } from '../core';

export type StoredEvent = GameEvent & { gameId: string };

interface ShiftDB extends DBSchema {
  games: { key: string; value: GameMeta; indexes: { byUpdated: number } };
  events: { key: [string, number]; value: StoredEvent; indexes: { byGame: string } };
}

let dbp: Promise<IDBPDatabase<ShiftDB>> | null = null;
function db() {
  dbp ??= openDB<ShiftDB>('hockey-shift-tracker', 1, {
    upgrade(d) {
      const games = d.createObjectStore('games', { keyPath: 'id' });
      games.createIndex('byUpdated', 'updatedAt');
      const events = d.createObjectStore('events', { keyPath: ['gameId', 'seq'] });
      events.createIndex('byGame', 'gameId');
    },
  });
  return dbp;
}

export async function listGames(): Promise<GameMeta[]> {
  const all = await (await db()).getAll('games');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGame(id: string): Promise<GameMeta | undefined> {
  return (await db()).get('games', id);
}

export async function putGame(meta: GameMeta): Promise<void> {
  await (await db()).put('games', meta);
}

export async function getEvents(gameId: string): Promise<GameEvent[]> {
  const rows = await (await db()).getAllFromIndex('events', 'byGame', gameId);
  return rows
    .sort((a, b) => a.seq - b.seq)
    .map(({ gameId: _g, ...e }) => e as GameEvent);
}

/** Appends events and updates the game record in one atomic transaction. */
export async function appendEvents(meta: GameMeta, events: readonly GameEvent[]): Promise<void> {
  const tx = (await db()).transaction(['events', 'games'], 'readwrite');
  for (const e of events) tx.objectStore('events').put({ ...e, gameId: meta.id });
  tx.objectStore('games').put(meta);
  await tx.done;
}

/** Removes undone events and updates the game record in one transaction. */
export async function removeEvents(meta: GameMeta, events: readonly GameEvent[]): Promise<void> {
  const tx = (await db()).transaction(['events', 'games'], 'readwrite');
  for (const e of events) tx.objectStore('events').delete([meta.id, e.seq]);
  tx.objectStore('games').put(meta);
  await tx.done;
}

export async function deleteGame(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['events', 'games'], 'readwrite');
  const keys = await tx.objectStore('events').index('byGame').getAllKeys(id);
  for (const k of keys) tx.objectStore('events').delete(k);
  tx.objectStore('games').delete(id);
  await tx.done;
}
