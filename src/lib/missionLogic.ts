import type { GMMission, GMMissionType, GMParticipant, AdvSlot, CasinoGame } from '../types';
import { MISSION_DEFS, CASINO_START_STATS, toRoman } from './constants';
import { CASINO_GAMES, CASINO_GAME_ORDER, seatSpend } from './casinoData';
import { rollTableSetup } from './casinoEngine';
import { countUnfinishedSets, normalizeSlots, claimEntries } from './slotHelpers';
import { parseApYaml } from './apYaml';
import type { TriState } from '../types';

export type GMMissionStatus = 'open' | 'filling' | 'inprogress';

export interface GMMissionCard {
  key:             string;
  mission:         GMMission;
  def:             typeof MISSION_DEFS[string];
  status:          GMMissionStatus;
  maxSlots:        number;
  filled:          number;
  /** Display-only seat count — see `seatTally`. Use this for any "x/y" the player sees. */
  seats:           SeatTally;
  decaySteps:      number;
  decayPct:        number;
  liveSec:         number;
  youIn:           boolean;
  seriesLabel:     string;
  takeable:        boolean;
  disabledReason:  string | null;
  doneLabel:       string | null;
  insufficientGold?: boolean;  // true when the player lacks the casino entry minimum
}

function decayWindowMs(m: GMMission): number {
  return m.type === 'casino' ? 36 * 3600_000 : 24 * 3600_000;
}

export function currentMaxSlots(m: GMMission, now: number): number {
  if (m.state === 'inprogress') return filledCount(m);
  if (m.firstJoinAt == null) return m.baseMax;
  const steps = Math.floor(Math.max(0, now - m.firstJoinAt) / decayWindowMs(m));
  return Math.max(1, m.baseMax - steps);
}

// Time until the next seat closes (decay lowers max-slots by one), or null when
// decay hasn't started (no first join yet) or the floor of 1 seat is reached.
// Keeps the decay-window constant in one place for any UI that shows a countdown.
export function msToNextDecay(m: GMMission, now: number): number | null {
  if (m.firstJoinAt == null || m.state !== 'forming') return null;
  if (currentMaxSlots(m, now) <= 1) return null;
  const w = decayWindowMs(m);
  return w - (Math.max(0, now - m.firstJoinAt) % w);
}

export function filledCount(m: GMMission): number {
  return Object.keys(m.participants ?? {}).length;
}

/**
 * A mission that has dealt in but has no Archipelago room yet.
 *
 * Deploying a cohort and generating its room are two separate host actions and can
 * sit a day apart — the `linkedAt` clock exists precisely because "a table can sit
 * deployed for a while before it has a room". That gap is a real state players
 * occupy, not a blink, so it needs its own wording: anything that says *live*,
 * counts elapsed time, or shows progress must hold off until the room exists, or
 * the table reads as running while nobody can actually play it.
 *
 * Deliberately keyed on `m.state`, NOT `GMMissionCard.status` — a full-but-forming
 * cohort already reports `status: 'inprogress'` (see `computeMissionCard`) and has
 * no business claiming its room is late.
 */
export function awaitingRoom(m: GMMission): boolean {
  return m.state === 'inprogress' && !m.link;
}

// ── Seat tally (what the UI shows) ────────────────────────────────────────────
/**
 * Seats as the UI should DISPLAY them, which is not always `currentMaxSlots`.
 *
 * Decay lowers the cap but never evicts a seated player, and a casino cohort keeps
 * decaying while it waits for every seat to lock in (`shouldDeploy` also demands
 * `allSeatsPlayed`). So a full table can outlive its own cap and render the
 * nonsense "7/6". The shown max is floored at the fill count instead, and `over`
 * marks the tables where that floor kicked in so they can be flagged — the seats
 * are real, the cap is simply behind them.
 *
 * Gameplay math (deploy, takeable, pot split) must keep using `currentMaxSlots`;
 * this is presentation only.
 */
