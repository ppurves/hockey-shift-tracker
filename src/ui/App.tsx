import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { listGames } from '../data/db';
import { navigate, useHashRoute } from './hooks/useHashRoute';
import { useGameSession } from './hooks/useGameSession';
import { Capture } from './screens/Capture';
import { Home } from './screens/Home';
import { Summary } from './screens/Summary';
import { Export } from './screens/Export';
import { SettingsScreen } from './screens/Settings';
import { NewGame } from './screens/NewGame';

type PersistState = 'unknown' | 'granted' | 'denied' | 'unsupported';

function usePersistentStorage(): PersistState {
  const [state, setState] = useState<PersistState>('unknown');
  useEffect(() => {
    const s = navigator.storage;
    if (!s?.persist) { setState('unsupported'); return; }
    s.persisted()
      .then((already) => (already ? true : s.persist()))
      .then((ok) => setState(ok ? 'granted' : 'denied'))
      .catch(() => setState('denied'));
  }, []);
  return state;
}

function GameRoute({ id, view }: { id: string; view?: string }) {
  const session = useGameSession(id);
  if (session === 'loading') return <main className="page"><p className="muted">Loading game…</p></main>;
  if (session === 'missing') {
    return (
      <main className="page">
        <p>Game not found.</p>
        <button className="big-btn" onClick={() => navigate('')}>Back to games</button>
      </main>
    );
  }
  if (view === 'export') return <Export session={session} />;
  if (view === 'summary' || session.meta.status === 'final') return <Summary session={session} />;
  return <Capture session={session} />;
}

export function App() {
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [controlled, setControlled] = useState(!!navigator.serviceWorker?.controller);
  const persist = usePersistentStorage();
  const route = useHashRoute();
  const checkedResume = useRef(false);

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onChange = () => setControlled(!!sw.controller);
    sw.addEventListener('controllerchange', onChange);
    return () => sw.removeEventListener('controllerchange', onChange);
  }, []);

  // A Home Screen app always launches at start_url (no hash), so after a
  // force-quit jump straight back into the in-progress game.
  useEffect(() => {
    if (checkedResume.current) return;
    checkedResume.current = true;
    if (route.length) return;
    void listGames().then((games) => {
      const live = games.find((g) => g.status === 'live');
      if (live) navigate(`game/${live.id}`);
    });
  }, [route]);

  const ready = offlineReady || controlled;
  const status = (
    <>
      {needRefresh && (
        <button className="banner banner-update" onClick={() => updateServiceWorker(true)}>
          Update available, tap to reload
        </button>
      )}
      <ul className="status">
        <li data-testid="offline-status" className={ready ? 'ok' : 'pending'}>
          {ready ? '● Ready for offline use' : '○ Preparing offline cache…'}
        </li>
        <li className={persist === 'granted' ? 'ok' : 'pending'}>Durable storage: {persist}</li>
        <li className="muted small">Build {__BUILD_TIME__.replace('T', ' ').slice(0, 16)} UTC</li>
      </ul>
    </>
  );

  if (route[0] === 'new') return <NewGame />;
  if (route[0] === 'settings') return <SettingsScreen />;
  if (route[0] === 'game' && route[1]) return <GameRoute key={route[1]} id={route[1]} view={route[2]} />;
  return <Home status={status} />;
}
