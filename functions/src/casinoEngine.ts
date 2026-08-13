// Casino engine — server-side mirror of src/lib/casino*.ts.
// Keep in sync with: casinoData.ts, casinoEngine.ts, casinoGambits.ts, casinoSlots.ts
// This file is compiled by functions/tsconfig.json (CommonJS, no Vite).

// ── Types ────────────────────────────────────────────────────────────────────

export type CardTypeKey = 'wild' | 'broad' | 'platform' | 'franchise' | 'narrow';
export type CasinoDeckChoice = 'purist' | 'unconsoled' | 'indie' | 'safety';

export interface DeckCard {
  name:      string;
  type:      CardTypeKey;
  count:     number | null;
  value:     number;
  copies:    number;
  blurb?:    string;
  uid:       number;
  copyIndex: number;
}

export interface CasinoCard {
  name:   string;
  value:  number;
  type?:  string;
  blurb?: string;
}

export interface CasinoStats {
  release: number;
  collect: number;
  hint:    number;
  xp:      number;
}

export type GambitStatKey = 'release' | 'collect' | 'hint';
export type GambitKind    = 'bonus' | 'penalty';
export type GambitSize    = 'small' | 'medium' | 'large';

export interface GambitDef {
  defId:      string;
  stat:       GambitStatKey;
  delta:      number;
  size:       GambitSize;
  copies:     number;
  goldCost:   number;
  xp:         number;
  pot:        number;
  kind:       GambitKind;
  deltaLabel: string;
  statLabel:  string;
  statFull:   string;
}

export interface GambitCard extends GambitDef {
  uid: string;
}

export interface GambitResult {
  stats:    CasinoStats;
  potAdd:   number;
  goldCost: number;
  xp:       number;
}

// ── Casino mission constants ─────────────────────────────────────────────────
// Mirror of CASINO_START_STATS in src/lib/constants.ts. (Enlist gold is the
// per-table finish cost — seatSpend(game, { playedOn: true }) — not a constant.)

export const CASINO_POT_CUT_PCT     = 0.40;
export const CASINO_START_STATS: CasinoStats = { release: 60, collect: 30, hint: 10, xp: 50 };

// ── Casino game variants (canonical — carries to S2) ─────────────────────────
// Mirror of CasinoGame / CASINO_GAMES in src/lib/casinoData.ts. Each S1.5 table
// is pinned to exactly one of these four games; costs are FINAL. Keep in sync.

export type CasinoGame = 'five_card_draw' | 'seven_card_stud' | 'holdem' | 'blackjack';

export const CASINO_GAME_ORDER: readonly CasinoGame[] = [
  'five_card_draw', 'seven_card_stud', 'holdem', 'blackjack',
];

export interface CasinoGameDef {
  key:        CasinoGame;
  label:      string;
  sittings:   1 | 2;
  hole:       number;
  community:  number;
  maxDraw:    number;
  pickMax:    number;
  reroll:     boolean;
  ante:       number;
  rerollCost: number;
  playOn:     number;
  subsetSelect: boolean;
}

// Entry costs are the S1 values ×3 (cards/pot/stake are ×2) — see the client copy.
export const CASINO_GAMES: Readonly<Record<CasinoGame, CasinoGameDef>> = {
  five_card_draw: {
    key: 'five_card_draw', label: 'Five Card Draw',
    sittings: 1, hole: 5, community: 0, maxDraw: 5, pickMax: 5,
    reroll: true, ante: 180, rerollCost: 60, playOn: 0,
    subsetSelect: false,
  },
  seven_card_stud: {
    key: 'seven_card_stud', label: 'Seven Card Stud',
    sittings: 1, hole: 7, community: 0, maxDraw: 7, pickMax: 5,
    reroll: false, ante: 210, rerollCost: 0, playOn: 0,
    subsetSelect: true,
  },
  holdem: {
    key: 'holdem', label: "Texas Hold 'Em",
    sittings: 2, hole: 2, community: 5, maxDraw: 7, pickMax: 5,
    reroll: false, ante: 80, rerollCost: 0, playOn: 120,
    subsetSelect: true,
  },
  blackjack: {
    key: 'blackjack', label: 'Blackjack',
    sittings: 1, hole: 0, community: 0, maxDraw: 6, pickMax: 5,
    reroll: false, ante: 150, rerollCost: 0, playOn: 0,
    subsetSelect: true,
  },
};