export interface SeatTally {
  filled: number;
  max:    number;   // never below `filled`
  over:   boolean;  // decay dropped the cap under the fill count
  label:  string;   // "5/6" · "7/7*"
  title:  string;   // tooltip explaining the label
}

export function seatTally(m: GMMission, now: number): SeatTally {
  const filled = filledCount(m);
  const cap    = currentMaxSlots(m, now);
  const over   = filled > cap;
  const max    = Math.max(cap, filled);
  return {
    filled,
    max,
    over,
    label: `${filled}/${max}${over ? '*' : ''}`,
    title: over
      ? `This table has one or more seats that will decay if a player leaves the table.`
      : `${filled} of ${max} seats taken`,
  };
}

export function allSeatsPlayed(m: GMMission): boolean {
  const participants = Object.values(m.participants ?? {});
  if (participants.length === 0) return false;
  return participants.every(p => p.played === true);
}

export function shouldDeploy(m: GMMission, now: number): boolean {
  if (m.state !== 'forming') return false;
  if (filledCount(m) === 0) return false;
  if (filledCount(m) < currentMaxSlots(m, now)) return false;
  if (m.type === 'casino' && !allSeatsPlayed(m)) return false;
  return true;
}

export function missionDisplayLabel(m: GMMission): string {
  const roman = toRoman(m.series);
  return `${m.label} · Cohort ${roman}`;
}

export function computeMissionCard(
  m: GMMission,
  uid: string | null,
  // Pooled claims: how many un-finished mission claims the player currently holds,
  // and their capacity (missionClaimCapacity). A new mission is takeable only when
  // the player is already in it OR has a free claim. Replaces the old single
  // activeMissionId identity check.
  heldClaimCount: number,
  claimCapacity: number,
  basicTrainingDone: boolean,
  now: number,
  playerGold?: number,
): GMMissionCard {
  const def = MISSION_DEFS[m.type];
  const maxSlots = currentMaxSlots(m, now);
  const filled = filledCount(m);
  const youIn = uid != null && m.participants != null && uid in m.participants;

  let status: GMMissionStatus;
  if (m.state === 'inprogress') {
    status = 'inprogress';
  } else if (filled === 0 || m.firstJoinAt == null) {
    status = 'open';
  } else if (filled >= maxSlots) {
    // Casino missions require all seats to have played before deploying.
    // A full but not-yet-deployed casino cohort is still 'filling'.
    status = (m.type === 'casino' && !allSeatsPlayed(m)) ? 'filling' : 'inprogress';
  } else {
    status = 'filling';
  }

  const windowMs = decayWindowMs(m);
  const windowHours = windowMs / 3600_000;

  const decaySteps = m.state === 'forming' && m.firstJoinAt != null
    ? Math.floor(Math.max(0, now - m.firstJoinAt) / windowMs)
    : 0;

  const elapsedMs = m.firstJoinAt != null ? Math.max(0, now - m.firstJoinAt) : 0;
  const hoursIntoWindow = (elapsedMs % windowMs) / 3600_000;

  const decayPct = status === 'filling' ? hoursIntoWindow / windowHours : (status === 'open' ? 0 : 1);
  const liveSec = (windowHours - hoursIntoWindow) * 3600;

  const roman = toRoman(m.series);
  const seriesLabel = `COHORT ${roman}`;

  let takeable = false;
  let disabledReason: string | null = null;
  let doneLabel: string | null = null;
  let insufficientGold = false;

  if (m.state === 'inprogress') {
    disabledReason = 'This cohort has already deployed. A fresh cohort is forming below.';
  } else if (def.special && basicTrainingDone && !youIn) {
    doneLabel = 'ALREADY COMPLETED';
    disabledReason = 'You have already completed Basic Training — it can be undertaken only once per guildmaster.';
  } else if (!youIn && heldClaimCount >= claimCapacity) {
    disabledReason = claimCapacity <= 1
      ? `You are already undertaking a mission. Finish your part of it to free your claim.`
      : `All your mission claims are in use — finish your part of a table to free one.`;
  } else if (m.type === 'casino' && filled >= maxSlots && !youIn) {
    disabledReason = 'All seats are taken — waiting for players to lock in at the card table.';
  } else if (m.type === 'casino' && m.casinoGame && playerGold != null && !youIn
             && playerGold < seatSpend(m.casinoGame, { playedOn: true })) {
    // The FULL cost to finish this table (Hold 'Em counts its play-on), so a seat is
    // never taken that can't be completed.
    disabledReason = `You need ${seatSpend(m.casinoGame, { playedOn: true })}g to see this table through.`;
    insufficientGold = true;
  } else if (youIn) {
    doneLabel = 'YOU ARE ENLISTED';
  } else {
    takeable = true;
  }

  return {
    key:           m.id,
    mission:       m,
    def,
    status,
    maxSlots,
    filled,
    seats:         seatTally(m, now),
    decaySteps,
    decayPct,
    liveSec,
    youIn,
    seriesLabel,
    takeable,
    disabledReason,
    doneLabel,
    ...(insufficientGold ? { insufficientGold: true } : {}),
  };
}

