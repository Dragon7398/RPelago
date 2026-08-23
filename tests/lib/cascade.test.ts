import { describe, it, expect, afterEach } from 'vitest';
import { computeRecalcUpdates } from '../../src/lib/gameLogic';
import { buildDefaultTileData, isPassThroughType } from '../../src/lib/tileGen';
import { buildTypeGridS2, S2_CASTLE } from '../../src/lib/tileGenS2';
import { BOARD_SPECS, setActiveBoard, coordFromRC, rcFromCoord, getAdjRC } from '../../src/lib/board';
import type { Tile, TileState, TileTypeKey } from '../../src/types';

const S2 = BOARD_SPECS.s2;
afterEach(() => setActiveBoard('s1'));

const tile = (state: TileState): Tile => ({
  state, required: 3, adventurers: {}, name: '',
  release: 'on', collect: 'off', hint: 10, details: '', link: '',
  gold: 0, xp: 0, bonusXP: 0, diffBonus: 100,
  baseRelease: 'on', baseCollect: 'off', baseHint: 10, adminOverride: false,
});

describe('isPassThroughType', () => {
  it('covers dungeon and tower only', () => {
    const yes: TileTypeKey[] = ['dungeon', 'tower'];
    const no:  TileTypeKey[] = ['battle', 'puzzle', 'elite', 'castle', 'town', 'town_center', 'boss'];
    yes.forEach(t => expect(isPassThroughType(t)).toBe(true));
    no.forEach(t  => expect(isPassThroughType(t)).toBe(false));
  });
});

describe('computeRecalcUpdates — pass-through', () => {
  // A 1-D corridor: A1 complete, B1 the tile under test, C1/D1 behind it.
  const corridor = (): Record<string, Tile> => ({
    A1: tile('complete'), B1: tile('hidden'), C1: tile('hidden'), D1: tile('hidden'),
  });

  it('stops at a normal tile — the classic S1 behaviour', () => {
    const updates = computeRecalcUpdates(corridor(), 'A1', 'complete', () => false);
    expect(updates.B1).toBe('available');
    expect(updates.C1).toBeUndefined();   // still hidden behind B1
  });

  it('reveals THROUGH a pass-through tile without completing it', () => {
    const updates = computeRecalcUpdates(corridor(), 'A1', 'complete', c => c === 'B1');
    expect(updates.B1).toBe('available');
    expect(updates.C1).toBe('available'); // revealed by the pass-through B1
    expect(updates.B1).not.toBe('complete');
  });

  it('chains across adjacent pass-through tiles and terminates', () => {
    const updates = computeRecalcUpdates(corridor(), 'A1', 'complete', c => c === 'B1' || c === 'C1');
    expect(updates.B1).toBe('available');
    expect(updates.C1).toBe('available');
    expect(updates.D1).toBe('available'); // reached via the B1→C1 chain
  });

  it('does not reveal from a HIDDEN pass-through tile', () => {
    const tiles: Record<string, Tile> = {
      A1: tile('hidden'), B1: tile('hidden'), C1: tile('hidden'),
    };
    const updates = computeRecalcUpdates(tiles, 'A1', 'hidden', c => c === 'B1');
    expect(updates.C1).toBeUndefined();
  });

  it('leaves S1 boards untouched — nothing is pass-through there', () => {
    setActiveBoard('s1');
    const tiles = buildDefaultTileData(1234);
    const withInjection = computeRecalcUpdates(tiles, 'D3', 'complete');
    const withoutAny    = computeRecalcUpdates(tiles, 'D3', 'complete', () => false);
    expect(withInjection).toEqual(withoutAny);
  });
});

describe('buildDefaultTileData on the S2 board', () => {
  it('completes the Castle and reveals outward from it', () => {
    setActiveBoard('s2');
    const tiles = buildDefaultTileData(7);

    expect(tiles[S2_CASTLE].state).toBe('complete');
    expect(tiles[S2_CASTLE].name).toBe('The Castle');
    expect(tiles[S2_CASTLE].typeKey).toBe('castle');
    expect(tiles[S2_CASTLE].required).toBe(0);

    const [cr, cc] = rcFromCoord(S2_CASTLE, S2);
    for (const [ar, ac] of getAdjRC(cr, cc, S2)) {
      expect(tiles[coordFromRC(ar, ac, S2)].state).not.toBe('hidden');
    }
  });

  it('persists typeKey on every tile', () => {
    setActiveBoard('s2');
    const tiles = buildDefaultTileData(7);
    expect(Object.keys(tiles)).toHaveLength(42);
    for (const t of Object.values(tiles)) expect(t.typeKey).toBeTruthy();
  });

  it('gives dungeon and tower tiles no challenge stats', () => {
    setActiveBoard('s2');
    for (const seed of [1, 2, 3, 17, 99]) {
      const tiles = buildDefaultTileData(seed);
      for (const t of Object.values(tiles)) {
        if (t.typeKey === 'dungeon' || t.typeKey === 'tower') {
          expect(t.required).toBe(0);
          expect(t.xp).toBe(0);
          expect(t.gold).toBe(0);
        }
      }
    }
  });

  it('reveals a dungeon adjacent to the Castle AND the cells behind it', () => {
    setActiveBoard('s2');
    // Find a seed whose d=3 dungeon touches the Castle, then assert the
    // pass-through actually fired at generation time.
    for (let seed = 1; seed <= 200; seed++) {
      const grid  = buildTypeGridS2(seed);
      const tiles = buildDefaultTileData(seed);
      const [cr, cc] = rcFromCoord(S2_CASTLE, S2);
      const touching = getAdjRC(cr, cc, S2)
        .filter(([r, c]) => isPassThroughType(grid[r][c]));
      if (!touching.length) continue;

      for (const [dr, dc] of touching) {
        expect(tiles[coordFromRC(dr, dc, S2)].state).toBe('available');
        for (const [nr, nc] of getAdjRC(dr, dc, S2)) {
          expect(tiles[coordFromRC(nr, nc, S2)].state).not.toBe('hidden');
        }
      }
      return;   // one qualifying seed is enough
    }
  });

  it('still builds the 5×7 S1 board when S1 is active', () => {
    setActiveBoard('s1');
    const tiles = buildDefaultTileData(7);
    expect(Object.keys(tiles)).toHaveLength(35);
    expect(tiles['D3'].state).toBe('complete');
    expect(tiles['D3'].name).toBe('The Crossroads');
  });
});
