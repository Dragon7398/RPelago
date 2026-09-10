import type { AdvSlot, GMParticipant, SlotStatus } from '../../types';
import type { CardTypeKey } from '../../lib/casinoData';

/**
 * One committed card of a casino seat, flattened for display.
 *
 * A seat's `slots` and its `lockedCards` are index-aligned — the card carries the
 * genre and gold value, the slot carries the game the player put behind it — so
 * every view that shows "what someone brought" has to walk them in step. This is
 * that walk, kept out of PhasePanel so both the table board and the profile's
 * history can use it (a plain function exported from a component module trips
 * react-refresh/only-export-components).
 */
export interface SeatGame {
  // NB: `slot` is the slot's NAME, not the slot object — `raw` is the object.
  slot: string; game: string; cardName: string; type?: CardTypeKey; status: SlotStatus;
  claimed?: boolean; claimedFrom?: string;
  /** Index into the seat's `slots` array — the address `setSlotStatusNote` writes to. */
  idx: number;
  raw: AdvSlot;
}

export function seatGames(seat: GMParticipant): SeatGame[] {
  const slots = seat.slots ?? [];
  const cards = seat.lockedCards ?? [];
  return slots.map((s, i) => ({
    slot:     s.name?.trim() || `Seat ${i + 1}`,
    game:     s.game?.trim() || cards[i]?.name || 'Unfilled',
    cardName: cards[i]?.name ?? '',
    type:     cards[i]?.type,
    status:   s.status ?? 'Unstarted',
    idx:      i,
    raw:      s,
    // A slot taken over from someone who left. Worth showing: it explains why a
    // seat holds more cards than it was dealt, and who was originally on the hook.
    ...(s.claimed ? { claimed: true, claimedFrom: s.claimedFrom } : {}),
  }));
}