export function freshMission(
  type: GMMissionType,
  series: number,
  now: number,
): Omit<GMMission, 'id'> {
  const def = MISSION_DEFS[type];
  return {
    type,
    series,
    label:        def.label,
    state:        'forming',
    baseMax:      def.baseMax,
    xp:           def.xp,
    gp:           def.gp,
    ...(def.traits        ? { traits:          { ...def.traits }      } : {}),
    release:      def.release as TriState,
    collect:      def.collect as TriState,
    hint:         def.hint,
    firstJoinAt:  null,
    createdAt:    now,
    participants: {},
    // casino-only optional fields
    ...(def.variableReward ? { variableReward: true                   } : {}),
    ...(def.tableUrl       ? { tableUrl:       def.tableUrl           } : {}),
    ...(def.entryCosts     ? { entryCosts:     [...def.entryCosts]    } : {}),
    ...(def.potSeed != null ? { pot:           def.potSeed            } : {}),
    ...(type === 'casino'  ? { casinoStats:    { ...CASINO_START_STATS } } : {}),
  };
}

// ── Casino multi-table model (canonical) ─────────────────────────────────────
// A casino season runs several single-game tables at once (see CASINO_OPEN_TABLES).
// Each table is a mission of type 'casino' pinned to one `casinoGame`. Mirror any
// change in functions/src/index.ts (gm* variants).

// The house-cut note shown on a table card, derived from the game's cost model.
export function casinoEntryCosts(game: CasinoGame): { label: string; gold: number }[] {
  const g = CASINO_GAMES[game];
  const costs: { label: string; gold: number }[] = [{ label: 'Ante', gold: g.ante }];
  if (g.reroll) costs.push({ label: 'Reroll',  gold: g.rerollCost });
  if (g.playOn) costs.push({ label: 'Play-on', gold: g.playOn });
  return costs;
}

// Pick the game type for the next table to open: at random among the type(s)
// with the FEWEST currently-forming tables. A type that hits zero is the sole
// minimum and is guaranteed next, so no game can be starved (which would make
// the all-four-games Coat unearnable). Only `forming` tables count.
export function pickNextCasinoGame(
  missions: Record<string, GMMission> | undefined,
  rng: () => number = Math.random,
): CasinoGame {
  const counts: Record<CasinoGame, number> = {
    five_card_draw: 0, seven_card_stud: 0, holdem: 0, blackjack: 0,
  };
  for (const m of Object.values(missions ?? {})) {
    if (m.type === 'casino' && m.state === 'forming' && m.casinoGame) counts[m.casinoGame]++;
  }
  const min = Math.min(...CASINO_GAME_ORDER.map(g => counts[g]));
  const candidates = CASINO_GAME_ORDER.filter(g => counts[g] === min);
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
}

