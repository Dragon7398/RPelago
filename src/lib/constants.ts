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

export const SLOT_STATUSES = ['Unstarted', 'In-Progress', '100%', 'Goaled', 'Done'] as const;
export const FREE_COMPLETED_STATUSES = new Set(['100%', 'Goaled', 'Done']);

export const NAME_COLORS: readonly { id: string; label: string; value: string }[] = [
  { id: 'default',  label: 'Default',  value: 'oklch(92% 0.03 80)'  },
  { id: 'gold',     label: 'Gold',     value: 'oklch(76% 0.14 75)'  },
  { id: 'crimson',  label: 'Crimson',  value: 'oklch(65% 0.20 25)'  },
  { id: 'ember',    label: 'Ember',    value: 'oklch(72% 0.18 50)'  },
  { id: 'lavender', label: 'Lavender', value: 'oklch(74% 0.16 285)' },
  { id: 'jade',     label: 'Jade',     value: 'oklch(68% 0.18 155)' },
  { id: 'amethyst', label: 'Amethyst', value: 'oklch(52% 0.45 310)' },
  { id: 'teal',     label: 'Teal',     value: 'oklch(68% 0.16 195)' },
  { id: 'sapphire', label: 'Sapphire', value: 'oklch(65% 0.18 240)' },
  { id: 'arcane',   label: 'Arcane',   value: 'oklch(68% 0.22 310)' },
  { id: 'rose',     label: 'Rose',     value: 'oklch(70% 0.18 355)' },
  { id: 'silver',   label: 'Silver',   value: 'oklch(78% 0.04 240)' },
];

export interface TraitDef {
  id: string;
  name: string;
  description: string; // {value} is replaced with the numeric parameter
  hasValue: boolean;
  defaultValue: number;
}

export const TILE_TRAITS: readonly TraitDef[] = [
  { id: 'aerial',       name: 'Aerial',         hasValue: false, defaultValue: 0,
    description: 'In order to engage this enemy, your slot must either have the ability to Fly or a Ranged Weapon. (Subject to discussion with admins.)' },
  { id: 'agile',        name: 'Agile',           hasValue: true,  defaultValue: 250,
    description: 'Your slot may not have more than {value} checks.' },
  { id: 'bifurcated',   name: 'Bifurcated',      hasValue: false, defaultValue: 0,
    description: 'This challenge will be split into two worlds that must both goal to complete this challenge.' },
  { id: 'camouflage',   name: 'Camouflage',      hasValue: false, defaultValue: 0,
    description: 'Hints are turned off on this challenge until at least one slot has goaled.' },
  { id: 'confounding',  name: 'Confounding',     hasValue: false, defaultValue: 0,
    description: "An additional Simon Tatham's Portable Puzzle Collection slot will be added to this challenge as a Public slot." },
  { id: 'cursed',       name: 'Cursed',          hasValue: false, defaultValue: 0,
    description: 'After submitting your slot, one or more of your settings will be randomized.' },
  { id: 'enduring',     name: 'Enduring',        hasValue: true,  defaultValue: 95,
    description: 'Goaling all slots does not complete this challenge. In order to complete the challenge, {value}% of all checks must be sent.' },
  { id: 'horde',        name: 'Horde',           hasValue: true,  defaultValue: 2,
    description: 'Your slot must have at least {value} games.' },
  { id: 'magicresist',  name: 'Magic Resist',    hasValue: false, defaultValue: 0,
    description: 'In order to engage this enemy, your slot must not involve magic. (Subject to discussion with admins.)' },
  { id: 'physresist',   name: 'Physical Resist', hasValue: false, defaultValue: 0,
    description: 'In order to engage this enemy, your slot must involve magic. (Subject to discussion with admins.)' },
  { id: 'puzzling',     name: 'Puzzling',        hasValue: false, defaultValue: 0,
    description: 'An additional Jigsaw will be added to this challenge as a Public slot.' },
  { id: 'sturdy',       name: 'Sturdy',          hasValue: true,  defaultValue: 150,
    description: 'Your slot must have at least {value} checks.' },
  { id: 'stunning',     name: 'Stunning',        hasValue: false, defaultValue: 0,
    description: 'One slot will be chosen at random to be stunned, and will have all locations excluded. If this randomly rolls a player who is immune to this status, this effect fizzles.' },
  { id: 'taunt',        name: 'Taunt',           hasValue: false, defaultValue: 0,
    description: 'One slot will be chosen at random to be VIP and have all locations prioritized.' },
  { id: 'thief',        name: 'Thief',           hasValue: false, defaultValue: 0,
    description: 'One or more slots will be assigned the role of Thief; they will steal one or more important items from the other slots.' },
  { id: 'unbalanced',   name: 'Unbalanced',      hasValue: false, defaultValue: 0,
    description: 'Progression balancing will be set to 0 for this challenge.' },
];

// Maps item ID → trait IDs whose names should be underlined in the shop description
export const ITEM_TRAIT_REFS: Readonly<Record<string, readonly string[]>> = {
  wand_of_piercing:   ['magicresist', 'physresist'],
  throwing_dagger:    ['aerial', 'agile'],
  ring_of_resistance: ['cursed', 'stunning'],
  warhammer:          ['horde', 'sturdy'],
};

export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2000];
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export const CENTER_COORD = 'D3';  // r=2, c=3 — always fixed

