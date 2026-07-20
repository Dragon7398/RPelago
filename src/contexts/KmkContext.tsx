import { createContext, useContext } from 'react';
import type { KmkList, KmkStatus } from '../types';

// The Provider component lives in ./KmkProvider so this file exports only the
// hook and context object (react-refresh can't hot-swap a module that mixes a
// component with a hook, and the hook is the widely imported half).

export interface KmkContextValue {
  lists: Record<string, KmkList>;
  /**
   * Ids of every list currently shown on the Trial Board. KMK lists come and go
   * and SEVERAL may run at once, so this is derived from each list's `active`
   * flag rather than a single global pointer.
   */
  activeListIds: string[];
  loading: boolean;

  // Admin actions
  importList: (name: string, rows: { area: string; trial: string; desc: string }[]) => Promise<string>;
  setListActive: (listId: string, active: boolean) => Promise<void>;
  setAreaLocked: (listId: string, areaId: string, locked: boolean) => Promise<void>;
  adminSetTaskStatus: (listId: string, areaId: string, taskId: string, status: KmkStatus) => Promise<void>;
  adminEditTaskPlayer: (listId: string, areaId: string, taskId: string, playerId: string, playerName: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;

  // Player self-service
  playerClaimTrial: (listId: string, areaId: string, taskId: string) => Promise<void>;
  playerMarkDone:   (listId: string, areaId: string, taskId: string) => Promise<void>;
  playerResume:     (listId: string, areaId: string, taskId: string) => Promise<void>;
  playerAbandon:    (listId: string, areaId: string, taskId: string) => Promise<void>;
}

export const KmkContext = createContext<KmkContextValue | null>(null);

export function useKmk(): KmkContextValue {
  const ctx = useContext(KmkContext);
  if (!ctx) throw new Error('useKmk must be used within KmkProvider');
  return ctx;
}