// Build a fresh casino table pinned to one game, with seats / odds / pot rolled
// at creation (rollTableSetup). Release/Collect are 'special' — rolled against
// the odds table at deploy. `series` is the per-game cohort number.
export function freshCasinoTable(
  game: CasinoGame,
  series: number,
  now: number,
  rng: () => number = Math.random,
): Omit<GMMission, 'id'> {
  const setup = rollTableSetup(rng);
  return {
    type:           'casino',
    casinoGame:     game,
    series,
    label:          CASINO_GAMES[game].label,
    state:          'forming',
    baseMax:        setup.seats,
    xp:             setup.stats.xp,
    gp:             0,
    release:        'special',
    collect:        'special',
    hint:           setup.stats.hint,
    firstJoinAt:    null,
    createdAt:      now,
    participants:   {},
    variableReward: true,
    tableUrl:       '/casino/table',
    entryCosts:     casinoEntryCosts(game),
    pot:            setup.pot,
    casinoStats:    setup.stats,
    // Frozen copies of the same roll: gambits mutate casinoStats and antes grow the
    // pot, so the opening odds AND opening pot are banked or they're unrecoverable
    // (the drift display and the pot audit both diff against these).
    casinoOpenStats: { ...setup.stats },
    casinoOpenPot:   setup.pot,
  };
}

// ── Pot shares ────────────────────────────────────────────────────────────────
//
// A casino pot is measured in SEAT UNITS: one unit per seat that locked a hand at
// deploy (`casinoShareUnits`). A seat that keeps its whole hand is worth one unit;
// removing cards from a seat carves fractions off it, and where those fractions go
// is the entire difference between a void and a kick.
//
//   VOID  — the slot is killed outright. Its fraction is RELEASED: it rejoins the
//           split by shrinking the denominator, so every survivor's share grows.
//           Tracked cumulatively on the mission as `casinoVoidedShare`.
//   KICK  — the slot survives as a claimable slot. Its fraction is RESERVED: it
//           stays in the denominator, and is paid only to a player who claims it.
//           Unclaimed at settle, it is simply never paid — the pot underpays
//           rather than rewarding the seats that happened to stay.
//
// So: denominator D = casinoShareUnits − casinoVoidedShare, unit U = pot / D, and
// a recipient is paid `weight × U`. Total paid ≤ pot, with the shortfall being
// exactly the unclaimed kick reserve.

/** Pot weight a participant holds from slots they CLAIMED (each carries its own fraction). */
export function claimedWeight(p: GMParticipant): number {
  return (p.slots ?? [])
    .filter(s => s && s.claimed)
    .reduce((sum, s) => sum + (s.claimedFraction ?? 0), 0);
}

/** How much of one seat unit a participant is owed: their own surviving cards plus anything they claimed. */
export function seatPotWeight(p: GMParticipant): number {
  const slots  = (p.slots ?? []).filter(Boolean);
  const owned  = slots.filter(s => !s.claimed).length;
  // `lockedCount` is stamped at lock; pre-change tables fall back to their current
  // owned count, which reads as a full unit — the same share they'd have had before.
  const denom  = p.lockedCount && p.lockedCount > 0 ? p.lockedCount : owned;
  const ownW   = denom > 0 ? owned / denom : 0;
  return ownW + claimedWeight(p);
}

/** Seats that take a cut at settle: anyone who locked a hand, plus pure claimants. */
export function potRecipients(m: GMMission): GMParticipant[] {
  return Object.values(m.participants ?? {})
    .filter(p => p.played || claimedWeight(p) > 0);
}

/**
 * The denominator: seat units banked at deploy, less everything voids have
 * released. Falls back to the recipient count for tables that deployed before
 * `casinoShareUnits` existed, which reproduces the old even split exactly.
 */
