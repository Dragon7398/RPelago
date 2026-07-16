// Casino game engine — pure hand evaluation logic.
// Ported from the prototype's casino/engine.js (AI player logic omitted).
// Imported by both the browser client (table UI) and Cloud Functions.

import { type DeckCard, buildDeck, shuffle, CASINO_GAMES, type CasinoGame } from './casinoData';
import type { CasinoStats } from '../types';

export type { DeckCard };

// ── Single-sitting play helpers (canonical — carries to S2) ───────────────────
// Blackjack starts with 2 cards and hits from there; the other single-sitting
// games deal their whole pool up front. Mirror in functions/src/casinoEngine.ts.
export function initialDealCount(game: CasinoGame): number {
  return game === 'blackjack' ? 2 : CASINO_GAMES[game].hole;
}

export type CommitResult = { ok: true; committed: DeckCard[] } | { ok: false; reason: string };

// Validate the cards a seat commits from its hand. keepUids (when provided)
// selects a subset — used by Seven Card Stud (≤5 of 7), Five Card Draw (reject
// some), and Blackjack (drop at 6). Enforces 1..pickMax kept cards, each present.
export function selectCommitted(
  hand: readonly DeckCard[],
  keepUids: number[] | undefined | null,
  pickMax: number,
): CommitResult {
  let committed = hand.slice();
  if (keepUids != null) {
    const keep = new Set(keepUids);
    committed = hand.filter(c => keep.has(c.uid));
    if (committed.length !== keep.size) return { ok: false, reason: 'Selected a card not in your hand.' };
  }
  if (committed.length === 0)      return { ok: false, reason: 'Keep at least one card.' };
  if (committed.length > pickMax)  return { ok: false, reason: `Keep at most ${pickMax} cards.` };
  return { ok: true, committed };
}

// ── Poker ─────────────────────────────────────────────────────────────────────
// Reward = sum of committed card values. No combo multiplier — more / rarer
// games committed means more gold. Rejecting a card removes it from the reward.

export interface PokerResult {
  base:  number;   // sum of committed card values
  total: number;   // same as base (no multiplier in this system)
  n:     number;   // cards committed
}

export function evaluatePoker(cards: readonly DeckCard[]): PokerResult {
  const base = cards.reduce((s, c) => s + c.value, 0);
  return { base, total: base, n: cards.length };
}

// ── Blackjack ─────────────────────────────────────────────────────────────────
// Reward = sum of final committed hand's gold. No numeric bust — risk is real
// commitment (more cards = more games to actually play). At 6 cards the player
// must drop one before locking in.

export interface BlackjackResult {
  sum:   number;   // sum of card values in the shown hand
  total: number;   // same as sum
  n:     number;   // number of cards in the shown hand
}

export function evaluateBlackjack(cards: readonly DeckCard[]): BlackjackResult {
  const sum = cards.reduce((s, c) => s + c.value, 0);
  return { sum, total: sum, n: cards.length };
}

// ── Table setup: rolled odds, dynamic pot (canonical — carries to S2) ─────────
// Each S1.5 table rolls its own seat count, Release/Collect *chances*, hint cost,
// and starting pot at creation. The chances (R, C) are stored on the mission;
// the actual On/Off is rolled AGAINST them later at room creation (rollCasinoOdds).
// Mirror every function here in functions/src/casinoEngine.ts.

export const CASINO_XP_FLOOR   = 50;    // XP floor settled at deploy; raised by penalty gambits.
export const CASINO_POT_CUT_PCT = 0.40; // fraction of every fee that feeds the shared pot.

type Rng = () => number;

// randInt(0..max) inclusive, guarded against an rng() that returns exactly 1.
function randInt(max: number, rng: Rng): number {
  return Math.min(max, Math.floor(rng() * (max + 1)));
}

// Seats per table: 5–8 inclusive.
export function rollSeatCount(rng: Rng = Math.random): number {
  return 5 + randInt(3, rng);
}

