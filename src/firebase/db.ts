import { ref, set, update, get, onValue, remove } from 'firebase/database';
import { db, firebaseReady } from './config';
import type { GameState, Tile, TileState, Player, Adventurer, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot } from '../types';
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

function defaultGameState(): Omit<GameState, 'players'> & { players: Record<string, never> } {
  const seed      = Math.floor(Math.random() * 0x7FFFFFFF);
  const orbConfig = defaultOrbConfig();
  initializeGrid(seed);
  return {
    tiles:     buildDefaultTileData(seed),
    players:   {},
    orbState:  {},
    orbConfig,
    shops:     { ...DEFAULT_SHOPS },
    meta:      { adminId: '', initialized: true, seed },
  };
}

// ── Initialize ────────────────────────────────────────────────────────────────
export async function initializeGameIfNeeded(): Promise<void> {
  assertDb();
  const d = db!;
  const snap = await get(ref(d, 'game/meta'));
  if (!snap.exists() || !snap.val()?.initialized) {
    await set(ref(d, 'game'), defaultGameState());
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
    await update(ref(d), migrationUpdates);
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

export async function updateTileAdmin(coord: string, updates: Partial<Tile>): Promise<void> {
  await update(ref(db!, `game/tiles/${coord}`), { ...updates, adminOverride: true });
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
  busyTile?: string | null,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {
    [`game/players/${playerId}/adventurers/${advId}/firstName`]: updates.firstName,
    [`game/players/${playerId}/adventurers/${advId}/lastName`]:  updates.lastName,
  };
  if (busyTile) {
    dbUpdates[`game/tiles/${busyTile}/adventurers/${advId}/name`] =
      `${updates.firstName} ${updates.lastName}`;
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
export async function setAdventurerSlots(coord: string, advId: string, slots: AdvSlot[]): Promise<void> {
  const path = `game/tiles/${coord}/adventurers/${advId}/slots`;
  if (slots.length === 0) {
    await remove(ref(db!, path));
  } else {
    await set(ref(db!, path), slots);
  }
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

  // Clear orb state
  updates['game/orbState'] = null;

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
  });
}
