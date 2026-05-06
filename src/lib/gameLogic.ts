import type { Player, Tile, AdvClass, Adventurer } from '../types';
import { LEVEL_THRESHOLDS, MAX_LEVEL } from './constants';
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

// Pure function — returns updated players map
export function awardTileRewards(
  tile: Tile,
  players: Record<string, Player>,
): Record<string, Player> {
  const adventurers = Object.values(tile.adventurers ?? {});
  if (adventurers.length === 0) return players;

  const ownerIds = [...new Set(adventurers.map(a => a.owner))];
  const updated = { ...players };

  for (const ownerId of ownerIds) {
    const p = updated[ownerId];
    if (!p) continue;

    // Free the adventurers that were assigned to this tile
    const myAdvIds = new Set(
      adventurers.filter(a => a.owner === ownerId).map(a => a.advId),
    );
    const clearedAdvs: Record<string, Adventurer> = {};
    for (const [advId, adv] of Object.entries(p.adventurers)) {
      clearedAdvs[advId] = myAdvIds.has(advId)
        ? { ...adv, busy: false, busyTile: null }
        : adv;
    }

    const prevLevel = calcLevel(p.xp);
    const newXp     = p.xp + (tile.xp ?? 0);
    const newGold   = p.gold + (tile.gold ?? 0);
    const newLevel  = calcLevel(newXp);
    let updatedPlayer = { ...p, xp: newXp, gold: newGold, adventurers: clearedAdvs };
    updatedPlayer = checkAndGrantAdventurers(updatedPlayer, prevLevel, newLevel);
    updated[ownerId] = updatedPlayer;
  }

  return updated;
}
