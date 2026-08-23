import { describe, it, expect, afterEach } from 'vitest';
import {
  planS2Board, buildTypeGridS2,
  S2_CASTLE, S2_TOWER_BAND, S2_DUNGEON_BANDS, S2_SPECIAL_GAP,
  S2_ELITE_MIN_DIST, S2_ELITE_COUNT, S2_PUZZLE_COUNT,
} from '../../src/lib/tileGenS2';
import {
  BOARD_SPECS, setActiveBoard, manhattan, rcFromCoord, coordFromRC,
  getAdjRC, isEdgeTile, allCoords,
} from '../../src/lib/board';
import type { TileTypeKey } from '../../src/types';

const S2 = BOARD_SPECS.s2;
const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

// The generator is pinned to BOARD_SPECS.s2, so it must not care what is active.
// Left on 's1' deliberately for most tests — that is the hostile case.
afterEach(() => setActiveBoard('s1'));

const dist = (a: string, b: string) => manhattan(a, b, S2);
const flat = (grid: TileTypeKey[][]) => grid.flat();
const count = (grid: TileTypeKey[][], t: TileTypeKey) => flat(grid).filter(x => x === t).length;

describe('planS2Board — placement rules', () => {
  it('never fails to find a layout across 500 seeds', () => {
    // The d=7 band is tight enough that a greedy, non-backtracking pick would
    // fail on some seeds. A throw here means the backtracking regressed.
    for (const seed of SEEDS) expect(() => planS2Board(seed)).not.toThrow();
  });

  it('places the Castle at D6 and the Tower at a top corner, distance 8', () => {
    for (const seed of SEEDS) {
      const p = planS2Board(seed);
      expect(p.castle).toBe('D6');
      expect(dist(p.tower, S2_CASTLE)).toBe(S2_TOWER_BAND);
      expect(['A1', 'G1']).toContain(p.tower);
    }
  });

  it('places one Dungeon in each band, in band order', () => {
    for (const seed of SEEDS) {
      const p = planS2Board(seed);
      expect(p.dungeons).toHaveLength(3);
      S2_DUNGEON_BANDS.forEach((band, i) => {
        expect(dist(p.dungeons[i], S2_CASTLE)).toBe(band);
      });
    }
  });

  it('keeps every Tower/Dungeon pair at least 3 apart', () => {
    for (const seed of SEEDS) {
      const p = planS2Board(seed);
      const specials = [p.tower, ...p.dungeons];
      for (let i = 0; i < specials.length; i++) {
        for (let j = i + 1; j < specials.length; j++) {
          expect(dist(specials[i], specials[j])).toBeGreaterThanOrEqual(S2_SPECIAL_GAP);
        }
      }
    }
  });

  it('places 3 Elites: interior, ≥3 from the Castle, never adjacent to each other', () => {
    for (const seed of SEEDS) {
      const p = planS2Board(seed);
      expect(p.elites).toHaveLength(S2_ELITE_COUNT);

      for (const e of p.elites) {
        const [r, c] = rcFromCoord(e, S2);
        expect(isEdgeTile(r, c, S2)).toBe(false);
        expect(dist(e, S2_CASTLE)).toBeGreaterThanOrEqual(S2_ELITE_MIN_DIST);
      }

      for (let i = 0; i < p.elites.length; i++) {
        for (let j = i + 1; j < p.elites.length; j++) {
          expect(dist(p.elites[i], p.elites[j])).toBeGreaterThan(1);
        }
      }
    }
  });

  it('never double-books a cell', () => {
    for (const seed of SEEDS) {
      const p = planS2Board(seed);
      const all = [p.castle, p.tower, ...p.dungeons, ...p.elites, ...p.puzzles, ...p.battles];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toHaveLength(S2.rows * S2.cols);   // 42 — every cell accounted for
    }
  });
});

