import { describe, it, expect } from 'vitest';
import {
  missionPendingAction, missionReadyToComplete, tileReadyToComplete, missionSettleBlockers,
  seatsMissingConfig, seatsAwaitingConfig,
  seatOwesConfig, outstandingConfigsBlockRoom, missionClockOrigin, compareMissionsForAdmin,
  holdPinned, hasUnfinishedSlots,
} from '../../src/lib/missionLogic';
import type { AdvSlot, GMMission, GMMissionState, GMMissionType, GMParticipant, Tile } from '../../src/types';

const HOUR = 3600_000;
const slot = (status?: AdvSlot['status']): AdvSlot => ({ name: 'n', game: 'g', ...(status ? { status } : {}) });

function mission(over: Partial<GMMission> & { participants?: Record<string, GMParticipant> } = {}): GMMission {
  return {
    id: 'm1', type: 'casino' as GMMissionType, series: 1, label: 'Casino',
    state: 'forming' as GMMissionState, baseMax: 3, xp: 0, gp: 0,
    release: 'off', collect: 'off', hint: 0, createdAt: 0,
    ...over,
  } as GMMission;
}

// A seat that has locked in with an accepted config — the "nothing to chase" seat.
const seated = (id: string, over: Partial<GMParticipant> = {}): [string, GMParticipant] =>
  [id, { playerId: id, playerName: id.toUpperCase(), joinedAt: 0, played: true, slots: [slot('In-Progress')], ...over }];

const seats = (...list: [string, GMParticipant][]) => Object.fromEntries(list);

describe('seatsMissingConfig', () => {
  it('counts a seat that never locked in AND one whose config was denied', () => {
    const m = mission({ participants: seats(
      seated('a'),
      seated('b', { played: false }),        // never locked in — no YAML was ever uploaded
      seated('c', { yamlDenied: true }),     // deny deletes the file but LEAVES played true
    ) });
    expect(seatsMissingConfig(m)).toBe(2);
  });

  it('is zero for a non-casino mission, which has no config step at all', () => {
    const m = mission({ type: 'patrol', participants: seats(seated('a', { played: false })) });
    expect(seatsMissingConfig(m)).toBe(0);
  });
});

describe('seatOwesConfig — the pure-claimant exception', () => {
  // Claiming adopts a live slot off a vacated seat: no ante, no deal, nothing to
  // submit. claimMissionSlot writes the participant with `played` left unset, and
  // it stays unset forever — so a naive `played !== true` accuses every claimant.
  const claimedSlot = (): AdvSlot => ({ ...slot('In-Progress'), claimed: true });

  it('does not accuse a seat holding only claimed slots', () => {
    expect(seatOwesConfig({ playerId: 'z', playerName: 'Z', joinedAt: 0, slots: [claimedSlot()] })).toBe(false);
  });

  it('still accuses a seat that played AND claimed, if its own config was denied', () => {
    expect(seatOwesConfig({
      playerId: 'z', playerName: 'Z', joinedAt: 0, played: true, yamlDenied: true,
      slots: [slot('In-Progress'), claimedSlot()],
    })).toBe(true);
  });

  it('accuses a seat with no slots at all — it simply never locked in', () => {
    expect(seatOwesConfig({ playerId: 'z', playerName: 'Z', joinedAt: 0 })).toBe(true);
  });

  it('keeps a claimant out of the pending count on a live table', () => {
    const m = mission({ state: 'inprogress', link: 'r', participants: seats(
      seated('a'),
      ['claimant', { playerId: 'claimant', playerName: 'C', joinedAt: 0, slots: [claimedSlot()] }],
    ) });
    expect(seatsMissingConfig(m)).toBe(0);
    expect(missionPendingAction(m, 0)).toBeNull();
  });
});

