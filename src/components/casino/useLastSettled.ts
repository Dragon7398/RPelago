import { useMemo } from 'react';
import type { GMMission } from '../../types';

/**
 * The player's most recently settled casino table — the Ledger phase's subject.
 *
 * A settled table leaves `missions` for `missionsHistory` and clears the seat's
 * `activeMission`, so there is nothing left pointing at the table the player just
 * finished. Find it by looking for themselves in the history instead.
 */
export function useLastSettled(
  history: Record<string, GMMission> | undefined,
  uid: string | null,
): GMMission | null {
  return useMemo(() => {
    if (!uid) return null;
    const mine = Object.values(history ?? {}).filter(m => m.type === 'casino' && !!m.participants?.[uid]);
    if (mine.length === 0) return null;
    const at = (m: GMMission) => m.deployedAt ?? m.createdAt;
    return mine.reduce((a, b) => (at(b) > at(a) ? b : a));
  }, [history, uid]);
}
