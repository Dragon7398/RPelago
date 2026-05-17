import type { Player, Tile, TileState, AdvClass, Adventurer, PlayerFeats } from '../types';
import { LEVEL_THRESHOLDS, MAX_LEVEL, FEATS, getAdjCoords, FREE_COMPLETED_STATUSES } from './constants';
import { slotsFromEntry } from './slotHelpers';
import { randomAdvName, randomAdvClass } from './tileGen';

export function calcLevel(xp: number): number {
  let lv = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) lv = i + 1;
    else break;
  }
  return lv;
}

export function xpForLevel(lv: number): number {
  return LEVEL_THRESHOLDS[lv - 1] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
}

export function xpForNextLevel(lv: number): number | null {
  if (lv >= MAX_LEVEL) return null;
  return LEVEL_THRESHOLDS[lv];
}

export function adventurerCountForLevel(lv: number): number {
  let count = 1;
  if (lv >= 2) count++;
  if (lv >= 4) count++;
  if (lv >= 6) count++;
  return count;
}

export function checkAndGrantAdventurers(player: Player, prevLevel: number, newLevel: number): Player {
  if (newLevel <= prevLevel) return player;

  const prevCount = adventurerCountForLevel(prevLevel);
  const newCount  = adventurerCountForLevel(newLevel);
  const toAdd     = newCount - prevCount;
  if (toAdd <= 0) return player;

  const updated = { ...player, adventurers: { ...player.adventurers } };
  for (let i = 0; i < toAdd; i++) {
    const usedClasses = Object.values(updated.adventurers).map(a => a.cls);
    const cls = randomAdvClass(usedClasses) as AdvClass;
    const { firstName, lastName } = randomAdvName();
    const id = `${player.id}-adv-${Date.now()}-${i}`;
    updated.adventurers[id] = { id, firstName, lastName, cls, busy: false, busyTile: null };
  }
  return updated;
}

// ── Feat helpers ───────────────────────────────────────────────────────────────

export function getPlayerFeatIds(feats?: PlayerFeats): string[] {
  if (!feats) return [];
  return [feats.level3, feats.level5, feats.level7].filter(Boolean) as string[];
}

// Returns feat IDs still available to pick for the given level slot
export function getAvailableFeatsForSlot(
  slot: 'level3' | 'level5' | 'level7',
  currentFeats: PlayerFeats,
): string[] {
  const taken = new Set([currentFeats.level3, currentFeats.level5, currentFeats.level7].filter(Boolean));
  const byLevel = (lv: 3 | 5 | 7) => FEATS.filter(f => f.availableAt === lv).map(f => f.id);

  let candidates: string[];
  if (slot === 'level3') {
    candidates = byLevel(3);
  } else if (slot === 'level5') {
    candidates = [...byLevel(5), ...byLevel(3)];
  } else {
    candidates = [...byLevel(7), ...byLevel(5), ...byLevel(3)];
  }

  return candidates.filter(id => !taken.has(id));
}

// Returns the feat slot that is available for selection at the player's current level
export function pendingFeatSlot(
  level: number,
  feats: PlayerFeats,
): 'level3' | 'level5' | 'level7' | null {
  if (level >= 7 && !feats.level7) return 'level7';
  if (level >= 5 && !feats.level5) return 'level5';
  if (level >= 3 && !feats.level3) return 'level3';
  return null;
}

function hasFeat(playerId: string, featId: string, players: Record<string, Player>): boolean {
  const f = players[playerId]?.feats;
  if (!f) return false;
  return f.level3 === featId || f.level5 === featId || f.level7 === featId;
}

// XP/Gold multipliers from Mentor/Treasurer feats for a specific player on a tile.
// Mentor: OTHER Mentors give everyone (incl. self) +5% each; self as Mentor gets +1% per other player.
// Treasurer: OTHER Treasurers give everyone +10% each; self as Treasurer gets +3% per other player.
export function calcFeatBonuses(
  ownerId: string,
  ownerIds: string[],
  players: Record<string, Player>,
): { xpMultiplier: number; goldMultiplier: number } {
  const otherOwners = ownerIds.filter(id => id !== ownerId);
  const isMentor    = hasFeat(ownerId, 'mentor',    players);
  const isTreasurer = hasFeat(ownerId, 'treasurer', players);

  const otherMentorCount    = otherOwners.filter(id => hasFeat(id, 'mentor',    players)).length;
  const otherTreasurerCount = otherOwners.filter(id => hasFeat(id, 'treasurer', players)).length;

  const xpBonus   = otherMentorCount    * 0.05 + (isMentor    ? otherOwners.length * 0.01 : 0);
  const goldBonus = otherTreasurerCount * 0.10 + (isTreasurer ? otherOwners.length * 0.03 : 0);

  return { xpMultiplier: 1 + xpBonus, goldMultiplier: 1 + goldBonus };
}

