import { describe, it, expect } from 'vitest';
import { slotsAllFree, countUnfinishedSets, normalizeClaimEntry, claimableCount } from '../../src/lib/slotHelpers';
import { awaitingRoom, hasUnfinishedSlots, hasUnfinishedTileSlots, computeMissionCard, currentMaxSlots, seatTally } from '../../src/lib/missionLogic';
import { missionClaimCapacity, playerStatus, releasesClaimsEarly, claimActivity, comparePlayersForAdmin } from '../../src/lib/gameLogic';
import type { Tile } from '../../src/types';
import type { AdvSlot, ClaimableEntry, GMMission, GMParticipant, Player } from '../../src/types';

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

  it('tells a RESTRICTED player the truth about why their claim is stuck', () => {
    // The default copy says "finish your part of it to free your claim" — which is
    // exactly the thing that no longer works for a restricted player.
    const plain = computeMissionCard(baseMission(), 'me', 1, 1, false, now, undefined, false);
    expect(plain.disabledReason).toMatch(/finish your part/i);
    const restricted = computeMissionCard(baseMission(), 'me', 1, 1, false, now, undefined, true);
    expect(restricted.takeable).toBe(false);
    expect(restricted.disabledReason).toMatch(/restricted/i);
    expect(restricted.disabledReason).toMatch(/whole mission finishes/i);
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

// ── Claimable entries ─────────────────────────────────────────────────────────
// Two shapes exist on the wire: the legacy/non-casino bare AdvSlot[], and the
// casino ClaimableEntry that also carries the card (its gold value survives
// nowhere else once the seat is gone) and the pot fraction the slot is worth.
// Every reader goes through the normalizer, so a table kicked before the shape
// change must still render and still be claimable.
describe('normalizeClaimEntry', () => {
  it('reads a legacy bare array as slots with no card or fraction', () => {
    const e = normalizeClaimEntry([slot('Goaled')]);
    expect(e.slots).toHaveLength(1);
    expect(e.card).toBeUndefined();
    expect(e.potFraction).toBeUndefined();
  });

  it('preserves the card and fraction on a casino entry', () => {
    const e = normalizeClaimEntry({
      slots: [slot('In-Progress')],
      card: { uid: 3, name: 'SNES', value: 20, type: 'platform' },
      potFraction: 0.25,
      fromPlayerName: 'Quitter',
    } as ClaimableEntry);
    expect(e.card?.value).toBe(20);
    expect(e.potFraction).toBe(0.25);
    expect(e.fromPlayerName).toBe('Quitter');
  });

  it('handles Firebase object-keyed slot arrays and absent entries', () => {
    expect(normalizeClaimEntry({ slots: { 0: slot(), 1: slot() } } as unknown as ClaimableEntry).slots).toHaveLength(2);
    expect(normalizeClaimEntry(undefined).slots).toEqual([]);
  });
});

describe('claimableCount', () => {
  it('counts open spots regardless of entry shape', () => {
    const m = {
      claimableSlots: {
        a: [slot()],
        b: { slots: [slot()], potFraction: 0.5 },
      },
    } as unknown as GMMission;
    expect(claimableCount(m)).toBe(2);
    expect(claimableCount({} as GMMission)).toBe(0);
  });
});

// ── Player status ─────────────────────────────────────────────────────────────
// Three states over two independent wire flags. The whole point of `restricted`
// is that it changes exactly one thing — whether a claim comes back early — so
// these pin both the derivation and the gate the release sites call.
describe('playerStatus', () => {
  const p = (over: Partial<Player>): Player => ({ id: 'p', ...over } as Player);

  it('is active when neither flag is set', () => {
    expect(playerStatus(p({}))).toBe('active');
    expect(playerStatus(undefined)).toBe('active');
    expect(playerStatus(null)).toBe('active');
  });

  it('reads each flag', () => {
    expect(playerStatus(p({ restricted: true }))).toBe('restricted');
    expect(playerStatus(p({ disabled: true }))).toBe('disabled');
  });

  it('lets disabled outrank restricted, so a legacy both-set record still reads as blocked', () => {
    expect(playerStatus(p({ disabled: true, restricted: true }))).toBe('disabled');
  });
});

describe('releasesClaimsEarly — the one thing restricted changes', () => {
  const p = (over: Partial<Player>): Player => ({ id: 'p', ...over } as Player);

  it('is true for everyone but a restricted player', () => {
    expect(releasesClaimsEarly(p({}))).toBe(true);
    expect(releasesClaimsEarly(p({ disabled: true }))).toBe(true);
    expect(releasesClaimsEarly(undefined)).toBe(true);
  });

  it('is false for a restricted player — their claim waits for the world to resolve', () => {
    expect(releasesClaimsEarly(p({ restricted: true }))).toBe(false);
  });

  // The gate is independent of slot state: a restricted player's slots still go
  // terminal, they just don't buy the claim back. Nothing about slotsAllFree moves.
  it('does not change what counts as a finished slot set', () => {
    expect(slotsAllFree([slot('Done'), slot('Goaled')])).toBe(true);
  });
});

// ── Admin roster ordering ─────────────────────────────────────────────────────
describe('claimActivity — the admin Players page tier', () => {
  const pl = (over: Partial<Player>): Player => ({ id: 'me', displayName: 'Me', ...over } as Player);
  const seated = (state: GMMission['state']): Record<string, GMMission> => ({
    m1: {
      id: 'm1', type: 'patrol', series: 1, label: 'Patrol', state,
      baseMax: 4, xp: 0, gp: 0, release: 'off', collect: 'off', hint: 0,
      firstJoinAt: 0, createdAt: 0,
      participants: { me: { playerId: 'me', playerName: 'Me', joinedAt: 0 } },
    },
  });

  it('is "none" for a player who has done nothing this season', () => {
    expect(claimActivity(pl({}), {})).toBe('none');
    // A live mission someone ELSE is seated at is not theirs — membership is by id.
    expect(claimActivity(pl({ id: 'nobody' }), { missions: seated('inprogress') })).toBe('none');
  });

  it('is "active" while a mission claim is held', () => {
    expect(claimActivity(pl({ activeMissions: { m1: true } }), { missions: seated('inprogress') }))
      .toBe('active');
  });

  it('is "active" while an adventurer is busy on a tile', () => {
    const p = pl({ adventurers: { a1: { id: 'a1', busy: true, busyTile: 'C2' } } as Player['adventurers'] });
    expect(claimActivity(p, {})).toBe('active');
  });

  // The one that matters: a SETTLING seat has already handed its claim back, but
  // the player is still AT that table, so they stay in the top band. The band
  // tracks the table, not the claim.
  it('keeps a settling seat in "active" even with the claim already returned', () => {
    expect(claimActivity(pl({}), { missions: seated('inprogress') })).toBe('active');
    expect(claimActivity(pl({}), { missions: seated('forming') })).toBe('active');
  });

  const tileWith = (state: string) => ({
    C2: { state, adventurers: { a1: { owner: 'me', advId: 'a1' } } },
  } as unknown as Record<string, Tile>);

  it('keeps an early-released adventurer on a live tile in "active"', () => {
    // busy/busyTile are cleared, so only the tile's own state can say they are
    // still on it.
    expect(claimActivity(pl({}), { tiles: tileWith('inprogress') })).toBe('active');
    expect(claimActivity(pl({}), { tiles: tileWith('available') })).toBe('active');
  });

  it('is "settled" once the table or tile is finished', () => {
    expect(claimActivity(pl({}), { missionsHistory: seated('complete') })).toBe('settled');
    expect(claimActivity(pl({}), { tiles: tileWith('complete') })).toBe('settled');
  });
});

describe('comparePlayersForAdmin', () => {
  const pl = (id: string, handle: string, over: Partial<Player> = {}): Player =>
    ({ id, displayName: handle, discordHandle: handle, ...over } as Player);
  const history: Record<string, GMMission> = {
    h1: {
      id: 'h1', type: 'patrol', series: 1, label: 'Patrol', state: 'complete',
      baseMax: 4, xp: 0, gp: 0, release: 'off', collect: 'off', hint: 0,
      firstJoinAt: 0, createdAt: 0,
      participants: { veteran: { playerId: 'veteran', playerName: 'veteran', joinedAt: 0 } },
    },
  };

  it('ranks active over settled over none, then falls back to name', () => {
    const busy    = pl('busy', 'aaa-busy', { activeMissions: { m1: true } });
    const veteran = pl('veteran', 'zzz-veteran');
    const rookie  = pl('rookie', 'bbb-rookie');
    const order = [rookie, veteran, busy]
      .sort((a, b) => comparePlayersForAdmin(a, b, { missionsHistory: history }))
      .map(p => p.id);
    // Alphabetically this would be aaa-busy, bbb-rookie, zzz-veteran — the tier
    // is what lifts the veteran above the rookie.
    expect(order).toEqual(['busy', 'veteran', 'rookie']);
  });

  it('sorts by Discord username within a tier, falling back to display name', () => {
    const withHandle = pl('a', 'zeta');
    const noHandle   = { id: 'b', displayName: 'Alpha' } as Player;
    const order = [withHandle, noHandle]
      .sort((a, b) => comparePlayersForAdmin(a, b, {}))
      .map(p => p.id);
    expect(order).toEqual(['b', 'a']);
  });
});
