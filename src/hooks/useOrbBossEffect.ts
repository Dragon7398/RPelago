import { useEffect, useRef } from 'react';
import type { GameState } from '../types';
import { updateTileTraits } from '../firebase/db';
import { ELEMENTAL_ORB_TRAITS, BOSS_SOFT_TRAITS } from '../lib/constants';
import { typeKeyForCoord } from '../lib/tileGen';

// Watches orbState for newly acquired elemental orbs and removes the
// corresponding boss traits. Soft traits are skipped if the boss is already
// in-progress (the game is locked and only cosmetic changes are safe).
export function useOrbBossEffect(gameState: GameState | null): void {
  const processedOrbsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!gameState) return;
    const currentOrbIds = Object.keys(gameState.orbState ?? {});

    if (processedOrbsRef.current === null) {
      processedOrbsRef.current = new Set(currentOrbIds);
      return;
    }

    if (currentOrbIds.length === 0) {
      processedOrbsRef.current = new Set();
      return;
    }

    const newOrbIds = currentOrbIds.filter(id => !processedOrbsRef.current!.has(id));
    newOrbIds.forEach(id => processedOrbsRef.current!.add(id));
    const elementalNew = newOrbIds.filter(id => id in ELEMENTAL_ORB_TRAITS);
    if (elementalNew.length === 0) return;

    const bossCoord = Object.keys(gameState.tiles).find(coord => typeKeyForCoord(coord) === 'boss');
    if (!bossCoord) return;

    const bossTile = gameState.tiles[bossCoord];
    if (!bossTile || bossTile.state === 'complete') return;

    const softSet = new Set(BOSS_SOFT_TRAITS);
    const isInProgress = bossTile.state === 'inprogress';
    const next = { ...(bossTile.traits ?? {}) };
    let changed = false;

    for (const orbId of elementalNew) {
      const traitIds = ELEMENTAL_ORB_TRAITS[orbId]!;
      const toRemove = isInProgress ? traitIds.filter(t => softSet.has(t)) : [...traitIds];
      for (const traitId of toRemove) {
        if (traitId in next) { delete next[traitId]; changed = true; }
      }
    }

    if (changed) {
      updateTileTraits(bossCoord, Object.keys(next).length > 0 ? next : null);
    }
  }, [gameState?.orbState]); // eslint-disable-line react-hooks/exhaustive-deps
}
