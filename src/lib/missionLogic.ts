import type { GMMission, GMMissionType, GMParticipant, AdvSlot } from '../types';
import { MISSION_DEFS, ROMAN_NUMERALS } from './constants';
import type { TriState } from '../types';

export type GMMissionStatus = 'open' | 'filling' | 'inprogress';

export interface GMMissionCard {
  key:          string;
  mission:      GMMission;
  def:          typeof MISSION_DEFS[string];
  status:       GMMissionStatus;
  maxSlots:     number;
  filled:       number;
  decaySteps:   number;
  decayPct:     number;
  liveSec:      number;
  youIn:        boolean;
  seriesLabel:  string;
  takeable:     boolean;
  disabledReason: string | null;
  doneLabel:    string | null;
}

export function currentMaxSlots(m: GMMission, now: number): number {
  if (m.firstJoinAt == null) return m.baseMax;
  const steps = Math.floor((now - m.firstJoinAt) / (24 * 3600_000));
  return Math.max(1, m.baseMax - steps);
}

export function filledCount(m: GMMission): number {
  return Object.keys(m.participants ?? {}).length;
}

export function shouldDeploy(m: GMMission, now: number): boolean {
  return m.state === 'forming'
    && filledCount(m) > 0
    && filledCount(m) >= currentMaxSlots(m, now);
}

export function missionDisplayLabel(m: GMMission): string {
  const roman = ROMAN_NUMERALS[m.series] ?? String(m.series);
  return `${m.label} · Cohort ${roman}`;
}

export function computeMissionCard(
  m: GMMission,
  uid: string | null,
  activeMissionId: string | null,
  basicTrainingDone: boolean,
  now: number,
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
    status = 'inprogress';
  } else {
    status = 'filling';
  }

  const decaySteps = m.firstJoinAt != null
    ? Math.floor((now - m.firstJoinAt) / (24 * 3600_000))
    : 0;

  const hoursIntoWindow = m.firstJoinAt != null
    ? ((now - m.firstJoinAt) % (24 * 3600_000)) / 3600_000
    : 0;

  const decayPct = status === 'filling' ? hoursIntoWindow / 24 : (status === 'open' ? 0 : 1);
  const liveSec  = status === 'filling'
    ? (24 - hoursIntoWindow) * 3600
    : (24 - hoursIntoWindow) * 3600;

  const roman = ROMAN_NUMERALS[m.series] ?? String(m.series);
  const seriesLabel = `COHORT ${roman}`;

  let takeable = false;
  let disabledReason: string | null = null;
  let doneLabel: string | null = null;

  if (m.state === 'inprogress') {
    disabledReason = 'This cohort has already deployed. A fresh cohort is forming below.';
  } else if (def.special && basicTrainingDone && !youIn) {
    doneLabel = 'ALREADY COMPLETED';
    disabledReason = 'You have already completed Basic Training — it can be undertaken only once per guildmaster.';
  } else if (activeMissionId && activeMissionId !== m.id) {
    disabledReason = `You are already undertaking another mission. A guildmaster may only undertake one mission at a time.`;
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
    ...(def.traits ? { traits: { ...def.traits } } : {}),
    release:      def.release as TriState,
    collect:      def.collect as TriState,
    hint:         def.hint,
    firstJoinAt:  null,
    createdAt:    now,
    participants: {},
  };
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
      if (!slot.status || slot.status === 'Unstarted' || slot.status === 'In-Progress') {
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
      if (!slot.status || slot.status === 'Unstarted' || slot.status === 'In-Progress') {
        count++;
        break;
      }
    }
  }
  return count;
}
