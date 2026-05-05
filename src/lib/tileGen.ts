import type { Tile, TileTypeKey, TriState, OrbConfig } from '../types';
import {
  COLS, ROWS, ADV_CLASSES, ADV_NAMES_FIRST, ADV_NAMES_LAST,
  ALL_ORBS, coordFromRC, getAdjRC, isEdgeTile, TOWN_SHOP_ITEMS, NON_CENTER_SHOP_IDS,
} from './constants';

// ── Seeded shuffle (LCG) ──────────────────────────────────────────────────────
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Boss corner placement ─────────────────────────────────────────────────────
const CORNER_POSITIONS: [number, number][] = [
  [0,        0       ], // A1
  [0,        COLS - 1], // G1
  [ROWS - 1, 0       ], // A5
  [ROWS - 1, COLS - 1], // G5
];

export function getBossPosition(seed: number): [number, number] {
  return seededShuffle([...CORNER_POSITIONS], seed ^ 0xDEADBEEF)[0];
}

// Region of tiles adjacent to the boss corner that must not contain hidden orbs.
// Extends 3 rows and 2 columns inward from the corner (per design spec example).
function isInBossCornerRegion(r: number, c: number, bossR: number, bossC: number): boolean {
  const rMin = bossR === 0 ? 0 : ROWS - 3;
  const rMax = bossR === 0 ? 2 : ROWS - 1;
  const cMin = bossC === 0 ? 0 : COLS - 2;
  const cMax = bossC === 0 ? 1 : COLS - 1;
  return r >= rMin && r <= rMax && c >= cMin && c <= cMax;
}

// ── Type grid ─────────────────────────────────────────────────────────────────
function buildTypeGrid(seed: number): TileTypeKey[][] {
  const [bossR, bossC] = getBossPosition(seed);

  const grid: TileTypeKey[][] = Array.from({ length: ROWS }, () =>
    Array(COLS).fill('battle' as TileTypeKey),
  );

  grid[2][3]      = 'town_center';
  grid[bossR][bossC] = 'boss';

  const fixedSet = new Set([2 * COLS + 3, bossR * COLS + bossC]);
  const freePositions: [number, number][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!fixedSet.has(r * COLS + c)) freePositions.push([r, c]);

  const shuffled = seededShuffle(freePositions, seed);

  // 9 puzzles
  for (let i = 0; i < 9; i++) {
    const [r, c] = shuffled[i];
    grid[r][c] = 'puzzle';
  }

  // 3 towns — not adjacent to other towns or town_center
  const townCandidates = seededShuffle(shuffled.slice(9), seed ^ 0x9E3779B9);
  let townPlaced = 0;
  for (let i = 0; i < townCandidates.length && townPlaced < 3; i++) {
    const [r, c] = townCandidates[i];
    const adjTypes = getAdjRC(r, c).map(([ar, ac]) => grid[ar][ac]);
    if (!adjTypes.some(t => t === 'town' || t === 'town_center')) {
      grid[r][c] = 'town';
      townPlaced++;
    }
  }

  // 5 elites — not adjacent to other elites or the boss
  const eliteCandidates = seededShuffle(
    shuffled.filter(([r, c]) => grid[r][c] === 'battle'),
    seed ^ 0x6C62272E,
  );
  let elitePlaced = 0;
  for (let i = 0; i < eliteCandidates.length && elitePlaced < 5; i++) {
    const [r, c] = eliteCandidates[i];
    const adj = getAdjRC(r, c);
    const nearBoss  = adj.some(([ar, ac]) => ar === bossR && ac === bossC);
    const nearElite = adj.some(([ar, ac]) => grid[ar][ac] === 'elite');
    if (!nearBoss && !nearElite) {
      grid[r][c] = 'elite';
      elitePlaced++;
    }
  }

  return grid;
}

// ── Orb positions ─────────────────────────────────────────────────────────────
interface OrbPositions {
  elitePositions: [number, number][];
  shopTownPositions: [number, number][];
  edgeBattlePos: [number, number] | null;
  edgePuzzlePos: [number, number] | null;
}