export function minCasinoAnte(): number {
  return Math.min(...CASINO_GAME_ORDER.map(g => CASINO_GAMES[g].ante));
}

export function seatSpend(game: CasinoGame, opts: { rerolled?: boolean; playedOn?: boolean } = {}): number {
  const g = CASINO_GAMES[game];
  let spent = g.ante;
  if (opts.rerolled && g.reroll) spent += g.rerollCost;
  if (opts.playedOn && g.playOn) spent += g.playOn;
  return spent;
}

// ── Card deck ────────────────────────────────────────────────────────────────

const CARD_TYPE_COPIES: Record<CardTypeKey, number> = {
  wild:      5,
  broad:     3,
  platform:  2,
  franchise: 1,
  narrow:    1,
};

// Mirror of CARD_TYPES ranges in src/lib/casinoData.ts (S1 values ×2).
const CARD_TYPE_RANGES: Partial<Record<CardTypeKey, [number, number]>> = {
  broad:     [30, 60],
  platform:  [40, 70],
  franchise: [50, 80],
  narrow:    [50, 100],
};

const RAW: readonly [string, CardTypeKey, number][] = [
  ['2D platformer',            'broad',      57],
  ['3D platformer',            'broad',      24],
  ['Action RPG',               'broad',      35],
  ['Turn-based RPG',           'broad',      35],
  ['Roguelike / roguelite',    'broad',      19],
  ['Puzzle',                   'broad',      22],
  ['FPS / shooter',            'broad',      23],
  ['Strategy',                 'broad',      45],
  ['Simulation / builder',     'broad',      15],
  ['Exploration / open world', 'broad',      20],
  ['Metroidvania',             'narrow',     35],
  ['Factory builder',          'narrow',      6],
  ['Survival / sandbox',       'narrow',      9],
  ['Horror / unsettling',      'narrow',     10],
  ['Cozy games',               'narrow',     25],
  ['Card games',               'narrow',     14],
  ['Rhythm / music game',      'narrow',      8],
  ['Tactical RPG',             'narrow',      6],
  ['Racing / driving',         'narrow',      8],
  ['Zelda',                    'franchise',  14],
  ['Mario',                    'franchise',  25],
  ['Pokemon',                  'franchise',  14],
  ['Castlevania',              'franchise',   5],
  ['Mega Man',                 'franchise',  12],
  ['Kingdom Hearts',           'franchise',   5],
  ['Final Fantasy',            'franchise',  12],
  ['Sonic',                    'franchise',  12],
  ['Metroid',                  'franchise',   4],
  ['Donkey Kong',              'franchise',   7],
  ['NES / Famicom',            'platform',   10],
  ['SNES / Super Famicom',     'platform',   30],
  ['Game Boy',                 'platform',   30],
  ['DS / 3DS',                 'platform',   15],
  ['Non-Nintendo Console',     'platform',   45],
  ['AP-original',              'platform',   35],
  ['N64 / Nintendo 64',        'platform',   27],
];

const CARD_NOTES: Record<string, string> = {
  'Game Boy':    'e.g. GB, GBA, GBC',
  'AP-original': 'A game made specifically for Archipelago',
};

const WILD_BASE = {
  name: 'Wild', type: 'wild' as CardTypeKey, count: null as null,
  value: 20, copies: 5, blurb: 'Choose any game you like.',
};

