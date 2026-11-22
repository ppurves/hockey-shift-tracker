// Demo game generator: drives the real engine with a fake clock, so the demo
// log is exactly what live use would produce. Deterministic for a given seed.

import { GameEngine, type Command } from './engine';
import { newGameMeta } from './game';
import type { GameEvent, GameMeta, UnitDef } from './types';
import { DEFAULT_UNITS } from './units';

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Incident = 'goalFor' | 'goalAgainst' | 'penaltyFor' | 'penaltyAgainst';
/** Per period. A "+" entry happens 30–90 s after the entry before it (e.g. a PP goal). */
const INCIDENTS: (Incident | `${Incident}+`)[][] = [
  ['penaltyFor', 'goalFor', 'goalAgainst'],
  ['penaltyFor', 'goalFor+', 'penaltyAgainst', 'goalFor'],
  ['penaltyAgainst', 'goalAgainst+', 'penaltyFor', 'goalFor'],
];

export interface DemoGame {
  meta: GameMeta;
  events: GameEvent[];
}

/**
 * A realistic 3-period game: rotating forward lines (~35–55 s) and D pairs
 * (~45–70 s), whistles every minute or two (some with line changes while
 * paused), penalties with 2:00 power plays / penalty kills, and goals.
 *
 * Demo convention: "Penalty for" = called for us (on the opponent) → we go on
 * the PP; "Penalty against" = called against us → PK.
 */
export function generateDemoGame(opts: { id: string; startWall: number; seed?: number; units?: UnitDef[] }): DemoGame {
  const rand = rng(opts.seed ?? 20261121);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const units = opts.units ?? DEFAULT_UNITS;
  const ids = (g: UnitDef['group']) => units.filter((u) => u.group === g).map((u) => u.id);
  const F = ids('F'), D = ids('D'), PP = ids('PP'), PK = ids('PK');
  const periodMs = 15 * 60_000;

  let wall = opts.startWall;
  const g = new GameEngine(units, () => wall);
  const run = (cmd: Command) => {
    const r = g.dispatch(cmd);
    if (!r.ok) throw new Error(`demo: ${cmd.type} failed: ${r.reason}`);
  };
  const tapOn = (id: string | undefined) => { if (id && !g.state.active[id]) run({ type: 'tapUnit', unitId: id }); };
  const tapOff = (id: string | undefined) => { if (id && g.state.active[id]) run({ type: 'tapUnit', unitId: id }); };
  const stoppage = (lo = 20, hi = 60) => { wall += between(lo, hi) * 1000; };

  let fi = 0, di = 0, ppi = 0, pki = 0;
  for (let period = 1; period <= 3; period++) {
    run({ type: 'startPeriod', period });
    wall += period === 1 ? 60_000 : 15 * 60_000; // warm-up / intermission
    tapOn(F[fi % F.length]);
    tapOn(D[di % D.length]);
    run({ type: 'resume' });

    let nextF = between(35, 55) * 1000;
    let nextD = between(45, 70) * 1000;
    let nextWhistle = between(50, 110) * 1000;
    let specialEnds = 0; // game ms when the current PP/PK ends
    let special: string | undefined;
    // Scripted incidents for this period, at random times (sorted).
    const script: { kind: Incident; atMs: number }[] = [];
    {
      const entries = INCIDENTS[period - 1];
      const slot = (13 * 60 - 60) / entries.length;
      entries.forEach((k, i) => {
        const kind = k.replace('+', '') as Incident;
        const atMs = k.endsWith('+')
          ? script[script.length - 1].atMs + between(30, 90) * 1000
          : between(60 + i * slot, 60 + (i + 0.7) * slot) * 1000;
        script.push({ kind, atMs });
      });
    }

    while (g.gameMs() < periodMs) {
      const t = g.gameMs();
      const step = Math.min(nextF, nextD, nextWhistle, special ? specialEnds : Infinity, periodMs) - t;
      wall += Math.max(step, 0);
      const now = g.gameMs();
      if (now >= periodMs) break;

      if (special && now >= specialEnds) {
        tapOff(special);
        special = undefined;
      }
      if (now >= nextF) {
        fi++;
        tapOn(F[fi % F.length]);
        nextF = now + between(35, 55) * 1000;
      }
      if (now >= nextD) {
        di++;
        tapOn(D[di % D.length]);
        nextD = now + between(45, 70) * 1000;
      }
      if (now >= nextWhistle) {
        const incident = script[0] && now >= script[0].atMs && (script[0].kind.startsWith('goal') || !special)
          ? script.shift()!.kind : null;
        if (incident === 'goalFor' || incident === 'goalAgainst') {
          run({ type: incident }); // auto-pauses
          // A goal by the team with the extra skater ends the power play.
          if (special && (incident === 'goalFor') === special.startsWith('PP')) { tapOff(special); special = undefined; }
          stoppage(40, 80);
          fi++; tapOn(F[fi % F.length]); nextF = now + between(35, 55) * 1000;
        } else if (incident === 'penaltyFor' || incident === 'penaltyAgainst') {
          run({ type: incident }); // auto-pauses
          special = incident === 'penaltyFor' ? PP[ppi++ % PP.length] : PK[pki++ % PK.length];
          tapOn(special);
          specialEnds = now + 120_000;
          stoppage(30, 60);
        } else {
          run({ type: 'pause' });
          stoppage();
          if (rand() < 0.5) { fi++; tapOn(F[fi % F.length]); nextF = now + between(35, 55) * 1000; }
        }
        run({ type: 'resume' });
        nextWhistle = now + between(50, 110) * 1000;
      }
    }
    // Clamp to exactly the period length, then end the period.
    wall -= g.gameMs() - periodMs;
    run({ type: 'endPeriod' });
  }

  const meta = newGameMeta({ opponent: 'Demo Hawks', units: [...units] }, opts.id, opts.startWall);
  meta.score = { ...g.state.score };
  meta.status = 'final';
  meta.updatedAt = wall;
  return { meta, events: [...g.events] };
}
