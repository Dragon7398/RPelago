// Casino game engine — pure hand evaluation logic.
// Ported from the prototype's casino/engine.js (AI player logic omitted).
// Imported by both the browser client (table UI) and Cloud Functions.

import { type DeckCard, buildDeck, shuffle } from './casinoData';

export type { DeckCard };

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
  let cards = shuffle(buildDeck());
  return makeDrawableDeck(cards);
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
