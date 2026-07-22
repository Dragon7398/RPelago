import type { DeckCard } from '../lib/casinoData';

export type TileState = 'hidden' | 'available' | 'inprogress' | 'complete';
export type SlotStatus = 'Unstarted' | 'In-Progress' | '100%' | 'Goaled' | 'Done';
export type TileTypeKey = 'town' | 'town_center' | 'battle' | 'puzzle' | 'elite' | 'boss';
export type TriState = 'on' | 'off' | 'special';
export type AdvClass = 'Warrior' | 'Mage' | 'Rogue' | 'Cleric' | 'Ranger' | 'Paladin' | 'Bard' | 'Druid';
export type CasinoDeckChoice = 'purist' | 'unconsoled' | 'indie';
// Which card game a casino table is pinned to (S1.5 multi-table model).
export type CasinoGame = 'five_card_draw' | 'seven_card_stud' | 'holdem' | 'blackjack';

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
  tracker?: string;
  tracker2?: string;
  cheese?: string;
  cheese2?: string;
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
  preferredDeckChoice?: CasinoDeckChoice;    // last casino deck picked; pre-fills the picker next cohort
  disabled?: boolean;
  feats?: PlayerFeats;
  warnings?: Record<string, PlayerWarning>;
  discordHandle?: string;
  avatarHash?: string | null;
  joinedAt?: number;
  activeMission?:     string | null;
  basicTrainingDone?: boolean;
  // Casino: which game types this player has successfully completed a table of.
  // When all four are true, the Coat of Many Colors is granted (name-color unlock).
  casinoGamesCompleted?: Partial<Record<CasinoGame, boolean>>;
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
  // NOTE: adminId moved to config/adminId (global, season-independent).
  // kmkActiveListId is gone — KMK lists now carry their own `active` flag.
  initialized: boolean;
  seed: number;
}

// ── Season config (global, at config/) ────────────────────────────────────────

/** Which root UI a season renders. */
export type SeasonShell  = 'map' | 'casino';

/**
 * draft    — unlaunched. NOT listed in the public config/seasonList; readable
 *            and playtestable only by admin + alpha users.
 * active   — live and public.
 * closing  — public and still writable, but no new missions spawn. In-flight
 *            missions play out to completion.
 * archived — public, frozen. Read-only to everyone but admin.
 */
export type SeasonStatus = 'draft' | 'active' | 'closing' | 'archived';

/** An entry in the PUBLIC config/seasonList (live + archived seasons only). */
export interface SeasonListEntry {
  label:  string;
  shell:  SeasonShell;
  status: Exclude<SeasonStatus, 'draft'>;
  /** Casino tables kept open concurrently. Per-season so S2 can differ from S1.5. */
  casinoOpenTables?: number;
}

/** An entry in the PRIVATE config/draftSeasons (admin + alpha only). */
export interface DraftSeasonEntry {
  label: string;
  shell: SeasonShell;
  casinoOpenTables?: number;
}

export interface SeasonConfig {
  adminId:          string;
  activeSeasonId:   string;
  minClientVersion: number;
  seasonList:       Record<string, SeasonListEntry>;
  /** Only present for admin/alpha readers; undefined for normal players. */
  draftSeasons?:    Record<string, DraftSeasonEntry>;
  /** Only present for admin/alpha readers. */
  alphaUsers?:      Record<string, boolean>;
}

/** The season the client is currently rendering, resolved from SeasonConfig. */
export interface ResolvedSeason {
  id:     string;
  label:  string;
  shell:  SeasonShell;
  status: SeasonStatus;
  /** True when viewing an unlaunched season (admin/alpha preview + playtest). */
  isDraft: boolean;
  /** False for archived seasons — the UI should render read-only. */
  writable: boolean;
}

// ── Keymaster's Keep ──────────────────────────────────────────────────────────
export type KmkStatus = 'Incomplete' | 'Pending' | 'Verifying' | 'Complete';

export interface KmkTask {
  trial: string;
  desc: string;
  order: number;
  status: KmkStatus;
  playerId?: string | null;
  playerName?: string | null;
  claimedAt?: number | null;
}

export interface KmkArea {
  name: string;
  order: number;
  locked: boolean;
  tasks: Record<string, KmkTask>;
}

export interface KmkList {
  name: string;
  createdAt: number;
  areas: Record<string, KmkArea>;
  /**
   * Lists come and go and MULTIPLE may be active at once, so activation is a
   * property of each list rather than a single global pointer. (Replaces the
   * old game/meta/kmkActiveListId.) KMK is global — not season-scoped.
   */
  active?: boolean;
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
  // Settled tables/cohorts. Already arrives with the season subscription (it is a
  // child of the season root), so reading it here costs no extra bandwidth.
  missionsHistory: Record<string, GMMission>;
  orbState: Record<string, OrbAcquisition>;
  orbConfig: OrbConfig;
  shops:    Record<string, Shop>;
  // Casino-season audit trail of weekly gold-floor top-ups — the one place outside
  // gold enters the economy. Absent (→ {}) in map seasons. Written by weeklyGoldTopUp.
  goldTopUpLog: Record<string, GoldTopUpEntry>;
  meta:     GameMeta;
}

