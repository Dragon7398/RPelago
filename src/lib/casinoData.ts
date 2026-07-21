// Casino card deck — data model and deck construction.
// Ported from the prototype's casino/data.js.
// This module is imported by both the browser client and Cloud Functions.

import type { CasinoDeckChoice, CasinoGame } from '../types';

// Re-exported so existing importers can keep pulling CasinoGame from casinoData.
export type { CasinoGame };

export type CardTypeKey = 'wild' | 'broad' | 'platform' | 'franchise' | 'narrow';

export interface CardTypeDef {
  key:     CardTypeKey;
  label:   string;
  suit:    string;     // casino/tarot mark for the type
  copies:  number;     // how many copies of each category card go in the deck
  range:   readonly [number, number] | null;  // [lo, hi] gold range; null = flat value (wild)
  order:   number;     // display order
}

// A unique card definition (one per category + wild)
export interface CardDef {
  name:      string;
  type:      CardTypeKey;
  count:     number | null;  // number of distinct games in this category (null for wild)
  value:     number;         // gold value of this card
  copies:    number;         // copies in the deck
  blurb?:    string;         // optional flavour note
}

// A physical card instance in a shuffled deck; carries a uid for React keys and server tracking
export interface DeckCard extends CardDef {
  uid:       number;
  copyIndex: number;
}

// Gold ranges are the S1 values ×2 — see docs/casino-season-1_5-plan.md
// "Economy tuning". Cards, antes, the pot and the starting stake all doubled so
// the (unchanged) gambit payouts stop out-earning the hand itself.
export const CARD_TYPES: Readonly<Record<CardTypeKey, CardTypeDef>> = {
  wild:      { key: 'wild',      label: 'Wild',      suit: '✦', copies: 5, range: null,      order: 0 },
  broad:     { key: 'broad',     label: 'Broad',     suit: '♦', copies: 3, range: [30, 60],  order: 1 },
  platform:  { key: 'platform',  label: 'Platform',  suit: '♠', copies: 2, range: [40, 70],  order: 2 },
  franchise: { key: 'franchise', label: 'Franchise', suit: '♥', copies: 1, range: [50, 80],  order: 3 },
  narrow:    { key: 'narrow',    label: 'Narrow',    suit: '♣', copies: 1, range: [50, 100], order: 4 },
};

// Raw category data: [name, type, gameCount]
const RAW: readonly [string, CardTypeKey, number][] = [
  // Broad (3 copies each, gold range 15–30)
  ['2D platformer',           'broad',     57],
  ['3D platformer',           'broad',     24],
  ['Action RPG',              'broad',     35],
  ['Turn-based RPG',          'broad',     35],
  ['Roguelike / roguelite',   'broad',     19],
  ['Puzzle',                  'broad',     21],
  ['FPS / shooter',           'broad',     11],
  ['Strategy',                'broad',     12],
  ['Simulation / builder',    'broad',     15],
  ['Exploration / open world','broad',     17],
  // Narrow (1 copy each, gold range 25–50)
  ['Metroidvania',            'narrow',    35],
  ['Factory builder',         'narrow',     6],
  ['Survival / sandbox',      'narrow',     9],
  ['Horror / unsettling',     'narrow',    10],
  ['Cozy games',              'narrow',    19],
  ['Card games',              'narrow',    14],
  ['Rhythm / music game',     'narrow',     8],
  ['Tactical RPG',            'narrow',     6],
  ['Racing / driving',        'narrow',     8],
  // Franchise (1 copy each, gold range 25–40)
  ['Zelda',                   'franchise', 14],
  ['Mario',                   'franchise', 25],
  ['Pokemon',                 'franchise', 14],
  ['Castlevania',             'franchise',  5],
  ['Mega Man',                'franchise',  6],
  ['Kingdom Hearts',          'franchise',  5],
  ['Final Fantasy',           'franchise',  9],
  ['Sonic',                   'franchise',  9],
  ['Metroid',                 'franchise',  5],
  ['Donkey Kong',             'franchise',  7],
  // Platform (2 copies each, gold range 20–35)
  ['NES / Famicom',           'platform',   9],
  ['SNES / Super Famicom',    'platform',  30],
  ['Game Boy',                'platform',  25],
  ['Non-Nintendo Console',    'platform',  10],
  ['AP-original',             'platform',  30],
];

