import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { httpsCallable } from 'firebase/functions';
import type { GameState, Tile, TileState, OrbConfig, TileAdventurer, OrbAcquisition, Shop, AdvSlot } from '../types';
import { firebaseReady, functions } from '../firebase/config';
import {
  subscribeToGame, initializeGameIfNeeded,
  setTileState, updateTileAdmin, assignAdventurer, removeAdventurer,
  completeTile, updateAdventurer,
  collectOrb, updateOrbConfig, resetOrbs, setAdminId,
  consumePlayerItem, mapReset, updateShop, setAdventurerSlots,
} from '../firebase/db';
import { awardTileRewards } from '../lib/gameLogic';
import { getAdjCoords } from '../lib/constants';
import { getTypeKey, orbIdForEdgeTile, orbIdForElite, initializeGrid } from '../lib/tileGen';
import { rcFromCoord } from '../lib/constants';

interface GameStateContextValue {
  gameState: GameState | null;
  loading: boolean;

  // Player actions
  sendAdventurer: (coord: string, entry: TileAdventurer) => Promise<void>;
  recallAdventurer: (coord: string, advId: string, ownerId: string) => Promise<void>;
  purchaseOrb: (coord: string) => Promise<void>;
  purchaseItem: (itemId: string, coord: string) => Promise<void>;
  renameAdventurer: (playerId: string, advId: string, firstName: string, lastName: string) => Promise<void>;

  // Admin tile actions
  adminSetTileState: (coord: string, state: TileState) => Promise<void>;
  adminUpdateTile: (coord: string, updates: Partial<Tile>) => Promise<void>;
  adminCompleteTile: (coord: string) => Promise<void>;
  adminGrantOrb: (orbId: string) => Promise<void>;

  // Admin config
  adminUpdateOrbConfig: (updates: Partial<OrbConfig>) => Promise<void>;
  adminResetOrbs: () => Promise<void>;
  adminMapReset: () => Promise<void>;
  adminConsumeItem: (playerId: string, itemId: string) => Promise<void>;
  adminSetAdmin: (playerId: string) => Promise<void>;
  adminUpdateShop: (shopId: string, updates: Partial<Shop>) => Promise<void>;
  adminSetAdventurerSlots: (coord: string, advId: string, slots: AdvSlot[]) => Promise<void>;
}

const GameStateContext = createContext<GameStateContextValue | null>(null);

export function GameStateProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!firebaseReady) {
      setLoading(false);
      return;
    }

    let unsubscribe: () => void;

    initializeGameIfNeeded().then(() => {
      unsubscribe = subscribeToGame(state => {
        if (state?.meta?.seed != null) initializeGrid(state.meta.seed);
        setGameState(state);
        setLoading(false);
      });
    }).catch(err => {
      console.error('Firebase init failed:', err);
      setLoading(false);
    });

    return () => { unsubscribe?.(); };
  }, []);

  // ── Player actions ──────────────────────────────────────────────────────────
  const sendAdventurer = useCallback(async (coord: string, entry: TileAdventurer) => {
    await assignAdventurer(coord, entry);
  }, []);

  const recallAdventurer = useCallback(async (coord: string, advId: string, ownerId: string) => {
    await removeAdventurer(coord, advId, ownerId);
  }, []);

  const purchaseOrb = useCallback(async (coord: string) => {
    if (!functions) throw new Error('Firebase not configured.');
    await httpsCallable(functions, 'purchaseShopOrb')({ coord });
  }, []);

  const renameAdventurer = useCallback(async (
    playerId: string, advId: string, firstName: string, lastName: string,
  ) => {
    const busyTile = gameState?.players[playerId]?.adventurers[advId]?.busyTile;
    await updateAdventurer(playerId, advId, { firstName, lastName }, busyTile);
  }, [gameState]);

  const purchaseItem = useCallback(async (itemId: string, coord: string) => {
    if (!functions) throw new Error('Firebase not configured.');
    await httpsCallable(functions, 'purchaseShopItem')({ itemId, coord });
  }, []);

  // ── Admin tile actions ──────────────────────────────────────────────────────
  const adminSetTileState = useCallback(async (coord: string, state: TileState) => {
    await setTileState(coord, state);
  }, []);

  const adminUpdateTile = useCallback(async (coord: string, updates: Partial<Tile>) => {
    await updateTileAdmin(coord, updates);
  }, []);

  const adminCompleteTile = useCallback(async (coord: string) => {
    if (!gameState) return;
    const tile = gameState.tiles[coord];
    if (!tile) return;

    const updatedPlayers = awardTileRewards(tile, gameState.players);
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
      const [ar, ac] = rcFromCoord(adjCoord);
      const adjType  = getTypeKey(ar, ac);
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

    await completeTile(coord, updatedPlayers, revealCoords, orbAcquisitions);
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
    await setAdventurerSlots(coord, advId, slots);
  }, []);

  return (
    <GameStateContext.Provider value={{
      gameState, loading,
      sendAdventurer, recallAdventurer, purchaseOrb, purchaseItem, renameAdventurer,
      adminSetTileState, adminUpdateTile, adminCompleteTile, adminGrantOrb,
      adminUpdateOrbConfig, adminResetOrbs, adminMapReset, adminConsumeItem, adminSetAdmin, adminUpdateShop,
      adminSetAdventurerSlots,
    }}>
      {children}
    </GameStateContext.Provider>
  );
}

export function useGameState(): GameStateContextValue {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within GameStateProvider');
  return ctx;
}
