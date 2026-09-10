import type { Player, Tile, TileState, AdvClass, Adventurer, PlayerFeats, GMMission } from '../types';
import { getAdjCoords } from './board';
import { LEVEL_THRESHOLDS, MAX_LEVEL, FEATS, BASE_YAML_LIMITS, FREE_COMPLETED_STATUSES } from './constants';
import type { YamlLimits } from './apYaml';
import { slotsFromEntry } from './slotHelpers';
import { randomAdvName, randomAdvClass, isPassThroughType, typeKeyForCoord } from './tileGen';

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

// How many missions a player may actively hold a claim on at once (the mission
// analogue of the adventurer pool for Challenges). Base 1 — the guildmaster.
// S2's advisor is a level-up bonus that raises this to 2 AND grants a second
// adventurer, both gated on the same future advisor-unlocked signal; when that
// lands it changes here and in adventurerCountForLevel together. A player may
// hold any number of finished-but-settling tables — only un-finished claims
// count against this cap (see missionLogic.hasUnfinishedSlots / activeMissions).
// The param is unused today but is the S2 advisor's input (a level-up bonus that
// raises this to 2); kept in the signature so call sites are already correct.
// The `_` prefix satisfies tsc's noUnusedParameters (used by `tsc -b` in the
// Netlify build); the eslint-disable covers ESLint, which doesn't honor the `_`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function missionClaimCapacity(_player: Player): number {
  return 1;
}

// ── Player status ─────────────────────────────────────────────────────────────
// Three states, derived from two independent booleans on the player record so the
// existing `disabled` wire field (and everything keyed off it — the Auth disable,
// the ban sweep, every callable's disabled check) is unchanged:
//
//   active      — neither flag set. The default.
//   restricted  — `restricted`. Plays as normal, but does NOT get a claim back
//                 early: a mission claim / tile adventurer is held until the world
//                 itself resolves, not the moment that player's own slots go
//                 terminal. The pre-pooled-claims behaviour, as a penalty.
//   disabled    — `disabled`. Cannot play at all; outranks restricted for display.

export type PlayerStatus = 'active' | 'restricted' | 'disabled';

type StatusFlags = Pick<Player, 'disabled' | 'restricted'> | null | undefined;

export function playerStatus(player: StatusFlags): PlayerStatus {
  if (player?.disabled)   return 'disabled';
  if (player?.restricted) return 'restricted';
  return 'active';
}

/**
 * Whether this player's claim may be released as soon as their OWN slots are all
 * free. False for a restricted player, whose claim is instead cleared by the
 * world's completion path (completeMission / awardTileRewards), same as everyone.
 *
 * Every early-release site gates on this: the two tile syncs (ChallengesPage,
 * MapPage), the admin slot edit (GameStateProvider), and the mission sync
 * (MissionsPage). `tickSlotStatuses` in functions/ inlines the same check, the
 * way it already inlines `deriveStatus`.
 */
export function releasesClaimsEarly(player: StatusFlags): boolean {
  return player?.restricted !== true;
}

// ── Admin roster ordering ─────────────────────────────────────────────────────
// The Players page is a roster, not a work queue, so it stays alphabetical — but
// an admin scanning it cares first about who is mid-something. Three bands, then
// name (the player analogue of missionLogic.compareMissionsForAdmin).
//
//   active   — engaged with something LIVE right now.
//   settled  — nothing live, but something behind them this season.
//   none     — nothing this season yet.
//
// The band tracks the TABLE, not the claim: a settling seat — still a participant
// on a live mission, claim already released because their own slots went terminal
// — is `active`, because the admin's question is "who is still at a table", and a
// freed claim does not take them off it. Same on the tile side: an adventurer
// released early off an in-progress tile keeps its player in the top band. What
// distinguishes held from freed is the card's own `· settling` tag, not this.

export type ClaimActivity = 'active' | 'settled' | 'none';

/** The mission/tile records the tier is derived from. All optional — a casino
 *  season has no tiles, and a fresh season has no history. */
export interface ClaimActivityCtx {
  missions?:        Record<string, GMMission> | null;
  missionsHistory?: Record<string, GMMission> | null;
  tiles?:           Record<string, Tile> | null;
}

export function claimActivity(player: Player, ctx: ClaimActivityCtx): ClaimActivity {
  const onTile = (state: TileState) => Object.values(ctx.tiles ?? {})
    .some(tile => tile.state === state
      && Object.values(tile.adventurers ?? {}).some(a => a.owner === player.id));

  // Live: a held claim, a seat at a table that has not settled yet, or an
  // adventurer on a tile still in play. `heldMission` is kept alongside the seat
  // scan so a claim on a mission missing from `missions` still counts.
  const heldMission = Object.keys(player.activeMissions ?? {}).length > 0;
  const busyAdv     = Object.values(player.adventurers ?? {}).some(a => a.busy && a.busyTile);
  const liveSeat    = Object.values(ctx.missions ?? {})
    .some(m => (m.state === 'forming' || m.state === 'inprogress') && !!m.participants?.[player.id]);
  const liveTile    = onTile('available') || onTile('inprogress');
  if (heldMission || busyAdv || liveSeat || liveTile) return 'active';

  // Settled: a finished mission, or an adventurer left on a tile they cleared.
  const inHistory = Object.values(ctx.missionsHistory ?? {})
    .some(m => !!m.participants?.[player.id]);
  return inHistory || onTile('complete') ? 'settled' : 'none';
}