export function buildXpBonusTooltip(
  ownerId: string,
  ownerIds: string[],
  players: Record<string, Player>,
): string | null {
  const isMentor        = hasFeat(ownerId, 'mentor', players);
  const otherOwners     = ownerIds.filter(id => id !== ownerId);
  const otherMentors    = otherOwners.filter(id => hasFeat(id, 'mentor', players));

  const totalPct = otherMentors.length * 5 + (isMentor ? otherOwners.length : 0);
  if (totalPct === 0) return null;

  const parts: string[] = [];
  if (otherMentors.length > 0) {
    const n = otherMentors.length;
    parts.push(`${n} ${isMentor ? 'other ' : ''}Mentor${n !== 1 ? 's' : ''} on challenge`);
  }
  if (isMentor && otherOwners.length > 0) {
    const n = otherOwners.length;
    parts.push(`${n} other player${n !== 1 ? 's' : ''} on challenge`);
  }

  return `+${totalPct}% due to ${parts.join(' and ')}`;
}

export function buildGoldBonusTooltip(
  ownerId: string,
  ownerIds: string[],
  players: Record<string, Player>,
): string | null {
  const isTreasurer     = hasFeat(ownerId, 'treasurer', players);
  const otherOwners     = ownerIds.filter(id => id !== ownerId);
  const otherTreasurers = otherOwners.filter(id => hasFeat(id, 'treasurer', players));

  const totalPct = otherTreasurers.length * 10 + (isTreasurer ? otherOwners.length * 3 : 0);
  if (totalPct === 0) return null;

  const parts: string[] = [];
  if (otherTreasurers.length > 0) {
    const n = otherTreasurers.length;
    parts.push(`${n} ${isTreasurer ? 'other ' : ''}Treasurer${n !== 1 ? 's' : ''} on challenge`);
  }
  if (isTreasurer && otherOwners.length > 0) {
    const n = otherOwners.length;
    parts.push(`${n} other player${n !== 1 ? 's' : ''} on challenge`);
  }

  return `+${totalPct}% due to ${parts.join(' and ')}`;
}

export function calcSeekerHintReduction(
  ownerIds: string[],
  players: Record<string, Player>,
): number {
  return ownerIds.filter(id => hasFeat(id, 'seeker', players)).length;
}

export function buildSeekerHintTooltip(seekerCount: number): string | null {
  if (seekerCount === 0) return null;
  return `-${seekerCount}% due to ${seekerCount} Seeker${seekerCount !== 1 ? 's' : ''} on challenge`;
}

// ── Reward distribution ────────────────────────────────────────────────────────

// Pure function — returns updated players map
export function awardTileRewards(
  tile: Tile,
  players: Record<string, Player>,
  coord: string,
): Record<string, Player> {
  const adventurers = Object.values(tile.adventurers ?? {});
  if (adventurers.length === 0) return players;

  const ownerIds = [...new Set(adventurers.map(a => a.owner))];
  const updated = { ...players };

  for (const ownerId of ownerIds) {
    const p = updated[ownerId];
    if (!p) continue;

    // Free adventurers still assigned to this tile. Skip ones that were released
    // early (slot completion) and may now be busy on a different tile.
    const myAdvIds = new Set(
      adventurers.filter(a => a.owner === ownerId).map(a => a.advId),
    );
    const clearedAdvs: Record<string, Adventurer> = {};
    for (const [advId, adv] of Object.entries(p.adventurers)) {
      clearedAdvs[advId] = myAdvIds.has(advId) && adv.busyTile === coord
        ? { ...adv, busy: false, busyTile: null }
        : adv;
    }

    // Sum flat slot bonuses across all this player's adventurers on the tile
    let slotBonusXP = 0;
    let slotBonusGold = 0;
    for (const adv of adventurers.filter(a => a.owner === ownerId)) {
      const advSlots = slotsFromEntry(adv);
      for (const slot of advSlots) {
        slotBonusXP   += slot.bonusXP   ?? 0;
        slotBonusGold += slot.bonusGold ?? 0;
      }
    }

    const { xpMultiplier, goldMultiplier } = calcFeatBonuses(ownerId, ownerIds, updated);
    const prevLevel = calcLevel(p.xp);
    const newXp    = p.xp   + Math.round((tile.xp   ?? 0) * xpMultiplier) + slotBonusXP;
    const newGold  = p.gold + Math.round((tile.gold ?? 0) * goldMultiplier) + slotBonusGold;
    const newLevel = calcLevel(newXp);
    let updatedPlayer = { ...p, xp: newXp, gold: newGold, adventurers: clearedAdvs };
    updatedPlayer = checkAndGrantAdventurers(updatedPlayer, prevLevel, newLevel);
    updated[ownerId] = updatedPlayer;
  }

  return updated;
}

