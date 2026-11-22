import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameEngine, type Command, type CommandResult, type GameEvent, type GameMeta } from '../../core';
import { appendEvents, getEvents, getGame, putGame, removeEvents, replaceEvents } from '../../data/db';

export interface GameSession {
  meta: GameMeta;
  engine: GameEngine;
  dispatch: (cmd: Command) => CommandResult;
  undo: () => GameEvent[];
  updateMeta: (patch: Partial<GameMeta>) => Promise<void>;
  /** Replaces the whole log (post-game edits) and saves it. */
  replaceLog: (events: GameEvent[]) => Promise<void>;
  /** Set when a write to storage failed: the UI must show it loudly. */
  saveError: string | null;
}

/**
 * Wraps the pure engine for React. The engine updates synchronously, so the
 * UI responds instantly; each change is then written through to IndexedDB.
 */
export function useGameSession(gameId: string): GameSession | 'loading' | 'missing' {
  const [loaded, setLoaded] = useState<{ meta: GameMeta; engine: GameEngine } | 'loading' | 'missing'>('loading');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const metaRef = useRef<GameMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded('loading');
    (async () => {
      const meta = await getGame(gameId);
      if (!meta) { if (!cancelled) setLoaded('missing'); return; }
      const events = await getEvents(gameId);
      if (cancelled) return;
      metaRef.current = meta;
      setLoaded({ meta, engine: new GameEngine(meta.units, Date.now, events) });
    })().catch((e) => !cancelled && setSaveError(`Could not load game: ${e}`));
    return () => { cancelled = true; };
  }, [gameId]);

  const engine = typeof loaded === 'object' ? loaded.engine : null;

  const syncMeta = useCallback((): GameMeta => {
    const next = { ...metaRef.current!, score: { ...engine!.state.score }, updatedAt: Date.now() };
    metaRef.current = next;
    return next;
  }, [engine]);

  const onSaveFail = (e: unknown) => setSaveError(`NOT SAVED: ${e instanceof Error ? e.message : e}`);

  const dispatch = useCallback((cmd: Command): CommandResult => {
    if (!engine) return { ok: false, reason: 'Game not loaded' };
    const r = engine.dispatch(cmd);
    if (r.ok) {
      rerender();
      appendEvents(syncMeta(), r.events).then(() => setSaveError(null), onSaveFail);
    }
    return r;
  }, [engine, syncMeta]);

  const undo = useCallback((): GameEvent[] => {
    if (!engine) return [];
    const undone = engine.undo();
    if (undone.length) {
      rerender();
      removeEvents(syncMeta(), undone).then(() => setSaveError(null), onSaveFail);
    }
    return undone;
  }, [engine, syncMeta]);

  const updateMeta = useCallback(async (patch: Partial<GameMeta>) => {
    if (!metaRef.current) return;
    metaRef.current = { ...metaRef.current, ...patch, updatedAt: Date.now() };
    rerender();
    await putGame(metaRef.current).catch(onSaveFail);
  }, []);

  const replaceLog = useCallback(async (events: GameEvent[]) => {
    const meta = metaRef.current;
    if (!meta) return;
    const next = new GameEngine(meta.units, Date.now, events);
    metaRef.current = { ...meta, score: { ...next.state.score }, updatedAt: Date.now() };
    setLoaded({ meta: metaRef.current, engine: next });
    await replaceEvents(metaRef.current, events).then(() => setSaveError(null), onSaveFail);
  }, []);

  if (typeof loaded !== 'object') return loaded;
  return { meta: metaRef.current!, engine: loaded.engine, dispatch, undo, updateMeta, replaceLog, saveError };
}
