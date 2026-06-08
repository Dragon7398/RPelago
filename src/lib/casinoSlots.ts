// Casino slot mapping — converts a locked card hand into mission AdvSlots.
// The core integration mapping: each committed card becomes one slot with
// blank name/game and the card's genre + gold value in the Details field.

import type { AdvSlot } from '../types';

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

// The total gold a seat is "playing for" — sum of all locked card values
export function handStake(hand: readonly CasinoCard[]): number {
  return hand.reduce((sum, c) => sum + (c.value ?? 0), 0);
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
export function cardsToSlots(hand: readonly CasinoCard[]): AdvSlot[] {
  return hand.map((card) => ({
    name:    '',
    game:    '',
    details: casinoSlotDetails(card),
    status:  'Unstarted' as const,
  }));
}
