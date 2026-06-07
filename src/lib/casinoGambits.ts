// Casino gambit deck — definitions and logic.
// Ported from the prototype's casino/gambits.js (AI pick logic omitted).
// Gambits are offered after a player locks their card hand. Playing one shifts
// the shared casinoStats for the entire cohort.

import type { CasinoStats } from '../types';
import { shuffle } from './casinoData';

export type GambitStatKey = 'release' | 'collect' | 'hint';
export type GambitKind    = 'bonus' | 'penalty';
export type GambitSize    = 'small' | 'big';

export interface GambitStatDef {
  key:        GambitStatKey;
  label:      string;  // e.g. "Release Odds"
  short:      string;  // e.g. "Release"
  betterWhen: 'up' | 'down';
  unit:       string;
}

export interface GambitDef {
  defId:      string;    // stable identifier used for offer deduplication
  stat:       GambitStatKey;
  delta:      number;    // how much to adjust the stat (may be fractional for hint)
  size:       GambitSize;
  copies:     number;    // copies in the gambit deck
  goldCost:   number;    // deducted from player gold (bonus cards only)
  xp:         number;    // added to casinoStats.xp (penalty cards only)
  pot:        number;    // added to mission.pot (penalty cards only)
  kind:       GambitKind;
  deltaLabel: string;    // e.g. "+2%" or "−5%"
  statLabel:  string;    // short stat name
  statFull:   string;    // full stat name
}

// A physical gambit card instance in a shuffled deck
export interface GambitCard extends GambitDef {
  uid: string;
}

export interface GambitResult {
  stats:    CasinoStats;
  potAdd:   number;
  goldCost: number;
  xp:       number;
}

export const GAMBIT_STATS: Readonly<Record<GambitStatKey, GambitStatDef>> = {
  release: { key: 'release', label: 'Release Odds', short: 'Release', betterWhen: 'up',   unit: '%' },
  collect: { key: 'collect', label: 'Collect Odds', short: 'Collect', betterWhen: 'up',   unit: '%' },
  hint:    { key: 'hint',    label: 'Hint Cost',    short: 'Hint',    betterWhen: 'down', unit: '%' },
};

function isBonus(stat: GambitStatKey, delta: number): boolean {
  return GAMBIT_STATS[stat].betterWhen === 'up' ? delta > 0 : delta < 0;
}

function fmtDelta(d: number): string {
  return (d > 0 ? '+' : '−') + Math.abs(d) + '%';
}

// Raw definitions: [stat, delta, size, copies, goldCost, xp, pot]
const RAW: readonly [GambitStatKey, number, GambitSize, number, number, number, number][] = [
  ['release',  2,    'small', 3,  0, 0,  0 ],
  ['release', -2,    'small', 3,  0, 5,  15],
  ['release',  5,    'big',   2, 15, 0,  0 ],
  ['release', -5,    'big',   2,  0, 10, 30],
  ['collect',  2,    'small', 3,  0, 0,  0 ],
  ['collect', -2,    'small', 3,  0, 5,  15],
  ['collect',  5,    'big',   2, 15, 0,  0 ],
  ['collect', -5,    'big',   2,  0, 10, 30],
  ['hint',    -0.5,  'small', 3,  0, 0,  0 ],
  ['hint',     0.5,  'small', 3,  0, 3,  15],
  ['hint',    -1,    'big',   2, 10, 0,  0 ],
  ['hint',     1,    'big',   2,  0, 5,  30],
];

export const GAMBIT_DEFS: readonly GambitDef[] = RAW.map((r, i) => {
  const [stat, delta, size, copies, goldCost, xp, pot] = r;
  return {
    defId:      'g' + i,
    stat, delta, size, copies, goldCost, xp, pot,
    kind:       isBonus(stat, delta) ? 'bonus' : 'penalty',
    deltaLabel: fmtDelta(delta),
    statLabel:  GAMBIT_STATS[stat].short,
    statFull:   GAMBIT_STATS[stat].label,
  };
});

export function buildGambitDeck(): GambitCard[] {
  const deck: GambitCard[] = [];
  let uid = 0;
  for (const def of GAMBIT_DEFS) {
    for (let i = 0; i < def.copies; i++) {
      deck.push({ ...def, uid: 'gam' + (uid++) });
    }
  }
  return shuffle(deck);
}

export interface GambitDeckHandle {
  remaining(): number;
  // Draw up to n cards with DISTINCT defId (no duplicate type in one offer).
  drawOffer(n: number): GambitCard[];
  toArray(): GambitCard[];
}

export function makeGambitDeck(cards?: GambitCard[]): GambitDeckHandle {
  let remaining = cards ? cards.slice() : buildGambitDeck();
  return {
    remaining: () => remaining.length,
    drawOffer(n: number): GambitCard[] {
      const offer: GambitCard[] = [];
      const used  = new Set<string>();
      const skipped: GambitCard[] = [];
      while (offer.length < n && remaining.length > 0) {
        const card = remaining.shift()!;
        if (used.has(card.defId)) { skipped.push(card); continue; }
        used.add(card.defId);
        offer.push(card);
      }
      // Return skipped duplicates to the bottom so they stay in circulation
      remaining = remaining.concat(skipped);
      return offer;
    },
    toArray(): GambitCard[] {
      return remaining.slice();
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, round1(v)));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// Apply a played gambit to a stats snapshot → returns new stats and side effects.
// stats is treated as immutable; a new object is always returned.
export function applyGambit(stats: CasinoStats, card: GambitDef): GambitResult {
  const next: CasinoStats = { ...stats };
  if (card.stat === 'release') {
    next.release = clamp(next.release + card.delta, 0, 100);
  } else if (card.stat === 'collect') {
    next.collect = clamp(next.collect + card.delta, 0, 100);
  } else {
    next.hint = Math.max(0, round1(next.hint + card.delta));
  }
  next.xp = (next.xp ?? 0) + (card.xp ?? 0);
  return {
    stats:    next,
    potAdd:   card.pot      ?? 0,
    goldCost: card.goldCost ?? 0,
    xp:       card.xp      ?? 0,
  };
}

// Roll the final release/collect outcomes from the settled odds percentages.
// Called once at deploy, server-side.
export function rollCasinoOdds(stats: CasinoStats): { releaseOn: boolean; collectOn: boolean } {
  return {
    releaseOn: Math.random() * 100 < stats.release,
    collectOn: Math.random() * 100 < stats.collect,
  };
}
