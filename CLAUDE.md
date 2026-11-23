# Hockey Shift Tracker — project notes for Claude

Offline-first iPhone PWA for a bench coach to track line shifts / time on ice live, log goals and penalties, and export a report. **Reliability during live use beats visual polish. A missed tap or lost clock is the worst failure.**

Live URL: https://ppurves.github.io/hockey-shift-tracker/ (GitHub Pages, public repo, no secrets).

## Commands
| Task | Command |
|---|---|
| Dev server | `npm run dev` (http://localhost:5173/hockey-shift-tracker/) |
| Unit tests (Vitest, src/core) | `npm test` (watch: `npm run test:watch`) |
| Production build | `npm run build` → `dist/` |
| Preview build | `npm run preview` |
| E2E + installability check | `npm run test:e2e` (Playwright; first time: `npx playwright install chromium`) |
| Regenerate icons | `npm run icons` (assets/icon.svg → public/icons/*.png, needs sharp; PNGs are committed) |
| Deploy | `git push` to `main` → `.github/workflows/deploy.yml` runs unit + e2e tests, builds, publishes to Pages |

## Decided stack (don't re-litigate)
TypeScript, Vite, React, vite-plugin-pwa (Workbox, `registerType: 'prompt'`), IndexedDB via `idb`, Vitest, Playwright. Hand-written SVG timeline (no chart lib). jsPDF for PDF. Minimal deps. No backend, accounts, analytics, or network calls after first load. Node 26 (`.nvmrc`). Vite `base` = `/hockey-shift-tracker/`. Hash routing.

## Layout
- `src/core/` — **pure TypeScript only, no React/DOM imports.** Engine, derivations, stats, CSV, demo generator. All unit-tested with an injected `now()`.
- `src/ui/` — React components and hooks (`useGameSession` wraps the engine: rendering, wake lock, IndexedDB write-through persistence).
- `e2e/` — Playwright. `pwa.spec.ts` replaces Lighthouse's PWA audit (removed in Lighthouse 12): checks CDP `Page.getInstallabilityErrors` is empty and the app reloads offline.

## Engine API (src/core)
- `types.ts`: `UnitDef`, `GameEvent` (each has `seq`, `txn`, `period`, `gameMs`, `wallTs`), `Shift`, `UnitStats`.
- `units.ts`: `DEFAULT_UNITS`, `exclusionSet(group)`, which returns F / D / ST (PP and PK share ST).
- `engine.ts`:
  - `reduce`/`replay` is the pure reducer.
  - `gameMsAt(state, now)` gives the live clock.
  - `plan(events, state, units, cmd, now)` turns a command into new events and enforces all rules.
  - `undoLast` removes the last **txn**, so a line change, a period change or another multi-event action is undone in one step.
  - `describeTxn` gives the label for the Undo toast.
  - `GameEngine` is a thin wrapper that the UI hook uses: `dispatch`, `undo`, `peekUndo`, `gameMs`.
- `stats.ts`:
  - `deriveShifts(events, liveGameMs?)` returns every shift.
  - `computeStats(units, events, {period?, liveGameMs?})` gives per-unit stats, with `null` instead of dividing by zero.
  - `periodLengths` returns how long each period ran.
- `format.ts`: `formatClock` (m:ss) and `formatMaybe` (null → "—").
- `timeline.ts`: `timelineSvg({units, events, period | 'all', periodLengthMs, liveGameMs?, width?, theme?})` returns a standalone SVG string with inline colours. The summary screen and the PDF both use it.
  - Bars: F `#56b4e9`, D `#009e73`, PP `#e69f00`, PK `#cc79a7`.
  - Goals: ▲ for `#0072b2`, ▼ against `#d55e00`, with a white outline. Penalties are flags: filled for "for", hollow for "against".
- `demo.ts`: `generateDemoGame({id, startWall, seed?})` drives the real engine with a fake clock. It's deterministic. Demo convention only: "penalty for" means we go on the PP. The app itself never interprets penalties.
- `stats.ts` `toiCheck`: per period, F TOI and D TOI vs the game clock. It's shown on the summary.
- Goal events store an `onIce` snapshot and a `strength`. Stats credit GF/GA from that snapshot. A post-game edit that changes shifts must recompute the snapshot.
- `purity.test.ts` fails if src/core imports React/idb or uses DOM globals, `setInterval`/`setTimeout`, or `Date.now`.

## UI layer (src/ui, src/data)
- Routes are hash-based: `#/` (games), `#/new`, `#/game/:id`. A Home Screen launch has no hash, so `App` jumps straight into the in-progress (`status: 'live'`) game. This is the force-quit restore.
- `src/data/db.ts` is the IndexedDB layer: a `games` store (GameMeta) and an `events` store keyed `[gameId, seq]`. `appendEvents`/`removeEvents` update the events and the game record in one transaction.
- `useGameSession(gameId)`: the engine updates synchronously for instant UI, then each change is written through to IndexedDB. A failed write shows a red "NOT SAVED" strip.
- `useDisplayClock(running)` is a rAF re-render trigger (~4 Hz) used for display only. `useWakeLock(enabled)` re-acquires the lock on visibilitychange and on the next tap, and the screen shows a warning strip if it's unavailable. There is no NoSleep video fallback (iOS 18.4+ supports wake lock in Home Screen apps).
- `TapButton` acts on pointerdown. Keyboard activation goes through click with `detail === 0`. Don't add onClick handlers to tiles.
- The big bottom button changes with state: Start P*n* (confirm sheet) → Pause all → ▶ Resume. Period changes and End game live in the period menu (P1 ▾), behind a confirm sheet.
- The "Update available" banner only shows on the games list, never mid-game.

## Export, email, backup (src/export, core/csv.ts, core/backup.ts)
- Files are named `YYYY-MM-DD_vs_Opponent_{report.pdf,summary.csv,shifts.csv,events.csv}` (`fileBase`).
- CSVs have a UTF-8 BOM and CRLF line endings. Times are given as m:ss plus a seconds column. Text cells starting with `= + - @` get a `'` prefix to block formula injection.
- `buildPdf` (jsPDF, Letter landscape, 2 pages, `compress: true`):
  - Page 1: header, stats table, goals.
  - Page 2: full-game timeline (light-theme SVG → canvas → **JPEG**) and TOI by period.
  - It uses ASCII text only, because Helvetica has no glyphs for — ▲ ▼. The demo PDF is about 180 KB.
  - jsPDF is lazy-loaded, so it lives in its own chunk.
- **iOS share rule:** `navigator.share` must run inside the tap, with nothing slow before it. The Export screen builds the files **when it opens**, so "Email me the data" can call share straight away.
- Delivery paths, in order:
  1. Share sheet with all 4 files.
  2. If that's unavailable or fails (except when the user cancels): download the 4 files and open a `mailto:` draft with the text summary. That draft has no attachments, and the screen says so.
  
  The screen always states which path was used.
- Backup: one JSON file `{app, version, exportedAt, settings, games: [{meta, events}]}`. `parseBackup` validates it and gives readable errors. Restore replaces games with the same id and keeps the rest.
- IndexedDB v2 adds a `settings` store (key `'settings'`). `normalizeSettings` fills in defaults.

## Post-game edits (core/edit.ts, screens/Edit.tsx)
- Only for **final** games. Live games stay append-only with Undo.
- `editShift` / `addShift` / `deleteShift` / `addMarker` / `deleteMarker` return `{ok, events}` or `{ok:false, reason}`. Each one rewrites the log:
  - Sorted per period: periodStart first, periodEnd last, then by gameMs. An edited unitOff sorts first among ties and an edited unitOn last.
  - `seq` is renumbered.
  - Every goal's `onIce` and `strength` are recomputed by replaying the log. An unedited log comes out identical, which is tested.
- Validation: the end must be after the start, times must be within the period, and shifts can't overlap within an exclusion set (F, D, or PP+PK). Added events get `wallTs: 0`.
- Saving goes through `session.replaceLog` → `replaceEvents`, which writes the events and the game score in one transaction.

## Settings
Stored in the IndexedDB `settings` store:
- `recipientEmail`
- `defaultPeriodLengthMs`
- `audioTick` (Web Audio click, off by default; the iPhone's silent switch mutes it)
- `defaultUnits` (rename; add or remove units per group with `nextUnit`; minimum one F and one D)

New Game copies the default units, and they can be renamed for that game only. On Capture, more than 4 PP+PK units split into a PP row and a PK row.

## Accessibility
- Dynamic Type via `font: -apple-system-body`. Capture-screen text is capped with `min(rem, vw)` so tiles never overflow.
- `:focus-visible` rings, `prefers-reduced-motion` support, and aria labels on every tile and button.
- Goal markers differ by shape as well as colour (▲/▼, Okabe-Ito).

## How a new version reaches the phone
Push to main → Pages deploys in ~2 min. The app checks for a new service worker on launch and whenever it returns to the foreground (`reg.update()` on visibilitychange). When it's installed, an **"Update available, tap to reload"** banner appears. Tapping it activates the new version. If you don't tap, the old version keeps running (safe mid-game). To force it, close the app fully and reopen it twice.

## iPhone PWA rules
- Manifest: standalone, `orientation: any`, theme `#1f4e79`, icons 192/512/maskable + 180 apple-touch-icon; apple-mobile-web-app-* meta tags; `viewport-fit=cover` + `env(safe-area-inset-*)`.
- SW precaches everything; show "Ready for offline use".
- Capture screen: no text selection, no long-press callout, `touch-action: manipulation`, `overscroll-behavior: none`. Tiles respond on pointerdown. Tap targets ≥ 60 px. Works one-handed, gloves, portrait + landscape.
- Wake Lock during a live game, re-acquired on `visibilitychange`; visible warning if unavailable (iOS < 18.4 standalone is unreliable → NoSleep-style muted video fallback).
- `navigator.storage.persist()` on first launch. Backup/Restore JSON because iOS may still evict storage.
- No haptics on iOS: instant visual press state + optional audio tick (setting, off by default).

## Domain rules (must be exactly right)
Units are data (array), groups: **F** (Line 1–3), **D** (D 1–2), **PP** (PP 1–2), **PK** (PK 1–2).
- Max one active unit per group. **PP and PK are mutually exclusive**: tapping a PK while a PP is on closes the PP first, and the reverse also applies (one "special teams" exclusion set).
- F, D, and special teams run independently and concurrently. PP/PK never auto-clear F/D lines (v1).
- Tap inactive unit → on (closes the other active unit in its exclusion set at the same timestamp). Tap active → off.
- Active tiles: strong fill + running timer. Inactive tiles show last shift length.
- Line/D tiles only (not PP/PK): inactive tiles show "off m:ss", the game-clock rest since the last shift (`restMsAt`; counts across periods, never paused time or intermissions). An active shift over 1:30 (`LONG_SHIFT_MS`) turns the tile red instead of yellow. Rest over 5:00 (`LONG_REST_MS`) turns the tile text red.
- Stats include `avgRestMs`: the mean gap between consecutive shifts. A gap belongs to the period in which the next shift starts. Shown as "Rest" on the summary, "Avg rest" in the PDF and summary.csv.

Clocks:
- One game clock per period, counts up from 0:00, advances only while running. Period length (default 15:00, per game) is for graph scale and an optional "period over" alert only. It never stops the clock.
- Shift time = game-clock time while on ice. Paused time is never counted.
- Pause All freezes clock + all shifts; active units stay active; resume continues the same shift (not a new shift).
- Line changes while paused are allowed: the new shift starts at the frozen game time, stays at 0:00 until resume, and counts as 1 shift.
- Period start/switch/End Period: close all open shifts at current game time → pause → new period at 0:00 paused awaiting Resume. Guarded by confirm/long-press.
- **Never** time with setInterval counters. Game clock = `accumulatedMs + (running ? now() - runningSince : 0)` using wall-clock `Date.now()`. Display refresh (rAF) is cosmetic. After kill/relaunch, replay the log; elapsed wall time since the last event counts only if the clock was running.

Events and stats:
- Append-only event log is the source of truth: periodStart, periodEnd, pause, resume, unitOn, unitOff, goalFor, goalAgainst, penaltyFor, penaltyAgainst. Each has period, gameMs, wallTs. Shifts and stats are pure derivations from it (Undo = drop last event(s)).
- Goals snapshot on-ice units; each gets GF/GA → +/-. Goal strength EV/PP/PK from the active PP/PK unit.
- Penalties: count + timeline marker only; never auto-start PP/PK.
- **Goals and penalties auto-pause the clock** (play stops). The goal/penalty event and the `pause` share one txn, so Undo reverts both and the clock runs as if nothing happened. If the clock is already paused, no extra pause is added.
- Per-unit stats (overall + per period): shifts, TOI, avg, longest, shortest, GF, GA, +/-. Averages show "—" with 0 shifts.
- Sanity check: per group, sum of TOI ≤ game clock (equal if a unit of that group was always on). Do not sum across groups.
- Persist every event to IndexedDB immediately (write-through).

Export: summary.csv, shifts.csv, events.csv, PDF (header + stats + timeline PNG). Web Share with files → fallbacks: download + mailto (text, no attachments, and the UI says so). Always tell the user which path was used. Filenames `YYYY-MM-DD_vs_Opponent_*`.

## Working agreement
Milestones M0–M5. After each one: build, test, commit, deploy, then stop with a 5-line summary and wait for "next". Small commits. Flag iOS limitations instead of silently changing requirements.
