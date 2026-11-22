import { useEffect, useState } from 'react';

/** Minimal hash router: "#/game/abc" -> ["game", "abc"]. */
export function useHashRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function navigate(path: string) {
  location.hash = `#/${path}`;
}
