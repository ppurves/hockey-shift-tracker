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
- Goal events store an `onIce` snapshot and a `strength`. Stats credit GF/GA from that snapshot. A post-game edit that changes shifts must recompute the snapshot.
- `purity.test.ts` fails if src/core imports React/idb or uses DOM globals, `setInterval`/`setTimeout`, or `Date.now`.

## How a new version reaches the phone
Push to main → Pages deploys in ~2 min. On the next launch the app checks for a new service worker in the background. When it's installed, an **"Update available, tap to reload"** banner appears. Tapping it activates the new version. If you don't tap, the old version keeps running (safe mid-game). To force it, close the app fully and reopen it twice.

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
- Per-unit stats (overall + per period): shifts, TOI, avg, longest, shortest, GF, GA, +/-. Averages show "—" with 0 shifts.
- Sanity check: per group, sum of TOI ≤ game clock (equal if a unit of that group was always on). Do not sum across groups.
- Persist every event to IndexedDB immediately (write-through).

Export: summary.csv, shifts.csv, events.csv, PDF (header + stats + timeline PNG). Web Share with files → fallbacks: download + mailto (text, no attachments, and the UI says so). Always tell the user which path was used. Filenames `YYYY-MM-DD_vs_Opponent_*`.

## Working agreement
Milestones M0–M5. After each one: build, test, commit, deploy, then stop with a 5-line summary and wait for "next". Small commits. Flag iOS limitations instead of silently changing requirements.
