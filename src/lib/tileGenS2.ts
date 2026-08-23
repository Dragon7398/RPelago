import type { TileTypeKey } from '../types';
import {
  BOARD_SPECS, allCoords, manhattan, rcFromCoord, coordFromRC, getAdjRC, isEdgeTile,
} from './board';
import { seededShuffle } from './seededRng';

// ── S2 map generation ─────────────────────────────────────────────────────────
// Rule-driven placement on the 6×7 board, seeded so a given seed always yields
// the same map. See docs/season-2-map-plan.md §1.3.
//
// PINNED to BOARD_SPECS.s2 — every geometry call passes the spec explicitly, so
// this produces a 6×7 layout regardless of which season happens to be active.
// (tileGen.ts pins itself to s1 the same way, which is why the two generators
// live in separate modules: sharing one file would put two different ROWS/COLS
// in scope.)

const S2 = BOARD_SPECS.s2;

/** The Castle — bottom-middle, auto-complete, origin of every distance band. */
export const S2_CASTLE = S2.startCoord;   // 'D6'

/**
 * Manhattan distance from the Castle for the Tower. 8 is the BOARD MAXIMUM on
 * 6 rows, and only the two top corners (A1, G1) satisfy it — which is what
 * makes "a seeded pick of two top corners" work. The design bundle said 9; that
 * is unreachable here (see plan decision 24).
 */
export const S2_TOWER_BAND = 8;

/** One Dungeon at each of these distances from the Castle. */
export const S2_DUNGEON_BANDS = [3, 5, 7] as const;

/** Minimum Manhattan gap between any two of {Tower, Dungeon}. */
export const S2_SPECIAL_GAP = 3;

/** Elites must sit at least this far from the Castle (and off the edge). */
export const S2_ELITE_MIN_DIST = 3;

export const S2_ELITE_COUNT  = 3;
/** Puzzles are a FIXED count, not a ratio — battles are the remainder. */
export const S2_PUZZLE_COUNT = 12;

// Distinct salts keep each decision's shuffle independent of the others.
const SALT_TOWER   = 0x70117;
const SALT_DUNGEON = 0xD00;
const SALT_ELITE   = 0xE117E;
const SALT_PUZZLE  = 0x9022E;

// ── Pinned geometry shorthands ────────────────────────────────────────────────
const cells = ()                       => allCoords(S2);
const dist  = (a: string, b: string)   => manhattan(a, b, S2);
const rc    = (co: string)             => rcFromCoord(co, S2);
const isEdgeCoord = (co: string)       => isEdgeTile(...rc(co), S2);
const adjCoords   = (co: string)       =>
  getAdjRC(...rc(co), S2).map(([r, c]) => coordFromRC(r, c, S2));

export interface S2Placement {
  castle:   string;
  tower:    string;
  /** In band order — [dist 3, dist 5, dist 7]. Orb config indexes off this. */
  dungeons: string[];
  elites:   string[];
  puzzles:  string[];
  battles:  string[];
}

/** Cells at exactly `band` distance from the Castle. */
function bandCells(band: number): string[] {
  return cells().filter(co => co !== S2_CASTLE && dist(co, S2_CASTLE) === band);
}

/** True when `co` is ≥ S2_SPECIAL_GAP from every already-placed special. */
function farEnough(co: string, others: string[]): boolean {
  return others.every(o => dist(co, o) >= S2_SPECIAL_GAP);
}

/**
 * One Dungeon per band, honouring the gap against the Tower and each other.
 * Backtracks: the d=7 band is tight (with the Tower at A1, both A2 and B1 are
 * inside the gap), so a greedy first-fit would fail on some seeds.
 */
function pickDungeons(tower: string, seed: number): string[] | null {
  const chosen: string[] = [];

  const recurse = (i: number): boolean => {
    if (i === S2_DUNGEON_BANDS.length) return true;
    const band = S2_DUNGEON_BANDS[i];
    for (const co of seededShuffle(bandCells(band), seed ^ (SALT_DUNGEON + band))) {
      if (co === tower) continue;
      if (!farEnough(co, [tower, ...chosen])) continue;
      chosen.push(co);
      if (recurse(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };

  return recurse(0) ? chosen : null;
}

/** Interior, ≥3 from the Castle, unoccupied — the pool elites are drawn from. */
function eliteCandidates(occupied: string[]): string[] {
  return cells().filter(co =>
    co !== S2_CASTLE &&
    !occupied.includes(co) &&
    !isEdgeCoord(co) &&
    dist(co, S2_CASTLE) >= S2_ELITE_MIN_DIST,
  );
}

/** Three elites, none orthogonally adjacent to another elite. */
function pickElites(occupied: string[], seed: number): string[] | null {
  const pool = seededShuffle(eliteCandidates(occupied), seed ^ SALT_ELITE);
  const chosen: string[] = [];

  const recurse = (start: number): boolean => {
    if (chosen.length === S2_ELITE_COUNT) return true;
    for (let i = start; i < pool.length; i++) {
      const co = pool[i];
      const neighbours = adjCoords(co);
      if (chosen.some(e => neighbours.includes(e))) continue;
      chosen.push(co);
      if (recurse(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };

  return recurse(0) ? chosen : null;
}

/**
 * Resolve the whole S2 layout for a seed. Exported separately from the type grid
 * because callers need the placements themselves — orb assignment keys off
 * dungeon order, and the dungeon interiors key off their surface coord.
 */
export function planS2Board(seed: number): S2Placement {
  for (const tower of seededShuffle(bandCells(S2_TOWER_BAND), seed ^ SALT_TOWER)) {
    const dungeons = pickDungeons(tower, seed);
    if (!dungeons) continue;

    const elites = pickElites([tower, ...dungeons], seed);
    if (!elites) continue;

    const taken   = new Set([S2_CASTLE, tower, ...dungeons, ...elites]);
    const fillers = seededShuffle(cells().filter(co => !taken.has(co)), seed ^ SALT_PUZZLE);

    return {
      castle:   S2_CASTLE,
      tower,
      dungeons,
      elites,
      puzzles:  fillers.slice(0, S2_PUZZLE_COUNT),
      battles:  fillers.slice(S2_PUZZLE_COUNT),
    };
  }

  // Unreachable for any seed: the bands are provably satisfiable on this board
  // (both Tower corners admit a full dungeon set, and the elite pool is never
  // exhausted). Throwing beats returning a half-built board silently.
  throw new Error(`tileGenS2: no valid layout for seed ${seed}`);
}

/** The S2 type grid, indexed [row][col] like the S1 generator's. */
export function buildTypeGridS2(seed: number): TileTypeKey[][] {
  const grid: TileTypeKey[][] = Array.from(
    { length: S2.rows }, () => Array(S2.cols).fill('battle' as TileTypeKey),
  );

  const put = (co: string, type: TileTypeKey) => {
    const [r, c] = rc(co);
    grid[r][c] = type;
  };

  const plan = planS2Board(seed);
  put(plan.castle, 'castle');
  put(plan.tower,  'tower');
  plan.dungeons.forEach(co => put(co, 'dungeon'));
  plan.elites.forEach(co   => put(co, 'elite'));
  plan.puzzles.forEach(co  => put(co, 'puzzle'));
  // battles are the fill value

  return grid;
}