export function casinoShareDenominator(m: GMMission): number {
  const banked = m.casinoShareUnits ?? potRecipients(m).filter(p => p.played).length;
  return Math.max(0, banked - (m.casinoVoidedShare ?? 0));
}

/**
 * Split a casino pot across weighted recipients. Each is floored, then the
 * rounding leftover goes to one recipient chosen at random so the paid portion
 * never leaks a gold — but the leftover is bounded by what the weights actually
 * earn, so an unclaimed kick reserve stays unpaid instead of being handed out.
 */
export function casinoPotShares(
  pot: number,
  weights: Map<string, number>,
  denominator: number,
  rng: () => number = Math.random,
): Map<string, number> {
  const shares = new Map<string, number>();
  const ids    = [...weights.keys()];
  if (pot <= 0 || denominator <= 0) {
    for (const id of ids) shares.set(id, 0);
    return shares;
  }

  // The whole pot is only on the table when the weights account for every unit;
  // any reserved-but-unclaimed weight simply never becomes gold.
  const paidWeight = ids.reduce((sum, id) => sum + Math.max(0, weights.get(id) ?? 0), 0);
  // Guard against minting. Weights should never outrun the denominator, but a
  // legacy table or a data repair can leave them inconsistent — and dividing by
  // the smaller number would pay out more gold than the pot holds. Falling back to
  // the weight total distributes the pot proportionally instead, which is wrong by
  // at most a rounding step and can never create gold.
  const divisor = Math.max(denominator, paidWeight);
  const payable = Math.min(pot, Math.round((pot * paidWeight) / divisor));

  let handed = 0;
  for (const id of ids) {
    const w = Math.max(0, weights.get(id) ?? 0);
    const g = Math.floor((pot * w) / divisor);
    shares.set(id, g);
    handed += g;
  }

  const leftover = payable - handed;
  if (leftover > 0 && ids.length > 0) {
    const idx = Math.min(ids.length - 1, Math.floor(rng() * ids.length));
    shares.set(ids[idx], (shares.get(ids[idx]) ?? 0) + leftover);
  }
  return shares;
}

/** The weights → shares pipeline for a whole table, as settlement uses it. */
export function casinoTableShares(m: GMMission, rng: () => number = Math.random): Map<string, number> {
  const weights = new Map<string, number>();
  for (const p of potRecipients(m)) weights.set(p.playerId, seatPotWeight(p));
  return casinoPotShares(m.pot ?? 0, weights, casinoShareDenominator(m), rng);
}

/**
 * The pre-settlement ESTIMATE of one seat's cut — a floor split of the current
 * pot across the seats expected to take a share. Display only: it assumes a
 * full one-unit seat (no voids, no claims) and the pot is still growing as
 * later seats ante in, so it is a floor, not a promise. `casinoTableShares` is
 * the real math. Shared so the pot chip and the play readout can't drift.
 */
export function estimatedSeatShare(pot: number, seats: number): number {
  return pot > 0 && seats > 0 ? Math.floor(pot / seats) : 0;
}

// What a seat actually paid at this table, read back off the audit log rather
// than re-derived from `seatSpend`: the log is the only record that captures the
// optional spends (reroll, Hold 'Em play-on) *and* gambit gold — including a
// penalty gambit's payout, which arrives as a negative `amount` and correctly
// reduces the total. Used for the settle ledger's Entries column.
export function casinoSeatPaid(m: GMMission, uid: string): number {
  let paid = 0;
  for (const e of Object.values(m.casinoLog ?? {})) {
    if (e.uid === uid) paid += e.amount ?? 0;
  }
  return paid;
}

