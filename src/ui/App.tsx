import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_NAME } from '../core';

type PersistState = 'unknown' | 'granted' | 'denied' | 'unsupported';

function usePersistentStorage(): PersistState {
  const [state, setState] = useState<PersistState>('unknown');
  useEffect(() => {
    const s = navigator.storage;
    if (!s?.persist) {
      setState('unsupported');
      return;
    }
    s.persisted()
      .then((already) => (already ? true : s.persist()))
      .then((ok) => setState(ok ? 'granted' : 'denied'))
      .catch(() => setState('denied'));
  }, []);
  return state;
}

export function App() {
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [controlled, setControlled] = useState(!!navigator.serviceWorker?.controller);
  const persist = usePersistentStorage();

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onChange = () => setControlled(!!sw.controller);
    sw.addEventListener('controllerchange', onChange);
    return () => sw.removeEventListener('controllerchange', onChange);
  }, []);

  const ready = offlineReady || controlled;

  return (
    <main className="shell">
      {needRefresh && (
        <button className="banner banner-update" onClick={() => updateServiceWorker(true)}>
          Update available, tap to reload
        </button>
      )}
      <h1>{APP_NAME}</h1>
      <p className="muted">Milestone 0: installable offline shell.</p>
      <ul className="status">
        <li data-testid="offline-status" className={ready ? 'ok' : 'pending'}>
          {ready ? '● Ready for offline use' : '○ Preparing offline cache…'}
        </li>
        <li className={persist === 'granted' ? 'ok' : 'pending'}>
          Durable storage: {persist}
        </li>
        <li className="muted">Build: {__BUILD_TIME__.replace('T', ' ').slice(0, 16)} UTC</li>
      </ul>
    </main>
  );
}
