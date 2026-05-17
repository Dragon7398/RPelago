import type { AdvSlot, TileAdventurer } from '../types';

export function normalizeSlots(raw: AdvSlot[] | Record<string, AdvSlot> | undefined): AdvSlot[] {
  if (!raw) return [];
  // Firebase may return a dense array or an object with numeric keys
  return Array.isArray(raw) ? raw : Object.values(raw);
}

export function slotsFromEntry(entry: TileAdventurer): AdvSlot[] {
  return normalizeSlots(entry.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
}
