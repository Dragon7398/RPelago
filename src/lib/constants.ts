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
  'Caspian', 'Thalia', 'Riven', 'Vesper', 'Emric', 'Wren', 'Draven', 'Elara',
  'Caius', 'Branwen', 'Zephyr', 'Tarrin', 'Phaedra', 'Jorvin', 'Celeste', 'Rook',
  'Elowen', 'Hadeon', 'Solia', 'Corvus', 'Mirela', 'Dusk', 'Zinnia', 'Tybalt',
];

export const ADV_NAMES_LAST = [
  'Stonefist', 'Ashveil', 'Ironwood', 'Dawnwhisper',
  'Greymantle', 'Blackthorn', 'Swiftarrow', 'Moonforge',
  'Emberveil', 'Shadowmend', 'Stormcaller', 'Nighthollow',
  'Firesong', 'Silverthorn', 'Ravenwing', 'Cinderspire',
  'Frosthollow', 'Starfall', 'Ashenbrow', 'Coppergate',
  'Galesong', 'Embercroft', 'Runeblade', 'Oakheart',
  'Brightholm', 'Duskmantle', 'Coldwater', 'Wildstride',
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
    description: "Hints are turned off on this challenge until at least one player's slots have fully goaled." },
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

// XP required for each level; this is calculated based on the average of around ~120 XP for completed tiles.
// These will need to be changed for future seasons as the map grows and/or the XP distribution changes.
export const LEVEL_THRESHOLDS = [0, 100, 300, 500, 800, 1150, 1500];
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
    description: 'Other players on challenges you play in receive 5% bonus XP. You receive 1% bonus XP for each other player on your challenge. This stacks with other Mentors.',
  },
  {
    id: 'treasurer',
    name: 'Treasurer',
    icon: '💰',
    availableAt: 5,
    description: 'Other players on challenges you play in receive 10% bonus Gold. You receive 3% bonus Gold for each other player on your challenge. This stacks with other Treasurers.',
  },
  {
    id: 'seeker',
    name: 'Seeker',
    icon: '🔍',
    availableAt: 7,
    description: 'Challenges you play in have 1% reduced Hint cost. This stacks with other Seekers, to a minimum of 1% Hint Cost.',
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

export interface GMMissionDef {
  type:       'basic' | 'patrol' | 'casino';
  label:      string;
  icon:       string;
  description: string;
  baseMax:    number;
  xp:         number;
  gp:         number;
  traits:     Record<string, { value: number }> | null;
  decayHours: number;
  release:    'on' | 'off' | 'special';
  collect:    'on' | 'off' | 'special';
  hint:       number;
  special:    boolean;   // true = once-per-guildmaster (Basic Training)
  repeatable: boolean;
  // casino-only optional fields
  variableReward?: boolean;
  tableUrl?:       string;
  entryCosts?:     { label: string; gold: number }[];
  potSeed?:        number;
}

// ── Casino mission constants ───────────────────────────────────────────────────
// Starting odds written to casinoStats when a casino cohort is created.
export const CASINO_START_STATS = { release: 60, collect: 30, hint: 10, xp: 50 } as const;
// Minimum gold a player must hold to enlist (= cheapest game ante: blackjack).
// = the cheapest ante across CASINO_GAMES (Hold 'Em, 90g). Kept as a constant
// because the server gates enlist on it; see minCasinoAnte() in casinoData.
export const CASINO_MIN_ENLIST_GOLD = 90;
// Ante costs by game type.
export const CASINO_ANTE: Record<'poker' | 'blackjack', number> = { poker: 40, blackjack: 30 };
// Cost to reroll rejected cards in poker.
export const CASINO_REROLL_COST = 20;

// Casino-season gold economy. Mirrored in functions/src/index.ts — keep in sync.
// A fresh casino player starts at START_GOLD; the weekly top-up brings anyone
// below GOLD_FLOOR up to it; S2 seed = max(final S1.5 balance, GOLD_FLOOR).
export const CASINO_START_GOLD = 500;
export const CASINO_GOLD_FLOOR = 250;

// How many casino tables are open (forming) at once in a casino season. A
// per-season override lives at config/seasonList/{seasonId}/casinoOpenTables;
// this is the default. Each table is pinned to one game type; a replacement
// spawns (least-represented game) whenever a table deploys, holding the count.
export const CASINO_OPEN_TABLES = 6;

// Season-end control is data-driven now: whether new cohorts may spawn follows the
// season's `status` (draft/active spawn; closing/archived wind down) — see
// gmSpawnAllowed in functions/src/index.ts and seedInitialMissions in db.ts. The
// old hand-flipped MISSIONS_CLOSED_FOR_SEASON dual-copy constant is gone.

export const MISSION_DEFS: Readonly<Record<string, GMMissionDef>> = {
  basic: {
    type:        'basic',
    label:       'Basic Training',
    icon:        '🗡️',
    description: 'While not glamorous, most adventurers start their career with fighting that most fearsome foe: the training dummies back at the capital.',
    baseMax:     5,
    xp:          100,
    gp:          0,
    traits:      { sturdy: { value: 150 } },
    decayHours:  24,
    release:     'on',
    collect:     'off',
    hint:        8,
    special:     true,
    repeatable:  false,
  },
  patrol: {
    type:        'patrol',
    label:       'Patrol',
    icon:        '🛡️',
    description: "Someone has to walk the walls and watch the roads. It isn't glorious work — but the gold is steady, the nights are quiet, and a guild that skips its patrols learns why they mattered.",
    baseMax:     8,
    xp:          50,
    gp:          50,
    traits:      null,
    decayHours:  24,
    release:     'on',
    collect:     'off',
    hint:        10,
    special:     false,
    repeatable:  true,
  },
  casino: {
    type:        'casino',
    label:       'A Night at the Casino',
    icon:        '🎲',
    description: "The guild's coffers won't fill themselves, and a guildmaster's evenings are long. Ante up at the card table, commit whatever games fortune deals you, and let the Archipelago decide who walks away richer — and who only walks away.",
    baseMax:     6,
    xp:          50,    // floor; settles at 50 + Σ gambit XP at deploy
    gp:          0,     // unknown until hands are locked; shown as "? GP" in the UI
    traits:      null,
    decayHours:  24,
    release:     'special',  // rolled from casinoStats at deploy
    collect:     'special',  // rolled from casinoStats at deploy
    hint:        10,
    special:     false,
    repeatable:  true,
    variableReward: true,
    tableUrl:       '/casino/table',
    entryCosts: [
      { label: 'Poker ante',     gold: 40 },
      { label: 'Blackjack ante', gold: 30 },
      { label: 'Reroll',         gold: 20 },
    ],
    potSeed: 50,
  },
};

export function toRoman(n: number): string {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result;
}

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
