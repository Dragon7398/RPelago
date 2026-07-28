import { describe, it, expect } from 'vitest';
import { slotsAllFree, countUnfinishedSets } from '../../src/lib/slotHelpers';
import { hasUnfinishedSlots, hasUnfinishedTileSlots, computeMissionCard } from '../../src/lib/missionLogic';
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
