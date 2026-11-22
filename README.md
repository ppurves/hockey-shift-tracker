# Hockey Shift Tracker

Offline-first iPhone web app (PWA) for tracking hockey line shifts and time on ice, live from the bench.

**App:** https://ppurves.github.io/hockey-shift-tracker/. Open it in Safari, then Share → Add to Home Screen.

- Live capture: one-tap line changes, Pause All, goals/penalties (auto-pause), Undo.
- Summary: per-unit stats and a shift timeline per period.
- Export: PDF report + CSVs via the share sheet (Mail), with download/mailto fallbacks.
- All data stays on the phone. Use Settings → Back up to keep a copy.

Development: `npm install`, `npm run dev`, `npm test`, `npm run test:e2e`. See [CLAUDE.md](CLAUDE.md) for the design and domain rules.
