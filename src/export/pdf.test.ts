import { describe, expect, it } from 'vitest';
import { generateDemoGame } from '../core';
import { buildPdf } from './pdf';

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('buildPdf', () => {
  const demo = generateDemoGame({ id: 'demo', startWall: Date.UTC(2026, 10, 21, 19) });

  it('builds a 2-page PDF with header, stats and the timeline image', () => {
    const doc = buildPdf({ ...demo, timeline: { dataUrl: PNG, width: 1400, height: 360 }, generatedAt: 0, compress: false });
    expect(doc.getNumberOfPages()).toBe(2);
    const raw = doc.output();
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('vs Demo Hawks');
    expect(raw).toContain('Line 1');
    expect(raw).toContain('/Subtype /Image');
    expect(raw).not.toContain('—'); // ASCII-safe for Helvetica
  });

  it('compresses by default', () => {
    const doc = buildPdf({ ...demo, timeline: null, generatedAt: 0 });
    expect(doc.output()).toContain('/FlateDecode');
  });

  it('works for an empty game without a timeline', () => {
    const doc = buildPdf({ meta: demo.meta, events: [], timeline: null, generatedAt: 0, compress: false });
    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.output()).toContain('None.');
  });
});