// Release chance R: 40–70% in 5% steps (7 options).
export function rollReleaseChance(rng: Rng = Math.random): number {
  return 40 + randInt(6, rng) * 5;
}

// Collect chance C: 25–50% in 5% steps (6 options).
export function rollCollectChance(rng: Rng = Math.random): number {
  return 25 + randInt(5, rng) * 5;
}

// Hint cost = (R + C) / 10, rounded to the nearest 0.5, as a percentage.
// Range 6.5% (40+25) → 12% (70+50). Higher R/C ⇒ costlier hints (a balancing push).
export function deriveHintCost(release: number, collect: number): number {
  return Math.round(((release + collect) / 10) * 2) / 2;
}

// Initial pot = 10 + seats×10 + randInt(0, 150 − R − C). Lower R/C (a harder
// room) pays a bigger difficulty bonus; the bonus span is never negative.
export function computeInitialPot(seats: number, release: number, collect: number, rng: Rng = Math.random): number {
  const base = 10 + seats * 10;
  const span = Math.max(0, 150 - release - collect);
  return base + randInt(span, rng);
}

// The gold added to the shared pot from one fee (40% of it, floored).
export function potContribution(fee: number): number {
  return Math.floor(fee * CASINO_POT_CUT_PCT);
}

// Roll a whole table's opening setup in one call.
export function rollTableSetup(rng: Rng = Math.random): { seats: number; stats: CasinoStats; pot: number } {
  const seats   = rollSeatCount(rng);
  const release = rollReleaseChance(rng);
  const collect = rollCollectChance(rng);
  const hint    = deriveHintCost(release, collect);
  const pot     = computeInitialPot(seats, release, collect, rng);
  return { seats, stats: { release, collect, hint, xp: CASINO_XP_FLOOR }, pot };
}

// ── Texas Hold 'Em community draw (canonical — carries to S2) ─────────────────
// The 5 shared, PUBLIC community cards, dealt once the table is full and every
// seat has locked its hole cards. Always from a full Purist deck regardless of
// any seat's deck variant: 1 truly random card, then one each of Broad / Narrow
// / Franchise / Platform, all distinct. Mirror in functions/src/casinoEngine.ts.

const COMMUNITY_TYPES = ['broad', 'narrow', 'franchise', 'platform'] as const;

function shuffleWith<T>(arr: readonly T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawCommunity(rng: () => number = Math.random): DeckCard[] {
  const deck = shuffleWith(buildDeck(), rng);   // full Purist deck
  const chosen: DeckCard[] = [deck[0]];         // 1 truly random (any type, incl. Wild)
  const used = new Set<number>([deck[0].uid]);
  for (const t of COMMUNITY_TYPES) {
    const card = deck.find(c => c.type === t && !used.has(c.uid));
    if (!card) throw new Error(`drawCommunity: no ${t} card available`);
    chosen.push(card);
    used.add(card.uid);
  }
  return chosen;
}

// Index of the lowest-value card in a hand (used by the UI to suggest which to drop)
export function lowestCardIndex(cards: readonly DeckCard[]): number {
  let idx = 0;
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].value < cards[idx].value) idx = i;
  }
  return idx;
}

// ── Drawable deck wrapper ─────────────────────────────────────────────────────
// Wraps a shuffled deck array with draw operations. The server holds one per
// seated player (stored in Firebase, not reconstructed on every call).

export interface DrawableDeck {
  remaining(): number;
  draw(n: number): DeckCard[];
  drawOne(): DeckCard;
  // Serialise the remaining cards for Firebase storage
  toArray(): DeckCard[];
}

export function makeDeck(): DrawableDeck {
  return makeDrawableDeck(shuffle(buildDeck()));
}

// Reconstruct a DrawableDeck from a stored card array (used server-side to resume
// a deck across callable invocations).
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
      const [card, ...rest] = remaining;
      remaining = rest;
      return card;
    },
    toArray(): DeckCard[] {
      return remaining.slice();
    },
  };
}