// One weekly gold-floor top-up: a player below the floor was raised to it.
export interface GoldTopUpEntry {
  ts:               number;  // epoch ms of the top-up
  uid:              string;
  playerName:       string;
  granted:          number;  // gold added (floor − prior balance)
  resultingBalance: number;  // always the floor
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

// One money-moving or outcome event in a casino mission's audit trail.
export interface CasinoLogEntry {
  ts:           number;
  uid:          string;
  playerName:   string;
  event:        'deal' | 'reroll' | 'gambit' | 'lock' | 'fold' | 'playon';
  game?:        CasinoGame;
  amount?:      number;           // gold the player paid for this event (negative = paid TO the player)
  potAdd?:      number;           // gold added to the shared pot from this event
  goldSwing?:   number;           // final reward at 'lock' (post deck-boost)
  deckChoice?:  CasinoDeckChoice; // at 'lock'
  gambitDefId?: string;           // at 'gambit'
}

export interface GMParticipant {
  playerId:    string;
  playerName:  string;
  avatarHash?: string | null;   // Discord avatar hash, stamped at enlist (for the seat icon)
  joinedAt:    number;
  slots?:      AdvSlot[];
  statusNote?: AdvStatusNote;
  // casino-only fields
  startBy?:     number;              // epoch ms — must start a casino round by this time or be stood down
  played?:      boolean;             // true once the player has locked their casino hand (immutable)
  goldSwing?:   number;              // sum of committed card values; paid out at mission complete
  lockedCards?: DeckCard[];          // the cards this seat COMMITTED, written from the secret hand at
                                     // lock so the landing can show them (they map 1:1 to the public
                                     // slots, so nothing secret is exposed). Only set once played.
  casinoXp?:    number;              // XP earned from gambits; merged into mission.xp at deploy
  gambitPlayed?: boolean;            // true once the player has played (or skipped) their gambit
  gambitOffer?:  string[];           // the gambit defIds the server dealt this seat (authoritative — the
                                     // only ones playCasinoGambit will accept); drawn from the shared deck
  // Set when the host denies this seat's uploaded config: the stored YAML is
  // deleted and the seat is flagged so the player is prompted to resubmit (works
  // whether the table is still forming or already in progress). Cleared on resubmit.
  yamlDenied?:       boolean;
  yamlDeniedReason?: string;
  yamlDeniedAt?:     number;
  gameType?:    'poker' | 'blackjack'; // legacy single-sitting selector; Hold 'Em uses mission.casinoGame
  rerolled?:    boolean;             // true once the poker reroll has been used this session
  deckChoice?:  CasinoDeckChoice;    // which deck variant this seat is drawing from this cohort
  // Hold 'Em (two-sitting) only:
  holeLocked?:  boolean;             // sitting 1: hole cards anted + locked in
  playedOn?:    boolean;             // sitting 2: paid the play-on and selected the final hand
  // Stamped onto the ARCHIVED copy at settle (see completeMission). The pot split
  // has a random remainder, so the ledger cannot re-derive it — it must be recorded.
  potShare?:    number;              // gold this seat took from the pot
  net?:         number;              // goldSwing + potShare − entry costs actually paid
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
  // When the room link first went up. The Elapsed clock runs from here, not from
  // deploy — players can't actually start until there's a room to join. Cleared
  // when the link is removed, so a re-added link restarts the clock.
  linkedAt?:       number;
  tracker?:        string;
  cheese?:         string;
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
  // The odds this table ROLLED at creation, frozen. Every table rolls its own
  // release/collect (rollTableSetup), so drift can only be measured against this
  // — not against CASINO_START_STATS, which is merely where the roll centres.
  casinoOpenStats?: CasinoStats;
  // The pot this table OPENED with (rollTableSetup), frozen. The opening pot is
  // variable (4×seats² + difficulty + premium) and is never logged as a potAdd, so
  // the audit needs it banked to reconcile the pot and to sum injected money.
  casinoOpenPot?:  number;
  casinoLog?:      Record<string, CasinoLogEntry>;  // audit trail of money-moving/outcome events
  casinoGame?:     CasinoGame;                      // which game this table is pinned to (multi-table)
  community?:      DeckCard[];                       // Hold 'Em: shared PUBLIC community cards (post-reveal)
  communityDrawnAt?: number;                        // Hold 'Em: when community was dealt; also the phase-2 gate
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