describe('seatsAwaitingConfig — the roster the YAML view renders', () => {
  it('lists both holes and sorts denials first', () => {
    const m = mission({ participants: seats(
      seated('a'),
      seated('b', { played: false }),
      seated('c', { yamlDenied: true, yamlDeniedReason: 'PB 0' }),
    ) });
    expect(seatsAwaitingConfig(m).map(x => [x.playerId, x.reason]))
      .toEqual([['c', 'denied'], ['b', 'unsubmitted']]);
  });

  it('is empty for a non-casino mission, which has no config step', () => {
    expect(seatsAwaitingConfig(mission({ type: 'patrol', participants: seats(seated('a', { played: false })) })))
      .toEqual([]);
  });
});

describe('outstandingConfigsBlockRoom — warning vs error', () => {
  const short = (over = {}) => mission({ baseMax: 3, participants: seats(
    seated('a'), seated('b', { played: false }),
  ), ...over });

  it('is only a warning while seats are still open — the room could not be made anyway', () => {
    expect(outstandingConfigsBlockRoom(short(), 0)).toBe(false);
  });

  it('becomes blocking the moment the table is full', () => {
    const full = mission({ baseMax: 2, participants: seats(seated('a'), seated('b', { played: false })) });
    expect(outstandingConfigsBlockRoom(full, 0)).toBe(true);
  });

  it('becomes blocking by decay alone, with nobody joining', () => {
    // Same two seats, baseMax 3: one 36h casino decay step closes the third seat.
    const m = short({ firstJoinAt: 0 });
    expect(outstandingConfigsBlockRoom(m, 0)).toBe(false);
    expect(outstandingConfigsBlockRoom(m, 40 * HOUR)).toBe(true);
  });

  it('is blocking on a live table whatever its fill — the room is already out', () => {
    const live = mission({ state: 'inprogress', baseMax: 9, link: 'r', participants: seats(
      seated('a'), seated('b', { yamlDenied: true }),
    ) });
    expect(outstandingConfigsBlockRoom(live, 0)).toBe(true);
  });

  it('is false when nothing is outstanding at all', () => {
    expect(outstandingConfigsBlockRoom(mission({ baseMax: 1, participants: seats(seated('a')) }), 0)).toBe(false);
  });
});

describe('missionReadyToComplete', () => {
  it('needs every seat to have slots and every slot terminal', () => {
    expect(missionReadyToComplete(mission({ participants: seats(
      seated('a', { slots: [slot('Done'), slot('Goaled')] }),
    ) }))).toBe(true);
    expect(missionReadyToComplete(mission({ participants: seats(
      seated('a', { slots: [slot('Done')] }),
      seated('b', { slots: [slot('In-Progress')] }),
    ) }))).toBe(false);
  });

  it('does NOT count 100% as terminal — that world may still owe items to others', () => {
    expect(missionReadyToComplete(mission({ participants: seats(
      seated('a', { slots: [slot('100%')] }),
    ) }))).toBe(false);
  });

  it('is false for a seat with no slots, and for an empty cohort', () => {
    expect(missionReadyToComplete(mission({ participants: seats(seated('a', { slots: [] })) }))).toBe(false);
    expect(missionReadyToComplete(mission({ participants: {} }))).toBe(false);
  });

  // An unanswered kick leaves a live Archipelago slot nobody is playing, so the
  // ROOM is unfinished even when every seated player is done.
  describe('outstanding claimable slots', () => {
    const doneSeats = seats(seated('a', { slots: [slot('Done'), slot('Goaled')] }));
    const ready = (claimableSlots: GMMission['claimableSlots']) =>
      missionReadyToComplete(mission({ participants: doneSeats, claimableSlots }));

    it('blocks on an ungoaled open slot', () => {
      expect(ready({ k1: { slots: [slot('In-Progress')] } })).toBe(false);
      expect(ready({ k1: { slots: [slot('Unstarted')] } })).toBe(false);
      // 100% is not goaled here either — same rule the seats get.
      expect(ready({ k1: { slots: [slot('100%')] } })).toBe(false);
      // One bad slot in an otherwise finished entry is enough.
      expect(ready({ k1: { slots: [slot('Done'), slot('In-Progress')] } })).toBe(false);
      // …and one bad entry among several.
      expect(ready({ k1: { slots: [slot('Goaled')] }, k2: { slots: [slot('Unstarted')] } })).toBe(false);
    });

    it('does not block on an entry whose slot already goaled', () => {
      // That Archipelago slot IS finished, whatever became of the kicked player.
      expect(ready({ k1: { slots: [slot('Goaled')] } })).toBe(true);
      expect(ready({ k1: { slots: [slot('Done')] } })).toBe(true);
    });

    it('blocks on an entry advertising an opening with no slots', () => {
      expect(ready({ k1: { slots: [] } })).toBe(false);
    });

    it('is unaffected when there are no claimable slots', () => {
      expect(ready(undefined)).toBe(true);
      expect(ready({})).toBe(true);
    });

    it('reads the legacy bare-array shape too', () => {
      expect(ready({ k1: [slot('In-Progress')] })).toBe(false);
      expect(ready({ k1: [slot('Goaled')] })).toBe(true);
    });

    it('drops the ready-to-settle hint from the admin board', () => {
      const m = mission({ state: 'inprogress', participants: doneSeats, link: 'https://archipelago.gg/room/x' });
      expect(missionPendingAction(m, 0)?.code).toBe('complete');
      const withOpen = mission({
        state: 'inprogress', participants: doneSeats, link: 'https://archipelago.gg/room/x',
        claimableSlots: { k1: { slots: [slot('In-Progress')] } },
      });
      expect(missionPendingAction(withOpen, 0)).toBeNull();
    });
  });
});

