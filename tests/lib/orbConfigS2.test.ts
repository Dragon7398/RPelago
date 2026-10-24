import { describe, it, expect, afterEach } from 'vitest';
import { ALL_ORBS, TOWER_FLOOR_ORBS } from '../../src/lib/constants';
import { buildTypeGridS2, S2_ELITE_COUNT } from '../../src/lib/tileGenS2';
import { setActiveBoard } from '../../src/lib/board';
import type { TileTypeKey } from '../../src/types';

afterEach(() => setActiveBoard('s1'));

describe('S2 orb sourcing', () => {
  it('has exactly one orb per elite across the whole season', () => {
    // 3 surface elites + 2 per dungeon x 3 dungeons = 9, matching ALL_ORBS.
    const SURFACE = S2_ELITE_COUNT;
    const DUNGEON = 3 * 2;
    expect(SURFACE + DUNGEON).toBe(ALL_ORBS.length);
  });

  it('sources only 3 of the 9 orbs on the surface — the rest wait on Phase 3', () => {
    for (const seed of [1, 7, 42, 99]) {
      const elites = buildTypeGridS2(seed).flat().filter((t: TileTypeKey) => t === 'elite');
      expect(elites).toHaveLength(S2_ELITE_COUNT);
    }
  });

  it('keeps the Tower reachable from surface orbs alone at floor 1', () => {
    // Floor 1 opens at 3 orbs and the surface supplies exactly 3, so a player
    // can always enter the Tower before any dungeon ships. If the elite count
    // or the gate ever moved, the Tower would be unreachable at launch.
    expect(S2_ELITE_COUNT).toBeGreaterThanOrEqual(TOWER_FLOOR_ORBS[0]);
  });

  it('cannot open floors 2 or 3 from the surface alone', () => {
    // The dungeons are load-bearing for the win condition, by design.
    expect(S2_ELITE_COUNT).toBeLessThan(TOWER_FLOOR_ORBS[1]);
  });
});
