import { describe, it, expect, afterEach } from 'vitest';
import {
  BOARD_SPECS, setActiveBoard, activeBoard,
  coordFromRC, rcFromCoord, getAdjRC, getAdjCoords,
  isEdgeTile, manhattan, inBounds, allCoords,
} from '../../src/lib/board';

// The active board is module state, so every test restores the default rather
// than leaking a 6×7 board into whatever runs next.
afterEach(() => setActiveBoard('s1'));

describe('board specs', () => {
  it('S1 is the 5×7 town-centre board', () => {
    const b = BOARD_SPECS.s1;
    expect([b.rows, b.cols]).toEqual([5, 7]);
    expect(b.startCoord).toBe('D3');
    expect(b.startType).toBe('town_center');
    expect(b.hasTowns).toBe(true);
    expect(b.hasBoss).toBe(true);
    expect(b.hasShopTiles).toBe(true);
  });

  it('S2 is the 6×7 Castle board with no towns, surface boss, or shop tiles', () => {
    const b = BOARD_SPECS.s2;
    expect([b.rows, b.cols]).toEqual([6, 7]);
    expect(b.startCoord).toBe('D6');
    expect(b.startType).toBe('castle');
    expect(b.hasTowns).toBe(false);
    expect(b.hasBoss).toBe(false);      // the Sorcerer is a Tower tile, not a surface one
    expect(b.hasShopTiles).toBe(false);
  });

  it('both boards use the same A–G columns, so coords stay comparable', () => {
    expect(BOARD_SPECS.s1.colChars).toBe(BOARD_SPECS.s2.colChars);
  });
});

describe('activeBoard', () => {
  it('defaults to S1 rather than throwing when nothing has been set', () => {
    // Load-bearing: tileGen.ts builds its type grid at MODULE SCOPE and sits in
    // the main bundle, so a throwing accessor would break app load for every
    // user — casino players included — before any season resolves.
    expect(() => activeBoard()).not.toThrow();
    expect(activeBoard().id).toBe('s1');
  });

  it('switches when set, and falls back to S1 on an unknown id', () => {
    setActiveBoard('s2');
    expect(activeBoard().id).toBe('s2');
    setActiveBoard('nonsense' as 's1');
    expect(activeBoard().id).toBe('s1');
  });
});

describe('coord round-trips', () => {
  it('maps corners on the S1 board', () => {
    expect(coordFromRC(0, 0)).toBe('A1');
    expect(coordFromRC(4, 6)).toBe('G5');
    expect(rcFromCoord('A1')).toEqual([0, 0]);
    expect(rcFromCoord('G5')).toEqual([4, 6]);
    expect(rcFromCoord('D3')).toEqual([2, 3]);   // S1 start
  });

  it('maps corners on the S2 board', () => {
    setActiveBoard('s2');
    expect(coordFromRC(0, 0)).toBe('A1');
    expect(coordFromRC(5, 6)).toBe('G6');
    expect(rcFromCoord('G6')).toEqual([5, 6]);
    expect(rcFromCoord('D6')).toEqual([5, 3]);   // S2 start (Castle)
  });

  it('round-trips every cell of both boards', () => {
    for (const id of ['s1', 's2'] as const) {
      setActiveBoard(id);
      const b = BOARD_SPECS[id];
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          expect(rcFromCoord(coordFromRC(r, c))).toEqual([r, c]);
        }
      }
    }
  });

  it('resolves the same coord string to different cells per board', () => {
    // D6 is off-board on S1 (only 5 rows) but is S2's Castle — the exact reason
    // geometry had to stop being module constants.
    setActiveBoard('s1');
    expect(inBounds(...rcFromCoord('D6'))).toBe(false);
    setActiveBoard('s2');
    expect(inBounds(...rcFromCoord('D6'))).toBe(true);
  });
});

describe('adjacency', () => {
  it('clips at S1 corners and edges', () => {
    expect(getAdjRC(0, 0)).toEqual([[1, 0], [0, 1]]);
    expect(getAdjRC(4, 6)).toEqual([[3, 6], [4, 5]]);
    expect(getAdjRC(2, 3)).toHaveLength(4);          // interior
    expect(getAdjCoords('A1').sort()).toEqual(['A2', 'B1']);
  });

  it('clips at the S2 bottom row, which does not exist on S1', () => {
    setActiveBoard('s2');
    // Row 6 (index 5) is the Castle's row and is the board's edge.
    expect(getAdjRC(5, 3)).toEqual([[4, 3], [5, 2], [5, 4]]);
    expect(getAdjCoords('D6').sort()).toEqual(['C6', 'D5', 'E6']);
  });

  it('never returns an out-of-bounds neighbour on either board', () => {
    for (const id of ['s1', 's2'] as const) {
      setActiveBoard(id);
      const b = BOARD_SPECS[id];
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          for (const [ar, ac] of getAdjRC(r, c)) {
            expect(inBounds(ar, ac)).toBe(true);
          }
        }
      }
    }
  });
});

