import { ref, set, update, get, onValue, remove, push } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseReady, functions } from './config';
import type { GameState, Tile, TileState, Player, Adventurer, AdvClass, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot, ActivityEntry, ActivityType, PlayerWarning, AdvStatusNote, SlotStatus, TriState, GMMission, KmkStatus } from '../types';
import { buildDefaultTileData, initializeGrid, computeTownShopIds, randomAdvClass, randomAdvName } from '../lib/tileGen';
import { ALL_ORBS, DEFAULT_SHOPS, MISSIONS_CLOSED_FOR_SEASON } from '../lib/constants';
import { normalizeSlots } from '../lib/slotHelpers';
import { freshMission, missionDisplayLabel, hasUnfinishedSlots } from '../lib/missionLogic';
import { calcLevel, checkAndGrantAdventurers, adventurerCountForLevel } from '../lib/gameLogic';

function assertDb() {
  if (!db || !firebaseReady) throw new Error('Firebase is not configured. Fill in .env with your Firebase project values.');
}

// ── Default values ────────────────────────────────────────────────────────────
function defaultOrbConfig(): OrbConfig {
  const effects: Record<string, string> = {};
  ALL_ORBS.forEach(o => {
    effects[o.id] = `The ${o.label} curse weakens your party while the ${o.label} Orb is absent.`;
  });
  return {
    eliteDrops:    [0, 1, 2, 3, 4],
    shopOrbs:      [5, 6],
    battleOrb:     7,
    puzzleOrb:     8,
    bossMinOrbs:   5,
    bossNegEffects: effects,
  };
}

// ── Initialize ────────────────────────────────────────────────────────────────
export async function initializeGameIfNeeded(uid?: string): Promise<void> {
  assertDb();
  const d = db!;
  const snap = await get(ref(d, 'game/meta'));
  if (!snap.exists() || !snap.val()?.initialized) {
    const seed      = Math.floor(Math.random() * 0x7FFFFFFF);
    const orbConfig = defaultOrbConfig();
    initializeGrid(seed);

    // Phase 1: write meta so the calling user becomes admin and the game is marked initialized.
    // game/meta allows any auth'd write when !initialized (DB rule).
    await set(ref(d, 'game/meta'), { adminId: uid ?? '', initialized: true, seed });

    // Phase 2: write the rest of the game data. The user is now admin (adminId === uid).
    const now = Date.now();
    const basicRef  = push(ref(d, 'game/missions'));
    const patrolRef = push(ref(d, 'game/missions'));
    const casinoRef = push(ref(d, 'game/missions'));
    const initialMissions: Record<string, unknown> = {
      [basicRef.key!]:  { ...freshMission('basic',  1, now), id: basicRef.key  },
      [patrolRef.key!]: { ...freshMission('patrol', 1, now), id: patrolRef.key },
      [casinoRef.key!]: { ...freshMission('casino', 1, now), id: casinoRef.key },
    };
    await update(ref(d), {
      'game/tiles':     buildDefaultTileData(seed),
      'game/players':   {},
      'game/orbState':  {},
      'game/orbConfig': orbConfig,
      'game/shops':     { ...DEFAULT_SHOPS },
      'game/missions':  initialMissions,
    });
    return;
  }

  // Migration: add shops and tile shopIds for games created before the shop system
  const shopsSnap = await get(ref(d, 'game/shops'));
  if (!shopsSnap.exists()) {
    const seed = snap.val()?.seed as number | undefined;
    const migrationUpdates: Record<string, unknown> = { 'game/shops': { ...DEFAULT_SHOPS } };
    if (seed != null) {
      for (const [coord, shopId] of Object.entries(computeTownShopIds(seed))) {
        migrationUpdates[`game/tiles/${coord}/shopId`] = shopId;
      }
    }
    // Migration requires admin access; silently skip if the current user isn't admin.
    try {
      await update(ref(d), migrationUpdates);
    } catch {
      // Non-admin users can't run the migration; admin will complete it on next load.
    }
  }

  // Migration: seed mission cohorts for games created before the mission system,
  // or add casino cohort to games created before the casino mission was added.
  const missionsSnap = await get(ref(d, 'game/missions'));
  const existingMissions = missionsSnap.exists() ? (missionsSnap.val() as Record<string, GMMission>) : {};
  const activeMissions = Object.values(existingMissions);
  const needsBasic  = !activeMissions.some(m => m.type === 'basic'  && m.state !== 'complete');
  const needsPatrol = !activeMissions.some(m => m.type === 'patrol' && m.state !== 'complete');
  const needsCasino = !activeMissions.some(m => m.type === 'casino' && m.state !== 'complete');
  if (needsBasic || needsPatrol || needsCasino) {
    const now = Date.now();
    const migrationUpdates: Record<string, unknown> = {};
    if (needsBasic)  { const r = push(ref(d, 'game/missions')); migrationUpdates[`game/missions/${r.key}`] = { ...freshMission('basic',  1, now), id: r.key }; }
    if (needsPatrol) { const r = push(ref(d, 'game/missions')); migrationUpdates[`game/missions/${r.key}`] = { ...freshMission('patrol', 1, now), id: r.key }; }
    if (needsCasino) { const r = push(ref(d, 'game/missions')); migrationUpdates[`game/missions/${r.key}`] = { ...freshMission('casino', 1, now), id: r.key }; }
    try {
      await update(ref(d), migrationUpdates);
    } catch (err) {
      console.warn('[RPelago] Mission seeding skipped (non-admin or rules error):', err);
    }
  }
}

