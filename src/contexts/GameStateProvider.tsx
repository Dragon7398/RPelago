import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref, remove } from 'firebase/database';
import type { Tile, TileState, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot, ActivityEntry, SlotStatus, TriState } from '../types';
import { firebaseReady, functions, auth as firebaseAuth, db as firebaseDb } from '../firebase/config';
import { sPath } from '../firebase/season';
import { useAuth } from './AuthContext';
import {
  ensureSeasonPlayer,
  subscribeToGame,
  setTileState, setTileInProgress, updateTileAdmin, assignAdventurer, removeAdventurer,
  completeTile, updateAdventurer, resetTileStats, setTilesAvailability,
  collectOrb, updateOrbConfig, resetOrbs, setAdminId,
  consumePlayerItem, mapReset, updateShop, setAdventurerSlots, setPublicSlots,
  setPlayerDisabled, setPlayerNameColor, subscribeToActivityLog, logActivity,
  selectFeat as dbSelectFeat, adminKickAdventurer as dbKickAdventurer,
  claimClaimableSlot as dbClaimClaimableSlot,
  setClaimableSlotBonus,
  addPlayerWarning, deletePlayerWarning, clearPlayerWarnings,
  setAdventurerStatusNote as dbSetAdventurerStatusNote,
  enlistInMission as dbEnlistInMission,
  standDownFromMission as dbStandDownFromMission,
  setMissionParticipantStatusNote as dbSetMissionParticipantStatusNote,
  adminSetParticipantSlots as dbAdminSetParticipantSlots,
  adminUpdateParticipantSlotStatus as dbAdminUpdateParticipantSlotStatus,
  adminSetMissionLink as dbAdminSetMissionLink,
  adminSetMissionRoomSettings as dbAdminSetMissionRoomSettings,
  adminKickMissionParticipant as dbAdminKickMissionParticipant,
  adminForceDeploy as dbAdminForceDeploy,
  completeMission as dbCompleteMission,
  backfillChallengeHistory as dbBackfillChallengeHistory,
  claimMissionSlot as dbClaimMissionSlot,
  grantMissingAdventurers as dbGrantMissingAdventurers,
} from '../firebase/db';
import { useToast } from './ToastContext';
import { useSeason } from './SeasonContext';
import { awardTileRewards, computeRecalcUpdates } from '../lib/gameLogic';
import { getAdjCoords, FREE_COMPLETED_STATUSES } from '../lib/constants';
import { getTypeKey, typeKeyForCoord, orbIdForEdgeTile, orbIdForElite, initializeGrid, generateTileStats } from '../lib/tileGen';
import { rcFromCoord } from '../lib/constants';
import { GameStateContext } from './GameStateContext';
import type { GameState } from '../types';