describe('isEdgeTile', () => {
  it('treats the S1 outer ring as edge and the rest as interior', () => {
    expect(isEdgeTile(0, 3)).toBe(true);
    expect(isEdgeTile(4, 3)).toBe(true);
    expect(isEdgeTile(2, 0)).toBe(true);
    expect(isEdgeTile(2, 6)).toBe(true);
    expect(isEdgeTile(2, 3)).toBe(false);
  });

  it('shifts the bottom edge from row 5 to row 6 on the S2 board', () => {
    expect(isEdgeTile(4, 3)).toBe(true);    // S1: bottom row
    setActiveBoard('s2');
    expect(isEdgeTile(4, 3)).toBe(false);   // S2: now interior
    expect(isEdgeTile(5, 3)).toBe(true);    // S2: bottom row (the Castle's)
  });

  it('leaves exactly 20 interior cells on S2 — the elite candidate pool', () => {
    setActiveBoard('s2');
    const interior = allCoords().filter(co => !isEdgeTile(...rcFromCoord(co)));
    expect(interior).toHaveLength(20);      // rows 2–5 × cols B–F = 4 × 5
  });
});

describe('manhattan', () => {
  it('measures the S2 placement bands from the Castle at D6', () => {
    setActiveBoard('s2');
    // The Tower band is 8 — the board's maximum distance — and only the two top
    // corners satisfy it. (9 is unreachable at 6 rows; see decision 24.)
    expect(manhattan('D6', 'A1')).toBe(8);
    expect(manhattan('D6', 'G1')).toBe(8);
    expect(manhattan('D6', 'D6')).toBe(0);
  });

  it('confirms 8 is the S2 maximum and A1/G1 are the only cells at it', () => {
    setActiveBoard('s2');
    const dists = allCoords().map(co => manhattan('D6', co));
    expect(Math.max(...dists)).toBe(8);
    const atMax = allCoords().filter(co => manhattan('D6', co) === 8);
    expect(atMax.sort()).toEqual(['A1', 'G1']);
  });

  it('finds candidates for every dungeon band (3, 5, 7)', () => {
    setActiveBoard('s2');
    for (const band of [3, 5, 7]) {
      const candidates = allCoords().filter(co => manhattan('D6', co) === band);
      expect(candidates.length).toBeGreaterThan(0);
    }
  });

  it('is symmetric', () => {
    setActiveBoard('s2');
    expect(manhattan('A1', 'G6')).toBe(manhattan('G6', 'A1'));
  });
});

describe('explicit spec override', () => {
  // tileGen pins itself to BOARD_SPECS.s1 through this parameter. Without it,
  // generating the S1 map while an S2 season is active (admin previewing the
  // draft) would build a 6-row grid and index off the end of 5-row arrays.
  it('ignores the active board when a spec is passed', () => {
    setActiveBoard('s2');
    const s1 = BOARD_SPECS.s1;

    // Row 5 (index 4) is S1's LAST row but an interior row on S2.
    expect(getAdjRC(4, 3)).toEqual([[3, 3], [5, 3], [4, 2], [4, 4]]);        // active = s2
    expect(getAdjRC(4, 3, s1)).toEqual([[3, 3], [4, 2], [4, 4]]);            // pinned  = s1
    expect(isEdgeTile(4, 3)).toBe(false);
    expect(isEdgeTile(4, 3, s1)).toBe(true);
    expect(inBounds(5, 3)).toBe(true);
    expect(inBounds(5, 3, s1)).toBe(false);
    expect(allCoords(s1)).toHaveLength(35);
    expect(allCoords()).toHaveLength(42);
  });

  it('never yields an S1-out-of-range neighbour when pinned to S1', () => {
    setActiveBoard('s2');
    const s1 = BOARD_SPECS.s1;
    for (let r = 0; r < s1.rows; r++) {
      for (let c = 0; c < s1.cols; c++) {
        for (const [ar, ac] of getAdjRC(r, c, s1)) {
          expect(inBounds(ar, ac, s1)).toBe(true);
        }
      }
    }
  });

  it('resolves coords identically on both boards (same colChars)', () => {
    // coordFromRC/rcFromCoord depend only on colChars, which both boards share —
    // so only the bounds-dependent helpers actually diverge.
    expect(coordFromRC(2, 3, BOARD_SPECS.s1)).toBe(coordFromRC(2, 3, BOARD_SPECS.s2));
    expect(rcFromCoord('D3', BOARD_SPECS.s1)).toEqual(rcFromCoord('D3', BOARD_SPECS.s2));
  });
});

describe('allCoords', () => {
  it('is column-major and sized to the active board', () => {
    expect(allCoords()).toHaveLength(35);            // S1: 5 × 7
    expect(allCoords().slice(0, 5)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    setActiveBoard('s2');
    expect(allCoords()).toHaveLength(42);            // S2: 6 × 7
    expect(allCoords().slice(0, 6)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
  });

  it('recomputes per call instead of caching the board it first saw', () => {
    const s1 = allCoords();
    setActiveBoard('s2');
    expect(allCoords()).not.toEqual(s1);
  });
});
