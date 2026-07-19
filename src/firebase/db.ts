import { ref, set, update, get, onValue, remove, push } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { db, firebaseReady, functions } from './config';
import { sRef, sPath, getCurrentSeason } from './season';
import type { GameState, Tile, TileState, Player, Adventurer, AdvClass, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot, ActivityEntry, ActivityType, PlayerWarning, AdvStatusNote, SlotStatus, TriState, GMMission, GMParticipant, KmkStatus, CasinoGame } from '../types';
import { buildDefaultTileData, initializeGrid, randomAdvClass, randomAdvName } from '../lib/tileGen';
import { ALL_ORBS, CASINO_OPEN_TABLES } from '../lib/constants';
import { CASINO_GAME_ORDER } from '../lib/casinoData';
import { normalizeSlots } from '../lib/slotHelpers';
import { freshMission, freshCasinoTable, pickNextCasinoGame, casinoPotShares, casinoSeatPaid, missionDisplayLabel, hasUnfinishedSlots } from '../lib/missionLogic';
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

// ── Season creation ───────────────────────────────────────────────────────────
//
// `initializeGameIfNeeded()` is GONE. It used to run on every client auth and
// made the FIRST authenticated user the admin, via a DB rule that let anyone
// write game/meta while !initialized. Both the function and that rule loophole
// are removed: a season is now created explicitly by admin (see the migration
// script), never by a client, and admin identity lives at config/adminId.
//
// See docs/season-architecture-plan.md → "Admin identity".

// Seed mission cohorts for each type that has no active (forming/inprogress) cohort.
// Safe to call on any existing season mid-flight — only creates what is missing.
//
// Bootstraps a season's initial mission cohorts. Behavior is season-driven:
//   · casino shell → opens up to casinoOpenTables single-game tables, each
//     pinned to a game via the least-represented spawn policy.
//   · map shell    → the legacy basic + patrol cohorts.
// No-op while the season is closing or archived (wind-down). Idempotent: only
// fills up to the target, so re-running never over-seeds. See
// docs/casino-season-1_5-plan.md → "Table model".
export interface SeedResult {
  shell:   'map' | 'casino';
  /** How many cohorts/tables were actually opened — 0 when there was nothing to do. */
  created: number;
}

export async function seedInitialMissions(): Promise<SeedResult> {
  assertDb();
  const d = db!;
  const seasonId = getCurrentSeason();

  const [listSnap, draftSnap] = await Promise.all([
    get(ref(d, `config/seasonList/${seasonId}`)),
    get(ref(d, `config/draftSeasons/${seasonId}`)),
  ]);
  const listed = listSnap.exists()  ? (listSnap.val()  as { shell?: string; status?: string; casinoOpenTables?: number }) : null;
  const draft  = draftSnap.exists() ? (draftSnap.val() as { shell?: string; casinoOpenTables?: number }) : null;
  const shell  = (listed?.shell ?? draft?.shell ?? 'map') as 'map' | 'casino';
  const status = listed?.status ?? (draft ? 'draft' : 'archived');
  if (status === 'closing' || status === 'archived') return { shell, created: 0 };  // winding down

  const snap     = await get(sRef(d, 'missions'));
  const existing = snap.exists() ? (snap.val() as Record<string, GMMission>) : {};
  const active   = Object.values(existing);
  const now      = Date.now();
  const updates: Record<string, unknown> = {};

  if (shell === 'casino') {
    const target  = listed?.casinoOpenTables ?? draft?.casinoOpenTables ?? CASINO_OPEN_TABLES;
    const forming = active.filter(m => m.type === 'casino' && m.state === 'forming').length;
    if (forming >= target) return { shell, created: 0 };

    // Continue per-game cohort numbering from the persisted counters.
    const series = { five_card_draw: 0, seven_card_stud: 0, holdem: 0, blackjack: 0 } as Record<CasinoGame, number>;
    const seriesSnap = await get(sRef(d, 'casinoSeries'));
    if (seriesSnap.exists()) Object.assign(series, seriesSnap.val());

    const working: Record<string, GMMission> = { ...existing };
    for (let i = forming; i < target; i++) {
      const game = pickNextCasinoGame(working);            // least-represented, sees tables added so far
      series[game] = (series[game] ?? 0) + 1;
      const r = push(sRef(d, 'missions'));
      const table = { ...freshCasinoTable(game, series[game], now), id: r.key! } as GMMission;
      updates[sPath(`missions/${r.key}`)] = table;
      working[r.key!] = table;
    }
    for (const g of CASINO_GAME_ORDER) updates[sPath(`casinoSeries/${g}`)] = series[g];
    await update(ref(d), updates);
    return { shell, created: target - forming };
  }

  // Map shell — legacy single-cohort bootstrap for basic + patrol.
  const hasBasic  = active.some(m => m.type === 'basic'  && m.state !== 'complete');
  const hasPatrol = active.some(m => m.type === 'patrol' && m.state !== 'complete');
  if (hasBasic && hasPatrol) return { shell, created: 0 };

  let created = 0;
  if (!hasBasic) {
    const r = push(sRef(d, 'missions'));
    updates[sPath(`missions/${r.key}`)] = { ...freshMission('basic',  1, now), id: r.key };
    created++;
  }
  if (!hasPatrol) {
    const r = push(sRef(d, 'missions'));
    updates[sPath(`missions/${r.key}`)] = { ...freshMission('patrol', 1, now), id: r.key };
    created++;
  }

  await update(ref(d), updates);
  return { shell, created };
}