// Seed mission cohorts for each type that has no active (forming/inprogress) cohort.
// Safe to call on any existing game mid-season — only creates what is missing.
export async function seedInitialMissions(): Promise<boolean> {
  if (MISSIONS_CLOSED_FOR_SEASON) return false;
  assertDb();
  const d = db!;
  const snap = await get(ref(d, 'game/missions'));
  const existing = snap.exists() ? (snap.val() as Record<string, GMMission>) : {};
  const active = Object.values(existing);

  const hasBasic  = active.some(m => m.type === 'basic'  && m.state !== 'complete');
  const hasPatrol = active.some(m => m.type === 'patrol' && m.state !== 'complete');
  const hasCasino = active.some(m => m.type === 'casino' && m.state !== 'complete');

  if (hasBasic && hasPatrol && hasCasino) return false;

  const now = Date.now();
  const updates: Record<string, unknown> = {};

  if (!hasBasic) {
    const r = push(ref(d, 'game/missions'));
    updates[`game/missions/${r.key}`] = { ...freshMission('basic',  1, now), id: r.key };
  }
  if (!hasPatrol) {
    const r = push(ref(d, 'game/missions'));
    updates[`game/missions/${r.key}`] = { ...freshMission('patrol', 1, now), id: r.key };
  }
  if (!hasCasino) {
    const r = push(ref(d, 'game/missions'));
    updates[`game/missions/${r.key}`] = { ...freshMission('casino', 1, now), id: r.key };
  }

  await update(ref(d), updates);
  return true;
}

// ── Subscribe to full game state ──────────────────────────────────────────────
export function subscribeToGame(
  callback: (state: GameState | null) => void,
): () => void {
  assertDb();
  const d = db!;
  return onValue(ref(d, 'game'), snap => {
    callback(snap.exists() ? (snap.val() as GameState) : null);
  });
}

// ── Tile mutations ────────────────────────────────────────────────────────────
export async function setTileState(coord: string, state: TileState): Promise<void> {
  await update(ref(db!, `game/tiles/${coord}`), { state, stunnedAdvId: null, tauntedAdvId: null });
}

export async function setTileInProgress(
  coord: string,
  stunnedAdvId: string | null,
  tauntedAdvId: string | null,
  roomAssignments?: Record<string, 1 | 2>,
  extraUpdates?: Record<string, unknown>,
): Promise<void> {
  const updates: Record<string, unknown> = { [`game/tiles/${coord}/state`]: 'inprogress' };
  updates[`game/tiles/${coord}/stunnedAdvId`] = stunnedAdvId;
  updates[`game/tiles/${coord}/tauntedAdvId`] = tauntedAdvId;
  if (roomAssignments) {
    for (const [advId, room] of Object.entries(roomAssignments)) {
      updates[`game/tiles/${coord}/adventurers/${advId}/room`] = room;
    }
  }
  if (extraUpdates) Object.assign(updates, extraUpdates);
  await update(ref(db!), updates);
}

export async function updateTileAdmin(coord: string, updates: Partial<Tile>): Promise<void> {
  await update(ref(db!, `game/tiles/${coord}`), { ...updates, adminOverride: true });
}

export async function resetTileStats(coord: string, stats: Partial<Tile>): Promise<void> {
  assertDb();
  await update(ref(db!, `game/tiles/${coord}`), { ...stats, adminOverride: false });
}

export async function setTilesAvailability(
  stateUpdates: Record<string, TileState>,
  inProgressCoord?: string,
  stunnedAdvId?: string | null,
  tauntedAdvId?: string | null,
  roomAssignments?: Record<string, 1 | 2>,
  extraUpdates?: Record<string, unknown>,
): Promise<void> {
  assertDb();
  const updates: Record<string, unknown> = {};
  for (const [c, s] of Object.entries(stateUpdates)) {
    updates[`game/tiles/${c}/state`] = s;
  }
  if (inProgressCoord != null) {
    updates[`game/tiles/${inProgressCoord}/stunnedAdvId`] = stunnedAdvId ?? null;
    updates[`game/tiles/${inProgressCoord}/tauntedAdvId`] = tauntedAdvId ?? null;
    if (roomAssignments) {
      for (const [advId, room] of Object.entries(roomAssignments)) {
        updates[`game/tiles/${inProgressCoord}/adventurers/${advId}/room`] = room;
      }
    }
  }
  if (extraUpdates) Object.assign(updates, extraUpdates);
  await update(ref(db!), updates);
}

export async function assignAdventurer(coord: string, entry: TileAdventurer): Promise<void> {
  await update(ref(db!), {
    [`game/tiles/${coord}/adventurers/${entry.advId}`]:                entry,
    [`game/players/${entry.owner}/adventurers/${entry.advId}/busy`]:    true,
    [`game/players/${entry.owner}/adventurers/${entry.advId}/busyTile`]: coord,
  });
}

export async function removeAdventurer(coord: string, advId: string, ownerId: string): Promise<void> {
  await update(ref(db!), {
    [`game/tiles/${coord}/adventurers/${advId}`]:                    null,
    [`game/players/${ownerId}/adventurers/${advId}/busy`]:    false,
    [`game/players/${ownerId}/adventurers/${advId}/busyTile`]: null,
  });
}

