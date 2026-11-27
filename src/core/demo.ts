// Demo game generator: drives the real engine with a fake clock, so the demo
// log is exactly what live use would produce. Deterministic for a given seed.

import { boxPenalty, GameEngine, type Command } from './engine';
import { newGameMeta } from './game';
import { rosterLines, trackedUnits } from './roster';
import type { GameEvent, GameMeta, Player, UnitDef } from './types';
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

/** Demo roster for DEFAULT_UNITS: three lines + an extra forward, two pairs + an extra D, two goalies. */
export const DEMO_ROSTER: Player[] = [
  ['9', 'Avery', 'F', 'L1'], ['17', 'Brooks', 'F', 'L1'], ['22', 'Cole', 'F', 'L1'],
  ['11', 'Diaz', 'F', 'L2'], ['14', 'Ellis', 'F', 'L2'], ['19', 'Fox', 'F', 'L2'],
  ['8', 'Grant', 'F', 'L3'], ['15', 'Hayes', 'F', 'L3'], ['21', 'Ivers', 'F', 'L3'],
  ['28', 'Jones', 'F', null],
  ['2', 'Kerr', 'D', 'D1'], ['4', 'Lowe', 'D', 'D1'],
  ['5', 'Moss', 'D', 'D2'], ['7', 'Nash', 'D', 'D2'],
  ['3', 'Ortiz', 'D', null],
  ['30', 'Price', 'G', null], ['31', 'Quinn', 'G', null],
].map(([number, name, position, lineId], i) => ({ id: `p${i + 1}`, number, name, position, lineId }) as Player);

export interface DemoGame {
  meta: GameMeta;
  events: GameEvent[];
}

/**
 * A realistic 3-period game: rotating forward lines (~35–55 s) and D pairs
 * (~45–70 s), whistles every minute or two (some with line changes while
 * paused), 2:00 penalties (power plays / penalty kills), and goals.
 */
export function generateDemoGame(opts: {
  id: string;
  startWall: number;
  seed?: number;
  units?: UnitDef[];
  /** Roster mode with this roster (DEMO_ROSTER fits DEFAULT_UNITS). */
  players?: Player[];
}): DemoGame {
  const rand = rng(opts.seed ?? 20261121);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const units = opts.units ?? DEFAULT_UNITS;
  const meta = newGameMeta(
    { opponent: 'Demo Hawks', units: [...units], ...(opts.players ? { mode: 'roster' as const, players: opts.players } : {}) },
    opts.id,
    opts.startWall,
  );
  const roster = !!opts.players;
  const tracked = trackedUnits(meta);
  const ids = (g: UnitDef['group']) => units.filter((u) => u.group === g).map((u) => u.id);
  const F = ids('F'), D = ids('D');
  const goalie = tracked.find((u) => u.group === 'G');
  const extras = (g: 'F' | 'D') => tracked.filter((u) => u.kind === 'player' && u.group === g && !u.lineId);
  const periodMs = 15 * 60_000;

  let wall = opts.startWall;
  const g = new GameEngine(tracked, () => wall, [], rosterLines(meta));
  const run = (cmd: Command) => {
    const r = g.dispatch(cmd);
    if (!r.ok) throw new Error(`demo: ${cmd.type} failed: ${r.reason}`);
  };
  const lineIsOn = (id: string) => {
    const members = tracked.filter((u) => u.lineId === id);
    return members.length > 0 && members.every((u) => g.state.active[u.id]);
  };
  /** Roster: a line change, and now and then the extra skater takes one member's place. */
  const lineOn = (id: string | undefined) => {
    if (!id || lineIsOn(id)) return;
    const group = units.find((u) => u.id === id)!.group as 'F' | 'D';
    const extra = extras(group)[0];
    if (extra && rand() < 0.2) {
      // Send the line out with the extra in place of one player, tapping players one by one.
      const members = tracked.filter((u) => u.lineId === id);
      const out = members[Math.floor(rand() * members.length)];
      const want = new Set([...members.filter((m) => m !== out).map((m) => m.id), extra.id]);
      for (const u of tracked) {
        const wanted = want.has(u.id) && !boxPenalty(g.state, u.id);
        if (u.kind === 'player' && u.group === group && !!g.state.active[u.id] !== wanted) run({ type: 'tapUnit', unitId: u.id });
      }
    } else {
      run({ type: 'tapLine', lineId: id });
    }
  };
  const tapOn = (id: string | undefined) => {
    if (roster) lineOn(id);
    else if (id && !g.state.active[id]) run({ type: 'tapUnit', unitId: id });
  };
  const stoppage = (lo = 20, hi = 60) => { wall += between(lo, hi) * 1000; };

  let fi = 0, di = 0;
  for (let period = 1; period <= 3; period++) {
    run({ type: 'startPeriod', period }); // from P2 on, the goalie goes back in net by itself
    if (goalie && period === 1) run({ type: 'tapUnit', unitId: goalie.id });
    wall += period === 1 ? 60_000 : 15 * 60_000; // warm-up / intermission
    tapOn(F[fi % F.length]);
    tapOn(D[di % D.length]);
    run({ type: 'resume' });

    let nextF = between(35, 55) * 1000;
    let nextD = between(45, 70) * 1000;
    let nextWhistle = between(50, 110) * 1000;
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
      const step = Math.min(nextF, nextD, nextWhistle, periodMs) - t;
      wall += Math.max(step, 0);
      const now = g.gameMs();
      if (now >= periodMs) break;
      g.settle(); // a penalty that ran out ends the PP/PK
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
        const incident = script[0] && now >= script[0].atMs && (script[0].kind.startsWith('goal') || !g.state.penalties.length)
          ? script.shift()!.kind : null;
        if (incident === 'goalFor' || incident === 'goalAgainst') {
          run({ type: incident }); // auto-pauses; a power-play goal ends the penalty
          stoppage(40, 80);
          fi++; tapOn(F[fi % F.length]); nextF = now + between(35, 55) * 1000;
        } else if (incident === 'penaltyFor' || incident === 'penaltyAgainst') {
          // Roster: one of our forwards on the ice goes to the box.
          const onF = tracked.filter((u) => u.kind === 'player' && u.group === 'F' && g.state.active[u.id]);
          const boxed = roster && incident === 'penaltyAgainst' ? onF[Math.floor(rand() * onF.length)] : undefined;
          run({ type: incident, lengthMs: 120_000, ...(boxed ? { playerId: boxed.id } : {}) }); // auto-pauses
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

  meta.score = { ...g.state.score };
  meta.status = 'final';
  meta.updatedAt = wall;
  return { meta, events: [...g.events] };
}