// ── Subscribe to full game state ──────────────────────────────────────────────

// Firebase omits empty nodes entirely, so a season's collections come back
// ABSENT rather than as `{}` — an archived season whose missions have all
// completed carries no `missions` node, and a casino season has no `tiles` /
// `orbState` / `shops` at all. GameState declares them non-optional and
// consumers iterate them directly (`Object.values(gameState.missions)`), so
// normalise here rather than guarding at every call site.
function normalizeGameState(raw: GameState): GameState {
  return {
    ...raw,
    tiles:    raw.tiles    ?? {},
    players:  raw.players  ?? {},
    missions: raw.missions ?? {},
    missionsHistory: raw.missionsHistory ?? {},
    orbState: raw.orbState ?? {},
    shops:    raw.shops    ?? {},
  };
}

export function subscribeToGame(
  callback: (state: GameState | null) => void,
): () => void {
  assertDb();
  const d = db!;
  return onValue(sRef(d), snap => {
    callback(snap.exists() ? normalizeGameState(snap.val() as GameState) : null);
  });
}

// ── Tile mutations ────────────────────────────────────────────────────────────
export async function setTileState(coord: string, state: TileState): Promise<void> {
  await update(sRef(db!, `tiles/${coord}`), { state, stunnedAdvId: null, tauntedAdvId: null });
}

export async function setTileInProgress(
  coord: string,
  stunnedAdvId: string | null,
  tauntedAdvId: string | null,
  roomAssignments?: Record<string, 1 | 2>,
  extraUpdates?: Record<string, unknown>,
): Promise<void> {
  const updates: Record<string, unknown> = { [sPath(`tiles/${coord}/state`)]: 'inprogress' };
  updates[sPath(`tiles/${coord}/stunnedAdvId`)] = stunnedAdvId;
  updates[sPath(`tiles/${coord}/tauntedAdvId`)] = tauntedAdvId;
  if (roomAssignments) {
    for (const [advId, room] of Object.entries(roomAssignments)) {
      updates[sPath(`tiles/${coord}/adventurers/${advId}/room`)] = room;
    }
  }
  if (extraUpdates) Object.assign(updates, extraUpdates);
  await update(ref(db!), updates);
}

export async function updateTileAdmin(coord: string, updates: Partial<Tile>): Promise<void> {
  await update(sRef(db!, `tiles/${coord}`), { ...updates, adminOverride: true });
}

export async function resetTileStats(coord: string, stats: Partial<Tile>): Promise<void> {
  assertDb();
  await update(sRef(db!, `tiles/${coord}`), { ...stats, adminOverride: false });
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
    updates[sPath(`tiles/${c}/state`)] = s;
  }
  if (inProgressCoord != null) {
    updates[sPath(`tiles/${inProgressCoord}/stunnedAdvId`)] = stunnedAdvId ?? null;
    updates[sPath(`tiles/${inProgressCoord}/tauntedAdvId`)] = tauntedAdvId ?? null;
    if (roomAssignments) {
      for (const [advId, room] of Object.entries(roomAssignments)) {
        updates[sPath(`tiles/${inProgressCoord}/adventurers/${advId}/room`)] = room;
      }
    }
  }
  if (extraUpdates) Object.assign(updates, extraUpdates);
  await update(ref(db!), updates);
}

