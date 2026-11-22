import { useEffect, useState } from 'react';
import { type GameEvent } from '../../core';
import {
  canShareFiles,
  downloadAll,
  downloadFile,
  emailMeTheData,
  mailtoHref,
  type DeliveryResult,
  type PreparedExport,
} from '../../export/deliver';
import { navigate } from '../hooks/useHashRoute';
import type { GameSession } from '../hooks/useGameSession';
import { useSettings } from '../hooks/useSettings';

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export function Export({ session }: { session: GameSession }) {
  const { meta, engine } = session;
  const { settings } = useSettings();
  const [prep, setPrep] = useState<PreparedExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryResult | null>(null);

  // Build the files up front: iOS only allows the share sheet during the tap
  // itself, so nothing slow may happen between the tap and navigator.share().
  useEffect(() => {
    let cancelled = false;
    import('../../export/deliver')
      .then(({ prepareExport }) => prepareExport(meta, engine.events as GameEvent[]))
      .then((p) => !cancelled && setPrep(p))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [meta, engine.events, engine.events.length]);

  const shareable = prep ? canShareFiles(prep.files) : false;
  const mailto = prep ? mailtoHref(settings.recipientEmail, prep.subject, prep.text) : '#';

  return (
    <main className="page export">
      <button className="link-btn" onClick={() => navigate(`game/${meta.id}/summary`)}>‹ Summary</button>
      <h1>Export &amp; email</h1>
      <p className="muted">{meta.date} {meta.homeAway === 'home' ? 'vs' : '@'} {meta.opponent}, {meta.score.for}–{meta.score.against}</p>

      {error && <p className="strip error" role="alert">Could not build the export: {error}</p>}
      {!prep && !error && <p className="muted" data-testid="export-preparing">Preparing PDF and CSV files…</p>}

      {prep && (
        <>
          <ul className="file-list" data-testid="export-files">
            {prep.files.map((f) => (
              <li key={f.name}>
                <span>{f.name}</span>
                <button className="small-btn" onClick={() => downloadFile(f, f.name)}>Save · {kb(f.size)}</button>
              </li>
            ))}
          </ul>

          <button
            className="big-btn primary"
            data-testid="email-me"
            onClick={async () => setResult(await emailMeTheData(prep, settings.recipientEmail))}
          >
            ✉ Email me the data
          </button>
          <p className="muted small">
            {shareable
              ? 'Opens the share sheet with the PDF and 3 CSVs attached. Choose Mail.'
              : 'The share sheet with files is not available in this browser. This will download the 4 files and open an email draft with the summary as text (no attachments).'}
          </p>

          {result && (
            <p className={`strip ${result.path === 'cancelled' ? 'info' : result.path === 'share' ? 'okstrip' : 'warn'}`} role="status" data-testid="delivery-result">
              <strong>{result.path === 'share' ? 'Path used: share sheet.' : result.path === 'cancelled' ? 'Cancelled.' : 'Path used: download + email text.'}</strong>{' '}
              {result.message}
            </p>
          )}

          <h2>Other options</h2>
          <button className="big-btn" onClick={() => void downloadAll(prep.files)}>Download all 4 files</button>
          <a className="big-btn as-link" href={mailto}>Email summary as text only (no attachments)</a>
          {!settings.recipientEmail && (
            <p className="muted small">Tip: set a default recipient in <a href="#/settings">Settings</a>.</p>
          )}
        </>
      )}
    </main>
  );
}
