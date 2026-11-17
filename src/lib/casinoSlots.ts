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

/**
 * The cards a seat may still re-pick from, with everything the host has struck off
 * it removed.
 *
 * `adminRemoveCasinoSlot` rewrites `slots` / `lockedCards` / `goldSwing`, but it
 * cannot touch the seat's dealt POOL — the secret hand, the hole+community, or the
 * finale row — which is what `resubmitCasinoYaml` re-selects from. Without this a
 * denied player simply re-picks the card the host just took off them: after a
 * KICK that card is live as somebody else's claimable slot, so the room would hold
 * two slots for one card and the pot would pay weight for both; after a VOID the
 * card was declared unplayable and its weight already released to the table, so
 * re-picking it over-pays against a denominator that has already shrunk.
 *
 * Applied on BOTH sides — the callable and `CasinoTable`'s `resubmitPool` — or the
 * client offers a card the server will refuse to commit.
 *
 * ⚠️ `removedCardUids` holds OWN cards only. A claimed card's uid belongs to
 * another player's deck (`DeckCard.uid` is a per-deck index from 0), so recording
 * one could exclude an unrelated own card that happens to share the number. The
 * `typeof` guard is not defensive noise either: RTDB hands an array with holes
 * back with `undefined` in them.
 */
export function repickPool<T extends { uid: number }>(
  pool: readonly T[] | undefined,
  seat: { removedCardUids?: number[] } | undefined,
): T[] {
  const struck = new Set((seat?.removedCardUids ?? []).filter(u => typeof u === 'number'));
  return (pool ?? []).filter(c => !!c && !struck.has(c.uid));
}

/**
 * The `lockedCount` a card re-pick should stamp — the DENOMINATOR the seat's pot
 * weight is measured against (`seatPotWeight` = own remaining / lockedCount).
 *
 * ⚠️ **A struck card stays in the denominator while the table is LIVE.** A void
 * released `1/lockedCount` of the pot to the table (`casinoVoidedShare`) and a kick
 * reserved it on the claim entry — both carved against the count stamped at lock.
 * Restamping to the new, smaller hand puts the seat back to a FULL unit while that
 * fraction is still released or reserved elsewhere, and the table then pays out more
 * than its pot. It is the same over-pay `repickPool` exists to stop, arriving by the
 * other door: the pool filter keeps the struck CARD out, and this keeps its SHARE
 * out.
 *
 * Pre-deploy there is nothing to conserve — `casinoShareUnits` is banked at deploy
 * and a forming void skips the `casinoVoidedShare` increment entirely — so a forming
 * seat is one whole unit however often its hand is rebuilt, and carrying struck cards
 * there would underpay it for nothing.
 *
 * The residual: a card struck while FORMING and re-picked after deploy counts here
 * without ever having released anything, costing that seat one card's share.
 * Underpaying is the direction this pot errs in by design — an unclaimed kick reserve
 * is never paid out either — so that is the safe side to land on.
 */
export function repickLockedCount(
  missionState: string | undefined,
  committedCount: number,
  seat: { removedCardUids?: number[] } | undefined,
): number {
  if (missionState === 'forming') return committedCount;
  const struck = (seat?.removedCardUids ?? []).filter(u => typeof u === 'number').length;
  return committedCount + struck;
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
