import { describe, it, expect } from 'vitest';
import { slotsAllFree, countUnfinishedSets } from '../../src/lib/slotHelpers';
import { awaitingRoom, hasUnfinishedSlots, hasUnfinishedTileSlots, computeMissionCard, currentMaxSlots, seatTally } from '../../src/lib/missionLogic';
import { missionClaimCapacity } from '../../src/lib/gameLogic';
import type { AdvSlot, GMMission, GMParticipant, Player } from '../../src/types';

const slot = (status?: AdvSlot['status']): AdvSlot => ({ name: 'n', game: 'g', ...(status ? { status } : {}) });

describe('slotsAllFree', () => {
  it('is false for an empty slot list (nothing played yet)', () => {
    expect(slotsAllFree([])).toBe(false);
    expect(slotsAllFree(undefined)).toBe(false);
  });

  it('is true only when every slot is terminal (100%/Goaled/Done)', () => {
    expect(slotsAllFree([slot('Goaled'), slot('Done'), slot('100%')])).toBe(true);
    expect(slotsAllFree([slot('Goaled'), slot('In-Progress')])).toBe(false);
    expect(slotsAllFree([slot('Goaled'), slot()])).toBe(false); // missing status ≠ free
    expect(slotsAllFree([slot('Unstarted')])).toBe(false);
  });
});

describe('countUnfinishedSets vs the mission/tile wrappers', () => {
  const finished = { slots: [slot('Done')] };
  const midway   = { slots: [slot('Done'), slot('In-Progress')] };
  const empty    = { slots: [] as AdvSlot[] };

  it('missions count a slotless participant as unfinished; tiles do not', () => {
    expect(countUnfinishedSets([finished, midway, empty], true)).toBe(2);  // midway + empty
    expect(countUnfinishedSets([finished, midway, empty], false)).toBe(1); // midway only
  });

  it('the named wrappers preserve those semantics', () => {
    const parts: Record<string, GMParticipant> = {
      a: { playerId: 'a', playerName: 'A', joinedAt: 0, slots: [slot('Done')] },
      b: { playerId: 'b', playerName: 'B', joinedAt: 0, slots: [slot('In-Progress')] },
      c: { playerId: 'c', playerName: 'C', joinedAt: 0 }, // no slots
    };
    expect(hasUnfinishedSlots(parts)).toBe(2);   // b + c
    expect(hasUnfinishedTileSlots([finished, midway, empty])).toBe(1); // midway only
  });
});

describe('missionClaimCapacity', () => {
  it('is 1 by default (guildmaster; advisor is S2)', () => {
    expect(missionClaimCapacity({ id: 'p' } as Player)).toBe(1);
  });
});

describe('seatTally — the displayed seat count', () => {
  const HOUR = 3600_000;
  // A casino table decays every 36h and waits for every seat to lock in, so it can
  // sit at baseMax while the cap keeps sliding under it — the "7/6" case.
  const table = (baseMax: number, seats: number, firstJoinAt: number | null): GMMission => ({
    id: 'c1', type: 'casino', series: 1, label: 'Casino', state: 'forming',
    baseMax, xp: 0, gp: 0, release: 'off', collect: 'off', hint: 0,
    firstJoinAt, createdAt: 0,
    participants: Object.fromEntries(
      Array.from({ length: seats }, (_, i) => [`p${i}`, { playerId: `p${i}`, playerName: `P${i}`, joinedAt: 0 }]),
    ),
  });

  it('reports the plain cap while decay is still above the fill count', () => {
    const t = seatTally(table(7, 3, 0), 40 * HOUR);   // one decay step: cap 6
    expect(t.label).toBe('3/6');
    expect(t.over).toBe(false);
  });

  it('floors the shown max at the fill count and stars it, instead of "7/6"', () => {
    const m = table(7, 7, 0);
    const now = 40 * HOUR;
    expect(currentMaxSlots(m, now)).toBe(6);          // the cap really did drop
    const t = seatTally(m, now);
    expect(t.label).toBe('7/7*');
    expect(t.max).toBe(7);
    expect(t.over).toBe(true);
  });

  it('never stars a table that has not decayed past its fill', () => {
    expect(seatTally(table(6, 6, null), 0).label).toBe('6/6');
  });
});

describe('awaitingRoom — deployed but no room generated yet', () => {
  const m = (over: Partial<GMMission>): GMMission => ({
    id: 'm1', type: 'patrol', series: 1, label: 'Patrol', state: 'forming',
    baseMax: 4, xp: 10, gp: 10, release: 'off', collect: 'off', hint: 0,
    firstJoinAt: null, createdAt: 0, participants: {}, ...over,
  });

  it('is true once deployed with no link — the gap between deploy and generation', () => {
    expect(awaitingRoom(m({ state: 'inprogress' }))).toBe(true);
    expect(awaitingRoom(m({ state: 'inprogress', link: '' }))).toBe(true);
  });

  it('is false the moment a room link exists', () => {
    expect(awaitingRoom(m({ state: 'inprogress', link: 'https://archipelago.gg/room/x' }))).toBe(false);
  });

  it('is false for a linkless FORMING cohort — it has no room because it has not dealt in', () => {
    expect(awaitingRoom(m({ state: 'forming' }))).toBe(false);
    expect(awaitingRoom(m({ state: 'complete' }))).toBe(false);
  });

  // The trap: computeMissionCard reports status 'inprogress' for a full-but-forming
  // cohort, so keying the notice off card.status would tell a table that hasn't
  // deployed that its room is late. awaitingRoom reads m.state instead.
  it('stays false for a full forming cohort that already reports status "inprogress"', () => {
    const full = m({
      baseMax: 2, firstJoinAt: 0,
      participants: {
        a: { playerId: 'a', playerName: 'A', joinedAt: 0 },
        b: { playerId: 'b', playerName: 'B', joinedAt: 0 },
      },
    });
    expect(computeMissionCard(full, 'a', 0, 1, false, 1_000).status).toBe('inprogress');
    expect(awaitingRoom(full)).toBe(false);
  });
});

describe('computeMissionCard — pooled-claim gating', () => {
  const baseMission = (): GMMission => ({
    id: 'm1', type: 'patrol', series: 1, label: 'Patrol', state: 'forming',
    baseMax: 4, xp: 10, gp: 10, release: 'off', collect: 'off', hint: 0,
    firstJoinAt: null, createdAt: 0, participants: {},
  });
  const now = 1_000;

  it('is takeable when the player holds a free claim', () => {
    const card = computeMissionCard(baseMission(), 'me', 0, 1, false, now);
    expect(card.takeable).toBe(true);
    expect(card.disabledReason).toBeNull();
  });

  it('is blocked (no free claim) when held claims meet capacity and you are not in it', () => {
    const card = computeMissionCard(baseMission(), 'me', 1, 1, false, now);
    expect(card.takeable).toBe(false);
    expect(card.disabledReason).toMatch(/free your claim|claims are in use/i);
  });

  it('does not block your OWN enlisted card even at capacity', () => {
    const m = baseMission();
    m.participants = { me: { playerId: 'me', playerName: 'Me', joinedAt: 0 } };
    const card = computeMissionCard(m, 'me', 1, 1, false, now);
    expect(card.youIn).toBe(true);
    expect(card.doneLabel).toBe('YOU ARE ENLISTED');
    expect(card.takeable).toBe(false);
  });
});