export function GameStateProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState]   = useState<GameState | null>(null);
  // Start "loading" only if Firebase is configured; with none there's nothing to
  // fetch. (Lazy init instead of a setState in the effect's not-ready guard.)
  const [loading, setLoading]       = useState(() => firebaseReady);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const currentUidRef = useRef<string | null>(null);
  const { addToast } = useToast();

  // Which season we're rendering. Null until config resolves; every
  // season-scoped read/write below waits on it.
  const season = useSeason().season;
  const seasonId = season?.id ?? null;
  // Whether this season awards XP (map) or is gold-only (casino) — see completeMission.
  const seasonShell = season?.shell ?? 'map';

  // Subscribe to the ACTIVE SEASON's state. Reads are open to all users, but we
  // must wait for SeasonContext to resolve which season to read — the db.ts path
  // helpers throw until setCurrentSeason() has run. Re-subscribes if the admin
  // switches to preview a draft season.
  //
  // This mirrors an external subscription (subscribeToGame) into state — the
  // sanctioned setState-in-effect pattern; the rule mis-fires only because
  // subscribeToGame is a custom function it can't see as an async boundary.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!firebaseReady || !seasonId) return;   // config still loading

    setLoading(true);
    const unsubscribeGame = subscribeToGame(state => {
      if (state?.meta?.seed != null) initializeGrid(state.meta.seed);
      setGameState(state);
      setLoading(false);
    });
    const unsubscribeLog = subscribeToActivityLog(setActivityLog);
    return () => { unsubscribeGame(); unsubscribeLog(); };
  }, [seasonId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Make sure the signed-in player actually exists in whatever season we're
  // rendering. A record is only minted at Discord sign-in, for the season active
  // AT THAT MOMENT — so a restored session, a season cutover, or an admin/alpha
  // previewing a draft would otherwise show a player with no record and 0 gold.
  // Re-runs on season switch; the callable is idempotent and no-ops on archived
  // seasons (frozen history).
  const { user: authUser } = useAuth();
  useEffect(() => {
    if (!firebaseReady || !authUser || !seasonId) return;
    void ensureSeasonPlayer().catch(err => {
      console.warn('[RPelago] Could not ensure a player record for this season.', err);
    });
  }, [authUser?.id, seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the current uid for the notification listener. (Game/season creation
  // is no longer client-triggered — see db.ts "Season creation".)
  useEffect(() => {
    if (!firebaseReady || !firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, fbUser => {
      currentUidRef.current = fbUser?.uid ?? null;
    });
  }, []);

  // Subscribe to deployment notifications for the current user, within the
  // active season. Each push-keyed entry fires a toast and is deleted on read.
  useEffect(() => {
    if (!firebaseReady || !firebaseDb || !seasonId) return;
    let unsubscribe: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth!, fbUser => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (!fbUser) return;
      const base = `seasons/${seasonId}/notifications/${fbUser.uid}`;
      unsubscribe = onValue(ref(firebaseDb!, base), snap => {
        if (!snap.exists()) return;
        const entries = snap.val() as Record<string, { type: string; label: string; ts: number }>;
        for (const [key, entry] of Object.entries(entries)) {
          if (entry.type === 'mission_deploy') {
            addToast(`⚜ ${entry.label} has deployed — you are committed!`, 'info');
          }
          remove(ref(firebaseDb!, `${base}/${key}`));
        }
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
      unsubscribeAuth();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  // ── Player actions ──────────────────────────────────────────────────────────
  const sendAdventurer = useCallback(async (coord: string, entry: TileAdventurer) => {
    await assignAdventurer(coord, entry);
  }, []);

  const recallAdventurer = useCallback(async (coord: string, advId: string, ownerId: string) => {
    await removeAdventurer(coord, advId, ownerId);
  }, []);

  const purchaseOrb = useCallback(async (coord: string) => {
    if (!functions) throw new Error('Firebase not configured.');
    await httpsCallable(functions, 'purchaseShopOrb')({ coord, seasonId });
  }, [seasonId]);

  const renameAdventurer = useCallback(async (
    playerId: string, advId: string, firstName: string, lastName: string,
  ) => {
    await updateAdventurer(playerId, advId, { firstName, lastName });
  }, []);

  const purchaseItem = useCallback(async (itemId: string, coord: string) => {
    if (!functions) throw new Error('Firebase not configured.');
    await httpsCallable(functions, 'purchaseShopItem')({ itemId, coord, seasonId });
  }, [seasonId]);

  const selectFeat = useCallback(async (
    playerId: string,
    slot: 'level3' | 'level5' | 'level7',
    featId: string,
  ) => {
    await dbSelectFeat(playerId, slot, featId);
  }, []);

  // ── Admin tile actions ──────────────────────────────────────────────────────
  const adminSetTileState = useCallback(async (coord: string, state: TileState) => {
    const tile = gameState?.tiles[coord];
    const wasComplete = tile?.state === 'complete';

    if (state === 'inprogress' && tile) {
      const advIds = Object.keys(tile.adventurers ?? {});
      const pick = () => advIds.length > 0 ? advIds[Math.floor(Math.random() * advIds.length)] : null;
      const stunnedAdvId = tile.traits?.['stunning'] !== undefined ? pick() : null;
      const tauntedAdvId = tile.traits?.['taunt']    !== undefined ? pick() : null;
      let roomAssignments: Record<string, 1 | 2> | undefined;
      let slotRoomUpdates: Record<string, unknown> | undefined;
      if (tile.traits?.['bifurcated'] !== undefined && advIds.length > 0) {
        const shuffled = [...advIds].sort(() => Math.random() - 0.5);
        const room1Count = Math.ceil(shuffled.length / 2);
        roomAssignments = {};
        shuffled.forEach((id, i) => { roomAssignments![id] = i < room1Count ? 1 : 2; });
        // Stamp room onto any slots already assigned at bifurcation time
        for (const [advId, room] of Object.entries(roomAssignments)) {
          const rawSlots = tile.adventurers[advId]?.slots;
          const existingSlots: AdvSlot[] = rawSlots
            ? (Array.isArray(rawSlots) ? rawSlots : Object.values(rawSlots as Record<string, AdvSlot>))
            : [];
          if (existingSlots.length > 0) {
            slotRoomUpdates ??= {};
            slotRoomUpdates[sPath(`tiles/${coord}/adventurers/${advId}/slots`)] =
              existingSlots.map(s => ({ ...s, room }));
          }
        }
      }
      if (wasComplete && gameState) {
        const recalc = computeRecalcUpdates(gameState.tiles, coord, 'inprogress');
        await setTilesAvailability(recalc, coord, stunnedAdvId, tauntedAdvId, roomAssignments, slotRoomUpdates);
      } else {
        await setTileInProgress(coord, stunnedAdvId, tauntedAdvId, roomAssignments, slotRoomUpdates);
      }
    } else if (wasComplete && state !== 'complete' && gameState) {
      const recalc = computeRecalcUpdates(gameState.tiles, coord, state);
      await setTilesAvailability(recalc);
    } else {
      await setTileState(coord, state);
    }
    if (state === 'inprogress') {
      const name = tile?.name || coord;
      await logActivity('tile_inprogress', `${name} is now In Progress.`, '⚔️');
    }
  }, [gameState]);

  const adminUpdateTile = useCallback(async (coord: string, updates: Partial<Tile>) => {
    await updateTileAdmin(coord, updates);
  }, []);

  const adminRegenTileStats = useCallback(async (coord: string) => {
    if (!gameState) return;
    const [r, c] = rcFromCoord(coord);
    const typeKey = getTypeKey(r, c);
    const stats = generateTileStats(gameState.meta.seed, r, c, typeKey);
    await resetTileStats(coord, stats);
  }, [gameState]);

  const adminCompleteTile = useCallback(async (coord: string) => {
    if (!gameState) return;
    const tile = gameState.tiles[coord];
    if (!tile) return;

    const originalPlayers = gameState.players;
    const updatedPlayers  = awardTileRewards(tile, originalPlayers, coord);

    const awardedAmounts: Record<string, { xp: number; gold: number }> = {};
    for (const [pid, updated] of Object.entries(updatedPlayers)) {
      const original = originalPlayers[pid];
      if (!original) continue;
      const xp   = updated.xp   - original.xp;
      const gold = updated.gold - original.gold;
      if (xp === 0 && gold === 0) continue; // skip players not on this tile
      awardedAmounts[pid] = { xp, gold };
    }
    const [r, c]   = rcFromCoord(coord);
    const typeKey  = getTypeKey(r, c);
    const orbState = gameState.orbState ?? {};
    const tileName = tile.name || coord;

    // Build acquisition records for orbs earned from this tile completion
    const orbAcquisitions: Record<string, OrbAcquisition> = {};

    const edgeOrbId = orbIdForEdgeTile(r, c, gameState.orbConfig);
    if (edgeOrbId && !orbState[edgeOrbId]) {
      orbAcquisitions[edgeOrbId] = {
        method:    typeKey as OrbAcquisition['method'],
        tileCoord: coord,
        tileName,
      };
    }

    if (typeKey === 'elite') {
      const eliteOrbId = orbIdForElite(r, c, gameState.orbConfig);
      if (eliteOrbId && !orbState[eliteOrbId]) {
        orbAcquisitions[eliteOrbId] = {
          method:    'elite',
          tileCoord: coord,
          tileName,
        };
      }
    }

    // Determine which adjacent hidden tiles to reveal
    const revealCoords: { coord: string; newState: TileState }[] = [];
    for (const adjCoord of getAdjCoords(coord)) {
      const adjTile = gameState.tiles[adjCoord];
      if (!adjTile || adjTile.state !== 'hidden') continue;
      const adjType  = typeKeyForCoord(adjCoord);
      if (adjType === 'town') {
        revealCoords.push({ coord: adjCoord, newState: 'complete' });
        for (const nc of getAdjCoords(adjCoord)) {
          const nt = gameState.tiles[nc];
          if (nt && nt.state === 'hidden') {
            revealCoords.push({ coord: nc, newState: 'available' });
          }
        }
      } else {
        revealCoords.push({ coord: adjCoord, newState: 'available' });
      }
    }

    await completeTile(coord, updatedPlayers, revealCoords, orbAcquisitions, tileName, awardedAmounts);

    const ownerIds = [...new Set(Object.values(tile.adventurers ?? {}).map(a => a.owner))];
    const participantNames = ownerIds.map(id => gameState.players[id]?.displayName).filter(Boolean).join(', ');
    const credit = participantNames || 'the party';
    await logActivity('tile_complete', `${tileName} cleared by ${credit}.`, '✅');

    for (const { coord: rc, newState } of revealCoords) {
      if (newState === 'available') {
        const name = gameState.tiles[rc]?.name || rc;
        await logActivity('tile_available', `${name} is now available.`, '🗺️');
      }
    }
  }, [gameState]);

  const adminGrantOrb = useCallback(async (orbId: string) => {
    await collectOrb(orbId, { method: 'admin', tileCoord: '' });
  }, []);

  // ── Admin config ────────────────────────────────────────────────────────────
  const adminUpdateOrbConfig = useCallback(async (updates: Partial<OrbConfig>) => {
    await updateOrbConfig(updates);
  }, []);

  const adminResetOrbs = useCallback(async () => {
    await resetOrbs();
  }, []);

  const adminMapReset = useCallback(async () => {
    await mapReset();
  }, []);

  const adminConsumeItem = useCallback(async (playerId: string, itemId: string) => {
    if (!gameState) return;
    const qty = (gameState.players[playerId]?.inventory?.[itemId] ?? 0) - 1;
    await consumePlayerItem(playerId, itemId, qty);
  }, [gameState]);

  const adminSetAdmin = useCallback(async (playerId: string) => {
    await setAdminId(playerId);
  }, []);

  const adminUpdateShop = useCallback(async (shopId: string, updates: Partial<Shop>) => {
    await updateShop(shopId, updates);
  }, []);

  const adminSetAdventurerSlots = useCallback(async (coord: string, advId: string, slots: AdvSlot[]) => {
    const tileAdv  = gameState?.tiles[coord]?.adventurers?.[advId];
    const playerAdv = tileAdv ? gameState?.players[tileAdv.owner]?.adventurers[advId] : null;

    // On bifurcated tiles, stamp each slot with the adventurer's room so room
    // propagates to claimable slots if this player is later kicked.
    const isBifurcated = gameState?.tiles[coord]?.traits?.['bifurcated'] !== undefined;
    const stampedSlots = isBifurcated && tileAdv?.room
      ? slots.map(s => ({ ...s, room: tileAdv.room as 1 | 2 }))
      : slots;

    const FREE_STATUSES = FREE_COMPLETED_STATUSES;
    const allComplete  = stampedSlots.length > 0 && stampedSlots.every(s => s.status && FREE_STATUSES.has(s.status));
    const stillHeld    = playerAdv?.busy === true && playerAdv?.busyTile === coord;
    const freeAdventurer = allComplete && stillHeld && tileAdv
      ? { ownerId: tileAdv.owner }
      : undefined;
    await setAdventurerSlots(coord, advId, stampedSlots, freeAdventurer);
  }, [gameState]);

  const adminSetPublicSlots = useCallback(async (coord: string, slots: AdvSlot[]) => {
    await setPublicSlots(coord, slots);
  }, []);

  const setNameColor = useCallback(async (playerId: string, colorId: string | null) => {
    await setPlayerNameColor(playerId, colorId);
  }, []);

  const adminDisablePlayer = useCallback(async (playerId: string) => {
    await setPlayerDisabled(playerId, true);
  }, []);

  const adminEnablePlayer = useCallback(async (playerId: string) => {
    await setPlayerDisabled(playerId, false);
  }, []);

  const adminKickAdventurer = useCallback(async (
    coord: string, advId: string, ownerId: string, convertToClaimableSlot: boolean,
  ) => {
    const autoWarning = convertToClaimableSlot && gameState
      ? `Abandoned in-progress challenge: ${gameState.tiles[coord]?.name || coord}`
      : undefined;
    await dbKickAdventurer(coord, advId, ownerId, convertToClaimableSlot, autoWarning);
  }, [gameState]);

  const claimClaimableSlot = useCallback(async (
    coord: string, slotKey: string, entry: TileAdventurer,
  ) => {
    await dbClaimClaimableSlot(coord, slotKey, entry);
  }, []);

  const adminSetClaimableSlotBonus = useCallback(async (
    coord: string, slotKey: string, slotArr: AdvSlot[],
  ) => {
    await setClaimableSlotBonus(coord, slotKey, slotArr);
  }, []);

  const adminAddWarning = useCallback(async (playerId: string, message: string) => {
    await addPlayerWarning(playerId, message);
  }, []);

  const adminDeleteWarning = useCallback(async (playerId: string, warnKey: string) => {
    await deletePlayerWarning(playerId, warnKey);
  }, []);

  const adminClearWarnings = useCallback(async (playerId: string) => {
    await clearPlayerWarnings(playerId);
  }, []);

  const setAdventurerStatusNote = useCallback(async (coord: string, advId: string, text: string | null) => {
    await dbSetAdventurerStatusNote(coord, advId, text);
  }, []);

  // ── Mission actions ─────────────────────────────────────────────────────────
  const enlistInMission = useCallback(async (missionId: string, missionLabel: string) => {
    await dbEnlistInMission(missionId);
    addToast(`You have enlisted in ${missionLabel}.`, 'success');
  }, [addToast]);

  const standDownFromMission = useCallback(async (missionId: string, missionLabel: string) => {
    await dbStandDownFromMission(missionId);
    addToast(`You have stood down from ${missionLabel}.`, 'info');
  }, [addToast]);

  const setMissionParticipantStatusNote = useCallback(async (missionId: string, note: string | null) => {
    await dbSetMissionParticipantStatusNote(missionId, note);
  }, []);

  const adminSetParticipantSlots = useCallback(async (missionId: string, playerId: string, slots: AdvSlot[]) => {
    await dbAdminSetParticipantSlots(missionId, playerId, slots);
  }, []);

  const adminUpdateParticipantSlotStatus = useCallback(async (missionId: string, playerId: string, slotIndex: number, status: SlotStatus) => {
    await dbAdminUpdateParticipantSlotStatus(missionId, playerId, slotIndex, status);
  }, []);

  const adminSetMissionLink = useCallback(async (missionId: string, link: string) => {
    await dbAdminSetMissionLink(missionId, link);
  }, []);

  const adminSetMissionRoomSettings = useCallback(async (missionId: string, release: TriState, collect: TriState, hint: number) => {
    await dbAdminSetMissionRoomSettings(missionId, release, collect, hint);
  }, []);

  const adminKickMissionParticipant = useCallback(async (missionId: string, playerId: string) => {
    await dbAdminKickMissionParticipant(missionId, playerId);
  }, []);

  const adminForceDeploy = useCallback(async (missionId: string) => {
    await dbAdminForceDeploy(missionId);
  }, []);

  const adminCompleteMission = useCallback(async (missionId: string, confirmed?: boolean) => {
    if (!gameState) return {};
    const mission = gameState.missions?.[missionId];
    if (!mission) return {};
    return await dbCompleteMission(mission, gameState.players, seasonShell, confirmed);
  }, [gameState, seasonShell]);

  const adminBackfillChallengeHistory = useCallback(async (coord: string) => {
    return await dbBackfillChallengeHistory(coord);
  }, []);

  const claimMissionSlot = useCallback(async (missionId: string, slotKey: string) => {
    await dbClaimMissionSlot(missionId, slotKey);
    addToast('You have claimed the open spot and are now committed to this mission.', 'success');
  }, [addToast]);

  const adminGrantMissingAdventurers = useCallback(async (playerId: string) => {
    if (!gameState) return 0;
    const player = gameState.players[playerId];
    if (!player) return 0;
    return await dbGrantMissingAdventurers(playerId, player);
  }, [gameState]);

  return (
    <GameStateContext.Provider value={{
      gameState, loading, activityLog,
      sendAdventurer, recallAdventurer, purchaseOrb, purchaseItem, renameAdventurer, selectFeat,
      adminSetTileState, adminUpdateTile, adminCompleteTile, adminRegenTileStats, adminGrantOrb,
      adminUpdateOrbConfig, adminResetOrbs, adminMapReset, adminConsumeItem, adminSetAdmin, adminUpdateShop,
      adminSetAdventurerSlots, adminSetPublicSlots, setNameColor, adminDisablePlayer, adminEnablePlayer,
      adminKickAdventurer, claimClaimableSlot, adminSetClaimableSlotBonus,
      adminAddWarning, adminDeleteWarning, adminClearWarnings,
      setAdventurerStatusNote,
      enlistInMission, standDownFromMission, setMissionParticipantStatusNote,
      adminSetParticipantSlots, adminUpdateParticipantSlotStatus,
      adminSetMissionLink, adminSetMissionRoomSettings,
      adminKickMissionParticipant, adminForceDeploy, adminCompleteMission,
      adminBackfillChallengeHistory, claimMissionSlot,
      adminGrantMissingAdventurers,
    }}>
      {children}
    </GameStateContext.Provider>
  );
}
