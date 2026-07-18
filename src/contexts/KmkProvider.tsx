import { useState, useEffect, useCallback, type ReactNode } from 'react';
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
import { KmkContext } from './KmkContext';

export function KmkProvider({ children }: { children: ReactNode }) {
  const [lists, setLists]     = useState<Record<string, KmkList>>({});
  // Start "loading" only if Firebase is actually there to subscribe to; with no
  // Firebase configured nothing loads, so we're settled at once. (Lazy init
  // instead of a setState in the effect's not-ready guard below.)
  const [loading, setLoading] = useState(() => firebaseReady && !!firebaseDb);

  // KMK is GLOBAL — it is not season-scoped, and its events may be entirely
  // unrelated to any RPelago season. One subscription, no season dependency.
  useEffect(() => {
    if (!firebaseReady || !firebaseDb) return;
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
