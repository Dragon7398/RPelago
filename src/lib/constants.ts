import type { AdvClass, OrbDef, ShopItem, Shop } from '../types';

export const COLS = 7;
export const ROWS = 5;
export const COL_CHARS = 'ABCDEFG';

export const TILE_TYPES: Record<string, { label: string; icon: string; cls: string }> = {
  town:        { label: 'Town',   icon: '🏰', cls: 'tile-town'   },
  town_center: { label: 'Town',   icon: '🏰', cls: 'tile-town'   },
  battle:      { label: 'Battle', icon: '⚔️',  cls: 'tile-battle' },
  puzzle:      { label: 'Puzzle', icon: '🧩', cls: 'tile-puzzle' },
  elite:       { label: 'Elite',  icon: '💀', cls: 'tile-elite'  },
  boss:        { label: 'Boss',   icon: '🐉', cls: 'tile-boss'   },
};

export const ADV_CLASSES: AdvClass[] = ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin', 'Bard', 'Druid'];

export const ADV_ICONS: Record<AdvClass, string> = {
  Warrior: '⚔️',
  Mage:    '🔮',
  Rogue:   '🗡️',
  Cleric:  '✨',
  Ranger:  '🏹',
  Paladin: '🛡️',
  Bard:    '🎵',
  Druid:   '🌿',
};

export const ADV_NAMES_FIRST = [
  'Aldric', 'Serana', 'Torvin', 'Mira', 'Dax', 'Lyra', 'Borin', 'Sylva',
  'Kael', 'Thessia', 'Oryn', 'Veda', 'Gareth', 'Nyx', 'Fenn', 'Isolde',
];

export const ADV_NAMES_LAST = [
  'Stonefist', 'Ashveil', 'Ironwood', 'Dawnwhisper',
  'Greymantle', 'Blackthorn', 'Swiftarrow', 'Moonforge',
];

export const ALL_ORBS: OrbDef[] = [
  { id: 'fire',  label: 'Fire',  color: 'oklch(62% 0.22 35)',  icon: '🔥' },
  { id: 'water', label: 'Water', color: 'oklch(60% 0.18 220)', icon: '💧' },
  { id: 'earth', label: 'Earth', color: 'oklch(58% 0.15 130)', icon: '🪨' },
  { id: 'air',   label: 'Air',   color: 'oklch(72% 0.10 200)', icon: '🌪️' },
  { id: 'light', label: 'Light', color: 'oklch(82% 0.14 90)',  icon: '☀️' },
  { id: 'dark',  label: 'Dark',  color: 'oklch(52% 0.18 310)', icon: '🌑' },
  { id: 'metal', label: 'Metal', color: 'oklch(65% 0.06 220)', icon: '⚙️' },
  { id: 'wood',  label: 'Wood',  color: 'oklch(60% 0.16 145)', icon: '🌿' },
  { id: 'soul',  label: 'Soul',  color: 'oklch(68% 0.20 290)', icon: '✨' },
];

export const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 750, 1000];
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export const CENTER_COORD = 'D3';  // r=2, c=3 — always fixed

// ── Shop items ────────────────────────────────────────────────────────────────
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id:          'map',
    name:        'Map',
    description: 'Consumable: Request a hint for 1 item and 1 location.',
    cost:        100,
    consumable:  true,
  },
];

export const ORB_SHOP_COST = 1000;

// The four named shops. orbId and itemIds can be edited by admin in Firebase;
// these are the defaults written on first initialization.
export const DEFAULT_SHOPS: Readonly<Record<string, Shop>> = {
  centralia:  { id: 'centralia',  name: 'Centralia',  orbId: null,    itemIds: ['map'] },
  frostshear: { id: 'frostshear', name: 'Frostshear', orbId: null,    itemIds: []      },
  flamefell:  { id: 'flamefell',  name: 'Flamefell',  orbId: 'fire',  itemIds: []      },
  pinereach:  { id: 'pinereach',  name: 'Pinereach',  orbId: 'earth', itemIds: []      },
};

// Non-center shop IDs assigned to the three non-center towns via seeded shuffle
export const NON_CENTER_SHOP_IDS = ['frostshear', 'flamefell', 'pinereach'] as const;

// Maps shop town index (0 = center town, 1+ = other towns in row-major order) → item IDs sold there
// Kept for legacy reference; shop inventory is now driven by game/shops in Firebase.
export const TOWN_SHOP_ITEMS: Readonly<Record<number, readonly string[]>> = {
  0: ['map'],
  1: [],
  2: [],
  3: [],
};

export function coordFromRC(r: number, c: number): string {
  return `${COL_CHARS[c]}${r + 1}`;
}

export function rcFromCoord(coord: string): [number, number] {
  const c = COL_CHARS.indexOf(coord[0]);
  const r = parseInt(coord.slice(1)) - 1;
  return [r, c];
}

export function getAdjRC(r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0)       out.push([r - 1, c]);
  if (r < ROWS - 1) out.push([r + 1, c]);
  if (c > 0)       out.push([r, c - 1]);
  if (c < COLS - 1) out.push([r, c + 1]);
  return out;
}

export function getAdjCoords(coord: string): string[] {
  const [r, c] = rcFromCoord(coord);
  return getAdjRC(r, c).map(([ar, ac]) => coordFromRC(ar, ac));
}

export function isEdgeTile(r: number, c: number): boolean {
  return r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
}
