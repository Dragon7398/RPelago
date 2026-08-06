import type { TileTypeKey } from '../types';

// ── Per-season board geometry ─────────────────────────────────────────────────
// S1 is a 5×7 board with a town centre at D3; S2 is 6×7 with the Castle at D6.
// Archived seasons keep rendering their own shape, so geometry cannot be a set
// of module constants any more — it is resolved per season, like the RTDB path
// helpers in src/firebase/season.ts.
//
// This module deliberately has NO runtime imports: it is the bottom of the
// import graph, so anything may depend on it.

export type BoardId = 's1' | 's2';

export interface BoardSpec {
  id:         BoardId;
  rows:       number;
  cols:       number;
  colChars:   string;
  /** The auto-revealed start tile: S1's town centre, S2's Castle. */
  startCoord: string;
  startType:  TileTypeKey;
  /** S1 scatters `town` tiles; S2 has none (its facilities are the district ward). */
  hasTowns:   boolean;
  /**
   * Whether a boss tile sits on the SURFACE grid. S1 puts one in a seeded
   * corner; S2's boss is the Sorcerer on Tower Floor 3, which is not a surface
   * tile — so this is false for S2 even though the season has a boss.
   */
  hasBoss:    boolean;
  /** S1 hangs shops off town tiles; S2 collapses them into one global shop. */
  hasShopTiles: boolean;
}

export const BOARD_SPECS: Readonly<Record<BoardId, BoardSpec>> = {
  s1: {
    id: 's1',
    rows: 5, cols: 7, colChars: 'ABCDEFG',
    startCoord: 'D3', startType: 'town_center',
    hasTowns: true, hasBoss: true, hasShopTiles: true,
  },
  s2: {
    id: 's2',
    rows: 6, cols: 7, colChars: 'ABCDEFG',
    startCoord: 'D6', startType: 'castle',
    hasTowns: false, hasBoss: false, hasShopTiles: false,
  },
};

// ── Active board (module state) ───────────────────────────────────────────────
// Mirrors setCurrentSeason in src/firebase/season.ts so callers don't thread a
// spec through every signature.
//
// UNLIKE the season path helpers, this NEVER throws when unset. sPath throws
// because guessing a season would write to the wrong data; a board is only a
// rendering concern, and geometry is evaluated at MODULE SCOPE in places that
// sit in the main bundle (tileGen.ts eagerly builds its type grid at import).
// A throwing accessor would break app load for every user before any season
// resolves — including casino-season players who never render a map at all.
let _active: BoardSpec = BOARD_SPECS.s1;

export function setActiveBoard(id: BoardId): void {
  _active = BOARD_SPECS[id] ?? BOARD_SPECS.s1;
}

export function activeBoard(): BoardSpec {
  return _active;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
// All read the active board at CALL time. Never cache their results at module
// scope — the board changes when the season resolves.

/** (0,0) → "A1". Row index is 0-based; the coord's row number is 1-based. */
export function coordFromRC(r: number, c: number): string {
  return `${activeBoard().colChars[c]}${r + 1}`;
}

/** "D3" → [2, 3]. Returns [-1, -1]-ish values for coords outside this board. */
export function rcFromCoord(coord: string): [number, number] {
  const c = activeBoard().colChars.indexOf(coord[0]);
  const r = parseInt(coord.slice(1), 10) - 1;
  return [r, c];
}

export function inBounds(r: number, c: number): boolean {
  const b = activeBoard();
  return r >= 0 && r < b.rows && c >= 0 && c < b.cols;
}

/** Orthogonal neighbours, clipped to the board. */
export function getAdjRC(r: number, c: number): [number, number][] {
  const b = activeBoard();
  const out: [number, number][] = [];
  if (r > 0)          out.push([r - 1, c]);
  if (r < b.rows - 1) out.push([r + 1, c]);
  if (c > 0)          out.push([r, c - 1]);
  if (c < b.cols - 1) out.push([r, c + 1]);
  return out;
}

export function getAdjCoords(coord: string): string[] {
  const [r, c] = rcFromCoord(coord);
  return getAdjRC(r, c).map(([ar, ac]) => coordFromRC(ar, ac));
}

export function isEdgeTile(r: number, c: number): boolean {
  const b = activeBoard();
  return r === 0 || r === b.rows - 1 || c === 0 || c === b.cols - 1;
}

/** Manhattan distance between two coords — the S2 placement bands are built on this. */
export function manhattan(a: string, b: string): number {
  const [ar, ac] = rcFromCoord(a);
  const [br, bc] = rcFromCoord(b);
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

/**
 * Every coord on the active board, in column-major order (A1–A5, B1–B5, …).
 * A FUNCTION, not a constant: callers that need this at module scope would
 * otherwise freeze S1's geometry into the bundle at import time.
 */
export function allCoords(): string[] {
  const b = activeBoard();
  const out: string[] = [];
  for (let c = 0; c < b.cols; c++) {
    for (let r = 0; r < b.rows; r++) {
      out.push(coordFromRC(r, c));
    }
  }
  return out;
}