function buildOrbPositions(
  typeGrid: TileTypeKey[][],
  bossR: number,
  bossC: number,
  seed: number,
): OrbPositions {
  const elitePositions: [number, number][]    = [];
  const shopTownPositions: [number, number][] = [];
  let edgeBattlePos: [number, number] | null  = null;
  let edgePuzzlePos: [number, number] | null  = null;

  // Use the same shuffle order as buildTypeGrid for consistent edge tile selection
  const fixedSet = new Set([2 * COLS + 3, bossR * COLS + bossC]);
  const freePositions: [number, number][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!fixedSet.has(r * COLS + c)) freePositions.push([r, c]);
  const shuffled = seededShuffle(freePositions, seed);

  // Center town is always index 0; other towns follow in row-major order
  shopTownPositions.push([2, 3]);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = typeGrid[r][c];
      if (t === 'elite') elitePositions.push([r, c]);
      if (t === 'town')  shopTownPositions.push([r, c]);
    }
  }

  // Edge orbs: first edge battle and puzzle NOT in the boss corner region
  for (const [r, c] of shuffled) {
    if (!edgeBattlePos && isEdgeTile(r, c) && typeGrid[r][c] === 'battle'
        && !isInBossCornerRegion(r, c, bossR, bossC))
      edgeBattlePos = [r, c];
    if (!edgePuzzlePos && isEdgeTile(r, c) && typeGrid[r][c] === 'puzzle'
        && !isInBossCornerRegion(r, c, bossR, bossC))
      edgePuzzlePos = [r, c];
    if (edgeBattlePos && edgePuzzlePos) break;
  }

  return { elitePositions, shopTownPositions, edgeBattlePos, edgePuzzlePos };
}

// ── Runtime grid state (re-initialized from Firebase seed on each load/reset) ──
const DEFAULT_SEED = 42;

let _typeGrid     = buildTypeGrid(DEFAULT_SEED);
let _bossPos      = getBossPosition(DEFAULT_SEED);
let _orbPositions = buildOrbPositions(_typeGrid, _bossPos[0], _bossPos[1], DEFAULT_SEED);

export function initializeGrid(seed: number): void {
  _typeGrid     = buildTypeGrid(seed);
  _bossPos      = getBossPosition(seed);
  _orbPositions = buildOrbPositions(_typeGrid, _bossPos[0], _bossPos[1], seed);
}

export function getTypeKey(r: number, c: number): TileTypeKey {
  return _typeGrid[r][c];
}

// ── Orb lookup helpers ────────────────────────────────────────────────────────
export function orbIdForElite(r: number, c: number, orbConfig: OrbConfig): string | null {
  const idx = _orbPositions.elitePositions.findIndex(([er, ec]) => er === r && ec === c);
  if (idx < 0) return null;
  const orbIdx = orbConfig.eliteDrops[idx];
  return orbIdx != null ? (ALL_ORBS[orbIdx]?.id ?? null) : null;
}

export function orbIdForTown(r: number, c: number, orbConfig: OrbConfig): string | null {
  const idx = _orbPositions.shopTownPositions.findIndex(([tr, tc]) => tr === r && tc === c);
  if (idx <= 0) return null;  // idx=0 is center (no orb), idx<0 not found
  const orbIdx = orbConfig.shopOrbs[idx - 1];
  return orbIdx != null ? (ALL_ORBS[orbIdx]?.id ?? null) : null;
}

export function orbIdForEdgeTile(r: number, c: number, orbConfig: OrbConfig): string | null {
  const { edgeBattlePos, edgePuzzlePos } = _orbPositions;
  if (edgeBattlePos && edgeBattlePos[0] === r && edgeBattlePos[1] === c)
    return ALL_ORBS[orbConfig.battleOrb]?.id ?? null;
  if (edgePuzzlePos && edgePuzzlePos[0] === r && edgePuzzlePos[1] === c)
    return ALL_ORBS[orbConfig.puzzleOrb]?.id ?? null;
  return null;
}

// Returns item IDs sold at the given town tile
export function shopItemIdsForTown(r: number, c: number): readonly string[] {
  const idx = _orbPositions.shopTownPositions.findIndex(([tr, tc]) => tr === r && tc === c);
  if (idx < 0) return [];
  return TOWN_SHOP_ITEMS[idx] ?? [];
}

// ── Seeded per-tile RNG ───────────────────────────────────────────────────────
function tileRng(seed: number, r: number, c: number, offset: number): number {
  let s = (seed ^ (r * 1000 + c * 100 + offset + 12345)) | 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  s = s ^ (s >>> 16);
  return (s >>> 0) / 0xffffffff;
}

function randInt(seed: number, r: number, c: number, offset: number, min: number, max: number): number {
  return min + Math.floor(tileRng(seed, r, c, offset) * (max - min + 1));
}

