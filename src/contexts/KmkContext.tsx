import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { onValue, ref } from 'firebase/database';
import type { KmkList, KmkStatus } from '../types';
import { firebaseReady, db as firebaseDb } from '../firebase/config';
import {
  kmkImportList as dbKmkImportList,
  kmkSetActiveList as dbKmkSetActiveList,
  kmkSetAreaLocked as dbKmkSetAreaLocked,
  kmkAdminSetTaskStatus as dbKmkAdminSetTaskStatus,
  kmkAdminEditTaskPlayer as dbKmkAdminEditTaskPlayer,
  kmkDeleteList as dbKmkDeleteList,
} from '../firebase/db';

interface KmkContextValue {
  lists: Record<string, KmkList>;
  activeListId: string | null;
  loading: boolean;

  // Admin actions
  importList: (name: string, rows: { area: string; trial: string; desc: string }[]) => Promise<string>;
  setActiveList: (listId: string | null) => Promise<void>;
  setAreaLocked: (listId: string, areaId: string, locked: boolean) => Promise<void>;
  adminSetTaskStatus: (listId: string, areaId: string, taskId: string, status: KmkStatus) => Promise<void>;
  adminEditTaskPlayer: (listId: string, areaId: string, taskId: string, playerId: string, playerName: string) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
}

const KmkContext = createContext<KmkContextValue | null>(null);

export function KmkProvider({ children }: { children: ReactNode }) {
  const [lists, setLists]             = useState<Record<string, KmkList>>({});
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    if (!firebaseReady || !firebaseDb) {
      setLoading(false);
      return;
    }

    let listsReady  = false;
    let activeReady = false;

    const unsubLists = onValue(ref(firebaseDb, 'kmkEvents'), snap => {
      setLists(snap.exists() ? (snap.val() as Record<string, KmkList>) : {});
      listsReady = true;
      if (activeReady) setLoading(false);
    });

    const unsubActive = onValue(ref(firebaseDb, 'game/meta/kmkActiveListId'), snap => {
      setActiveListId(snap.exists() ? (snap.val() as string) : null);
      activeReady = true;
      if (listsReady) setLoading(false);
    });

    return () => { unsubLists(); unsubActive(); };
  }, []);

  const importList = useCallback(async (
    name: string,
    rows: { area: string; trial: string; desc: string }[],
  ) => {
    return await dbKmkImportList(name, rows);
  }, []);

  const setActiveList = useCallback(async (listId: string | null) => {
    await dbKmkSetActiveList(listId);
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

  return (
    <KmkContext.Provider value={{
      lists, activeListId, loading,
      importList, setActiveList, setAreaLocked,
      adminSetTaskStatus, adminEditTaskPlayer, deleteList,
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