describe('missionPendingAction — forming', () => {
  it('flags nothing while the table is still taking seats', () => {
    expect(missionPendingAction(mission({ baseMax: 3, participants: seats(seated('a'), seated('b')) }), 0)).toBeNull();
  });

  it('flags nothing for an empty cohort, however long it has sat', () => {
    expect(missionPendingAction(mission({ baseMax: 3, participants: {} }), 500 * HOUR)).toBeNull();
  });

  it('flags the missing configs once full, and counts them', () => {
    const p = missionPendingAction(mission({ baseMax: 2, participants: seats(
      seated('a'), seated('b', { played: false }),
    ) }), 0);
    expect(p?.code).toBe('configs');
    expect(p?.label).toBe('1 config');
  });

  it('flags a full table with every config in as ready to deploy', () => {
    const p = missionPendingAction(mission({ baseMax: 2, participants: seats(seated('a'), seated('b')) }), 0);
    expect(p?.code).toBe('deploy');
  });

  it('becomes full — and so actionable — purely by decay closing seats', () => {
    // baseMax 3, two seated: not full at t=0, but one 36h casino decay step later
    // the cap is 2 and the same table is now waiting on the host.
    const m = mission({ baseMax: 3, firstJoinAt: 0, participants: seats(seated('a'), seated('b')) });
    expect(missionPendingAction(m, 0)).toBeNull();
    expect(missionPendingAction(m, 40 * HOUR)?.code).toBe('deploy');
  });
});

describe('missionPendingAction — in progress', () => {
  const live = (over: Partial<GMMission>) => mission({ state: 'inprogress', ...over });

  it('flags a deployed cohort with no room link', () => {
    expect(missionPendingAction(live({ participants: seats(seated('a')) }), 0)?.code).toBe('generate');
  });

  it('flags an all-terminal cohort as ready to settle', () => {
    const p = missionPendingAction(live({
      link: 'https://room', participants: seats(seated('a', { slots: [slot('Done')] })),
    }), 0);
    expect(p?.code).toBe('complete');
  });

  it('flags nothing while players are simply mid-playthrough', () => {
    expect(missionPendingAction(live({ link: 'https://room', participants: seats(seated('a')) }), 0)).toBeNull();
  });

  it('reports a denial ahead of the missing room — regenerating first would be wasted', () => {
    const p = missionPendingAction(live({ participants: seats(seated('a', { yamlDenied: true })) }), 0);
    expect(p?.code).toBe('denied');
  });
});