function weightedPick<T>(
  seed: number, r: number, c: number, offset: number,
  options: { value: T; weight: number }[],
): T {
  const roll = tileRng(seed, r, c, offset) * 100;
  let acc = 0;
  for (const opt of options) {
    acc += opt.weight;
    if (roll < acc) return opt.value;
  }
  return options[options.length - 1].value;
}

// ── Tile stat generation ──────────────────────────────────────────────────────
const BATTLE_RC = [
  { weight: 20, value: { release: 'on'  as TriState, collect: 'on'  as TriState } },
  { weight: 50, value: { release: 'on'  as TriState, collect: 'off' as TriState } },
  { weight: 30, value: { release: 'off' as TriState, collect: 'off' as TriState } },
];
const PUZZLE_RC = [
  { weight: 10, value: { release: 'on'      as TriState, collect: 'on'      as TriState } },
  { weight: 25, value: { release: 'on'      as TriState, collect: 'off'     as TriState } },
  { weight: 30, value: { release: 'special' as TriState, collect: 'off'     as TriState } },
  { weight: 20, value: { release: 'special' as TriState, collect: 'special' as TriState } },
  { weight: 15, value: { release: 'off'     as TriState, collect: 'off'     as TriState } },
];
const ELITE_RC = [
  { weight: 15, value: { release: 'on'      as TriState, collect: 'on'  as TriState } },
  { weight: 30, value: { release: 'on'      as TriState, collect: 'off' as TriState } },
  { weight: 25, value: { release: 'special' as TriState, collect: 'off' as TriState } },
  { weight: 30, value: { release: 'off'     as TriState, collect: 'off' as TriState } },
];

function calcDifficultyBonus(release: TriState, collect: TriState): number {
  let bonus = 100;
  for (const v of [release, collect]) {
    if (v === 'special') bonus += 15;
    else if (v === 'off') bonus += 25;
  }
  return bonus;
}

function calcXP(
  typeKey: string, required: number, hint: number,
  release: TriState, collect: TriState, bonusXP: number,
): number {
  const BASE: Record<string, number> = { battle: 30, puzzle: 40, elite: 50, boss: 60 };
  const base = BASE[typeKey] ?? 25;
  const diff = calcDifficultyBonus(release, collect);
  const raw = base + bonusXP + 5 * required + hint;
  return Math.max(1, Math.round(raw * diff / 100));
}

function calcGold(seed: number, r: number, c: number, xp: number): number {
  const pct = 100 + Math.floor(tileRng(seed, r, c, 77) * 101);
  return Math.round(xp * pct / 100);
}

function generateTileStats(seed: number, r: number, c: number, typeKey: TileTypeKey): Partial<Tile> {
  if (typeKey === 'town' || typeKey === 'town_center') return {};

  if (typeKey === 'boss') {
    const required = 20;
    const release: TriState = 'special';
    const collect: TriState = 'special';
    const hint    = 40;
    const bonusXP = randInt(seed, r, c, 55, 0, 20);
    const diffBonus = calcDifficultyBonus(release, collect);
    const xp   = calcXP('boss', required, hint, release, collect, bonusXP);
    const gold = calcGold(seed, r, c, xp);
    return { required, release, collect, hint, bonusXP, diffBonus, xp, gold,
             baseRelease: release, baseCollect: collect, baseHint: hint };
  }

  const rcOptions   = typeKey === 'battle' ? BATTLE_RC : typeKey === 'puzzle' ? PUZZLE_RC : ELITE_RC;
  const [hintMin, hintMax] = typeKey === 'elite' ? [10, 20] : [6, 15];
  const requiredMin = typeKey === 'elite' ? 6 : 4;
  const requiredMax = typeKey === 'elite' ? 12 : 8;

  const required  = randInt(seed, r, c, 1, requiredMin, requiredMax);
  const rc        = weightedPick(seed, r, c, 2, rcOptions);
  const hint      = randInt(seed, r, c, 3, hintMin, hintMax);
  const bonusXP   = randInt(seed, r, c, 4, 0, 20);
  const diffBonus = calcDifficultyBonus(rc.release, rc.collect);
  const xp   = calcXP(typeKey, required, hint, rc.release, rc.collect, bonusXP);
  const gold = calcGold(seed, r, c, xp);

  return {
    required,
    release:  rc.release,
    collect:  rc.collect,
    hint, bonusXP, diffBonus, xp, gold,
    baseRelease: rc.release,
    baseCollect: rc.collect,
    baseHint: hint,
  };
}

