import { useRef, useState } from 'react';
import { DEFAULT_UNITS, DEMO_ROSTER, formatClock, generateDemoGame, isoDate, sanitizeRoster, makeBackup, MAX_THRESHOLD_MS, parseBackup, parseClock, type Backup } from '../../core';
import { appendEvents, exportAll, importGames, putSettings } from '../../data/db';
import { canShareFiles, downloadFile } from '../../export/deliver';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { UnitsEditor } from '../components/UnitsEditor';
import { ModePicker, RosterEditor } from '../components/RosterEditor';
import { navigate } from '../hooks/useHashRoute';
import { useSettings } from '../hooks/useSettings';

export function SettingsScreen() {
  const { settings, loaded, save } = useSettings();
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const backup = async () => {
    const b = makeBackup(await exportAll(), settings, Date.now());
    const name = `hockey-shift-tracker-backup-${isoDate(Date.now())}.json`;
    const file = new File([JSON.stringify(b)], name, { type: 'application/json' });
    if (canShareFiles([file])) {
      try {
        await navigator.share({ files: [file], title: 'Hockey Shift Tracker backup' });
        setMsg({ text: `Backup of ${b.games.length} games sent to the share sheet. Save it to Files or email it to yourself.`, tone: 'ok' });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') { setMsg({ text: 'Backup cancelled.', tone: 'error' }); return; }
      }
    }
    downloadFile(file, name);
    setMsg({ text: `Backup of ${b.games.length} games downloaded as ${name}.`, tone: 'ok' });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPending(parseBackup(await f.text()));
    } catch (e) {
      setMsg({ text: `Restore failed: ${(e as Error).message}`, tone: 'error' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const restore = async (b: Backup) => {
    setPending(null);
    await importGames(b.games);
    await putSettings(b.settings);
    setMsg({ text: `Restored ${b.games.length} games and settings.`, tone: 'ok' });
    setTimeout(() => location.reload(), 800);
  };

  const loadDemo = async (roster = false) => {
    const { meta, events } = generateDemoGame({
      id: crypto.randomUUID(),
      startWall: Date.now() - 3 * 3600_000,
      ...(roster ? { units: DEFAULT_UNITS, players: DEMO_ROSTER } : {}),
    });
    await appendEvents(meta, events);
    navigate(`game/${meta.id}/summary`);
  };

  if (!loaded) return <main className="page"><p className="muted">Loading…</p></main>;

  return (
    <main className="page settings">
      <button className="link-btn" onClick={() => navigate('')}>‹ Games</button>
      <h1>Settings</h1>

      <section className="form">
        <label>Default email recipient
          <input
            type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
            defaultValue={settings.recipientEmail}
            onBlur={(e) => void save({ recipientEmail: e.target.value.trim() })}
          />
        </label>
        <label>Default period length (minutes)
          <input
            type="number" inputMode="decimal" min="1" max="60" step="0.5"
            defaultValue={settings.defaultPeriodLengthMs / 60_000}
            onBlur={(e) => {
              const m = Number(e.target.value);
              if (m > 0 && m <= 60) void save({ defaultPeriodLengthMs: Math.round(m * 60_000) });
            }}
          />
        </label>
        <ThresholdInput
          label="Long shift: tile turns red after (m:ss)"
          testId="long-shift"
          valueMs={settings.longShiftMs}
          onSave={(longShiftMs) => void save({ longShiftMs })}
        />
        <ThresholdInput
          label="Long rest: tile text turns red after (m:ss)"
          testId="long-rest"
          valueMs={settings.longRestMs}
          onSave={(longRestMs) => void save({ longRestMs })}
        />
        <p className="muted small">Both apply to lines and D pairs only, and use game-clock time.</p>
        <label className="toggle">
          <input type="checkbox" checked={settings.audioTick} onChange={(e) => void save({ audioTick: e.target.checked })} />
          <span>Audio tick on taps <small className="muted">(off by default; the silent switch mutes it)</small></span>
        </label>
      </section>

      <h2>Default units</h2>
      <p className="muted small">Used for new games. Rename (e.g. “Smith-Jones-Lee”) or add Line 4 / a third D pair. Each game can still rename its own units.</p>
      <UnitsEditor units={settings.defaultUnits} allowAddRemove onChange={(defaultUnits) => void save({ defaultUnits })} />

      <h2>Roster</h2>
      <p className="muted small">Track individual players instead of whole lines. Each new game copies this roster; you can change it for one game when you create it.</p>
      <ModePicker legend="New games track" value={settings.defaultMode} onChange={(defaultMode) => void save({ defaultMode })} />
      <RosterEditor
        players={sanitizeRoster(settings.defaultRoster, settings.defaultUnits)}
        units={settings.defaultUnits}
        onChange={(defaultRoster) => void save({ defaultRoster })}
      />

      <h2>Back up &amp; restore</h2>
      <p className="muted small">iOS can clear website storage in rare cases. Back up after each game and keep the file in Files or email.</p>
      <button className="big-btn primary" onClick={() => void backup()}>Back up all data</button>
      <button className="big-btn" onClick={() => fileRef.current?.click()}>Restore from backup…</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="restore-input" onChange={(e) => void onFile(e.target.files?.[0])} />
      {msg && <p className={`strip ${msg.tone === 'ok' ? 'okstrip' : 'error'}`} role="status">{msg.text}</p>}

      <h2>Demo</h2>
      <button className="big-btn" onClick={() => void loadDemo()}>Load demo game</button>
      <button className="big-btn" onClick={() => void loadDemo(true)}>Load roster demo game</button>

      {pending && (
        <ConfirmSheet
          title={`Restore ${pending.games.length} games?`}
          message={`Backup from ${pending.exportedAt.slice(0, 16).replace('T', ' ')}. Games with the same id are replaced; other games on this phone are kept. Settings are replaced.`}
          actions={[{ label: 'Restore', onConfirm: () => void restore(pending) }]}
          onCancel={() => setPending(null)}
        />
      )}
    </main>
  );
}

/** m:ss input that saves on blur; an invalid entry reverts to the saved value. */
function ThresholdInput({ label, testId, valueMs, onSave }: { label: string; testId: string; valueMs: number; onSave: (ms: number) => void }) {
  return (
    <label>{label}
      <input
        key={valueMs}
        type="text" autoComplete="off" placeholder="1:30"
        data-testid={testId}
        defaultValue={formatClock(valueMs)}
        onBlur={(e) => {
          const ms = parseClock(e.target.value);
          if (ms !== null && ms > 0 && ms <= MAX_THRESHOLD_MS) {
            e.target.value = formatClock(ms);
            if (ms !== valueMs) onSave(ms);
          } else {
            e.target.value = formatClock(valueMs);
          }
        }}
      />
    </label>
  );
}
