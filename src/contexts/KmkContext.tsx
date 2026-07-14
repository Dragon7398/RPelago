import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onValue, ref } from 'firebase/database';
import type { KmkList, KmkStatus } from '../types';
import { firebaseReady, db as firebaseDb } from '../firebase/config';
import {
  kmkImportList as dbKmkImportList,
  kmkSetListActive as dbKmkSetListActive,
  kmkSetAreaLocked as dbKmkSetAreaLocked,
  kmkAdminSetTaskStatus as dbKmkAdminSetTaskStatus,
  kmkAdminEditTaskPlayer as dbKmkAdminEditTaskPlayer,
  kmkDeleteList as dbKmkDeleteList,
  kmkClaimTrial as dbKmkClaimTrial,
  kmkMarkDone as dbKmkMarkDone,
  kmkResume as dbKmkResume,
  kmkAbandon as dbKmkAbandon,
} from '../firebase/db';

interface KmkContextValue {
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

const KmkContext = createContext<KmkContextValue | null>(null);

export function KmkProvider({ children }: { children: ReactNode }) {
  const [lists, setLists]     = useState<Record<string, KmkList>>({});
  const [loading, setLoading] = useState(true);

  // KMK is GLOBAL — it is not season-scoped, and its events may be entirely
  // unrelated to any RPelago season. One subscription, no season dependency.
  useEffect(() => {
    if (!firebaseReady || !firebaseDb) {
      setLoading(false);
      return;
    }
    return onValue(ref(firebaseDb, 'kmkEvents'), snap => {
      setLists(snap.exists() ? (snap.val() as Record<string, KmkList>) : {});
      setLoading(false);
    });
  }, []);

  const activeListIds = Object.entries(lists)
    .filter(([, list]) => list.active)
    .map(([id]) => id);

  const importList = useCallback(async (
    name: string,
    rows: { area: string; trial: string; desc: string }[],
  ) => {
    return await dbKmkImportList(name, rows);
  }, []);

  const setListActive = useCallback(async (listId: string, active: boolean) => {
    await dbKmkSetListActive(listId, active);
  }, []);

  const setAreaLocked = useCallback(async (listId: string, areaId: string, locked: boolean) => {
    await dbKmkSetAreaLocked(listId, areaId, locked);
  }, []);

  const adminSetTaskStatus = useCallback(async (
    listId: string, areaId: string, taskId: string, status: KmkStatus,
  ) => {
    await dbKmkAdminSetTaskStatus(listId, areaId, taskId, status);
  }, []);

  const adminEditTaskPlayer = useCallback(async (
    listId: string, areaId: string, taskId: string, playerId: string, playerName: string,
  ) => {
    await dbKmkAdminEditTaskPlayer(listId, areaId, taskId, playerId, playerName);
  }, []);

  const deleteList = useCallback(async (listId: string) => {
    await dbKmkDeleteList(listId);
  }, []);

  const playerClaimTrial = useCallback(async (listId: string, areaId: string, taskId: string) => {
    await dbKmkClaimTrial(listId, areaId, taskId);
  }, []);

  const playerMarkDone = useCallback(async (listId: string, areaId: string, taskId: string) => {
    await dbKmkMarkDone(listId, areaId, taskId);
  }, []);

  const playerResume = useCallback(async (listId: string, areaId: string, taskId: string) => {
    await dbKmkResume(listId, areaId, taskId);
  }, []);

  const playerAbandon = useCallback(async (listId: string, areaId: string, taskId: string) => {
    await dbKmkAbandon(listId, areaId, taskId);
  }, []);

  return (
    <KmkContext.Provider value={{
      lists, activeListIds, loading,
      importList, setListActive, setAreaLocked,
      adminSetTaskStatus, adminEditTaskPlayer, deleteList,
      playerClaimTrial, playerMarkDone, playerResume, playerAbandon,
    }}>
      {children}
    </KmkContext.Provider>
  );
}

export function useKmk(): KmkContextValue {
  const ctx = useContext(KmkContext);
  if (!ctx) throw new Error('useKmk must be used within KmkProvider');
  return ctx;
}
