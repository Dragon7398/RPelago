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
  room?: 1 | 2;       // bifurcated tiles: which room this slot belongs to
  bonusXP?: number;   // extra XP awarded to the player who completes this slot
  bonusGold?: number; // extra gold awarded to the player who completes this slot
}

export interface AdvStatusNote {
  text: string;
  timestamp: number;
}

export interface TileAdventurer {
  advId: string;
  name: string;
  cls: AdvClass;
  owner: string;       // player ID
  ownerName: string;   // display name for rendering
  slots?: AdvSlot[];
  room?: 1 | 2;
  statusNote?: AdvStatusNote;
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
  claimableSlots?: Record<string, AdvSlot[]>;
  stunnedAdvId?: string;
  tauntedAdvId?: string;
  link: string;
  link2?: string;
  gold: number;
  xp: number;
  bonusXP: number;
  diffBonus: number;
  baseRelease: TriState;
  baseCollect: TriState;
  baseHint: number;
  adminOverride: boolean;
  shopId?: string;
  slotsLocked?: boolean;
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

export interface PlayerWarning {
  timestamp: number;
  message: string;
  auto?: boolean;
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
  warnings?: Record<string, PlayerWarning>;
  discordHandle?: string;
  avatarHash?: string | null;
  joinedAt?: number;
  activeMission?:     string | null;
  basicTrainingDone?: boolean;
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
  tiles:    Record<string, Tile>;
  players:  Record<string, Player>;
  missions: Record<string, GMMission>;
  orbState: Record<string, OrbAcquisition>;
  orbConfig: OrbConfig;
  shops:    Record<string, Shop>;
  meta:     GameMeta;
}

export interface AuthUser {
  id: string;
  displayName: string;
}

export type GMMissionType  = 'basic' | 'patrol' | 'casino';
export type GMMissionState = 'forming' | 'inprogress' | 'complete';

// Shared odds table for casino missions; all participants' gambits write to this.
export interface CasinoStats {
  release: number;  // 0–100 — percentage chance release is ON at deploy
  collect: number;  // 0–100 — percentage chance collect is ON at deploy
  hint:    number;  // hint cost modifier (percentage)
  xp:      number;  // XP floor; raised by penalty gambits
}

export interface GMParticipant {
  playerId:    string;
  playerName:  string;
  joinedAt:    number;
  slots?:      AdvSlot[];
  statusNote?: AdvStatusNote;
  // casino-only fields
  startBy?:     number;   // epoch ms — must start a casino round by this time or be stood down
  played?:      boolean;  // true once the player has locked their casino hand (immutable)
  goldSwing?:   number;   // sum of committed card values; paid out at mission complete
  casinoXp?:    number;   // XP earned from gambits; merged into mission.xp at deploy
  gambitPlayed?: boolean;  // true once the player has played (or skipped) their gambit
}

export interface GMMission {
  id:              string;
  type:            GMMissionType;
  series:          number;
  label:           string;
  state:           GMMissionState;
  baseMax:         number;
  xp:              number;
  gp:              number;
  traits?:         Record<string, { value: number }>;
  release:         TriState;
  collect:         TriState;
  hint:            number;
  link?:           string;
  firstJoinAt:     number | null;
  createdAt:       number;
  deployedAt?:     number;
  participants:    Record<string, GMParticipant>;
  claimableSlots?: Record<string, AdvSlot[]>;
  slotsLocked?:   boolean;
  // casino-only fields
  variableReward?: boolean;                         // true → show "50+ XP / ? GP" until locked
  tableUrl?:       string;                          // route opened in a new tab
  entryCosts?:     { label: string; gold: number }[]; // house-cut note on the mission card
  pot?:            number;                          // shared gold pot; seeded at cohort creation
  casinoStats?:    CasinoStats;                     // shared odds table modified by gambits
}

export interface CompletedChallenge {
  coord:       string;
  name:        string;
  xpAwarded:   number;
  goldAwarded: number;
  completedAt: number;
}

export type ActivityType =
  | 'tile_complete'
  | 'tile_inprogress'
  | 'tile_available'
  | 'orb_collected'
  | 'item_purchased'
  | 'orb_purchased'
  | 'mission_deploy'
  | 'mission_complete';

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: ActivityType;
  message: string;
  icon: string;
}
