import { useEffect, useState } from 'react';
import type { GameMeta } from '../../core';
import { deleteGame, listGames } from '../../data/db';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { navigate } from '../hooks/useHashRoute';

export function Home({ status }: { status: React.ReactNode }) {
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [toDelete, setToDelete] = useState<GameMeta | null>(null);
  const refresh = () => listGames().then(setGames);
  useEffect(() => { void refresh(); }, []);

  return (
    <main className="page">
      <h1>Hockey Shift Tracker</h1>
      {status}
      <button className="big-btn primary" onClick={() => navigate('new')}>+ New game</button>
      <h2>Games</h2>
      {games === null ? <p className="muted">Loading…</p> : games.length === 0 ? (
        <p className="muted">No games yet.</p>
      ) : (
        <ul className="game-list">
          {games.map((g) => (
            <li key={g.id}>
              <button className="game-row" onClick={() => navigate(`game/${g.id}`)}>
                <span className="g-date">{g.date}</span>
                <span className="g-opp">{g.homeAway === 'home' ? 'vs' : '@'} {g.opponent}</span>
                <span className="g-score">{g.score.for}–{g.score.against}</span>
                <span className={`g-status ${g.status}`}>{g.status === 'live' ? 'In progress' : 'Final'}</span>
              </button>
              <button className="g-del" aria-label={`Delete game vs ${g.opponent}`} onClick={() => setToDelete(g)}>🗑</button>
            </li>
          ))}
        </ul>
      )}
      {toDelete && (
        <ConfirmSheet
          title={`Delete game vs ${toDelete.opponent}?`}
          message={`${toDelete.date}, ${toDelete.score.for}–${toDelete.score.against}. This can't be undone.`}
          actions={[{ label: 'Delete game', tone: 'danger', onConfirm: async () => { await deleteGame(toDelete.id); setToDelete(null); void refresh(); } }]}
          onCancel={() => setToDelete(null)}
        />
      )}
    </main>
  );
}