export async function assignAdventurer(coord: string, entry: TileAdventurer): Promise<void> {
  await update(ref(db!), {
    [sPath(`tiles/${coord}/adventurers/${entry.advId}`)]:                entry,
    [sPath(`players/${entry.owner}/adventurers/${entry.advId}/busy`)]:    true,
    [sPath(`players/${entry.owner}/adventurers/${entry.advId}/busyTile`)]: coord,
  });
}

export async function removeAdventurer(coord: string, advId: string, ownerId: string): Promise<void> {
  await update(ref(db!), {
    [sPath(`tiles/${coord}/adventurers/${advId}`)]:                    null,
    [sPath(`players/${ownerId}/adventurers/${advId}/busy`)]:    false,
    [sPath(`players/${ownerId}/adventurers/${advId}/busyTile`)]: null,
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
  updates[sPath(`tiles/${coord}/state`)] = 'complete';

  for (const { coord: nc, newState } of revealCoords) {
    updates[sPath(`tiles/${nc}/state`)] = newState;
  }
  for (const [playerId, player] of Object.entries(updatedPlayers)) {
    updates[sPath(`players/${playerId}`)] = player;
  }
  for (const [orbId, acquisition] of Object.entries(orbAcquisitions)) {
    updates[sPath(`orbState/${orbId}`)] = acquisition;
  }

  if (awardedAmounts) {
    const now = Date.now();
    const name = tileName || coord;
    for (const [playerId, amounts] of Object.entries(awardedAmounts)) {
      const entryKey = push(sRef(db!, `players/${playerId}/completedChallenges`)).key!;
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
      const playerWrite = updates[sPath(`players/${playerId}`)] as Record<string, unknown>;
      if (playerWrite) {
        const existing = (playerWrite.completedChallenges ?? {}) as Record<string, unknown>;
        playerWrite.completedChallenges = { ...existing, [entryKey]: entry };
      } else {
        updates[sPath(`players/${playerId}/completedChallenges/${entryKey}`)] = entry;
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
    get(sRef(db!, `tiles/${coord}`)),
    get(sRef(db!, 'players')),
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
    const entryKey = push(sRef(db!, `players/${ownerId}/completedChallenges`)).key!;
    updates[sPath(`players/${ownerId}/completedChallenges/${entryKey}`)] = {
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
  const snap = await get(sRef(db!, `players/${playerId}`));
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
    [sPath(`players/${playerId}/adventurers/${advId}/firstName`)]: updates.firstName,
    [sPath(`players/${playerId}/adventurers/${advId}/lastName`)]:  updates.lastName,
  };

  // Scan all tiles so the name is updated wherever this adventurer appears,
  // not just the current busyTile (which can be stale after reassignment).
  const tilesSnap = await get(sRef(db!, 'tiles'));
  if (tilesSnap.exists()) {
    const tiles = tilesSnap.val() as Record<string, { adventurers?: Record<string, unknown> }>;
    for (const coord of Object.keys(tiles)) {
      if (tiles[coord].adventurers?.[advId] !== undefined) {
        dbUpdates[sPath(`tiles/${coord}/adventurers/${advId}/name`)] = fullName;
      }
    }
  }

  await update(ref(db!), dbUpdates);
}

// ── Orb mutations ─────────────────────────────────────────────────────────────
export async function collectOrb(orbId: string, acquisition: OrbAcquisition): Promise<void> {
  await set(sRef(db!, `orbState/${orbId}`), acquisition);
}

export async function updateOrbConfig(updates: Partial<OrbConfig>): Promise<void> {
  await update(sRef(db!, 'orbConfig'), updates);
}

export async function resetOrbs(): Promise<void> {
  await set(sRef(db!, 'orbState'), {});
}

// ── Shop ──────────────────────────────────────────────────────────────────────
export async function updateShop(shopId: string, updates: Partial<Shop>): Promise<void> {
  await update(sRef(db!, `shops/${shopId}`), updates);
}

export async function consumePlayerItem(playerId: string, itemId: string, newQty: number): Promise<void> {
  if (newQty <= 0) {
    await remove(sRef(db!, `players/${playerId}/inventory/${itemId}`));
  } else {
    await set(sRef(db!, `players/${playerId}/inventory/${itemId}`), newQty);
  }
}

// ── Admin: adventurer slots ───────────────────────────────────────────────────
export async function setAdventurerSlots(
  coord: string,
  advId: string,
  slots: AdvSlot[],
  freeAdventurer?: { ownerId: string },
): Promise<void> {
  const slotsPath = sPath(`tiles/${coord}/adventurers/${advId}/slots`);
  if (freeAdventurer) {
    const advBase = sPath(`players/${freeAdventurer.ownerId}/adventurers/${advId}`);
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
    const taSnap = await get(sRef(db!, `tiles/${coord}/adventurers/${advId}`));
    const ta = taSnap.exists() ? (taSnap.val() as TileAdventurer) : null;
    const rawSlots = normalizeSlots(ta?.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
    slotsToAdd = rawSlots.length > 0
      ? rawSlots.map(s => ({ name: s.name, game: s.game, ...(s.details   ? { details:   s.details   } : {}), ...(s.room      ? { room:      s.room      } : {}), ...(s.bonusXP   ? { bonusXP:   s.bonusXP   } : {}), ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}) }))
      : [{ name: '', game: '' }];
  }

  const updates: Record<string, unknown> = {
    [sPath(`tiles/${coord}/adventurers/${advId}`)]:            null,
    [sPath(`players/${ownerId}/adventurers/${advId}/busy`)]:    false,
    [sPath(`players/${ownerId}/adventurers/${advId}/busyTile`)]: null,
  };

  if (convertToClaimableSlot) {
    const newSlotRef = push(sRef(db!, `tiles/${coord}/claimableSlots`));
    updates[sPath(`tiles/${coord}/claimableSlots/${newSlotRef.key}`)] = slotsToAdd;
  }

  if (autoWarning) {
    const warnRef = push(sRef(db!, `players/${ownerId}/warnings`));
    const warning: PlayerWarning = { timestamp: Date.now(), message: autoWarning, auto: true };
    updates[sPath(`players/${ownerId}/warnings/${warnRef.key}`)] = warning;
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
  const path = sPath(`tiles/${coord}/adventurers/${advId}/statusNote`);
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
  await push(sRef(db!, `players/${playerId}/warnings`), warning);
}

export async function deletePlayerWarning(playerId: string, warnKey: string): Promise<void> {
  await remove(sRef(db!, `players/${playerId}/warnings/${warnKey}`));
}

export async function clearPlayerWarnings(playerId: string): Promise<void> {
  await remove(sRef(db!, `players/${playerId}/warnings`));
}

// ── Player: claim a claimable slot ───────────────────────────────────────────
export async function claimClaimableSlot(
  coord: string,
  slotKey: string,
  entry: TileAdventurer,
): Promise<void> {
  assertDb();
  const updates: Record<string, unknown> = {
    [sPath(`tiles/${coord}/claimableSlots/${slotKey}`)]:                 null,
    [sPath(`tiles/${coord}/adventurers/${entry.advId}`)]:                entry,
    [sPath(`players/${entry.owner}/adventurers/${entry.advId}/busy`)]:    true,
    [sPath(`players/${entry.owner}/adventurers/${entry.advId}/busyTile`)]: coord,
  };
  await update(ref(db!), updates);
}

// ── Tile traits (orb effects — does not set adminOverride) ───────────────────
export async function updateTileTraits(
  coord: string,
  traits: Record<string, { value: number }> | null,
): Promise<void> {
  await update(ref(db!), { [sPath(`tiles/${coord}/traits`)]: traits });
}

// ── Admin: claimable slot bonus ───────────────────────────────────────────────
export async function setClaimableSlotBonus(
  coord: string,
  slotKey: string,
  slotArr: AdvSlot[],
): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/claimableSlots/${slotKey}`), slotArr);
}

// ── Admin: slot lock ─────────────────────────────────────────────────────────
export async function setTileSlotLock(coord: string, locked: boolean): Promise<void> {
  assertDb();
  if (locked) {
    await set(sRef(db!, `tiles/${coord}/slotsLocked`), true);
  } else {
    await remove(sRef(db!, `tiles/${coord}/slotsLocked`));
  }
}

export async function setMissionSlotLock(missionId: string, locked: boolean): Promise<void> {
  assertDb();
  if (locked) {
    await set(sRef(db!, `missions/${missionId}/slotsLocked`), true);
  } else {
    await remove(sRef(db!, `missions/${missionId}/slotsLocked`));
  }
}

// ── Admin: Archipelago tracker ────────────────────────────────────────────────

export async function setTileTracker(coord: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/tracker`), tracker);
}

export async function setTileTracker2(coord: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/tracker2`), tracker);
}

export async function setTileCheese(coord: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/cheese`), cheese);
}

