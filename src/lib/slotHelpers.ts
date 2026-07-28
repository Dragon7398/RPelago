import type { AdvSlot, SlotStatus, TileAdventurer } from '../types';
import { FREE_COMPLETED_STATUSES } from './constants';

export function normalizeSlots(raw: AdvSlot[] | Record<string, AdvSlot> | undefined): AdvSlot[] {
  if (!raw) return [];
  // Firebase may return a dense array or an object with numeric keys
  return Array.isArray(raw) ? raw : Object.values(raw);
}

export function slotsFromEntry(entry: TileAdventurer): AdvSlot[] {
  return normalizeSlots(entry.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
}

// ── Slot-completion core (shared by Challenges and Missions) ────────────────────
// A slot is "free" once its status is terminal (100%/Goaled/Done). Both the tile
// adventurer-release and the mission claim-reclaim key off this single predicate.

/**
 * True when a claimant's slots are all free — i.e. the claim (adventurer on a
 * tile, or guildmaster on a mission) can be released early. Empty/absent slots
 * are NOT free (nothing has been played yet), matching the tile/mission counters.
 */
export function slotsAllFree(slots?: { status?: SlotStatus }[]): boolean {
  const list = slots ?? [];
  if (list.length === 0) return false;
  return list.every(s => s.status != null && FREE_COMPLETED_STATUSES.has(s.status));
}

/**
 * Count claimants (tile adventurers or mission participants) that still have at
 * least one unfinished slot. A claimant with no slots counts as unfinished only
 * when `emptyCountsUnfinished` is set — missions treat a slotless participant as
 * unfinished (they haven't locked a hand), tiles skip them.
 */
export function countUnfinishedSets(
  sets: { slots?: AdvSlot[] }[],
  emptyCountsUnfinished: boolean,
): number {
  let count = 0;
  for (const s of sets) {
    const slots = normalizeSlots(s.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
    if (slots.length === 0) {
      if (emptyCountsUnfinished) count++;
      continue;
    }
    if (!slotsAllFree(slots)) count++;
  }
  return count;
}