function computeCardDefs(): Omit<DeckCard, 'uid' | 'copyIndex'>[] {
  const bounds: Record<string, { min: number; max: number }> = {};
  for (const [, type, count] of RAW) {
    if (!bounds[type]) bounds[type] = { min: count, max: count };
    bounds[type].min = Math.min(bounds[type].min, count);
    bounds[type].max = Math.max(bounds[type].max, count);
  }
  const categories: Omit<DeckCard, 'uid' | 'copyIndex'>[] = RAW.map(([name, type, count]) => {
    const [lo, hi] = CARD_TYPE_RANGES[type]!;
    const { min, max } = bounds[type];
    const frac  = max === min ? 0 : (max - count) / (max - min);
    const value = Math.round(lo + frac * (hi - lo));
    const def: Omit<DeckCard, 'uid' | 'copyIndex'> = {
      name, type, count, value, copies: CARD_TYPE_COPIES[type],
    };
    if (CARD_NOTES[name]) def.blurb = CARD_NOTES[name];
    return def;
  });
  return [WILD_BASE, ...categories];
}

const CARD_DEFS = computeCardDefs();

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
// Mirror of DECK_VARIANTS in src/lib/casinoData.ts.

export interface DeckVariant {
  key:          CasinoDeckChoice;
  label:        string;
  excludeTypes: CardTypeKey[];
  gpBoost:      number;
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
    blurb: 'Pulls every Platform card from the deck — no console or handheld categories.',
  },
  indie: {
    key: 'indie', label: 'Indie',
    excludeTypes: ['franchise'], gpBoost: 0,
    blurb: 'Pulls every Franchise card from the deck — no Zelda, Mario, Pokemon.',
  },
  safety: {
    key: 'safety', label: 'Safety',
    excludeTypes: ['platform', 'franchise'], gpBoost: -0.10,
    blurb: 'Unconsoled and Indie combined — no console, handheld or Franchise categories at all. '
         + 'The narrowest deck, and you pay for the comfort: −10% GP on everything you win.',
  },
};

