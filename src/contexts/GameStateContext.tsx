import { createContext, useContext } from 'react';
import type { GameState, Tile, TileState, OrbConfig, DeclaredSlot, Shop, AdvSlot, ActivityEntry, SlotStatus, TriState } from '../types';
import type { SettleBlockers } from '../lib/missionLogic';

// The Provider component lives in ./GameStateProvider so this file exports only
// the hook and context object (react-refresh can't hot-swap a module that mixes
// a component with a hook, and the hook is imported all over the app).

export interface GameStateContextValue {
  gameState: GameState | null;
  loading: boolean;
  activityLog: ActivityEntry[];

  // Player actions
  // Joins go through callables now (map plan 0.5.2): the player declares slots
  // and attaches a config, and the server validates both.
  sendAdventurer: (coord: string, advId: string, slots: DeclaredSlot[]) => Promise<void>;
  recallAdventurer: (coord: string, advId: string, ownerId: string) => Promise<void>;
  /**
   * `coord` names the S1 town shop to buy from. OMITTED on S2, which has one global
   * shop at a fixed path and no shop tiles to name (§1.8).
   */
  purchaseItem: (itemId: string, coord?: string) => Promise<void>;
  renameAdventurer: (playerId: string, advId: string, firstName: string, lastName: string) => Promise<void>;
  selectFeat: (playerId: string, slot: 'level3' | 'level5' | 'level7', featId: string) => Promise<void>;

  // Admin tile actions
  adminSetTileState: (coord: string, state: TileState) => Promise<void>;
  adminUpdateTile: (coord: string, updates: Partial<Tile>) => Promise<void>;
  adminCompleteTile: (coord: string) => Promise<void>;
  adminRegenTileStats: (coord: string) => Promise<void>;
  adminGrantOrb: (orbId: string) => Promise<void>;

  // Admin config
  adminUpdateOrbConfig: (updates: Partial<OrbConfig>) => Promise<void>;
  adminResetOrbs: () => Promise<void>;
  adminMapReset: () => Promise<void>;
  adminConsumeItem: (playerId: string, itemId: string) => Promise<void>;
  adminSetAdmin: (playerId: string) => Promise<void>;
  /** S1 only — per-town shops. */
  adminUpdateShop: (shopId: string, updates: Partial<Shop>) => Promise<void>;
  /** S2 — the single global shop's whole stock list (§1.8). */
  adminSetGlobalShopItems: (itemIds: readonly string[]) => Promise<void>;
  adminSetAdventurerSlots: (coord: string, advId: string, slots: AdvSlot[]) => Promise<void>;
  adminSetPublicSlots: (coord: string, slots: AdvSlot[]) => Promise<void>;
  setNameColor: (playerId: string, colorId: string | null) => Promise<void>;
  adminDisablePlayer: (playerId: string) => Promise<void>;
  adminEnablePlayer: (playerId: string) => Promise<void>;
  // Restricted is the middle status: plays as normal, but claims are only
  // returned when the world resolves. See `playerStatus` in gameLogic.ts.
  adminSetPlayerRestricted: (playerId: string, restricted: boolean) => Promise<void>;
  adminKickAdventurer: (coord: string, advId: string, ownerId: string, convertToClaimableSlot: boolean) => Promise<void>;
  // No slots argument: a claimant INHERITS the vacated slot (0.5.8).
  claimClaimableSlot: (coord: string, slotKey: string, advId: string) => Promise<void>;
  adminSetClaimableSlotBonus: (coord: string, slotKey: string, slotArr: AdvSlot[]) => Promise<void>;
  adminAddWarning: (playerId: string, message: string) => Promise<void>;
  adminDeleteWarning: (playerId: string, warnKey: string) => Promise<void>;
  adminClearWarnings: (playerId: string) => Promise<void>;
  // Manual balance adjustment (negative = clawback). Resolves to the new balance.
  adminGrantGold: (playerId: string, amount: number, reason?: string) => Promise<number>;
  setAdventurerStatusNote: (coord: string, advId: string, text: string | null) => Promise<void>;

  // Mission actions
  enlistInMission: (missionId: string, missionLabel: string) => Promise<void>;
  standDownFromMission: (missionId: string, missionLabel: string) => Promise<void>;
  setMissionParticipantStatusNote: (missionId: string, note: string | null) => Promise<void>;
  setSlotStatusNote: (missionId: string, slotIndex: number, note: string | null, ownerId?: string) => Promise<void>;
  adminSetParticipantSlots: (missionId: string, playerId: string, slots: AdvSlot[]) => Promise<void>;
  adminUpdateParticipantSlotStatus: (missionId: string, playerId: string, slotIndex: number, status: SlotStatus) => Promise<void>;
  adminSetMissionLink: (missionId: string, link: string) => Promise<void>;
  adminSetMissionRoomSettings: (missionId: string, release: TriState, collect: TriState, hint: number) => Promise<void>;
  adminKickMissionParticipant: (missionId: string, playerId: string) => Promise<void>;
  adminForceDeploy: (missionId: string) => Promise<void>;
  adminCompleteMission: (missionId: string, confirmed?: boolean) => Promise<{ warned?: boolean; blockers?: SettleBlockers }>;
  adminBackfillChallengeHistory: (coord: string) => Promise<number>;
  claimMissionSlot: (missionId: string, slotKey: string) => Promise<void>;
  adminGrantMissingAdventurers: (playerId: string) => Promise<number>;
}

export const GameStateContext = createContext<GameStateContextValue | null>(null);

export function useGameState(): GameStateContextValue {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error('useGameState must be used within GameStateProvider');
  return ctx;
}
