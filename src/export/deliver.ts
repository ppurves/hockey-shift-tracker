// Browser-side export: builds the files, then delivers them via the share
// sheet, or falls back to downloads + a mailto: draft (no attachments).

import {
  eventsCsv,
  fileBase,
  shiftsCsv,
  summaryCsv,
  summaryText,
  timelineSvg,
  type GameEvent,
  type GameMeta,
} from '../core';

export interface PreparedExport {
  base: string;
  files: File[];
  text: string;
  subject: string;
}

/** Rasterises an SVG string to a JPEG data URL (white background, 2x). JPEG keeps the PDF small. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the timeline image.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareExport(meta: GameMeta, events: readonly GameEvent[]): Promise<PreparedExport> {
  const base = fileBase(meta);
  const csv = (name: string, body: string) => new File([body], `${base}_${name}.csv`, { type: 'text/csv' });
  const tl = timelineSvg({ units: meta.units, events, period: 'all', periodLengthMs: meta.periodLengthMs, width: 1400, theme: 'light' });
  const timeline = await svgToPng(tl.svg, tl.width, tl.height).catch(() => null);
  const { buildPdf } = await import('./pdf'); // jsPDF is loaded only when exporting
  const pdf = buildPdf({ meta, events, timeline, generatedAt: Date.now() });
  const files = [
    new File([pdf.output('blob')], `${base}_report.pdf`, { type: 'application/pdf' }),
    csv('summary', summaryCsv(meta, events)),
    csv('shifts', shiftsCsv(meta, events)),
    csv('events', eventsCsv(meta, events)),
  ];
  const subject = `Hockey shifts ${meta.date} ${meta.homeAway === 'home' ? 'vs' : '@'} ${meta.opponent} (${meta.score.for}-${meta.score.against})`;
  return { base, files, text: summaryText(meta, events), subject };
}

export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadAll(files: File[]) {
  for (const f of files) {
    downloadFile(f, f.name);
    await new Promise((r) => setTimeout(r, 400)); // browsers drop rapid-fire downloads
  }
}

export function mailtoHref(to: string, subject: string, body: string): string {
  const addr = to.trim().replace(/[?&#\s]/g, '');
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type DeliveryPath = 'share' | 'cancelled' | 'download+mailto';
export interface DeliveryResult { path: DeliveryPath; message: string }

/**
 * "Email me the data". Must be called directly from a tap with files already
 * prepared: iOS only allows navigator.share() during a user gesture.
 */
export async function emailMeTheData(prep: PreparedExport, recipient: string): Promise<DeliveryResult> {
  if (canShareFiles(prep.files)) {
    try {
      await navigator.share({ files: prep.files, title: prep.subject, text: prep.text });
      return { path: 'share', message: 'Sent to the share sheet with the PDF and 3 CSV files attached. Choose Mail there.' };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return { path: 'cancelled', message: 'Share cancelled. Nothing was sent.' };
      }
      // Fall through to the fallback path (e.g. NotAllowedError).
    }
  }
  await downloadAll(prep.files);
  location.href = mailtoHref(recipient, prep.subject, `${prep.text}\n\n(Attachments not included: the 4 files were downloaded to this device.)`);
  return {
    path: 'download+mailto',
    message:
      'Share sheet with files is not available here. The 4 files were downloaded, and an email draft with the summary as text was opened. That email has NO attachments: attach the downloaded files yourself if needed.',
  };
}