export function deckChoiceOf(seat: { deckChoice?: CasinoDeckChoice }): CasinoDeckChoice {
  return seat.deckChoice ?? 'purist';
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Deck wrapper ─────────────────────────────────────────────────────────────

export interface DrawableDeck {
  remaining(): number;
  draw(n: number): DeckCard[];
  drawOne(): DeckCard;
  toArray(): DeckCard[];
}

export function makeDrawableDeck(cards: DeckCard[]): DrawableDeck {
  let remaining = cards.slice();
  return {
    remaining: () => remaining.length,
    draw(n: number): DeckCard[] {
      const taken = remaining.slice(0, n);
      remaining = remaining.slice(taken.length);
      return taken;
    },
    drawOne(): DeckCard {
      const card = remaining[0];
      remaining = remaining.slice(1);
      return card;
    },
    toArray(): DeckCard[] { return remaining.slice(); },
  };
}

export function makeDeck(): DrawableDeck {
  return makeDrawableDeck(shuffle(buildDeck()));
}

// ── Hand evaluation ──────────────────────────────────────────────────────────

export function handStake(hand: readonly DeckCard[]): number {
  return hand.reduce((s, c) => s + c.value, 0);
}

// ── Single-sitting play helpers (mirror of src/lib/casinoEngine.ts) ──────────
export function initialDealCount(game: CasinoGame): number {
  return game === 'blackjack' ? 2 : CASINO_GAMES[game].hole;
}

export type CommitResult = { ok: true; committed: DeckCard[] } | { ok: false; reason: string };

// `minKeep` defaults to 1 (free subset); Blackjack passes handLength−1 so a seat
// may drop AT MOST one card — the push-your-luck rule. Mirror of src/lib/casinoEngine.ts.
export function selectCommitted(
  hand: readonly DeckCard[],
  keepUids: number[] | undefined | null,
  pickMax: number,
  minKeep = 1,
): CommitResult {
  let committed = hand.slice();
  if (keepUids != null) {
    const keep = new Set(keepUids);
    committed = hand.filter(c => keep.has(c.uid));
    if (committed.length !== keep.size) return { ok: false, reason: 'Selected a card not in your hand.' };
  }
  if (committed.length < minKeep) {
    return { ok: false, reason: minKeep > 1 ? 'You may discard at most one card.' : 'Keep at least one card.' };
  }
  if (committed.length > pickMax)  return { ok: false, reason: `Keep at most ${pickMax} cards.` };
  return { ok: true, committed };
}

// Mirror of applyDeckBoost in src/lib/casinoSlots.ts.
// ⚠️ The guard is `!== 0`, NOT `> 0`: gpBoost is signed (Safety is −0.10), and a
// `> 0` test silently drops every penalty deck, paying the full unmodified stake.
export function applyDeckBoost(reward: number, choice: CasinoDeckChoice): number {
  const boost = DECK_VARIANTS[choice].gpBoost;
  return boost !== 0 ? Math.round(reward * (1 + boost)) : reward;
}

// ── Gambit deck ──────────────────────────────────────────────────────────────

const GAMBIT_STATS: Record<GambitStatKey, { short: string; full: string; betterWhen: 'up' | 'down' }> = {
  release: { short: 'Release', full: 'Release Odds', betterWhen: 'up'   },
  collect: { short: 'Collect', full: 'Collect Odds', betterWhen: 'up'   },
  hint:    { short: 'Hint',    full: 'Hint Cost',    betterWhen: 'down' },
};

// Mirror of the RAW gambit table in src/lib/casinoGambits.ts. Keep in sync
// (order matters — defId is derived from array index).
const GAMBIT_RAW: readonly [GambitStatKey, number, GambitSize, number, number, number, number][] = [
  ['release',  3,    'small',  4,  0,  0,  0 ],
  ['release',  5,    'medium', 3, 15,  0,  0 ],
  ['release',  7,    'large',  2, 30,  0,  0 ],
  ['release', -3,    'small',  4,  0, 10, 20],
  ['release', -5,    'medium', 3,  0, 15, 30],
  ['release', -7,    'large',  2,  0, 20, 40],
  ['collect',  3,    'small',  4,  0,  0,  0 ],
  ['collect',  5,    'medium', 3, 15,  0,  0 ],
  ['collect',  7,    'large',  2, 30,  0,  0 ],
  ['collect', -3,    'small',  4,  0, 10, 20],
  ['collect', -5,    'medium', 3,  0, 15, 30],
  ['collect', -7,    'large',  2,  0, 20, 40],
  ['hint',    -0.5,  'small',  4,  0,  0,  0 ],
  ['hint',    -1,    'medium', 3, 10,  0,  0 ],
  ['hint',    -1.5,  'large',  2, 20,  0,  0 ],
  ['hint',     0.5,  'small',  4,  0,  5, 20],
  ['hint',     1,    'medium', 3,  0, 10, 30],
  ['hint',     1.5,  'large',  2,  0, 15, 40],
];

function fmtDelta(d: number): string {
  return (d > 0 ? '+' : '−') + Math.abs(d) + '%';
}

function isBonus(stat: GambitStatKey, delta: number): boolean {
  return GAMBIT_STATS[stat].betterWhen === 'up' ? delta > 0 : delta < 0;
}

export const GAMBIT_DEFS: readonly GambitDef[] = GAMBIT_RAW.map((r, i) => {
  const [stat, delta, size, copies, goldCost, xp, pot] = r;
  return {
    defId:      'g' + i,
    stat, delta, size, copies, goldCost, xp, pot,
    kind:       isBonus(stat, delta) ? 'bonus' : 'penalty',
    deltaLabel: fmtDelta(delta),
    statLabel:  GAMBIT_STATS[stat].short,
    statFull:   GAMBIT_STATS[stat].full,
  };
});

export const GAMBIT_DEFS_BY_ID: Readonly<Record<string, GambitDef>> = Object.fromEntries(
  GAMBIT_DEFS.map(d => [d.defId, d]),
);

// Mirror of CASINO_GAMBIT_XP_TO_GP / gambitCasinoGold in src/lib/casinoGambits.ts.
// In a casino season a penalty gambit's inert XP is paid to the player as gold.
export const CASINO_GAMBIT_XP_TO_GP = 2;

export function gambitCasinoGold(card: GambitDef): number {
  return card.xp * CASINO_GAMBIT_XP_TO_GP;
}

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

// A gambit may be offered only if applying it wouldn't drive its stat below 0.
// Mirror of src/lib/casinoGambits.ts.
export function gambitOfferable(stats: CasinoStats, card: GambitDef): boolean {
  const current = card.stat === 'release' ? stats.release
    : card.stat === 'collect' ? stats.collect
    : stats.hint;
  return Math.round((current + card.delta) * 10) / 10 >= 0;
}

export interface GambitDeckHandle {
  remaining(): number;
  drawOffer(n: number, allow?: (card: GambitCard) => boolean): GambitCard[];
  toArray(): GambitCard[];
}

// Shared, depleting gambit deck. Draws up to n cards with DISTINCT defId; `allow`
// filters out cards that fail it (returned to circulation like duplicates).
// Mirror of src/lib/casinoGambits.ts — the server draws the authoritative offer.
export function makeGambitDeck(cards?: GambitCard[]): GambitDeckHandle {
  let remaining = cards ? cards.slice() : buildGambitDeck();
  return {
    remaining: () => remaining.length,
    drawOffer(n: number, allow?: (card: GambitCard) => boolean): GambitCard[] {
      const offer: GambitCard[] = [];
      const used  = new Set<string>();
      const skipped: GambitCard[] = [];
      while (offer.length < n && remaining.length > 0) {
        const card = remaining.shift()!;
        if (used.has(card.defId) || (allow && !allow(card))) { skipped.push(card); continue; }
        used.add(card.defId);
        offer.push(card);
      }
      remaining = remaining.concat(skipped);
      return offer;
    },
    toArray(): GambitCard[] {
      return remaining.slice();
    },
  };
}

// ── Gambit application ───────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
}

