import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../../core';
import { getSettings, putSettings } from '../../data/db';

/** App settings from IndexedDB. `loaded` is false until the first read. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    getSettings().then((s) => { setSettings(s); setLoaded(true); }, () => setLoaded(true));
  }, []);
  const save = useCallback(async (patch: Partial<Settings>) => {
    let next!: Settings;
    setSettings((prev) => (next = { ...prev, ...patch }));
    await putSettings(next);
  }, []);
  return { settings, loaded, save };
}
