// ── Server mirror: the trait values the server actually validates ─────────────
//
// Deliberately NOT the whole trait table. The server only ever needs the values
// it enforces at a join, which today is the Horde floor; descriptions, levels
// and the other fifteen traits are display concerns the client owns.
//
// ⚠️ DUAL COPY — mirrors HORDE_V in src/lib/traits.ts. If that ladder changes,
// change it here too, or the server will accept a join the client rejected (or
// worse, the reverse). Listed alongside ITEM_COSTS and casinoEngine.ts in
// CLAUDE.md's mirror list.

/** Minimum games per slot at Horde level 1 / 2 / 3. */
const HORDE_VALUES = [2, 3, 4] as const;

/** A tile's stored trait entry. `value` is the legacy S1 shape. */
export interface TraitEntryLike {
  level?: number;
  count?: number;
  value?: number;
}

/**
 * Minimum games a slot must carry on this tile — 1 when Horde is absent.
 *
 * Mirrors `hordeFloor` in src/lib/traits.ts, including its tolerance of legacy
 * S1 records (a stored `value` maps back onto its level; an unrecognised one
 * reads as level 1 rather than "off").
 */
export function hordeFloor(traits: Record<string, TraitEntryLike> | undefined): number {
  const entry = traits?.['horde'];
  if (!entry) return 1;

  let level: number;
  if (entry.level != null) {
    level = entry.level;
  } else if (entry.value != null) {
    const i = (HORDE_VALUES as readonly number[]).indexOf(entry.value);
    level = i >= 0 ? i + 1 : 1;
  } else {
    level = 1;
  }

  if (level <= 0) return 1;
  return HORDE_VALUES[Math.min(level, HORDE_VALUES.length) - 1];
}

/** Slot-count bounds a player may declare at a join (map plan §0.5.1). */
export const MIN_DECLARED_SLOTS = 1;
export const MAX_DECLARED_SLOTS = 5;