export function applyGambit(stats: CasinoStats, card: GambitDef): GambitResult {
  const next: CasinoStats = { ...stats };
  if (card.stat === 'release') {
    next.release = clamp(next.release + card.delta, 0, 100);
  } else if (card.stat === 'collect') {
    next.collect = clamp(next.collect + card.delta, 0, 100);
  } else {
    next.hint = Math.max(0, Math.round((next.hint + card.delta) * 10) / 10);
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
export function rollCasinoOdds(stats: CasinoStats): { releaseOn: boolean; collectOn: boolean } {
  return {
    releaseOn: Math.random() * 100 < stats.release,
    collectOn: Math.random() * 100 < stats.collect,
  };
}

// ── Table setup: rolled odds, dynamic pot (canonical — carries to S2) ─────────
// Mirror of the table-setup block in src/lib/casinoEngine.ts. Table creation is
// server-side, so this logic must match the client copy exactly. Keep in sync.

export const CASINO_XP_FLOOR = 50;

type Rng = () => number;

function randInt(max: number, rng: Rng): number {
  return Math.min(max, Math.floor(rng() * (max + 1)));
}

export function rollSeatCount(rng: Rng = Math.random): number {
  return 5 + randInt(3, rng);
}

export function rollReleaseChance(rng: Rng = Math.random): number {
  return 40 + randInt(6, rng) * 5;
}

export function rollCollectChance(rng: Rng = Math.random): number {
  return 25 + randInt(5, rng) * 5;
}

export function deriveHintCost(release: number, collect: number): number {
  return Math.round(((release + collect) / 10) * 2) / 2;
}

// Mirror of computeInitialPot in src/lib/casinoEngine.ts — base 4×seats²
// (squared so bigger tables pay each seat slightly MORE, not less), a doubled
// random difficulty span, plus a flat 2×(120−R−C) premium (120 is the max
// possible R+C, so it never goes negative). ~3g per point of difficulty.
export function computeInitialPot(seats: number, release: number, collect: number, rng: Rng = Math.random): number {
  const base = 4 * seats * seats;
  const span = Math.max(0, 150 - release - collect);
  const flat = 2 * Math.max(0, 120 - release - collect);
  return base + randInt(span * 2, rng) + flat;
}

export function potContribution(fee: number): number {
  return Math.floor(fee * CASINO_POT_CUT_PCT);
}

export function rollTableSetup(rng: Rng = Math.random): { seats: number; stats: CasinoStats; pot: number } {
  const seats   = rollSeatCount(rng);
  const release = rollReleaseChance(rng);
  const collect = rollCollectChance(rng);
  const hint    = deriveHintCost(release, collect);
  const pot     = computeInitialPot(seats, release, collect, rng);
  return { seats, stats: { release, collect, hint, xp: CASINO_XP_FLOOR }, pot };
}

// ── Texas Hold 'Em community draw (canonical — carries to S2) ─────────────────
// Mirror of drawCommunity in src/lib/casinoEngine.ts. The 5 shared PUBLIC
// community cards: full Purist deck, 1 truly random + one each of Broad / Narrow
// / Franchise / Platform, all distinct. Keep in sync.

const COMMUNITY_TYPES = ['broad', 'narrow', 'franchise', 'platform'] as const;

// ⚠️ `uid` is NOT globally unique — buildDeck numbers it 0..N by position, fresh
// on every call. Hold 'Em is the only game whose pool comes from TWO independent
// buildDeck() calls (the seat's hole deck and the community deck below), so its
// two halves share a uid space and can collide. uid is the selection protocol
// (`selectedUids` / `keepUids`) AND the client's React key, so one uid meaning two
// cards makes the `byUid` Map below silently drop a card and makes the UI count a
// single tap as two commits. Community cards therefore live in their own uid
// range. Applied at draw time, so it only covers tables dealt from here on — see
// holdemPool for the seats already holding a collision.
export const COMMUNITY_UID_BASE = 1000;

// Step used to move a colliding LEGACY community card out of the way. Chosen so a
// rekeyed uid can never land on a hole uid (0..N) or a modern community uid.
const LEGACY_REKEY_STEP = 2000;

function shuffleWith<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawCommunity(rng: Rng = Math.random): DeckCard[] {
  const deck = shuffleWith(buildDeck(), rng);
  const chosen: DeckCard[] = [deck[0]];
  const used = new Set<number>([deck[0].uid]);
  for (const t of COMMUNITY_TYPES) {
    const card = deck.find(c => c.type === t && !used.has(c.uid));
    if (!card) throw new Error(`drawCommunity: no ${t} card available`);
    chosen.push(card);
    used.add(card.uid);
  }
  // Namespace the whole community so it can never share a uid with a hole card.
  return chosen.map(c => ({ ...c, uid: c.uid + COMMUNITY_UID_BASE }));
}

/**
 * A Hold 'Em seat's selectable pool: its own hole cards, then the shared
 * community. THE one way to assemble it — the reveal, the play-on, and the
 * resubmit re-selection must all agree on which uid means which card.
 *
 * Tables whose community was dealt before COMMUNITY_UID_BASE existed can carry a
 * collision. Their rows are already written, so this de-duplicates on read rather
 * than rewriting stored data: the hole card KEEPS its uid (it is what `hand` and
 * `lockedCards` were written from) and the colliding community card moves. The
 * rekey is pure and deterministic, and both client and server build the pool
 * through this function, so a uid the player taps resolves to the same card here.
 * For every table dealt since, this is a no-op copy.
 *
 * Mirror of holdemPool in src/lib/casinoEngine.ts. Keep in sync.
 */
export function holdemPool(
  hole: readonly DeckCard[] = [],
  community: readonly DeckCard[] = [],
): DeckCard[] {
  const seen = new Set<number>();
  const pool: DeckCard[] = [];
  for (const card of [...hole, ...community]) {
    let uid = card.uid;
    while (seen.has(uid)) uid += LEGACY_REKEY_STEP;
    seen.add(uid);
    pool.push(uid === card.uid ? { ...card } : { ...card, uid });
  }
  return pool;
}

// ── Slot conversion ──────────────────────────────────────────────────────────

export function cardsToSlots(hand: readonly DeckCard[]): Array<{ name: string; game: string; details: string; status: 'Unstarted' }> {
  return hand.map(card => ({
    name:    '',
    game:    '',
    details: `${card.name} · ${card.value}g`,
    status:  'Unstarted' as const,
  }));
}