// ── Boss orb-reactive traits ───────────────────────────────────────────────────
// Elemental orb → trait IDs applied to the boss while that orb is ungathered
export const ELEMENTAL_ORB_TRAITS: Readonly<Record<string, readonly string[]>> = {
  fire:  ['cursed', 'stunning'],
  air:   ['aerial', 'agile'],
  water: ['camouflage', 'taunt'],
  earth: ['enduring', 'sturdy'],
};

// These traits can still be removed even while the boss is In Progress
export const BOSS_SOFT_TRAITS: readonly string[] = ['camouflage', 'enduring'];

// Initial trait values written to the boss on map generation (all 4 orbs ungathered)
export const BOSS_ELEMENTAL_TRAIT_VALUES: Readonly<Record<string, number>> = {
  cursed: 0, stunning: 0,
  aerial: 0, agile:    250,
  camouflage: 0, taunt: 0,
  enduring: 95, sturdy: 150,
};

// ── Shop items ────────────────────────────────────────────────────────────────
export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id:          'map',
    name:        'Map',
    description: 'Consumable: Request a hint for 1 item and 1 location.',
    cost:        250,
    consumable:  true,
  },
  {
    id:          'scroll_of_magnetism',
    name:        'Scroll of Magnetism',
    description: 'Consumable: Turns Collect On in a Collect Off challenge.',
    cost:        1000,
    consumable:  true,
  },
  {
    id:          'scroll_of_generosity',
    name:        'Scroll of Generosity',
    description: 'Consumable: Turns Release On in a Release Off challenge.',
    cost:        1000,
    consumable:  true,
  },
  {
    id:          'coat_of_many_colors',
    name:        'Coat of Many Colors',
    description: 'Cosmetic: Allows you to adjust the color of your username.',
    cost:        750,
    consumable:  false,
  },
  {
    id:          'wand_of_piercing',
    name:        'Wand of Piercing',
    description: 'Passive: You may ignore the Magic Resist and Physical Resist traits on challenges.',
    cost:        300,
    consumable:  false,
  },
  {
    id:          'throwing_dagger',
    name:        'Throwing Dagger',
    description: 'Passive: You may ignore the Aerial trait on challenges. You may bring up to 25% more checks to Agile challenges.',
    cost:        400,
    consumable:  false,
  },
  {
    id:          'ring_of_resistance',
    name:        'Ring of Resistance',
    description: 'Passive: You are immune to the Cursed and Stunning traits on challenges.',
    cost:        500,
    consumable:  false,
  },
  {
    id:          'warhammer',
    name:        'Warhammer',
    description: 'Passive: You may bring 1 fewer game to Horde challenges. You may bring up to 50% fewer checks to Sturdy challenges.',
    cost:        600,
    consumable:  false,
  },
];

export const ORB_SHOP_COST = 1500;

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

export interface FeatDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  availableAt: 3 | 5 | 7;
  yamlEffect?: {
    startingHints?: number;
    hintedLocations?: number;
    excludedLocations?: number;
    priorityLocations?: number;
    startingItems?: number;
  };
}

export const FEATS: readonly FeatDef[] = [
  {
    id: 'knowledgeable',
    name: 'Knowledgeable',
    icon: '📚',
    availableAt: 3,
    description: 'You are allowed to add 1 additional Starting Hint and 2 additional Hinted Locations to each YAML you submit. (This changes your maximum to 2 Hints and 2 Hint Locations, or 1 Hint and 3 Hint Locations.)',
    yamlEffect: { startingHints: 1, hintedLocations: 2 },
  },
  {
    id: 'picky',
    name: 'Picky',
    icon: '🚫',
    availableAt: 3,
    description: 'You are allowed to add 4 additional Excluded Locations to each YAML you submit. (This changes your maximum to 6 Excluded Locations.)',
    yamlEffect: { excludedLocations: 4 },
  },
  {
    id: 'helpful',
    name: 'Helpful',
    icon: '📌',
    availableAt: 3,
    description: 'You are allowed to add 2 additional Priority Locations to each YAML you submit. (This changes your maximum to 4 Priority Locations.)',
    yamlEffect: { priorityLocations: 2 },
  },
  {
    id: 'mentor',
    name: 'Mentor',
    icon: '🎓',
    availableAt: 5,
    description: 'Players on challenges you play in receive 5% bonus XP. You receive 1% bonus XP for each other player on your challenge. This stacks with other Mentors.',
  },
  {
    id: 'treasurer',
    name: 'Treasurer',
    icon: '💰',
    availableAt: 5,
    description: 'Players on challenges you play in receive 10% bonus Gold. You receive 3% bonus Gold for each other player on your challenge. This stacks with other Treasurers.',
  },
  {
    id: 'seeker',
    name: 'Seeker',
    icon: '🔍',
    availableAt: 7,
    description: 'Challenges you play on have 1% reduced Hint cost. This stacks with other Seekers, to a minimum of 1% Hint Cost.',
  },
  {
    id: 'prepared',
    name: 'Prepared',
    icon: '🎒',
    availableAt: 7,
    description: 'You are allowed to add 1 starting inventory item to each YAML you submit. (This changes your maximum to 1 starting inventory item.)',
    yamlEffect: { startingItems: 1 },
  },
];

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
