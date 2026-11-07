// Casino slot mapping — converts a locked card hand into mission AdvSlots.
// The core integration mapping: each committed card becomes one slot with
// blank name/game and the card's genre + gold value in the Details field.

import type { AdvSlot, CasinoDeckChoice } from '../types';
import { DECK_VARIANTS } from './casinoData';

// A card as it exists in a player's committed hand.
// Subset of DeckCard; the uid is dropped once the hand is locked.
export interface CasinoCard {
  name:   string;    // genre / franchise / platform label
  value:  number;    // gold value from the deck
  type?:  string;    // card type key ('wild' | 'broad' | 'platform' | 'franchise' | 'narrow')
  blurb?: string;    // optional flavour note (e.g. "e.g. GB, GBA, GBC")
}

// The Details line stamped on a locked slot: "SNES / Super Famicom · 20g"
export function casinoSlotDetails(card: CasinoCard): string {
  return `${card.name} · ${card.value}g`;
}

/**
 * The Finale's details line: "Sonic · 5★".
 *
 * A finale card's worth is its STARS, not its gold value, so printing the card's
 * `value` here would show a number that has nothing to do with what the slot pays.
 *
 * ⚠️ This deliberately does not match `handStakeFromSlots`' regex, and that is
 * safe: that function is only ever a fallback behind `p.goldSwing ?? …` (three
 * sites), and a finale seat always carries a `goldSwing`. Writing a fake gold
 * figure just to keep the regex happy would make this the only lying number in
 * the record.
 */
export function finaleSlotDetails(card: CasinoCard, stars: number): string {
  return `${card.name} · ${stars}★`;
}

// The total gold a seat is "playing for" — sum of all locked card values
export function handStake(hand: readonly CasinoCard[]): number {
  return hand.reduce((sum, c) => sum + (c.value ?? 0), 0);
}

// Apply a deck variant's GP modifier to a seat's own reward — Purist +10%,
// Safety −10%, the others flat. Rounds once, at the reward, before any spend is
// subtracted. ⚠️ The guard is `!== 0`, NOT `> 0`: gpBoost is signed, and a `> 0`
// test silently drops every penalty deck, paying Safety the full unmodified
// stake. Mirror of applyDeckBoost in functions/src/casinoEngine.ts.
export function applyDeckBoost(reward: number, choice: CasinoDeckChoice): number {
  const boost = DECK_VARIANTS[choice].gpBoost;
  return boost !== 0 ? Math.round(reward * (1 + boost)) : reward;
}

// Parse the stake back out of already-written slot details lines.
// Used in the UI where we only have participant.slots, not the raw hand.
export function handStakeFromSlots(slots: readonly AdvSlot[] | undefined): number {
  if (!slots) return 0;
  return slots.reduce((sum, s) => {
    const m = s.details?.match(/·\s*(\d+)g$/);
    return sum + (m ? parseInt(m[1], 10) : 0);
  }, 0);
}

// Convert a locked casino hand into the AdvSlots written to the mission participant.
// name and game are intentionally blank — the player fills them in later through
// the normal slot-editing flow, the same way every other mission slot is filled.
// `details` overrides the line stamped on each slot — the Finale passes
// `finaleSlotDetails` so its slots read in stars rather than gold.
export function cardsToSlots(
  hand: readonly CasinoCard[],
  details: (card: CasinoCard, index: number) => string = casinoSlotDetails,
): AdvSlot[] {
  return hand.map((card, i) => ({
    name:    '',
    game:    '',
    details: details(card, i),
    status:  'Unstarted' as const,
  }));
}