// ── Boss live stats (orb-reactive) ───────────────────────────────────────────
export function getBossLiveStats(
  tile: Tile,
  orbState: Record<string, unknown>,
): { release: TriState; collect: TriState; hint: number } {
  const release: TriState = orbState['wood'] ? 'on' : (tile.baseRelease ?? 'special');
  const collect: TriState = orbState['soul'] ? 'on' : (tile.baseCollect ?? 'special');
  const hint = (tile.baseHint ?? 40)
    - (orbState['light'] ? 10 : 0)
    - (orbState['dark']  ? 10 : 0);
  return { release, collect, hint };
}

// ── Shop assignment (coord → shopId, stable per seed) ────────────────────────
// Seed constant keeps shop shuffle independent from other seeded shuffles.
const SHOP_SHUFFLE_SEED = 0xC0FFEE;

export function computeTownShopIds(seed: number): Record<string, string> {
  const typeGrid  = buildTypeGrid(seed);
  const [bossR, bossC] = getBossPosition(seed);
  const orbPos    = buildOrbPositions(typeGrid, bossR, bossC, seed);
  const shuffled  = seededShuffle([...NON_CENTER_SHOP_IDS], seed ^ SHOP_SHUFFLE_SEED);

  const result: Record<string, string> = { D3: 'centralia' };
  for (let i = 1; i < orbPos.shopTownPositions.length; i++) {
    const [r, c] = orbPos.shopTownPositions[i];
    result[coordFromRC(r, c)] = shuffled[i - 1] ?? 'frostshear';
  }
  return result;
}

// ── Default tile data (self-contained, uses its own fresh grid for the seed) ──
function makeBlankTile(overrides: Partial<Tile> = {}): Tile {
  return {
    state: 'hidden',
    required: 3,
    adventurers: {},
    name: '',
    release: 'on', collect: 'off', hint: 10,
    details: '', link: '',
    gold: 0, xp: 0, bonusXP: 0, diffBonus: 100,
    baseRelease: 'on', baseCollect: 'off', baseHint: 10,
    adminOverride: false,
    ...overrides,
  };
}

export function buildDefaultTileData(seed: number): Record<string, Tile> {
  const typeGrid   = buildTypeGrid(seed);
  const shopIds    = computeTownShopIds(seed);
  const tiles: Record<string, Tile> = {};

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const coord   = coordFromRC(r, c);
      const typeKey = typeGrid[r][c];
      const stats   = generateTileStats(seed, r, c, typeKey);
      const shopId  = shopIds[coord];
      tiles[coord]  = makeBlankTile({ ...stats, ...(shopId ? { shopId } : {}) });
    }
  }

  // Center tile always complete
  tiles['D3'] = makeBlankTile({
    state: 'complete', required: 0,
    name: 'The Crossroads',
    release: 'on', collect: 'on', hint: 0, xp: 0, gold: 0,
    shopId: 'centralia',
  });

  // Reveal neighbors of center; towns auto-complete and cascade their neighbors
  for (const [ar, ac] of getAdjRC(2, 3)) {
    const adjCoord = coordFromRC(ar, ac);
    if (typeGrid[ar][ac] === 'town') {
      tiles[adjCoord].state = 'complete';
      for (const [nr, nc] of getAdjRC(ar, ac)) {
        const nCoord = coordFromRC(nr, nc);
        if (tiles[nCoord].state === 'hidden') tiles[nCoord].state = 'available';
      }
    } else {
      tiles[adjCoord].state = 'available';
    }
  }

  return tiles;
}

// ── Random adventurer helpers ─────────────────────────────────────────────────
export function randomAdvName(): { firstName: string; lastName: string } {
  const firstName = ADV_NAMES_FIRST[Math.floor(Math.random() * ADV_NAMES_FIRST.length)];
  const lastName  = ADV_NAMES_LAST[Math.floor(Math.random() * ADV_NAMES_LAST.length)];
  return { firstName, lastName };
}

export function randomAdvClass(usedClasses: string[] = []): string {
  const available = ADV_CLASSES.filter(c => !usedClasses.includes(c));
  const pool = available.length > 0 ? available : ADV_CLASSES;
  return pool[Math.floor(Math.random() * pool.length)];
}