const CLAIM_ACTIVITY_RANK: Record<ClaimActivity, number> = { active: 0, settled: 1, none: 2 };

/**
 * Roster order for the admin Players page: claim activity first, then Discord
 * username. Older records may predate `discordHandle`, so the name key falls back
 * to the display name rather than sinking all of them under an empty key.
 */
export function comparePlayersForAdmin(a: Player, b: Player, ctx: ClaimActivityCtx): number {
  const rank = CLAIM_ACTIVITY_RANK[claimActivity(a, ctx)] - CLAIM_ACTIVITY_RANK[claimActivity(b, ctx)];
  if (rank !== 0) return rank;
  const nameKey = (p: Player) => (p.discordHandle || p.displayName || '').toLowerCase();
  return nameKey(a).localeCompare(nameKey(b));
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

// This player's YAML settings caps: the base limits plus whatever their feats
// raise. The one place FeatDef.yamlEffect is turned into numbers, so the rules
// text, the player's attach-time warning and the host's download badge all read
// the same allowance for the same player.
//
// A player with no feats (or a casino season, where feats don't exist) simply
// gets the base limits back.
export function yamlLimitsForFeats(featIds: string[]): YamlLimits {
  const limits: YamlLimits = { ...BASE_YAML_LIMITS };
  for (const id of featIds) {
    const eff = FEATS.find(f => f.id === id)?.yamlEffect;
    if (!eff) continue;
    limits.startInventory     += eff.startingItems       ?? 0;
    limits.priorityLocations  += eff.priorityLocations   ?? 0;
    limits.excludeLocations   += eff.excludedLocations   ?? 0;
    limits.startHints         += eff.startingHints       ?? 0;
    // "Hinted locations" in feat terms is AP's start_location_hints.
    limits.startLocationHints += eff.hintedLocations     ?? 0;
  }
  return limits;
}

// Convenience wrapper for the common "I have a player record" case.
export function yamlLimitsForPlayer(player?: Player | null): YamlLimits {
  return yamlLimitsForFeats(getPlayerFeatIds(player?.feats));
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

  // Adventurer busy-state desync: player record says busy on a tile but tile disagrees
  for (const [advId, adv] of Object.entries(player.adventurers ?? {})) {
    const name = `${adv.firstName} ${adv.lastName}`;
    if (adv.busy && adv.busyTile) {
      if (!tiles[adv.busyTile]?.adventurers?.[advId]) {
        warnings.push(`${name} marked busy on ${adv.busyTile} but not found on that tile`);
      }
    }
  }
  // Tile-side desync: adventurer is active on a tile but player record doesn't show busy
  for (const [advId, coords] of Object.entries(advTileMap)) {
    const adv = player.adventurers?.[advId];
    if (!adv) {
      warnings.push(`Adventurer ${advId} is active on ${coords.join(', ')} but missing from player record`);
    } else if (!adv.busy) {
      const name = `${adv.firstName} ${adv.lastName}`;
      warnings.push(`${name} is active on ${coords.join(', ')} but not marked busy in player record`);
    }
  }

  // nameColor set without owning the Coat of Many Colors
  if (player.nameColor && (player.inventory?.['coat_of_many_colors'] ?? 0) === 0) {
    warnings.push('Has a custom name color but does not own Coat of Many Colors');
  }

  return warnings;
}

// ── Tile availability recalculation ───────────────────────────────────────────

// Pure function — given a tile state change, returns only the coords whose
// state differs from the current map (hidden→available derivation included).
//
// `isPassThrough` is injected so this stays pure and unit-testable; it defaults
// to the tileGen type lookup. A pass-through tile (S2 dungeon / Tower) reveals
// its neighbours while merely REVEALED, without ever completing — see
// isPassThroughType. On an S1 board nothing is pass-through and the behaviour is
// byte-for-byte what it always was.
export function computeRecalcUpdates(
  tiles: Record<string, Tile>,
  coord: string,
  newState: TileState,
  isPassThrough: (coord: string) => boolean = defaultIsPassThrough,
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

  // Fixpoint: a revealed pass-through tile reveals its own neighbours, which may
  // reveal a further pass-through tile. Dungeons are ≥3 apart today so chains
  // can't actually occur, but the loop costs nothing and survives a layout
  // change. Bounded by the tile count — each pass reveals at least one tile or
  // stops.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [c, state] of Object.entries(map)) {
      if (state === 'hidden' || !isPassThrough(c)) continue;
      for (const adjCoord of getAdjCoords(c)) {
        if (map[adjCoord] === 'hidden') { map[adjCoord] = 'available'; changed = true; }
      }
    }
  }

  const updates: Record<string, TileState> = {};
  for (const [c, s] of Object.entries(map)) {
    if (tiles[c]?.state !== s) updates[c] = s;
  }
  return updates;
}

function defaultIsPassThrough(coord: string): boolean {
  return isPassThroughType(typeKeyForCoord(coord));
}