describe('buildTypeGridS2 — composition', () => {
  it('is 6 rows × 7 cols', () => {
    const grid = buildTypeGridS2(1);
    expect(grid).toHaveLength(6);
    grid.forEach(row => expect(row).toHaveLength(7));
  });

  it('holds exactly 1 castle / 1 tower / 3 dungeons / 3 elites / 12 puzzles / 22 battles', () => {
    for (const seed of SEEDS) {
      const grid = buildTypeGridS2(seed);
      expect(count(grid, 'castle')).toBe(1);
      expect(count(grid, 'tower')).toBe(1);
      expect(count(grid, 'dungeon')).toBe(3);
      expect(count(grid, 'elite')).toBe(S2_ELITE_COUNT);
      expect(count(grid, 'puzzle')).toBe(S2_PUZZLE_COUNT);
      expect(count(grid, 'battle')).toBe(22);
      expect(flat(grid)).toHaveLength(42);
    }
  });

  it('carries no S1-only tile types', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const types = new Set(flat(buildTypeGridS2(seed)));
      for (const gone of ['town', 'town_center', 'boss'] as TileTypeKey[]) {
        expect(types.has(gone)).toBe(false);
      }
    }
  });

  it('puts the Castle at D6 in the grid itself', () => {
    const [r, c] = rcFromCoord('D6', S2);
    expect(buildTypeGridS2(7)[r][c]).toBe('castle');
  });
});

describe('reachability', () => {
  // Dungeons and the Tower cascade like S1 towns — revealing one reveals its
  // neighbours without it ever completing (decision 6) — so NO surface type
  // blocks the cascade and the board is trivially connected. These tests pin
  // that property rather than re-BFSing an unchanging grid 500 times: if a
  // blocking type is ever introduced, the second test is what fails.
  const reachableFrom = (start: string, blocks: (t: TileTypeKey) => boolean, grid: TileTypeKey[][]) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const co = queue.shift()!;
      const [r, c] = rcFromCoord(co, S2);
      for (const [ar, ac] of getAdjRC(r, c, S2)) {
        const next = coordFromRC(ar, ac, S2);
        if (seen.has(next) || blocks(grid[ar][ac])) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };

  it('reaches all 42 cells from the Castle when nothing blocks', () => {
    const grid = buildTypeGridS2(11);
    expect(reachableFrom(S2_CASTLE, () => false, grid).size).toBe(S2.rows * S2.cols);
  });

  it('would strand cells if dungeon/tower ever became blocking — which is why they are not', () => {
    // Demonstrates the property is load-bearing, not incidental: treat the
    // specials as walls and at least one seed loses cells (a dungeon sitting in
    // a corridor). Pass-through is what keeps the board whole.
    const strandedSeeds = SEEDS.slice(0, 100).filter(seed => {
      const grid = buildTypeGridS2(seed);
      const blocked = reachableFrom(S2_CASTLE, t => t === 'dungeon' || t === 'tower', grid);
      return blocked.size < S2.rows * S2.cols;
    });
    expect(strandedSeeds.length).toBeGreaterThan(0);
  });
});

describe('determinism and board pinning', () => {
  it('is deterministic for a given seed', () => {
    expect(planS2Board(42)).toEqual(planS2Board(42));
    expect(buildTypeGridS2(42)).toEqual(buildTypeGridS2(42));
  });

  it('varies across seeds', () => {
    const layouts = new Set(SEEDS.slice(0, 50).map(s => JSON.stringify(planS2Board(s))));
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('produces the same 6×7 layout no matter which board is active', () => {
    // The hostile case: an admin previewing the S2 draft while S1 is active, or
    // vice versa. Reading the active board here would emit a 5-row grid.
    setActiveBoard('s1');
    const underS1 = buildTypeGridS2(99);
    setActiveBoard('s2');
    const underS2 = buildTypeGridS2(99);
    expect(underS1).toEqual(underS2);
    expect(underS1).toHaveLength(6);
  });
});

describe('board arithmetic the placement rules depend on', () => {
  it('confirms every band has candidates and d=7 is the tight one', () => {
    const byBand = (b: number) =>
      allCoords(S2).filter(co => co !== S2_CASTLE && dist(co, S2_CASTLE) === b);
    expect(byBand(3)).toHaveLength(7);
    expect(byBand(5)).toHaveLength(7);
    expect(byBand(7)).toHaveLength(4);   // ← the constrained one
    expect(byBand(S2_TOWER_BAND).sort()).toEqual(['A1', 'G1']);
  });

  it('shows why d=7 needs backtracking: a Tower at A1 rules out half that band', () => {
    const band7 = allCoords(S2).filter(co => dist(co, S2_CASTLE) === 7);
    const viable = band7.filter(co => dist(co, 'A1') >= S2_SPECIAL_GAP);
    expect(band7).toHaveLength(4);
    expect(viable).toHaveLength(2);      // A2 and B1 are both within the gap
  });
});
