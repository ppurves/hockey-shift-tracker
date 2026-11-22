import { describe, expect, it } from 'vitest';

// Guard: src/core must stay pure TypeScript (no React, no DOM/browser APIs, no
// wall-clock reads: time is injected via now()).
const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('src/core purity', () => {
  it('finds the core sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(5);
  });
  it.each(Object.entries(sources))('%s has no React/DOM imports or browser globals', (_file, raw) => {
    const code = stripComments(raw);
    expect(code).not.toMatch(/from ['"](react|react-dom|idb)/);
    expect(code).not.toMatch(/\b(window|document|navigator|localStorage|indexedDB|setInterval|setTimeout|Date\.now)\b/);
  });
});