export async function completeTile(
  coord: string,
  updatedPlayers: Record<string, Player>,
  revealCoords: { coord: string; newState: TileState }[],
  orbAcquisitions: Record<string, OrbAcquisition> = {},
  tileName?: string,
  awardedAmounts?: Record<string, { xp: number; gold: number }>,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  updates[`game/tiles/${coord}/state`] = 'complete';

  for (const { coord: nc, newState } of revealCoords) {
    updates[`game/tiles/${nc}/state`] = newState;
  }
  for (const [playerId, player] of Object.entries(updatedPlayers)) {
    updates[`game/players/${playerId}`] = player;
  }
  for (const [orbId, acquisition] of Object.entries(orbAcquisitions)) {
    updates[`game/orbState/${orbId}`] = acquisition;
  }

  if (awardedAmounts) {
    const now = Date.now();
    const name = tileName || coord;
    for (const [playerId, amounts] of Object.entries(awardedAmounts)) {
      const entryKey = push(ref(db!, `game/players/${playerId}/completedChallenges`)).key!;
      const entry = {
        coord,
        name,
        xpAwarded:   amounts.xp,
        goldAwarded: amounts.gold,
        completedAt: now,
      };
      // Merge into the existing player write rather than adding a separate child
      // path — Firebase RTDB rejects update() calls where one path is a prefix
      // of another (key-path conflict).
      const playerWrite = updates[`game/players/${playerId}`] as Record<string, unknown>;
      if (playerWrite) {
        const existing = (playerWrite.completedChallenges ?? {}) as Record<string, unknown>;
        playerWrite.completedChallenges = { ...existing, [entryKey]: entry };
      } else {
        updates[`game/players/${playerId}/completedChallenges/${entryKey}`] = entry;
      }
    }
  }

  await update(ref(db!), updates);

  for (const orbId of Object.keys(orbAcquisitions)) {
    const orb  = ALL_ORBS.find(o => o.id === orbId);
    const name = tileName || coord;
    await logActivity('orb_collected', `${orb?.label ?? orbId} Orb gathered from ${name}.`, orb?.icon ?? '🔮');
  }
}

// Writes CompletedChallenge records for a tile that completed before history
// tracking was added. Uses base tile XP/Gold — feat bonuses at time of
// completion are unknown and not applied.
export async function backfillChallengeHistory(coord: string): Promise<number> {
  assertDb();
  const [tileSnap, playersSnap] = await Promise.all([
    get(ref(db!, `game/tiles/${coord}`)),
    get(ref(db!, 'game/players')),
  ]);
  if (!tileSnap.exists()) throw new Error(`Tile ${coord} not found.`);

  const tile    = tileSnap.val() as Tile;
  const players = (playersSnap.val() ?? {}) as Record<string, Player>;
  const now     = Date.now();
  const name    = tile.name || coord;

  const ownerIds = [...new Set(
    Object.values(tile.adventurers ?? {}).map(a => a.owner),
  )];
  if (ownerIds.length === 0) return 0;

  const updates: Record<string, unknown> = {};
  for (const ownerId of ownerIds) {
    if (!players[ownerId]) continue;
    const entryKey = push(ref(db!, `game/players/${ownerId}/completedChallenges`)).key!;
    updates[`game/players/${ownerId}/completedChallenges/${entryKey}`] = {
      coord,
      name,
      xpAwarded:   tile.xp   ?? 0,
      goldAwarded: tile.gold  ?? 0,
      completedAt: now,
    };
  }

  await update(ref(db!), updates);
  return ownerIds.length;
}

// ── Player queries ────────────────────────────────────────────────────────────
export async function playerExists(playerId: string): Promise<boolean> {
  assertDb();
  const snap = await get(ref(db!, `game/players/${playerId}`));
  return snap.exists();
}

// ── Player mutations ──────────────────────────────────────────────────────────


export async function updateAdventurer(
  playerId: string,
  advId: string,
  updates: { firstName: string; lastName: string },
): Promise<void> {
  assertDb();
  const fullName = `${updates.firstName} ${updates.lastName}`;
  const dbUpdates: Record<string, unknown> = {
    [`game/players/${playerId}/adventurers/${advId}/firstName`]: updates.firstName,
    [`game/players/${playerId}/adventurers/${advId}/lastName`]:  updates.lastName,
  };

  // Scan all tiles so the name is updated wherever this adventurer appears,
  // not just the current busyTile (which can be stale after reassignment).
  const tilesSnap = await get(ref(db!, 'game/tiles'));
  if (tilesSnap.exists()) {
    const tiles = tilesSnap.val() as Record<string, { adventurers?: Record<string, unknown> }>;
    for (const coord of Object.keys(tiles)) {
      if (tiles[coord].adventurers?.[advId] !== undefined) {
        dbUpdates[`game/tiles/${coord}/adventurers/${advId}/name`] = fullName;
      }
    }
  }

  await update(ref(db!), dbUpdates);
}

// ── Orb mutations ─────────────────────────────────────────────────────────────
export async function collectOrb(orbId: string, acquisition: OrbAcquisition): Promise<void> {
  await set(ref(db!, `game/orbState/${orbId}`), acquisition);
}

export async function updateOrbConfig(updates: Partial<OrbConfig>): Promise<void> {
  await update(ref(db!, 'game/orbConfig'), updates);
}

export async function resetOrbs(): Promise<void> {
  await set(ref(db!, 'game/orbState'), {});
}

// ── Shop ──────────────────────────────────────────────────────────────────────
export async function updateShop(shopId: string, updates: Partial<Shop>): Promise<void> {
  await update(ref(db!, `game/shops/${shopId}`), updates);
}

export async function consumePlayerItem(playerId: string, itemId: string, newQty: number): Promise<void> {
  if (newQty <= 0) {
    await remove(ref(db!, `game/players/${playerId}/inventory/${itemId}`));
  } else {
    await set(ref(db!, `game/players/${playerId}/inventory/${itemId}`), newQty);
  }
}