describe('missionClockOrigin', () => {
  it('prefers the room link, then deploy, then first join, then creation', () => {
    expect(missionClockOrigin(mission({ createdAt: 1, firstJoinAt: 2, deployedAt: 3, linkedAt: 4 }))).toBe(4);
    expect(missionClockOrigin(mission({ createdAt: 1, firstJoinAt: 2, deployedAt: 3 }))).toBe(3);
    expect(missionClockOrigin(mission({ createdAt: 1, firstJoinAt: 2 }))).toBe(2);
    expect(missionClockOrigin(mission({ createdAt: 1 }))).toBe(1);
  });
});

describe('compareMissionsForAdmin', () => {
  it('floats anything waiting on the host above everything that is not', () => {
    // Fresh but stuck (full, a config missing) vs ancient but healthy (still filling).
    const stuck   = mission({ id: 'stuck',   createdAt: 100 * HOUR, baseMax: 1, participants: seats(seated('a', { played: false })) });
    const healthy = mission({ id: 'healthy', createdAt: 0,          baseMax: 9, participants: seats(seated('b')) });
    expect([healthy, stuck].sort((x, y) => compareMissionsForAdmin(x, y, 0))[0].id).toBe('stuck');
  });

  it("orders within each half by the card's own Elapsed clock, longest wait first", () => {
    const old   = mission({ id: 'old',   state: 'inprogress', deployedAt: 1 * HOUR, participants: seats(seated('a')) });
    const newer = mission({ id: 'newer', state: 'inprogress', deployedAt: 9 * HOUR, participants: seats(seated('a')) });
    // Both are 'generate' (no link), so only the clock separates them.
    expect([newer, old].sort((x, y) => compareMissionsForAdmin(x, y, 10 * HOUR)).map(m => m.id))
      .toEqual(['old', 'newer']);
  });

  it('dates a late-linked cohort by its room, not by when it deployed', () => {
    // `deployed` went live first but sat without a room; `linked` deployed later and
    // got its room immediately, so it has actually been PLAYABLE longer.
    const deployed = mission({ id: 'deployed', state: 'inprogress', deployedAt: 1 * HOUR, link: 'r', linkedAt: 8 * HOUR, participants: seats(seated('a', { slots: [slot('Done')] })) });
    const linked   = mission({ id: 'linked',   state: 'inprogress', deployedAt: 4 * HOUR, link: 'r', linkedAt: 5 * HOUR, participants: seats(seated('a', { slots: [slot('Done')] })) });
    expect([deployed, linked].sort((x, y) => compareMissionsForAdmin(x, y, 10 * HOUR)).map(m => m.id))
      .toEqual(['linked', 'deployed']);
  });
});