export function fmtClock(totalSec: number): string {
  const s  = Math.max(0, Math.floor(totalSec));
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

// Day-aware duration for long-running clocks (elapsed / deployed-ago / since-
// report). Renders `d HH:mm` once past 24h (e.g. "2d 14:03") and drops the day
// segment below it, reading as plain "HH:mm". Seconds are omitted — these clocks
// span hours to days, unlike the short countdowns that stay on fmtClock.
export function fmtDayClock(totalSec: number): string {
  const s   = Math.max(0, Math.floor(totalSec));
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}`;
}

// ── Game titles the host has already had to source ────────────────────────────
//
// The host installs an APworld for every game a config asks for, so when
// verifying a table's uploads the useful question is "have I had to source this
// one before?". A mission counts as having sourced its games once its room
// actually exists — an in-progress table WITH a link, or a finished one. A
// forming table contributes nothing: nothing has been generated, seats can still
// be voided, and its games are still hypothetical.
//
// Titles are folded exactly as StatsPage folds them — case- and whitespace-
// insensitive, and nothing fuzzier. On a casino seat `slot.game` is lifted
// verbatim from the config's `game:` field by parseApYaml, and AP itself demands
// an exact APworld-name match, so two titles differing by more than case or
// spacing are two different games.

export const foldGameTitle = (raw: string) => raw.trim().replace(/\s+/g, ' ');
export const gameTitleKey  = (raw: string) => foldGameTitle(raw).toLowerCase();

/** Has this mission reached the point where its games had to be downloaded? */
export function hasSourcedGames(m: GMMission): boolean {
  return m.state === 'complete' || (m.state === 'inprogress' && !awaitingRoom(m));
}

/**
 * Folded titles of every game running on — or finished on — a sourced mission
 * other than `excludeId`. Pass the union of `missions` and `missionsHistory`:
 * `archivedMission` stamps `state: 'complete'`, so both nodes filter identically.
 *
 * Claimable slots are counted alongside seated ones: a claimable slot was carved
 * off a live seat on a table that already has a room, so its game is downloaded
 * whether or not anybody has taken it over.
 */
export function sourcedGameTitles(missions: Iterable<GMMission>, excludeId?: string): Set<string> {
  const seen = new Set<string>();
  const add = (slots: AdvSlot[]) => {
    for (const s of slots) {
      const key = gameTitleKey(s.game ?? '');
      if (key) seen.add(key);
    }
  };
  for (const m of missions) {
    if (m.id === excludeId || !hasSourcedGames(m)) continue;
    for (const p of Object.values(m.participants ?? {})) add(normalizeSlots(p.slots));
    for (const [, entry] of claimEntries(m)) add(entry.slots);
  }
  return seen;
}

/**
 * Games in one uploaded config that no other sourced mission has asked for yet —
 * i.e. APworlds the host must go and download before this room can be generated.
 * Returned as display titles, deduped within the file, so an empty array means
 * "nothing new here".
 *
 * A weighted `game:` block can't be pinned to one world, so its viable candidates
 * are judged individually: if any is unsourced the roll may still land on a
 * download, and the title is marked "(?)" to say it's a maybe rather than a
 * certainty. A weighted block with no viable option resolves to no candidates and
 * is ignored — that file is broken in a way `parseApYaml` already reports.
 */
export function newGamesInYaml(text: string, sourced: Set<string>): string[] {
  const out = new Map<string, string>();   // folded key → display title
  for (const s of parseApYaml(text).slots) {
    for (const t of s.randomized ? (s.candidates ?? []) : [s.game]) {
      const key = gameTitleKey(t);
      if (!key || sourced.has(key) || out.has(key)) continue;
      out.set(key, foldGameTitle(t) + (s.randomized ? ' (?)' : ''));
    }
  }
  return [...out.values()];
}

// Thin wrappers over the shared slot-completion core (slotHelpers.ts). Missions
// count a slotless participant as unfinished (no hand locked yet); tiles skip a
// slotless adventurer. Kept as named exports so existing imports/tests are stable.
export function hasUnfinishedSlots(participants: Record<string, GMParticipant>): number {
  return countUnfinishedSets(Object.values(participants), true);
}

export function hasUnfinishedTileSlots(adv: { slots?: AdvSlot[] }[]): number {
  return countUnfinishedSets(adv, false);
}
