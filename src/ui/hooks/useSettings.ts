import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../core';
import { getSettings, putSettings } from '../../data/db';

/** App settings from IndexedDB. `loaded` is false until the first read. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const current = useRef<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    getSettings().then(
      (s) => { current.current = s; setSettings(s); setLoaded(true); },
      () => setLoaded(true),
    );
  }, []);
  const save = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setSettings(next);
    await putSettings(next);
  }, []);
  return { settings, loaded, save };
}
