import { useEffect, useState } from 'react';
import { DEFAULT_PERIOD_MS, isoDate, newGameMeta, positionGroup, sanitizeRoster, type Player, type TrackMode, type UnitDef } from '../../core';
import { putGame } from '../../data/db';
import { UnitsEditor } from '../components/UnitsEditor';
import { ModePicker, RosterEditor } from '../components/RosterEditor';
import { navigate } from '../hooks/useHashRoute';
import { useSettings } from '../hooks/useSettings';

export function NewGame() {
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(isoDate(Date.now()));
  const [homeAway, setHomeAway] = useState<'home' | 'away'>('home');
  const [minutes, setMinutes] = useState(String(DEFAULT_PERIOD_MS / 60_000));
  const [busy, setBusy] = useState(false);
  const { settings, loaded } = useSettings();
  const [units, setUnits] = useState<UnitDef[] | null>(null);
  const [showUnits, setShowUnits] = useState(false);
  const [mode, setMode] = useState<TrackMode | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!loaded) return;
    setUnits((u) => u ?? settings.defaultUnits.map((x) => ({ ...x })));
    setMode((m) => m ?? settings.defaultMode);
    setPlayers((p) => p ?? settings.defaultRoster.map((x) => ({ ...x })));
    setMinutes(String(settings.defaultPeriodLengthMs / 60_000));
  }, [loaded, settings]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const roster = mode === 'roster';
    const skaters = (players ?? []).filter((p) => positionGroup(p.position));
    if (roster && !skaters.length) {
      setError('Add at least one skater to the roster, or switch to Lines only.');
      setShowRoster(true);
      return;
    }
    setBusy(true);
    const meta = newGameMeta(
      {
        opponent, date, homeAway, periodLengthMs: Math.round(Number(minutes) * 60_000), units: units ?? undefined,
        mode: roster ? 'roster' : 'lines',
        ...(roster ? { players: players ?? [] } : {}),
      },
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
        {units && (
          <div>
            <button type="button" className="link-btn" aria-expanded={showUnits} onClick={() => setShowUnits(!showUnits)}>
              {showUnits ? '▾' : '▸'} {mode === 'roster' ? 'Line names' : 'Unit names'} for this game ({units.length} units)
            </button>
            {showUnits && <UnitsEditor units={units} onChange={setUnits} />}
          </div>
        )}
        {mode && <ModePicker legend="Track" value={mode} onChange={(m) => { setMode(m); setError(''); }} />}
        {mode === 'roster' && units && players && (
          <div>
            <button type="button" className="link-btn" aria-expanded={showRoster} onClick={() => setShowRoster(!showRoster)}>
              {showRoster ? '▾' : '▸'} Roster for this game ({players.filter((p) => positionGroup(p.position)).length} skaters)
            </button>
            {showRoster && <RosterEditor players={sanitizeRoster(players, units)} units={units} onChange={(p) => { setPlayers(p); setError(''); }} />}
          </div>
        )}
        {error && <p className="strip error" role="alert">{error}</p>}
        <button className="big-btn primary" disabled={busy || !loaded}>Create game</button>
      </form>
    </main>
  );
}