describe('holdPinned — the card the host is working on', () => {
  const row = (id: string) => ({ id });
  const list = () => [row('a'), row('b'), row('c'), row('d')];
  const ids = (xs: { id: string }[]) => xs.map(x => x.id);

  it('is a no-op with no pin, or an empty list', () => {
    expect(ids(holdPinned(list(), null))).toEqual(['a', 'b', 'c', 'd']);
    expect(holdPinned([], { id: 'a', index: 0 })).toEqual([]);
  });

  it('holds a card that the live sort just dropped to the bottom', () => {
    // The reported case: pasting a room link zeroes the sort key, so 'a' sorts
    // last — but the host is still typing into it, so it stays at index 0.
    const resorted = [row('b'), row('c'), row('d'), row('a')];
    expect(ids(holdPinned(resorted, { id: 'a', index: 0 }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves the list untouched when the card has not actually moved', () => {
    const l = list();
    expect(holdPinned(l, { id: 'b', index: 1 })).toBe(l);   // same reference, no copy
  });

  it('ignores a pin whose card is no longer in this list', () => {
    // Settled, or deployed into the other column: a pin holds a place, it never
    // resurrects a row.
    expect(ids(holdPinned(list(), { id: 'zz', index: 0 }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clamps an index the list has since shrunk past', () => {
    expect(ids(holdPinned([row('b'), row('a')], { id: 'a', index: 9 }))).toEqual(['b', 'a']);
    expect(ids(holdPinned([row('b'), row('a')], { id: 'a', index: -3 }))).toEqual(['a', 'b']);
  });

  it('does not mutate the array it was given', () => {
    const l = [row('b'), row('a')];
    holdPinned(l, { id: 'a', index: 0 });
    expect(ids(l)).toEqual(['b', 'a']);
  });
});

// ── tileReadyToComplete ──────────────────────────────────────────────────────
// The tile twin of the mission check, and the source of the ✓ badge on the admin
// Challenges card. Tiles carry two slot kinds a mission does not, and the inline
// predicate this replaced saw neither.

describe('tileReadyToComplete', () => {
  const adv = (owner: string, slots: AdvSlot[]) =>
    ({ advId: owner, owner, ownerName: owner.toUpperCase(), name: 'A', cls: 'warrior', slots });
  const t = (over: Partial<Tile> = {}): Tile => ({
    state: 'inprogress', required: 1, adventurers: {}, name: 'Tile',
    release: 'on', collect: 'off', hint: 0, details: '', gold: 0, xp: 0, bonusXP: 0,
    diffBonus: 0, baseRelease: 'on', baseCollect: 'off', baseHint: 0, adminOverride: false,
    link: 'x',
    ...over,
  } as Tile);

  const done = { a: adv('a', [slot('Done'), slot('Goaled')]) } as unknown as Tile['adventurers'];

  it('needs at least one adventurer, each with terminal slots', () => {
    expect(tileReadyToComplete(t({ adventurers: done }))).toBe(true);
    expect(tileReadyToComplete(t({ adventurers: {} }))).toBe(false);
    expect(tileReadyToComplete(t({
      adventurers: { a: adv('a', [slot('In-Progress')]) } as unknown as Tile['adventurers'],
    }))).toBe(false);
    expect(tileReadyToComplete(t({
      adventurers: { a: adv('a', []) } as unknown as Tile['adventurers'],
    }))).toBe(false);
  });

  it('does NOT count 100% as terminal, matching the mission rule', () => {
    expect(tileReadyToComplete(t({
      adventurers: { a: adv('a', [slot('100%')]) } as unknown as Tile['adventurers'],
    }))).toBe(false);
  });

  it('blocks on an ungoaled PUBLIC slot — the old inline check could not see these', () => {
    expect(tileReadyToComplete(t({ adventurers: done, publicSlots: [slot('In-Progress')] }))).toBe(false);
    expect(tileReadyToComplete(t({ adventurers: done, publicSlots: [slot('Unstarted')] }))).toBe(false);
    expect(tileReadyToComplete(t({ adventurers: done, publicSlots: [slot('Goaled')] }))).toBe(true);
    expect(tileReadyToComplete(t({ adventurers: done, publicSlots: [] }))).toBe(true);
  });

  it('blocks on an unclaimed vacated slot, like the mission board', () => {
    expect(tileReadyToComplete(t({ adventurers: done, claimableSlots: { k: [slot('In-Progress')] } }))).toBe(false);
    expect(tileReadyToComplete(t({ adventurers: done, claimableSlots: { k: [] } }))).toBe(false);
    // Already goaled: that Archipelago slot IS finished, whoever left it behind.
    expect(tileReadyToComplete(t({ adventurers: done, claimableSlots: { k: [slot('Goaled')] } }))).toBe(true);
    expect(tileReadyToComplete(t({ adventurers: done, claimableSlots: {} }))).toBe(true);
  });

  it('agrees with the mission rule on the shared cases', () => {
    // Both sides read the same `goaled` predicate, so a status that settles one
    // settles the other.
    for (const st of ['Done', 'Goaled'] as const) {
      expect(tileReadyToComplete(t({ adventurers: { a: adv('a', [slot(st)]) } as unknown as Tile['adventurers'] }))).toBe(true);
      expect(missionReadyToComplete(mission({ participants: seats(seated('a', { slots: [slot(st)] })) }))).toBe(true);
    }
    for (const st of ['100%', 'In-Progress', 'Unstarted'] as const) {
      expect(tileReadyToComplete(t({ adventurers: { a: adv('a', [slot(st)]) } as unknown as Tile['adventurers'] }))).toBe(false);
      expect(missionReadyToComplete(mission({ participants: seats(seated('a', { slots: [slot(st)] })) }))).toBe(false);
    }
  });
});

// ── missionSettleBlockers ────────────────────────────────────────────────────
// The Complete dialog's gate. It must agree with the board's ✓ hint, and it must
// name WHAT is unfinished — an unclaimed open slot is not a participant.

describe('missionSettleBlockers', () => {
  const doneSeat = seats(seated('a', { slots: [slot('Done'), slot('Goaled')] }));

  it('is empty when the cohort and every open slot are terminal', () => {
    expect(missionSettleBlockers(mission({ participants: doneSeat }))).toEqual({ seats: 0, open: 0, total: 0 });
    expect(missionSettleBlockers(mission({
      participants: doneSeat, claimableSlots: { k: { slots: [slot('Goaled')] } },
    }))).toEqual({ seats: 0, open: 0, total: 0 });
  });

  it('counts a seat that is not all Goaled/Done, slotless included', () => {
    expect(missionSettleBlockers(mission({ participants: seats(
      seated('a', { slots: [slot('Done')] }),
      seated('b', { slots: [slot('In-Progress')] }),
      seated('c', { slots: [] }),
    ) }))).toEqual({ seats: 2, open: 0, total: 2 });
  });

  it('counts a 100% seat — unlike hasUnfinishedSlots, which frees its CLAIM', () => {
    // FREE_COMPLETED_STATUSES calls 100% finished because the player may take
    // another world. Settlement asks a different question: that seat can still
    // owe items to the rest of the room.
    expect(missionSettleBlockers(mission({
      participants: seats(seated('a', { slots: [slot('100%')] })),
    }))).toEqual({ seats: 1, open: 0, total: 1 });
    expect(hasUnfinishedSlots(seats(seated('a', { slots: [slot('100%')] })))).toBe(0);
  });

  it('counts unclaimed open slots separately from seats', () => {
    const b = missionSettleBlockers(mission({
      participants: seats(seated('a', { slots: [slot('In-Progress')] })),
      claimableSlots: { k1: { slots: [slot('In-Progress')] }, k2: [slot('Unstarted')], k3: { slots: [slot('Done')] } },
    }));
    expect(b).toEqual({ seats: 1, open: 2, total: 3 });
  });

  it('agrees with the board hint on every non-empty cohort', () => {
    const cases: GMMission[] = [
      mission({ participants: doneSeat }),
      mission({ participants: doneSeat, claimableSlots: { k: { slots: [slot('In-Progress')] } } }),
      mission({ participants: seats(seated('a', { slots: [slot('100%')] })) }),
      mission({ participants: seats(seated('a', { slots: [] })) }),
    ];
    for (const m of cases) {
      expect(missionSettleBlockers(m).total === 0).toBe(missionReadyToComplete(m));
    }
  });

  it('warns about nothing on an empty cohort, which is NOT "ready" either', () => {
    // The one deliberate divergence: nothing to settle, but nothing to warn about.
    const empty = mission({ participants: {} });
    expect(missionSettleBlockers(empty).total).toBe(0);
    expect(missionReadyToComplete(empty)).toBe(false);
  });
});
