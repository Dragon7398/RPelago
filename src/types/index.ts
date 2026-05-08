export type TileState = 'hidden' | 'available' | 'inprogress' | 'complete';
export type SlotStatus = 'Unstarted' | 'In-Progress' | '100%' | 'Goaled' | 'Done';
export type TileTypeKey = 'town' | 'town_center' | 'battle' | 'puzzle' | 'elite' | 'boss';
export type TriState = 'on' | 'off' | 'special';
export type AdvClass = 'Warrior' | 'Mage' | 'Rogue' | 'Cleric' | 'Ranger' | 'Paladin' | 'Bard' | 'Druid';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  consumable: boolean;
}

export interface AdvSlot {
  name: string;       // player-chosen slot name, e.g. "BrisbeLTTP"
  game: string;       // game title, e.g. "Link To The Past"
  details?: string;   // optional extra info for complex challenges
  status?: SlotStatus;
}

export interface TileAdventurer {
  advId: string;
  name: string;
  cls: AdvClass;
  owner: string;       // player ID
  ownerName: string;   // display name for rendering
  slots?: AdvSlot[];
}

export interface Tile {
  state: TileState;
  required: number;
  adventurers: Record<string, TileAdventurer>;  // keyed by advId
  name: string;
  release: TriState;
  collect: TriState;
  hint: number;
  details: string;
  rules?: string;
  traits?: Record<string, { value: number }>;
  publicSlots?: AdvSlot[];
  stunnedAdvId?: string;
  tauntedAdvId?: string;
  link: string;
  gold: number;
  xp: number;
  bonusXP: number;
  diffBonus: number;
  baseRelease: TriState;
  baseCollect: TriState;
  baseHint: number;
  adminOverride: boolean;
  shopId?: string;
}

export interface Adventurer {
  id: string;
  firstName: string;
  lastName: string;
  cls: AdvClass;
  busy: boolean;
  busyTile: string | null;
}

export interface PlayerFeats {
  level3?: string;
  level5?: string;
  level7?: string;
}

export interface Player {
  id: string;
  displayName: string;
  xp: number;
  gold: number;
  adventurers: Record<string, Adventurer>;  // keyed by adventurer id
  inventory: Record<string, number>;         // itemId → quantity owned
  xpHistory?: number[];                      // archived XP totals from previous campaigns
  nameColor?: string;                        // color ID from NAME_COLORS palette
  disabled?: boolean;
  feats?: PlayerFeats;
}

export interface OrbConfig {
  eliteDrops: number[];   // indices into ALL_ORBS for each elite position
  shopOrbs: number[];     // indices into ALL_ORBS for each shop town
  battleOrb: number;      // index into ALL_ORBS for edge battle reward
  puzzleOrb: number;      // index into ALL_ORBS for edge puzzle reward
  bossMinOrbs: number;
  bossNegEffects: Record<string, string>;  // orbId -> curse text
}

export interface OrbDef {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly icon: string;
}

export interface GameMeta {
  adminId: string;
  initialized: boolean;
  seed: number;
}

export interface OrbAcquisition {
  method: 'battle' | 'puzzle' | 'elite' | 'boss' | 'shop' | 'admin';
  tileCoord: string;
  tileName?: string;
  buyerName?: string;
}

export interface Shop {
  id: string;
  name: string;
  orbId: string | null;
  itemIds: string[];
}

export interface GameState {
  tiles: Record<string, Tile>;            // keyed by coord e.g. "A1"
  players: Record<string, Player>;        // keyed by player ID
  orbState: Record<string, OrbAcquisition>;
  orbConfig: OrbConfig;
  shops: Record<string, Shop>;
  meta: GameMeta;
}

export interface AuthUser {
  id: string;
  displayName: string;
}

export type ActivityType =
  | 'tile_complete'
  | 'tile_inprogress'
  | 'tile_available'
  | 'orb_collected'
  | 'item_purchased'
  | 'orb_purchased';

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: ActivityType;
  message: string;
  icon: string;
}