// ── Admin: adventurer slots ───────────────────────────────────────────────────
export async function setAdventurerSlots(
  coord: string,
  advId: string,
  slots: AdvSlot[],
  freeAdventurer?: { ownerId: string },
): Promise<void> {
  const slotsPath = `game/tiles/${coord}/adventurers/${advId}/slots`;
  if (freeAdventurer) {
    const advBase = `game/players/${freeAdventurer.ownerId}/adventurers/${advId}`;
    const updates: Record<string, unknown> = {
      [slotsPath]: slots.length > 0 ? slots : null,
      [`${advBase}/busy`]: false,
      [`${advBase}/busyTile`]: null,
    };
    await update(ref(db!), updates);
  } else if (slots.length === 0) {
    await remove(ref(db!, slotsPath));
  } else {
    await set(ref(db!, slotsPath), slots);
  }
}

// ── Admin: kick adventurer ────────────────────────────────────────────────────
export async function adminKickAdventurer(
  coord: string,
  advId: string,
  ownerId: string,
  convertToClaimableSlot: boolean,
  autoWarning?: string,
): Promise<void> {
  assertDb();

  let slotsToAdd: AdvSlot[] = [];
  if (convertToClaimableSlot) {
    const taSnap = await get(ref(db!, `game/tiles/${coord}/adventurers/${advId}`));
    const ta = taSnap.exists() ? (taSnap.val() as TileAdventurer) : null;
    const rawSlots = normalizeSlots(ta?.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
    slotsToAdd = rawSlots.length > 0
      ? rawSlots.map(s => ({ name: s.name, game: s.game, ...(s.details   ? { details:   s.details   } : {}), ...(s.room      ? { room:      s.room      } : {}), ...(s.bonusXP   ? { bonusXP:   s.bonusXP   } : {}), ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}) }))
      : [{ name: '', game: '' }];
  }

  const updates: Record<string, unknown> = {
    [`game/tiles/${coord}/adventurers/${advId}`]:            null,
    [`game/players/${ownerId}/adventurers/${advId}/busy`]:    false,
    [`game/players/${ownerId}/adventurers/${advId}/busyTile`]: null,
  };

  if (convertToClaimableSlot) {
    const newSlotRef = push(ref(db!, `game/tiles/${coord}/claimableSlots`));
    updates[`game/tiles/${coord}/claimableSlots/${newSlotRef.key}`] = slotsToAdd;
  }

  if (autoWarning) {
    const warnRef = push(ref(db!, `game/players/${ownerId}/warnings`));
    const warning: PlayerWarning = { timestamp: Date.now(), message: autoWarning, auto: true };
    updates[`game/players/${ownerId}/warnings/${warnRef.key}`] = warning;
  }

  await update(ref(db!), updates);
}

// ── Player: adventurer status note ───────────────────────────────────────────
export async function setAdventurerStatusNote(
  coord: string,
  advId: string,
  text: string | null,
): Promise<void> {
  assertDb();
  const path = `game/tiles/${coord}/adventurers/${advId}/statusNote`;
  if (!text) {
    await remove(ref(db!, path));
  } else {
    const note: AdvStatusNote = { text, timestamp: Date.now() };
    await set(ref(db!, path), note);
  }
}

// ── Admin: player warnings ────────────────────────────────────────────────────
export async function addPlayerWarning(playerId: string, message: string): Promise<void> {
  assertDb();
  const warning: PlayerWarning = { timestamp: Date.now(), message };
  await push(ref(db!, `game/players/${playerId}/warnings`), warning);
}

export async function deletePlayerWarning(playerId: string, warnKey: string): Promise<void> {
  await remove(ref(db!, `game/players/${playerId}/warnings/${warnKey}`));
}

export async function clearPlayerWarnings(playerId: string): Promise<void> {
  await remove(ref(db!, `game/players/${playerId}/warnings`));
}

// ── Player: claim a claimable slot ───────────────────────────────────────────
export async function claimClaimableSlot(
  coord: string,
  slotKey: string,
  entry: TileAdventurer,
): Promise<void> {
  assertDb();
  const updates: Record<string, unknown> = {
    [`game/tiles/${coord}/claimableSlots/${slotKey}`]:                 null,
    [`game/tiles/${coord}/adventurers/${entry.advId}`]:                entry,
    [`game/players/${entry.owner}/adventurers/${entry.advId}/busy`]:    true,
    [`game/players/${entry.owner}/adventurers/${entry.advId}/busyTile`]: coord,
  };
  await update(ref(db!), updates);
}

// ── Tile traits (orb effects — does not set adminOverride) ───────────────────
export async function updateTileTraits(
  coord: string,
  traits: Record<string, { value: number }> | null,
): Promise<void> {
  await update(ref(db!), { [`game/tiles/${coord}/traits`]: traits });
}

// ── Admin: claimable slot bonus ───────────────────────────────────────────────
export async function setClaimableSlotBonus(
  coord: string,
  slotKey: string,
  slotArr: AdvSlot[],
): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/claimableSlots/${slotKey}`), slotArr);
}

// ── Admin: slot lock ─────────────────────────────────────────────────────────
export async function setTileSlotLock(coord: string, locked: boolean): Promise<void> {
  assertDb();
  if (locked) {
    await set(ref(db!, `game/tiles/${coord}/slotsLocked`), true);
  } else {
    await remove(ref(db!, `game/tiles/${coord}/slotsLocked`));
  }
}

export async function setMissionSlotLock(missionId: string, locked: boolean): Promise<void> {
  assertDb();
  if (locked) {
    await set(ref(db!, `game/missions/${missionId}/slotsLocked`), true);
  } else {
    await remove(ref(db!, `game/missions/${missionId}/slotsLocked`));
  }
}

// ── Admin: Archipelago tracker ────────────────────────────────────────────────

export async function setTileTracker(coord: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/tracker`), tracker);
}

