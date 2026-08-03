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
// some), and Blackjack (drop at 6). Enforces minKeep..pickMax kept cards, each
// present. `minKeep` defaults to 1 (free subset); Blackjack passes handLength−1
// so a seat may drop AT MOST one card — the push-your-luck rule that makes it a
// balanced value. Every card drawn is a committed game; you can't cherry-pick a
// six-card hand down to two.
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

// Initial pot = base + a random difficulty bonus + a flat difficulty premium.
//
//   base    = 4 × seats²                         → superlinear in table size
//   random  = randInt(0, 2 × (150 − R − C))      → mean (150−R−C), slope 1/pt
//   flat    = 2 × (120 − R − C)                  → slope 2/pt
//
// Lower R/C (a harder room) pays more. The flat term pivots on 120 — the highest
// R+C the rolls can produce (70 + 50) — so it can never go negative and needs no
// clamp. Together the two terms give a ~3g-per-point slope, which is what makes
// one table's odds worth choosing over another's: across the full R/C range a
// hard table carries ~165g more pot than an easy one.
//
// The base is SQUARED in seats on purpose. A linear base (and a difficulty bonus
// split more ways) made each extra seat *dilute* the per-seat share, so bigger
// tables quietly paid less. A big table takes longer to fill and longer to play
// out, so it should pay each seat slightly MORE — squaring the base outruns the
// dilution and tilts the per-seat share gently upward with table size.
export function computeInitialPot(seats: number, release: number, collect: number, rng: Rng = Math.random): number {
  const base = 4 * seats * seats;
  const span = Math.max(0, 150 - release - collect);
  const flat = 2 * Math.max(0, 120 - release - collect);
  return base + randInt(span * 2, rng) + flat;
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

// ⚠️ `uid` is NOT globally unique — buildDeck numbers it 0..N by position, fresh
// on every call. Hold 'Em is the only game whose pool comes from TWO independent
// buildDeck() calls (the seat's hole deck and the community deck below), so its
// two halves share a uid space and can collide. That is not cosmetic: uid is the
// selection protocol (`selectedUids` / `keepUids`) AND the React key, so one uid
// meaning two cards makes holdemPlayOn's `byUid` Map silently drop a card and
// makes the UI count a single tap as two commits (locking the commit button at
// "Drop 1 to commit" with no way back to five).
//
// Community cards therefore live in their own uid range. Applied at draw time, so
// it only covers tables dealt from here on — see holdemPool for the seats already
// holding a collision.
export const COMMUNITY_UID_BASE = 1000;

// Step used to move a colliding LEGACY community card out of the way. Chosen so a
// rekeyed uid can never land on a hole uid (0..N) or a modern community uid.
const LEGACY_REKEY_STEP = 2000;

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
 * through this function, so a uid the player taps resolves to the same card when
 * the server re-reads it. For every table dealt since, this is a no-op copy.
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