// ── Player validation ──────────────────────────────────────────────────────────

const SLOT_MIN_LEVEL: Record<string, number>   = { level3: 3, level5: 5, level7: 7 };
const SLOT_ALLOWED:   Record<string, number[]> = { level3: [3], level5: [3, 5], level7: [3, 5, 7] };

export function getFeatWarnings(player: Player, tiles: Record<string, Tile>): string[] {
  const feats = player.feats ?? {};
  const level = calcLevel(player.xp);
  const warnings: string[] = [];

  for (const [slot, featId] of Object.entries(feats)) {
    if (!featId) continue;
    const def = FEATS.find(f => f.id === featId);
    if (!def) {
      warnings.push(`${slot}: unrecognised feat ID "${featId}"`);
      continue;
    }
    if (!(SLOT_ALLOWED[slot] ?? []).includes(def.availableAt)) {
      warnings.push(`${slot}: ${def.name} (tier ${def.availableAt}) is not valid for this slot`);
    }
    if (level < (SLOT_MIN_LEVEL[slot] ?? 99)) {
      warnings.push(`${slot}: ${def.name} requires level ${SLOT_MIN_LEVEL[slot]}, player is level ${level}`);
    }
  }

  const maxAdvs  = adventurerCountForLevel(level);
  const advCount = Object.keys(player.adventurers ?? {}).length;
  if (advCount > maxAdvs) {
    warnings.push(`Has ${advCount} adventurers but level ${level} allows ${maxAdvs}`);
  }

  const FREE_SLOT_STATUSES = FREE_COMPLETED_STATUSES;
  const isActiveOnTile = (slots: Tile['adventurers'][string]['slots']) => {
    if (!slots || slots.length === 0) return true;
    return !slots.every(s => s.status && FREE_SLOT_STATUSES.has(s.status));
  };
  const advTileMap: Record<string, string[]> = {};
  for (const [coord, tile] of Object.entries(tiles)) {
    for (const [advId, ta] of Object.entries(tile.adventurers ?? {})) {
      if (ta.owner === player.id && isActiveOnTile(ta.slots)) {
        (advTileMap[advId] ??= []).push(coord);
      }
    }
  }
  for (const [advId, coords] of Object.entries(advTileMap)) {
    if (coords.length > 1) {
      const adv  = player.adventurers?.[advId];
      const name = adv ? `${adv.firstName} ${adv.lastName}` : advId;
      warnings.push(`${name} is double-assigned: ${coords.join(', ')}`);
    }
  }

  return warnings;
}

// ── Tile availability recalculation ───────────────────────────────────────────

// Pure function — given a tile state change, returns only the coords whose
// state differs from the current map (hidden→available derivation included).
export function computeRecalcUpdates(
  tiles: Record<string, Tile>,
  coord: string,
  newState: TileState,
): Record<string, TileState> {
  const map: Record<string, TileState> = {};
  for (const [c, t] of Object.entries(tiles)) map[c] = t.state;
  map[coord] = newState;

  for (const c of Object.keys(map)) {
    if (map[c] === 'available') map[c] = 'hidden';
  }

  for (const [c, state] of Object.entries(map)) {
    if (state !== 'complete') continue;
    for (const adjCoord of getAdjCoords(c)) {
      if (map[adjCoord] === 'hidden') map[adjCoord] = 'available';
    }
  }

  const updates: Record<string, TileState> = {};
  for (const [c, s] of Object.entries(map)) {
    if (tiles[c]?.state !== s) updates[c] = s;
  }
  return updates;
}