export async function setTileCheese2(coord: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/cheese2`), cheese);
}

export async function setMissionTracker(missionId: string, tracker: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `missions/${missionId}/tracker`), tracker);
}

export async function setMissionCheese(missionId: string, cheese: string | null): Promise<void> {
  assertDb();
  await set(sRef(db!, `missions/${missionId}/cheese`), cheese);
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
  await set(sRef(db!, `tiles/${coord}/adventurers/${advId}/slots/${slotIndex}/status`), status);
}

export async function adminUpdatePublicSlotStatus(coord: string, slotIndex: number, status: SlotStatus): Promise<void> {
  assertDb();
  await set(sRef(db!, `tiles/${coord}/publicSlots/${slotIndex}/status`), status);
}

export async function freeAdventurer(ownerId: string, advId: string): Promise<void> {
  assertDb();
  await update(ref(db!), {
    [sPath(`players/${ownerId}/adventurers/${advId}/busy`)]:     false,
    [sPath(`players/${ownerId}/adventurers/${advId}/busyTile`)]: null,
  });
}

// ── Admin: public slots ───────────────────────────────────────────────────────
export async function setPublicSlots(coord: string, slots: AdvSlot[]): Promise<void> {
  const path = sPath(`tiles/${coord}/publicSlots`);
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
  await set(sRef(db!, `players/${playerId}/feats/${slot}`), featId);
}

// ── Player name color ─────────────────────────────────────────────────────────
export async function setPlayerNameColor(playerId: string, colorId: string | null): Promise<void> {
  if (!colorId || colorId === 'default') {
    await remove(sRef(db!, `players/${playerId}/nameColor`));
  } else {
    await set(sRef(db!, `players/${playerId}/nameColor`), colorId);
  }
}

// ── Player disable / enable ───────────────────────────────────────────────────
export async function setPlayerDisabled(playerId: string, disabled: boolean): Promise<void> {
  if (disabled) {
    await set(sRef(db!, `players/${playerId}/disabled`), true);
  } else {
    await remove(sRef(db!, `players/${playerId}/disabled`));
  }
}

export async function isPlayerDisabled(playerId: string): Promise<boolean> {
  assertDb();
  const snap = await get(sRef(db!, `players/${playerId}/disabled`));
  return snap.val() === true;
}

// ── Activity log ──────────────────────────────────────────────────────────────
export async function logActivity(type: ActivityType, message: string, icon: string): Promise<void> {
  if (!db || !firebaseReady) return;
  await push(sRef(db, 'activityLog'), { timestamp: Date.now(), type, message, icon });
}

export function subscribeToActivityLog(
  callback: (entries: ActivityEntry[]) => void,
): () => void {
  assertDb();
  return onValue(sRef(db!, 'activityLog'), snap => {
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
// Admin is GLOBAL now (config/adminId), not per-season — a season that doesn't
// exist yet can't own an admin.
export async function setAdminId(playerId: string): Promise<void> {
  assertDb();
  await set(ref(db!, 'config/adminId'), playerId);
}

// ── Map reset: new seed + free adventurers, preserve players ──────────────────
export async function mapReset(): Promise<void> {
  assertDb();
  const d = db!;
  const snap = await get(sRef(d));
  const current = snap.exists() ? (snap.val() as GameState) : null;

  const seed = Math.floor(Math.random() * 0x7FFFFFFF);
  initializeGrid(seed);

  const updates: Record<string, unknown> = {};

  const orbConfig = current?.orbConfig ?? defaultOrbConfig();

  // Fresh tile layout with new shop assignments for this seed
  updates[sPath('tiles')] = buildDefaultTileData(seed);

  // Clear orb state and activity log
  updates[sPath('orbState')] = null;
  updates[sPath('activityLog')] = null;

  // Preserve orb config and shops (admin may have customized both); update meta
  updates[sPath('orbConfig')] = orbConfig;
  // shops is intentionally NOT reset — admin customizations are preserved
  // adminId is no longer here; it lives at the global config/adminId.
  updates[sPath('meta')] = { initialized: true, seed };

  // Free all adventurers, preserve player stats
  for (const [playerId, player] of Object.entries(current?.players ?? {})) {
    const freedAdvs: Record<string, Adventurer> = {};
    for (const [advId, adv] of Object.entries(player.adventurers ?? {})) {
      freedAdvs[advId] = { ...adv, busy: false, busyTile: null };
    }
    updates[sPath(`players/${playerId}`)] = { ...player, adventurers: freedAdvs };
  }

  await update(ref(d), updates);
}

// ── Player reset: archive XP, wipe stats, trim to 1 adventurer ───────────────
export async function playerReset(playerId: string): Promise<void> {
  assertDb();
  const snap = await get(sRef(db!, `players/${playerId}`));
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

    const tileSnap = await get(sRef(db!, `tiles/${coord}`));
    if (!tileSnap.exists()) continue;
    const tile = tileSnap.val() as Tile;

    updates[sPath(`tiles/${coord}/adventurers/${advId}`)] = null;

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
      const newSlotRef = push(sRef(db!, `tiles/${coord}/claimableSlots`));
      updates[sPath(`tiles/${coord}/claimableSlots/${newSlotRef.key}`)] = slotsToAdd;
    }
  }

  // Handle active mission — decision E
  if (player.activeMission) {
    const missionSnap = await get(sRef(db!, `missions/${player.activeMission}`));
    if (missionSnap.exists()) {
      const mission = missionSnap.val() as GMMission;

      // Remove from participants
      updates[sPath(`missions/${player.activeMission}/participants/${playerId}`)] = null;

      if (mission.state === 'forming') {
        // Check if this was the last participant; if so, reset firstJoinAt
        const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== playerId);
        if (remaining.length === 0) {
          updates[sPath(`missions/${player.activeMission}/firstJoinAt`)] = null;
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
        const claimRef = push(sRef(db!, `missions/${player.activeMission}/claimableSlots`));
        updates[sPath(`missions/${player.activeMission}/claimableSlots/${claimRef.key}`)] = slotsToAdd;

        const warnRef = push(sRef(db!, `players/${playerId}/warnings`));
        updates[sPath(`players/${playerId}/warnings/${warnRef.key}`)] = {
          timestamp: Date.now(),
          message: `Removed from ${mission.label} · Cohort ${mission.series} during player reset.`,
          auto: true,
        };
      }
    }
  }

  updates[sPath(`players/${playerId}`)] = {
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

// Callables take an optional seasonId; passing the current season (which may be
// a draft under alpha preview) keeps writes on the season the client is viewing.
// The server defaults to the active season when it's omitted.
// Give the signed-in player a record in the CURRENT season if they don't have
// one. A record is otherwise only minted at Discord sign-in, for whatever season
// was active then — so a restored session, a season cutover, or an admin/alpha
// previewing a draft would land in a season with no record and no gold.
// Idempotent and safe to call on every load / season switch.
export async function ensureSeasonPlayer(): Promise<{ created: boolean }> {
  assertFunctions();
  const res = await httpsCallable(functions!, 'ensureSeasonPlayer')({ seasonId: getCurrentSeason() });
  return res.data as { created: boolean };
}

export async function enlistInMission(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'enlistInMission')({ missionId, seasonId: getCurrentSeason() });
}

export async function standDownFromMission(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'standDownFromMission')({ missionId, seasonId: getCurrentSeason() });
}

export async function setMissionParticipantStatusNote(missionId: string, note: string | null): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'setMissionParticipantStatusNote')({ missionId, note, seasonId: getCurrentSeason() });
}

export async function adminSetParticipantSlots(missionId: string, playerId: string, slots: AdvSlot[]): Promise<void> {
  assertDb();
  await set(sRef(db!, `missions/${missionId}/participants/${playerId}/slots`), slots);
}

export async function adminUpdateParticipantSlotStatus(missionId: string, playerId: string, slotIndex: number, status: SlotStatus): Promise<void> {
  assertDb();
  await set(sRef(db!, `missions/${missionId}/participants/${playerId}/slots/${slotIndex}/status`), status);
}

export async function adminSetMissionLink(missionId: string, link: string): Promise<void> {
  assertDb();
  await set(sRef(db!, `missions/${missionId}/link`), link || null);
}

export async function adminSetMissionRoomSettings(missionId: string, release: TriState, collect: TriState, hint: number): Promise<void> {
  assertDb();
  await update(sRef(db!, `missions/${missionId}`), { release, collect, hint });
}

export async function adminKickMissionParticipant(missionId: string, playerId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'adminKickMissionParticipant')({ missionId, playerId, seasonId: getCurrentSeason() });
}

export interface CasinoYaml { uid: string; playerName: string; text: string }

// Admin: fetch a casino mission's uploaded Slot-Fill YAMLs (via the Admin SDK,
// which bypasses the owner-only Storage rules). For host verification / AP room
// generation. Works for live or settled missions.
export async function adminGetCasinoYamls(missionId: string): Promise<CasinoYaml[]> {
  assertFunctions();
  const res = await httpsCallable<{ missionId: string; seasonId: string }, { yamls: CasinoYaml[] }>(
    functions!, 'adminGetCasinoYamls',
  )({ missionId, seasonId: getCurrentSeason() });
  return res.data.yamls;
}

// Admin: deny a casino seat's uploaded config — invalidates the stored YAML and
// flags the seat so the player is prompted to resubmit (forming or in-progress).
export async function adminDenyCasinoYaml(missionId: string, playerId: string, reason?: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'adminDenyCasinoYaml')({ missionId, playerId, reason: reason ?? null, seasonId: getCurrentSeason() });
}

export async function claimMissionSlot(missionId: string, slotKey: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'claimMissionSlot')({ missionId, slotKey, seasonId: getCurrentSeason() });
}

export async function adminForceDeploy(missionId: string): Promise<void> {
  assertFunctions();
  await httpsCallable(functions!, 'adminForceDeploy')({ missionId, seasonId: getCurrentSeason() });
}

export async function syncPlayerProfile(
  targetUid?: string,
): Promise<{ tileCount: number; missionCount: number; gameCount: number }> {
  assertFunctions();
  const fn = httpsCallable<{ targetUid?: string; seasonId?: string }, { tileCount: number; missionCount: number; gameCount: number }>(
    functions!, 'syncPlayerProfile',
  );
  const result = await fn({ targetUid, seasonId: getCurrentSeason() });
  return result.data;
}

// The archived copy a mission settles into. For casino tables it stamps each
// seat's `potShare` and `net`, which the Settled ledger reads back: the pot split
// awards its remainder to a randomly chosen seat, so nothing downstream can
// re-derive who got it. Non-casino missions archive unchanged.
function archivedMission(mission: GMMission, potShares: Map<string, number>): GMMission {
  const settled: GMMission = { ...mission, state: 'complete' };
  if (mission.type !== 'casino') return settled;

  const participants: Record<string, GMParticipant> = {};
  for (const [pid, p] of Object.entries(mission.participants ?? {})) {
    const potShare = potShares.get(pid) ?? 0;
    participants[pid] = {
      ...p,
      potShare,
      net: (p.goldSwing ?? 0) + potShare - casinoSeatPaid(mission, pid),
    };
  }
  return { ...settled, participants };
}

// Completes a mission: awards XP/GP (with feat bonuses), writes CompletedChallenge
// records, archives to missionsHistory, and clears participants' activeMission.
// Returns { warned, unfinishedSlots } without acting when gating applies and
// confirmed is not true — caller shows the confirmation dialog then re-calls.
export async function completeMission(
  mission: GMMission,
  players: Record<string, Player>,
  // The active season's shell decides whether XP is a live reward. A casino-only
  // season (S1.5) is gold-only — XP is inert, so no mission awards it. A map
  // season (S2) awards XP for every mission, casino ones included. Keyed on the
  // shell (not on the player's `xp` field) so it stays correct even if casino
  // records later carry a uniform `xp: 0`, per the season-architecture plan.
  shell: 'map' | 'casino',
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
  let potShares = new Map<string, number>();
  if (mission.type === 'casino') {
    const winnerIds = Object.entries(mission.participants ?? {})
      .filter(([, p]) => p.played)
      .map(([pid]) => pid);
    potShares = casinoPotShares(mission.pot ?? 0, winnerIds);
  }

  for (const [pid, participant] of Object.entries(mission.participants ?? {})) {
    const player = players[pid];
    if (!player) continue;

    const isCasino = mission.type === 'casino';

    // A folded / never-played casino seat wins nothing — just free it.
    if (isCasino && !participant.played) {
      updates[sPath(`players/${pid}/activeMission`)] = null;
      continue;
    }

    // Feat bonuses (mentor/treasurer) — same calculation as tile rewards. They
    // apply to a mission's fixed XP/GP reward, NOT to casino winnings (card
    // values + pot are never feat-multiplied).
    const otherIds = ownerIds.filter(id => id !== pid);
    const isMentor    = Object.values(player.feats ?? {}).includes('mentor');
    const isTreasurer = Object.values(player.feats ?? {}).includes('treasurer');
    const otherMentors    = otherIds.filter(id => Object.values(players[id]?.feats ?? {}).includes('mentor')).length;
    const otherTreasurers = otherIds.filter(id => Object.values(players[id]?.feats ?? {}).includes('treasurer')).length;
    const xpMultiplier   = 1 + otherMentors    * 0.05 + (isMentor    ? otherIds.length * 0.01 : 0);
    const goldMultiplier = 1 + otherTreasurers * 0.10 + (isTreasurer ? otherIds.length * 0.03 : 0);

    // Gold source differs by mission kind; XP is the (possibly gambit-raised)
    // mission floor for both. For casino, gold = card values + pot share.
    let earnedXP:   number;
    let earnedGold: number;
    if (isCasino) {
      earnedXP   = Math.round((mission.xp ?? 0) * xpMultiplier);
      earnedGold = (participant.goldSwing ?? 0) + (potShares.get(pid) ?? 0);
    } else {
      earnedXP   = Math.round(mission.xp * xpMultiplier);
      earnedGold = Math.round(mission.gp * goldMultiplier);
      for (const slot of participant.slots ?? []) {
        earnedXP   += slot.bonusXP   ?? 0;
        earnedGold += slot.bonusGold ?? 0;
      }
    }

    // Gold and mission-release are written for everyone.
    updates[sPath(`players/${pid}/gold`)]          = (player.gold ?? 0) + earnedGold;
    updates[sPath(`players/${pid}/activeMission`)] = null;

    // XP, level-grants and completion history are only written in a season that
    // awards XP (map). A casino-only season (S1.5) is gold-only — XP is inert
    // (gambit XP is paid as gold) and its players carry no adventurers, so this
    // whole block is skipped. In a MAP season (S2), casino participants DO earn
    // XP from their gambit-raised floor and can level up, like any other mission.
    if (shell !== 'casino') {
      const baseXp        = player.xp ?? 0;
      const prevLevel     = calcLevel(baseXp);
      const newXp         = baseXp + earnedXP;
      const newLevel      = calcLevel(newXp);
      const updatedPlayer = checkAndGrantAdventurers(player, prevLevel, newLevel);

      updates[sPath(`players/${pid}/xp`)]         = newXp;
      updates[sPath(`players/${pid}/adventurers`)] = updatedPlayer.adventurers;

      const entryKey = push(sRef(db!, `players/${pid}/completedChallenges`)).key!;
      updates[sPath(`players/${pid}/completedChallenges/${entryKey}`)] = {
        coord:       'D3',
        name:        label,
        xpAwarded:   earnedXP,
        goldAwarded: earnedGold,
        completedAt: now,
      };
    }

    // Casino Coat earn path: mark this game type completed; grant the Coat once
    // the player has successfully completed a table of all four game types. Works
    // in either season — the tracking is the same.
    if (isCasino && mission.casinoGame) {
      updates[sPath(`players/${pid}/casinoGamesCompleted/${mission.casinoGame}`)] = true;
      const completed  = { ...(player.casinoGamesCompleted ?? {}), [mission.casinoGame]: true };
      const hasAllFour = CASINO_GAME_ORDER.every(g => completed[g]);
      const hasCoat    = (player.inventory?.['coat_of_many_colors'] ?? 0) > 0;
      if (hasAllFour && !hasCoat) {
        updates[sPath(`players/${pid}/inventory/coat_of_many_colors`)] = 1;
      }
    }

    if (mission.type === 'basic') {
      updates[sPath(`players/${pid}/basicTrainingDone`)] = true;
    }
  }

  updates[sPath(`missionsHistory/${mission.id}`)] = archivedMission(mission, potShares);
  updates[sPath(`missions/${mission.id}`)]         = null;

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

  await set(ref(d, `kmkEvents/${listId}`), { name, createdAt: Date.now(), active: false, areas });
  return listId;
}

// Show/hide a list on the player Trial Board.
//
// KMK is GLOBAL — not season-scoped — and its events may be unrelated to any
// RPelago season. Lists come and go and SEVERAL may be active at once, so
// activation is a flag on each list rather than a single pointer. (This replaces
// the old game/meta/kmkActiveListId.)
export async function kmkSetListActive(listId: string, active: boolean): Promise<void> {
  assertDb();
  await set(ref(db!, `kmkEvents/${listId}/active`), active);
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
    updates[sPath(`players/${playerId}/adventurers/${id}`)] = existing[id];
  }

  await update(ref(db!), updates);
  return toAdd;
}
