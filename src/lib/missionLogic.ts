import type { GMMission, GMMissionType, GMParticipant, AdvSlot, CasinoGame } from '../types';
import { MISSION_DEFS, CASINO_START_STATS, CASINO_MIN_ENLIST_GOLD, toRoman } from './constants';
import { CASINO_GAMES, CASINO_GAME_ORDER } from './casinoData';
import { rollTableSetup } from './casinoEngine';
import type { TriState } from '../types';

export type GMMissionStatus = 'open' | 'filling' | 'inprogress';

export interface GMMissionCard {
  key:             string;
  mission:         GMMission;
  def:             typeof MISSION_DEFS[string];
  status:          GMMissionStatus;
  maxSlots:        number;
  filled:          number;
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

export function filledCount(m: GMMission): number {
  return Object.keys(m.participants ?? {}).length;
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
  activeMissionId: string | null,
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
  } else if (activeMissionId && activeMissionId !== m.id) {
    disabledReason = `You are already undertaking another mission. A guildmaster may only undertake one mission at a time.`;
  } else if (m.type === 'casino' && filled >= maxSlots && !youIn) {
    disabledReason = 'All seats are taken — waiting for players to lock in at the card table.';
  } else if (m.type === 'casino' && playerGold != null && playerGold < CASINO_MIN_ENLIST_GOLD && !youIn) {
    disabledReason = `You need at least ${CASINO_MIN_ENLIST_GOLD}g to ante up — that's the cheapest table on the floor.`;
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
  };
}

// Split a casino pot evenly among the winning (played) seats at settle. The
// floor-division remainder (0..winners−1 gold) goes to one seat chosen at random
// so the whole pot is always paid out and never leaks. Empty winners → no split.
export function casinoPotShares(
  pot: number,
  winnerIds: string[],
  rng: () => number = Math.random,
): Map<string, number> {
  const shares = new Map<string, number>();
  const n = winnerIds.length;
  if (n === 0 || pot <= 0) {
    for (const id of winnerIds) shares.set(id, 0);
    return shares;
  }
  const base = Math.floor(pot / n);
  const rem  = pot - base * n;
  const remIdx = Math.min(n - 1, Math.floor(rng() * n));
  winnerIds.forEach((id, i) => shares.set(id, base + (i === remIdx ? rem : 0)));
  return shares;
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

export function hasUnfinishedSlots(participants: Record<string, GMParticipant>): number {
  let count = 0;
  for (const p of Object.values(participants)) {
    if (!p.slots || p.slots.length === 0) {
      count++;
      continue;
    }
    for (const slot of p.slots) {
      if (!slot || !slot.status || slot.status === 'Unstarted' || slot.status === 'In-Progress') {
        count++;
        break;
      }
    }
  }
  return count;
}

export function hasUnfinishedTileSlots(adv: { slots?: AdvSlot[] }[]): number {
  let count = 0;
  for (const a of adv) {
    if (!a.slots || a.slots.length === 0) continue;
    for (const slot of a.slots) {
      if (!slot || !slot.status || slot.status === 'Unstarted' || slot.status === 'In-Progress') {
        count++;
        break;
      }
    }
  }
  return count;
}