export async function setTileTracker2(coord: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/tracker2`), tracker);
}

export async function setTileCheese(coord: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/cheese`), cheese);
}

export async function setTileCheese2(coord: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/cheese2`), cheese);
}

export async function setMissionTracker(missionId: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/missions/${missionId}/tracker`), tracker);
}

export async function setMissionCheese(missionId: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(ref(db!, `game/missions/${missionId}/cheese`), cheese);
}

export async function fetchCheesetrackerId(apTrackerId: string): Promise<string> {
  assertFunctions();
  const result = await httpsCallable<{ trackerId: string }, { tracker_id: string }>(
    functions!, 'fetchCheesetracker',
  )({ trackerId: apTrackerId });
  return result.data.tracker_id;
}

export interface CheeseGame {
  name: string;
  game: string;
  tracker_status: string;
  checks_done: number;
  checks_total: number;
}

export async function fetchCheeseDetails(cheeseId: string): Promise<CheeseGame[]> {
  assertFunctions();
  const result = await httpsCallable<{ cheeseId: string }, { games: CheeseGame[] }>(
    functions!, 'fetchCheeseDetails',
  )({ cheeseId });
  return result.data.games;
}

export async function adminUpdateAdvSlotStatus(coord: string, advId: string, slotIndex: number, status: SlotStatus): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/adventurers/${advId}/slots/${slotIndex}/status`), status);
}

export async function adminUpdatePublicSlotStatus(coord: string, slotIndex: number, status: SlotStatus): Promise<void> {
  assertDb();
  await set(ref(db!, `game/tiles/${coord}/publicSlots/${slotIndex}/status`), status);
}

export async function freeAdventurer(ownerId: string, advId: string): Promise<void> {
  assertDb();
  await update(ref(db!), {
    [`game/players/${ownerId}/adventurers/${advId}/busy`]:     false,
    [`game/players/${ownerId}/adventurers/${advId}/busyTile`]: null,
  });
}

// ── Admin: public slots ───────────────────────────────────────────────────────
export async function setPublicSlots(coord: string, slots: AdvSlot[]): Promise<void> {
  const path = `game/tiles/${coord}/publicSlots`;
  if (slots.length === 0) {
    await remove(ref(db!, path));
  } else {
    await set(ref(db!, path), slots);
  }
}

// ── Player feats ──────────────────────────────────────────────────────────────
export async function selectFeat(
  playerId: string,
  slot: 'level3' | 'level5' | 'level7',
  featId: string,
): Promise<void> {
  assertDb();
  await set(ref(db!, `game/players/${playerId}/feats/${slot}`), featId);
}

// ── Player name color ─────────────────────────────────────────────────────────
export async function setPlayerNameColor(playerId: string, colorId: string | null): Promise<void> {
  if (!colorId || colorId === 'default') {
    await remove(ref(db!, `game/players/${playerId}/nameColor`));
  } else {
    await set(ref(db!, `game/players/${playerId}/nameColor`), colorId);
  }
}

// ── Player disable / enable ───────────────────────────────────────────────────
export async function setPlayerDisabled(playerId: string, disabled: boolean): Promise<void> {
  if (disabled) {
    await set(ref(db!, `game/players/${playerId}/disabled`), true);
  } else {
    await remove(ref(db!, `game/players/${playerId}/disabled`));
  }
}

export async function isPlayerDisabled(playerId: string): Promise<boolean> {
  assertDb();
  const snap = await get(ref(db!, `game/players/${playerId}/disabled`));
  return snap.val() === true;
}

// ── Activity log ──────────────────────────────────────────────────────────────
export async function logActivity(type: ActivityType, message: string, icon: string): Promise<void> {
  if (!db || !firebaseReady) return;
  await push(ref(db, 'game/activityLog'), { timestamp: Date.now(), type, message, icon });
}

export function subscribeToActivityLog(
  callback: (entries: ActivityEntry[]) => void,
): () => void {
  assertDb();
  return onValue(ref(db!, 'game/activityLog'), snap => {
    if (!snap.exists()) { callback([]); return; }
    const raw = snap.val() as Record<string, Omit<ActivityEntry, 'id'>>;
    const entries = Object.entries(raw)
      .map(([id, e]) => ({ ...e, id }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 25);
    callback(entries);
  });
}

// ── Admin: set admin ID ───────────────────────────────────────────────────────
export async function setAdminId(playerId: string): Promise<void> {
  await update(ref(db!, 'game/meta'), { adminId: playerId });
}

// ── Map reset: new seed + free adventurers, preserve players and adminId ──────
export async function mapReset(): Promise<void> {
  assertDb();
  const d = db!;
  const snap = await get(ref(d, 'game'));
  const current = snap.exists() ? (snap.val() as GameState) : null;

  const seed = Math.floor(Math.random() * 0x7FFFFFFF);
  initializeGrid(seed);

  const updates: Record<string, unknown> = {};

  const orbConfig = current?.orbConfig ?? defaultOrbConfig();

  // Fresh tile layout with new shop assignments for this seed
  updates['game/tiles'] = buildDefaultTileData(seed);

  // Clear orb state and activity log
  updates['game/orbState'] = null;
  updates['game/activityLog'] = null;

  // Preserve orb config and shops (admin may have customized both); update meta
  updates['game/orbConfig'] = orbConfig;
  // game/shops is intentionally NOT reset — admin customizations are preserved
  updates['game/meta'] = { adminId: current?.meta?.adminId ?? '', initialized: true, seed };

  // Free all adventurers, preserve player stats
  for (const [playerId, player] of Object.entries(current?.players ?? {})) {
    const freedAdvs: Record<string, Adventurer> = {};
    for (const [advId, adv] of Object.entries(player.adventurers ?? {})) {
      freedAdvs[advId] = { ...adv, busy: false, busyTile: null };
    }
    updates[`game/players/${playerId}`] = { ...player, adventurers: freedAdvs };
  }

  await update(ref(d), updates);
}

// ── Player reset: archive XP, wipe stats, trim to 1 adventurer ───────────────
export async function playerReset(playerId: string): Promise<void> {
  assertDb();
  const snap = await get(ref(db!, `game/players/${playerId}`));
  if (!snap.exists()) return;
  const player = snap.val() as Player;

  const xpHistory = [...(player.xpHistory ?? []), player.xp];

  // Keep only the first adventurer, freed from any tile
  const firstEntry = Object.entries(player.adventurers ?? {})[0];
  const keptAdvs: Record<string, Adventurer> = {};
  if (firstEntry) {
    const [advId, adv] = firstEntry;
    keptAdvs[advId] = { ...adv, busy: false, busyTile: null };
  }

  const updates: Record<string, unknown> = {};

  // Mirror kick behavior: remove tile entries, create claimable slots for in-progress tiles
  for (const [advId, adv] of Object.entries(player.adventurers ?? {})) {
    if (!adv.busy || !adv.busyTile) continue;
    const coord = adv.busyTile;

    const tileSnap = await get(ref(db!, `game/tiles/${coord}`));
    if (!tileSnap.exists()) continue;
    const tile = tileSnap.val() as Tile;

    updates[`game/tiles/${coord}/adventurers/${advId}`] = null;

    if (tile.state === 'inprogress') {
      const rawSlots = normalizeSlots(
        tile.adventurers?.[advId]?.slots as AdvSlot[] | Record<string, AdvSlot> | undefined,
      );
      const slotsToAdd: AdvSlot[] = rawSlots.length > 0
        ? rawSlots.map(s => ({
            name: s.name, game: s.game,
            ...(s.details   ? { details:   s.details   } : {}),
            ...(s.room      ? { room:      s.room      } : {}),
            ...(s.bonusXP   ? { bonusXP:   s.bonusXP   } : {}),
            ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}),
          }))
        : [{ name: '', game: '' }];
      const newSlotRef = push(ref(db!, `game/tiles/${coord}/claimableSlots`));
      updates[`game/tiles/${coord}/claimableSlots/${newSlotRef.key}`] = slotsToAdd;
    }
  }

  // Handle active mission — decision E
  if (player.activeMission) {
    const missionSnap = await get(ref(db!, `game/missions/${player.activeMission}`));
    if (missionSnap.exists()) {
      const mission = missionSnap.val() as GMMission;

      // Remove from participants
      updates[`game/missions/${player.activeMission}/participants/${playerId}`] = null;

      if (mission.state === 'forming') {
        // Check if this was the last participant; if so, reset firstJoinAt
        const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== playerId);
        if (remaining.length === 0) {
          updates[`game/missions/${player.activeMission}/firstJoinAt`] = null;
        }
      } else if (mission.state === 'inprogress') {
        // Full kick: create claimable slot + warning
        const participant = mission.participants?.[playerId];
        const slotsToAdd: AdvSlot[] = participant?.slots?.length
          ? participant.slots.map(s => ({
              name: s.name, game: s.game,
              ...(s.bonusXP   ? { bonusXP:   s.bonusXP   } : {}),
              ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}),
            }))
          : [{ name: '', game: '' }];
        const claimRef = push(ref(db!, `game/missions/${player.activeMission}/claimableSlots`));
        updates[`game/missions/${player.activeMission}/claimableSlots/${claimRef.key}`] = slotsToAdd;

        const warnRef = push(ref(db!, `game/players/${playerId}/warnings`));
        updates[`game/players/${playerId}/warnings/${warnRef.key}`] = {
          timestamp: Date.now(),
          message: `Removed from ${mission.label} · Cohort ${mission.series} during player reset.`,
          auto: true,
        };
      }
    }
  }

  updates[`game/players/${playerId}`] = {
    ...player,
    xp:               0,
    gold:             0,
    inventory:        {},
    adventurers:      keptAdvs,
    xpHistory,
    feats:            {},
    activeMission:    null,
    basicTrainingDone: false,
  };

  await update(ref(db!), updates);
}

// ── Mission wrappers (all writes go through Cloud Functions / admin SDK) ───────

function assertFunctions() {
  if (!functions || !firebaseReady) throw new Error('Firebase is not configured.');
}

export async function enlistInMission(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'enlistInMission')({ missionId });
}

export async function standDownFromMission(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'standDownFromMission')({ missionId });
}

export async function setMissionParticipantStatusNote(missionId: string, note: string | null): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'setMissionParticipantStatusNote')({ missionId, note });
}

export async function adminSetParticipantSlots(missionId: string, playerId: string, slots: AdvSlot[]): Promise<void> {
  assertDb();
  await set(ref(db!, `game/missions/${missionId}/participants/${playerId}/slots`), slots);
}

export async function adminUpdateParticipantSlotStatus(missionId: string, playerId: string, slotIndex: number, status: SlotStatus): Promise<void> {
  assertDb();
  await set(ref(db!, `game/missions/${missionId}/participants/${playerId}/slots/${slotIndex}/status`), status);
}

export async function adminSetMissionLink(missionId: string, link: string): Promise<void> {
  assertDb();
  await set(ref(db!, `game/missions/${missionId}/link`), link || null);
}

export async function adminSetMissionRoomSettings(missionId: string, release: TriState, collect: TriState, hint: number): Promise<void> {
  assertDb();
  await update(ref(db!, `game/missions/${missionId}`), { release, collect, hint });
}

export async function adminKickMissionParticipant(missionId: string, playerId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'adminKickMissionParticipant')({ missionId, playerId });
}

export async function claimMissionSlot(missionId: string, slotKey: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'claimMissionSlot')({ missionId, slotKey });
}

export async function adminForceDeploy(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'adminForceDeploy')({ missionId });
}

export async function syncPlayerProfile(
  targetUid?: string,
): Promise<{ tileCount: number; missionCount: number; gameCount: number }> {
  assertFunctions();
  const fn = httpsCallable<{ targetUid?: string }, { tileCount: number; missionCount: number; gameCount: number }>(
    functions!, 'syncPlayerProfile',
  );
  const result = await fn({ targetUid });
  return result.data;
}

// Completes a mission: awards XP/GP (with feat bonuses), writes CompletedChallenge
// records, archives to missionsHistory, and clears participants' activeMission.
// Returns { warned, unfinishedSlots } without acting when gating applies and
// confirmed is not true — caller shows the confirmation dialog then re-calls.
export async function completeMission(
  mission: GMMission,
  players: Record<string, Player>,
  confirmed?: boolean,
): Promise<{ warned?: boolean; unfinishedSlots?: number }> {
  assertDb();

  const unfinished = hasUnfinishedSlots(mission.participants ?? {});
  if (unfinished > 0 && !confirmed) {
    return { warned: true, unfinishedSlots: unfinished };
  }

  const ownerIds = Object.keys(mission.participants ?? {});
  const now      = Date.now();
  const label    = missionDisplayLabel(mission);
  const updates: Record<string, unknown> = {};

  // For casino missions, pre-compute each played player's pot share.
  // Gold comes from goldSwing (card values) + equal pot split; no feat multiplier on gambling winnings.
  const casinoPotShares = new Map<string, number>();
  if (mission.type === 'casino') {
    const playedEntries = Object.entries(mission.participants ?? {})
      .filter(([, p]) => p.played);
    const pot   = (mission as unknown as { pot?: number }).pot ?? 0;
    const count = playedEntries.length;
    const base  = count > 0 ? Math.floor(pot / count) : 0;
    const rem   = count > 0 ? pot - base * count : pot;
    const remIdx = count > 0 ? Math.floor(Math.random() * count) : -1;
    playedEntries.forEach(([pid], i) => {
      casinoPotShares.set(pid, base + (i === remIdx ? rem : 0));
    });
  }

  for (const [pid, participant] of Object.entries(mission.participants ?? {})) {
    const player = players[pid];
    if (!player) continue;

    // Feat bonuses — same calculation as tile rewards
    const otherIds = ownerIds.filter(id => id !== pid);
    const isMentor    = Object.values(player.feats ?? {}).includes('mentor');
    const isTreasurer = Object.values(player.feats ?? {}).includes('treasurer');
    const otherMentors    = otherIds.filter(id => Object.values(players[id]?.feats ?? {}).includes('mentor')).length;
    const otherTreasurers = otherIds.filter(id => Object.values(players[id]?.feats ?? {}).includes('treasurer')).length;
    const xpMultiplier   = 1 + otherMentors    * 0.05 + (isMentor    ? otherIds.length * 0.01 : 0);
    const goldMultiplier = 1 + otherTreasurers * 0.10 + (isTreasurer ? otherIds.length * 0.03 : 0);

    let earnedXP: number;
    let earnedGold: number;

    if (mission.type === 'casino') {
      // Folded players (never played) receive nothing; just free them from the mission.
      if (!participant.played) {
        updates[`game/players/${pid}/activeMission`] = null;
        continue;
      }
      // XP: mission.xp was locked at deploy to casinoStats.xp; feat multipliers apply.
      earnedXP = Math.round(mission.xp * xpMultiplier);
      // Gold: gambling winnings (goldSwing + pot share); no feat multiplier on gambling.
      const goldSwing = (participant as unknown as { goldSwing?: number }).goldSwing ?? 0;
      earnedGold = goldSwing + (casinoPotShares.get(pid) ?? 0);
    } else {
      earnedXP   = Math.round(mission.xp * xpMultiplier);
      earnedGold = Math.round(mission.gp * goldMultiplier);
      for (const slot of participant.slots ?? []) {
        earnedXP   += slot.bonusXP   ?? 0;
        earnedGold += slot.bonusGold ?? 0;
      }
    }

    const prevLevel     = calcLevel(player.xp);
    const newXp         = player.xp + earnedXP;
    const newLevel      = calcLevel(newXp);
    const updatedPlayer = checkAndGrantAdventurers(player, prevLevel, newLevel);

    updates[`game/players/${pid}/xp`]           = newXp;
    updates[`game/players/${pid}/gold`]          = player.gold + earnedGold;
    updates[`game/players/${pid}/adventurers`]   = updatedPlayer.adventurers;
    updates[`game/players/${pid}/activeMission`] = null;
    if (mission.type === 'basic') {
      updates[`game/players/${pid}/basicTrainingDone`] = true;
    }

    const entryKey = push(ref(db!, `game/players/${pid}/completedChallenges`)).key!;
    updates[`game/players/${pid}/completedChallenges/${entryKey}`] = {
      coord:       'D3',
      name:        label,
      xpAwarded:   earnedXP,
      goldAwarded: earnedGold,
      completedAt: now,
    };
  }

  updates[`game/missionsHistory/${mission.id}`] = { ...mission, state: 'complete' };
  updates[`game/missions/${mission.id}`]         = null;

  await update(ref(db!), updates);
  await logActivity('mission_complete', `${label} has completed.`, '⚜');

  return {};
}

// ── Keymaster's Keep ──────────────────────────────────────────────────────────

export async function kmkImportList(
  name: string,
  rows: { area: string; trial: string; desc: string }[],
): Promise<string> {
  assertDb();
  const d = db!;
  const listId = push(ref(d, 'kmkEvents')).key!;

  // Group rows by area in first-appearance order
  const areaMap = new Map<string, { trial: string; desc: string }[]>();
  for (const row of rows) {
    if (!areaMap.has(row.area)) areaMap.set(row.area, []);
    areaMap.get(row.area)!.push({ trial: row.trial, desc: row.desc });
  }

  const areas: Record<string, unknown> = {};
  let areaOrder = 0;
  for (const [areaName, taskRows] of areaMap) {
    const areaId = push(ref(d, `kmkEvents/${listId}/areas`)).key!;
    const tasks: Record<string, unknown> = {};
    let taskOrder = 0;
    for (const row of taskRows) {
      const taskId = push(ref(d, `kmkEvents/${listId}/areas/${areaId}/tasks`)).key!;
      tasks[taskId] = { trial: row.trial, desc: row.desc, order: taskOrder++, status: 'Incomplete' };
    }
    areas[areaId] = { name: areaName, order: areaOrder++, locked: true, tasks };
  }

  await set(ref(d, `kmkEvents/${listId}`), { name, createdAt: Date.now(), areas });
  return listId;
}

// Sets (or clears) the active list shown on the player Trial Board.
export async function kmkSetActiveList(listId: string | null): Promise<void> {
  assertDb();
  await update(ref(db!, 'game/meta'), { kmkActiveListId: listId });
}

export async function kmkSetAreaLocked(listId: string, areaId: string, locked: boolean): Promise<void> {
  assertDb();
  await set(ref(db!, `kmkEvents/${listId}/areas/${areaId}/locked`), locked);
}

// Admin status override. Setting 'Incomplete' is a penalty-free kick: player fields are cleared.
export async function kmkAdminSetTaskStatus(
  listId: string,
  areaId: string,
  taskId: string,
  status: KmkStatus,
): Promise<void> {
  assertDb();
  const updates: Record<string, unknown> = { status };
  if (status === 'Incomplete') {
    updates.playerId  = null;
    updates.playerName = null;
    updates.claimedAt  = null;
  }
  await update(ref(db!, `kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`), updates);
}

// Admin override for the player name shown on a claimed task.
export async function kmkAdminEditTaskPlayer(
  listId: string,
  areaId: string,
  taskId: string,
  playerId: string,
  playerName: string,
): Promise<void> {
  assertDb();
  await update(ref(db!, `kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`), { playerId, playerName });
}

// Deletes an event list. Caller is responsible for ensuring it is not the active list.
export async function kmkDeleteList(listId: string): Promise<void> {
  assertDb();
  await remove(ref(db!, `kmkEvents/${listId}`));
}

// Claim a trial via Cloud Function (Incomplete → Pending). Rejects disabled players and locked areas.
export async function kmkClaimTrial(listId: string, areaId: string, taskId: string): Promise<void> {
  if (!functions) throw new Error('Firebase is not configured.');
  const fn = httpsCallable(functions, 'kmkClaimTrial');
  await fn({ listId, areaId, taskId });
}

// Player self-service: Pending → Verifying (submit for admin review).
export async function kmkMarkDone(listId: string, areaId: string, taskId: string): Promise<void> {
  assertDb();
  await update(ref(db!, `kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`), { status: 'Verifying' });
}

// Player self-service: Verifying → Pending (pull back submission).
export async function kmkResume(listId: string, areaId: string, taskId: string): Promise<void> {
  assertDb();
  await update(ref(db!, `kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`), { status: 'Pending' });
}

// Player self-service: Pending | Verifying → Incomplete (return trial to pool).
export async function kmkAbandon(listId: string, areaId: string, taskId: string): Promise<void> {
  assertDb();
  await update(ref(db!, `kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`), {
    status: 'Incomplete',
    playerId: null,
    playerName: null,
    claimedAt: null,
  });
}

// Checks how many adventurers a player should have at their current level and
// grants any that are missing. Returns the number of adventurers granted.
export async function grantMissingAdventurers(playerId: string, player: Player): Promise<number> {
  assertDb();
  const level         = calcLevel(player.xp);
  const expectedCount = adventurerCountForLevel(level);
  const currentCount  = Object.keys(player.adventurers ?? {}).length;
  const toAdd         = expectedCount - currentCount;
  if (toAdd <= 0) return 0;

  const updates: Record<string, unknown> = {};
  const existing = { ...player.adventurers };
  for (let i = 0; i < toAdd; i++) {
    const usedClasses = Object.values(existing).map(a => a.cls);
    const cls = randomAdvClass(usedClasses) as AdvClass;
    const { firstName, lastName } = randomAdvName();
    const id = `${playerId}-adv-${Date.now()}-${i}`;
    existing[id] = { id, firstName, lastName, cls, busy: false, busyTile: null };
    updates[`game/players/${playerId}/adventurers/${id}`] = existing[id];
  }

  await update(ref(db!), updates);
  return toAdd;
}