// Optional flavour notes displayed on a card's details line
const CARD_NOTES: Readonly<Record<string, string>> = {
  'Game Boy':  'e.g. GB, GBA, GBC',
  'AP-original': 'A game made specifically for Archipelago',
};

// Value rule: more games in a category → lower value; fewer → higher.
// Interpolated (inverted) inside each type's gold range, rounded to nearest 1g.
function computeCategories(): CardDef[] {
  const bounds: Record<string, { min: number; max: number }> = {};
  for (const [, type, count] of RAW) {
    if (!bounds[type]) bounds[type] = { min: count, max: count };
    bounds[type].min = Math.min(bounds[type].min, count);
    bounds[type].max = Math.max(bounds[type].max, count);
  }
  return RAW.map(([name, type, count]) => {
    const typeDef = CARD_TYPES[type];
    const [lo, hi] = typeDef.range!;
    const { min, max } = bounds[type];
    const frac  = max === min ? 0 : (max - count) / (max - min);
    const value = Math.round(lo + frac * (hi - lo));
    const def: CardDef = { name, type, count, value, copies: typeDef.copies };
    if (CARD_NOTES[name]) def.blurb = CARD_NOTES[name];
    return def;
  });
}

export const WILD_DEF: CardDef = {
  name:  'Wild',
  type:  'wild',
  count: null,
  value: 20,
  copies: 5,
  blurb: 'Choose any game you like.',
};

// All unique card definitions (wild first, then one per category)
export const CARD_DEFS: readonly CardDef[] = [WILD_DEF, ...computeCategories()];

// The full deck as a multiset: CARD_DEFS expanded by copies count (64 cards total).
// Pass excludeTypes to strip whole categories out for a deck variant (see DECK_VARIANTS).
export function buildDeck(excludeTypes: readonly CardTypeKey[] = []): DeckCard[] {
  const excl = new Set(excludeTypes);
  const deck: DeckCard[] = [];
  let uid = 0;
  for (const def of CARD_DEFS) {
    if (excl.has(def.type)) continue;
    for (let i = 0; i < def.copies; i++) {
      deck.push({ ...def, uid: uid++, copyIndex: i });
    }
  }
  return deck;
}

// ── Deck variants ────────────────────────────────────────────────────────────
// A per-seat choice of which card types stay in that seat's draw deck.

export interface DeckVariant {
  key:          CasinoDeckChoice;
  label:        string;
  excludeTypes: CardTypeKey[];  // card types stripped entirely from this seat's deck
  gpBoost:      number;         // flat fraction added to this seat's own reward at settlement
  blurb:        string;
}

export const DECK_VARIANTS: Readonly<Record<CasinoDeckChoice, DeckVariant>> = {
  purist: {
    key: 'purist', label: 'Purist',
    excludeTypes: [], gpBoost: 0.10,
    blurb: 'Every card stays in the deck. Rewarded for the flexibility: +10% GP on everything you win.',
  },
  unconsoled: {
    key: 'unconsoled', label: 'Unconsoled',
    excludeTypes: ['platform'], gpBoost: 0,
    blurb: 'Pulls every Platform card from the deck — no NES, SNES, Game Boy or AP-original.',
  },
  indie: {
    key: 'indie', label: 'Indie',
    excludeTypes: ['franchise'], gpBoost: 0,
    blurb: 'Pulls every Franchise card from the deck — no Zelda, Mario, Pokemon.',
  },
};

export const DECK_VARIANT_ORDER: CasinoDeckChoice[] = ['purist', 'unconsoled', 'indie'];

// Participant records predate this feature — treat a missing value as Purist.
export function deckChoiceOf(seat: { deckChoice?: CasinoDeckChoice }): CasinoDeckChoice {
  return seat.deckChoice ?? 'purist';
}

