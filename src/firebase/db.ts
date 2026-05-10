import { ref, set, update, get, onValue, remove, push } from 'firebase/database';
import { db, firebaseReady } from './config';
import type { GameState, Tile, TileState, Player, Adventurer, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot, ActivityEntry, ActivityType, PlayerWarning } from '../types';
import { buildDefaultTileData, initializeGrid, computeTownShopIds } from '../lib/tileGen';
import { ALL_ORBS, DEFAULT_SHOPS } from '../lib/constants';

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
    await update(ref(d), {
      'game/tiles':     buildDefaultTileData(seed),
      'game/players':   {},
      'game/orbState':  {},
      'game/orbConfig': orbConfig,
      'game/shops':     { ...DEFAULT_SHOPS },
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
  await update(ref(db!, `game/tiles/${coord}`), { state });
}

export async function setTileInProgress(
  coord: string,
  stunnedAdvId: string | null,
  tauntedAdvId: string | null,
  roomAssignments?: Record<string, 1 | 2>,
): Promise<void> {
  const updates: Record<string, unknown> = { [`game/tiles/${coord}/state`]: 'inprogress' };
  updates[`game/tiles/${coord}/stunnedAdvId`] = stunnedAdvId;
  updates[`game/tiles/${coord}/tauntedAdvId`] = tauntedAdvId;
  if (roomAssignments) {
    for (const [advId, room] of Object.entries(roomAssignments)) {
      updates[`game/tiles/${coord}/adventurers/${advId}/room`] = room;
    }
  }
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
  await update(ref(db!), updates);
}

export async function assignAdventurer(coord: string, entry: TileAdventurer): Promise<void> {
  await set(ref(db!, `game/tiles/${coord}/adventurers/${entry.advId}`), entry);
  await update(ref(db!, `game/players/${entry.owner}/adventurers/${entry.advId}`), {
    busy: true,
    busyTile: coord,
  });
}

export async function removeAdventurer(coord: string, advId: string, ownerId: string): Promise<void> {
  await remove(ref(db!, `game/tiles/${coord}/adventurers/${advId}`));
  await update(ref(db!, `game/players/${ownerId}/adventurers/${advId}`), {
    busy: false,
    busyTile: null,
  });
}

export async function completeTile(
  coord: string,
  updatedPlayers: Record<string, Player>,
  revealCoords: { coord: string; newState: TileState }[],
  orbAcquisitions: Record<string, OrbAcquisition> = {},
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

  await update(ref(db!), updates);

  for (const orbId of Object.keys(orbAcquisitions)) {
    const orb = ALL_ORBS.find(o => o.id === orbId);
    const tileNameSnap = (await get(ref(db!, `game/tiles/${coord}/name`))).val() as string | null;
    await logActivity('orb_collected', `${orb?.label ?? orbId} Orb gathered from ${tileNameSnap || coord}.`, orb?.icon ?? '🔮');
  }
}

// ── Player queries ────────────────────────────────────────────────────────────
export async function playerExists(playerId: string): Promise<boolean> {
  assertDb();
  const snap = await get(ref(db!, `game/players/${playerId}`));
  return snap.exists();
}

// ── Player mutations ──────────────────────────────────────────────────────────
export async function upsertPlayer(player: Player): Promise<void> {
  await set(ref(db!, `game/players/${player.id}`), player);
}

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
    const rawSlots: AdvSlot[] = ta?.slots
      ? (Array.isArray(ta.slots) ? ta.slots : Object.values(ta.slots as Record<string, AdvSlot>))
      : [];
    slotsToAdd = rawSlots.length > 0
      ? rawSlots.map(s => ({ name: s.name, game: s.game, ...(s.details ? { details: s.details } : {}) }))
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

  await set(ref(db!, `game/players/${playerId}`), {
    ...player,
    xp:          0,
    gold:        0,
    inventory:   {},
    adventurers: keptAdvs,
    xpHistory,
    feats:       {},
  });
}
