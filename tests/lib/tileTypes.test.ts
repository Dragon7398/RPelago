import { describe, it, expect } from 'vitest';
import { TILE_TYPES } from '../../src/lib/constants';
import { buildTypeGridS2 } from '../../src/lib/tileGenS2';
import { buildTypeGridS1 } from '../../src/lib/tileGen';
import type { TileTypeKey } from '../../src/types';

describe('TILE_TYPES covers every type a generator can emit', () => {
  // A missing entry falls through to TILE_TYPES.battle at every call site, so a
  // dungeon would silently render as a battle rather than failing loudly.
  const emitted = (grid: TileTypeKey[][]) => new Set(grid.flat());

  it('has an entry for every S2 type', () => {
    const types = new Set<TileTypeKey>();
    for (let seed = 1; seed <= 50; seed++) {
      emitted(buildTypeGridS2(seed)).forEach(t => types.add(t));
    }
    expect(types.size).toBeGreaterThanOrEqual(6);
    for (const t of types) expect(TILE_TYPES[t], `missing TILE_TYPES.${t}`).toBeTruthy();
  });

  it('has an entry for every S1 type', () => {
    const types = new Set<TileTypeKey>();
    for (let seed = 1; seed <= 50; seed++) {
      emitted(buildTypeGridS1(seed)).forEach(t => types.add(t));
    }
    for (const t of types) expect(TILE_TYPES[t], `missing TILE_TYPES.${t}`).toBeTruthy();
  });

  it('gives the S2 types their own css class, not the battle fallback', () => {
    for (const t of ['castle', 'dungeon', 'tower'] as const) {
      expect(TILE_TYPES[t].cls).toBe(`tile-${t}`);
      expect(TILE_TYPES[t].cls).not.toBe(TILE_TYPES.battle.cls);
    }
  });

  it('gives each S2 type a distinct icon and label', () => {
    expect(TILE_TYPES.dungeon.icon).toBe('🗝️');
    expect(TILE_TYPES.tower.icon).toBe('🏯');
    expect(TILE_TYPES.castle.icon).toBe('🏰');
    expect(TILE_TYPES.dungeon.label).toBe('Dungeon');
    expect(TILE_TYPES.tower.label).toBe('Tower');
    expect(TILE_TYPES.castle.label).toBe('Castle');
  });
});