// How many cards a given deck variant plays with — for the picker's "N of 64" line.
export function deckSizeFor(choice: CasinoDeckChoice): number {
  const excl = new Set(DECK_VARIANTS[choice].excludeTypes);
  return CARD_DEFS.reduce((s, d) => (excl.has(d.type) ? s : s + d.copies), 0);
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Total number of cards in a full deck
export const DECK_TOTAL = CARD_DEFS.reduce((n, d) => n + d.copies, 0);

// ── Casino game variants (canonical — carries to S2) ─────────────────────────
// S1.5 retires S1's single in-table poker/blackjack selector: each table is
// pinned to exactly ONE of these four games. Costs here are FINAL and become
// S2's casino baseline. Mirror any change in functions/src/casinoEngine.ts.

export const CASINO_GAME_ORDER: readonly CasinoGame[] = [
  'five_card_draw', 'seven_card_stud', 'holdem', 'blackjack',
];

export interface CasinoGameDef {
  key:        CasinoGame;
  label:      string;
  sittings:   1 | 2;      // Hold 'Em plays across two sittings; all others resolve in one.
  hole:       number;     // cards dealt privately to the seat (Blackjack draws these one at a time).
  community:  number;     // shared face-up cards (Hold 'Em only); 0 otherwise.
  maxDraw:    number;     // hard cap on cards a seat may hold before it must trim to pickMax.
  pickMax:    number;     // most cards a seat may commit (reward = Σ of committed values). Always ≤5.
  reroll:     boolean;    // may the seat pay rerollCost to redraw?
  ante:       number;     // gold to sit / first commitment.
  rerollCost: number;     // 0 when reroll is false.
  playOn:     number;     // Hold 'Em second-sitting cost; 0 otherwise.
  // A "best possible" gauge (the reused Blackjack gauge, UI-only) is meaningful
  // only when the seat picks a ≤pickMax subset from a pool LARGER than pickMax.
  subsetSelect: boolean;
}

// Entry costs are the S1 values ×3, against ×2 on cards/pot/stake. Deliberately
// steeper than the rest of the inflation: it tightens margins (leaving room for
// a future entry-cost reduction to matter), roughly halves what the house injects
// per table, and makes a bonus gambit a real sacrifice rather than small change.
//   Five Card Draw 180g (+60g reroll) · Seven Card Stud 210g · Hold 'Em 80g ante
//   + 120g play-on (200g total) · Blackjack 150g.
// 210g is the priciest MANDATORY full round, which is why the weekly floor sits
// at 250 — a topped-up player can always afford a full round of any game.
export const CASINO_GAMES: Readonly<Record<CasinoGame, CasinoGameDef>> = {
  five_card_draw: {
    key: 'five_card_draw', label: 'Five Card Draw',
    sittings: 1, hole: 5, community: 0, maxDraw: 5, pickMax: 5,
    reroll: true, ante: 180, rerollCost: 60, playOn: 0,
    subsetSelect: false,   // hold 5, commit ≤5 — no larger pool to optimise.
  },
  seven_card_stud: {
    key: 'seven_card_stud', label: 'Seven Card Stud',
    sittings: 1, hole: 7, community: 0, maxDraw: 7, pickMax: 5,
    reroll: false, ante: 210, rerollCost: 0, playOn: 0,
    subsetSelect: true,    // pick the best 5 of 7.
  },
  holdem: {
    key: 'holdem', label: "Texas Hold 'Em",
    sittings: 2, hole: 2, community: 5, maxDraw: 7, pickMax: 5,
    reroll: false, ante: 80, rerollCost: 0, playOn: 120,
    subsetSelect: true,    // pick the best 5 of 2 hole + 5 community.
  },
  blackjack: {
    key: 'blackjack', label: 'Blackjack',
    sittings: 1, hole: 0, community: 0, maxDraw: 6, pickMax: 5,
    reroll: false, ante: 150, rerollCost: 0, playOn: 0,
    subsetSelect: true,    // push-your-luck pool; drop to the best 5 at 6.
  },
};

// The cheapest ante across all games — the gold a player must hold to sit at
// SOME table. Mirrors the hardcoded CASINO_MIN_ENLIST_GOLD; keep them in step.
// (= Hold 'Em's 80g ante.)
export function minCasinoAnte(): number {
  return Math.min(...CASINO_GAME_ORDER.map(g => CASINO_GAMES[g].ante));
}

// Total gold a seat spends in one table, given which optional costs it incurred.
// spent = ante (+ reroll if used) (+ play-on if the seat played on after a
// Hold 'Em reveal). Net swing = reward − seatSpend.
export function seatSpend(game: CasinoGame, opts: { rerolled?: boolean; playedOn?: boolean } = {}): number {
  const g = CASINO_GAMES[game];
  let spent = g.ante;
  if (opts.rerolled && g.reroll) spent += g.rerollCost;
  if (opts.playedOn && g.playOn) spent += g.playOn;
  return spent;
}
