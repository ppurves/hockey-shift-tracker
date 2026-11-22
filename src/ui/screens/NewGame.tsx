import { useState } from 'react';
import { DEFAULT_PERIOD_MS, isoDate, newGameMeta } from '../../core';
import { putGame } from '../../data/db';
import { navigate } from '../hooks/useHashRoute';

export function NewGame() {
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(isoDate(Date.now()));
  const [homeAway, setHomeAway] = useState<'home' | 'away'>('home');
  const [minutes, setMinutes] = useState(String(DEFAULT_PERIOD_MS / 60_000));
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const meta = newGameMeta(
      { opponent, date, homeAway, periodLengthMs: Math.round(Number(minutes) * 60_000) },
      crypto.randomUUID(),
      Date.now(),
    );
    await putGame(meta);
    navigate(`game/${meta.id}`);
  };

  return (
    <main className="page">
      <button className="link-btn" onClick={() => navigate('')}>‹ Games</button>
      <h1>New game</h1>
      <form className="form" onSubmit={create}>
        <label>Opponent
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="e.g. Hawks" autoComplete="off" />
        </label>
        <label>Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <fieldset className="seg">
          <legend>Home / away</legend>
          {(['home', 'away'] as const).map((v) => (
            <button type="button" key={v} className={homeAway === v ? 'sel' : ''} aria-pressed={homeAway === v} onClick={() => setHomeAway(v)}>
              {v === 'home' ? 'Home' : 'Away'}
            </button>
          ))}
        </fieldset>
        <label>Period length (minutes)
          <input type="number" inputMode="decimal" min="1" max="60" step="0.5" value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
        </label>
        <p className="muted small">Unit names (Line 1, D 1, …) can be renamed in a later update.</p>
        <button className="big-btn primary" disabled={busy}>Create game</button>
      </form>
    </main>
  );
}
