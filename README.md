# Hockey Shift Tracker

Offline-first iPhone web app (PWA) for tracking hockey line shifts and time on ice, live from the bench.

**App:** https://ppurves.github.io/hockey-shift-tracker/. Open it in Safari, then Share → Add to Home Screen.

- Live capture: one-tap line changes, Pause All, goals/penalties (auto-pause), Undo.
- Summary: per-unit stats and a shift timeline per period.
- Roster mode (optional): track individual players by number. Tap a line to change the whole line, or tap a number to swap one player. Reports show time on ice per player, grouped under each line. Goalie buttons track who is in net.
- Penalties start a power play or penalty kill on the game clock (default 2:00). A penalty ends when its time runs out or on a power-play goal. The penalized player sits in the box and can't be selected until it ends. The timeline shows PP/PK on one game-condition lane.
- Export: PDF report + CSVs via the share sheet (Mail), with download/mailto fallbacks.
- All data stays on the phone. Use Settings → Back up to keep a copy.

Development: `npm install`, `npm run dev`, `npm test`, `npm run test:e2e`. See [CLAUDE.md](CLAUDE.md) for the design and domain rules.
