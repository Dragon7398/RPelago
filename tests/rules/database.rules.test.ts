import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  makeTestEnv, seed,
  ADMIN_UID, PLAYER_UID, OTHER_UID,
  TILE_AVAILABLE, TILE_INPROGRESS, MISSION_ID,
  KMK_LIST, KMK_AREA, KMK_TASK,
} from './setup';

let testEnv: RulesTestEnvironment;

// Rules-under-test operate on the CURRENT database.rules.json (the `game/` tree).
// This is the baseline suite: it must be green before the `seasons/` refactor
// begins, so that a later failure means "my new rule is wrong", not "my test is wrong".

const admin  = () => testEnv.authenticatedContext(ADMIN_UID).database();
const player = () => testEnv.authenticatedContext(PLAYER_UID).database();
const other  = () => testEnv.authenticatedContext(OTHER_UID).database();
const anon   = () => testEnv.unauthenticatedContext().database();

beforeAll(async () => { testEnv = await makeTestEnv('demo-rpelago-legacy'); });
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await seed(testEnv); });

// ─────────────────────────────────────────────────────────────────────────────
describe('admin identity', () => {
  it('admin can write game/meta', async () => {
    await assertSucceeds(admin().ref('game/meta/seed').set(999));
  });

  it('a player cannot write game/meta (game is initialized)', async () => {
    await assertFails(player().ref('game/meta/seed').set(999));
  });

  it('a player cannot seize adminId', async () => {
    await assertFails(player().ref('game/meta/adminId').set(PLAYER_UID));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('player economy — gold and xp are server-owned', () => {
  it('a player cannot write their OWN gold', async () => {
    await assertFails(player().ref(`game/players/${PLAYER_UID}/gold`).set(999999));
  });

  it('a player cannot write ANOTHER player\'s gold', async () => {
    await assertFails(player().ref(`game/players/${OTHER_UID}/gold`).set(999999));
  });

  it('a player cannot write their OWN xp', async () => {
    await assertFails(player().ref(`game/players/${PLAYER_UID}/xp`).set(999999));
  });

  it('admin can write gold', async () => {
    await assertSucceeds(admin().ref(`game/players/${PLAYER_UID}/gold`).set(1234));
  });

  it('a player cannot grant themselves inventory', async () => {
    await assertFails(player().ref(`game/players/${PLAYER_UID}/inventory/warhammer`).set(1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('player self-service fields', () => {
  it('a player can set their own nameColor', async () => {
    await assertSucceeds(player().ref(`game/players/${PLAYER_UID}/nameColor`).set('crimson'));
  });

  it('a player cannot set another player\'s nameColor', async () => {
    await assertFails(player().ref(`game/players/${OTHER_UID}/nameColor`).set('crimson'));
  });

  it('a player can select a feat into an EMPTY slot', async () => {
    await assertSucceeds(player().ref(`game/players/${PLAYER_UID}/feats/level3`).set('picky'));
  });

  it('a player cannot OVERWRITE an already-chosen feat (re-selection blocked)', async () => {
    // OTHER_UID seeded with feats.level3 = 'knowledgeable'
    await assertFails(other().ref(`game/players/${OTHER_UID}/feats/level3`).set('picky'));
  });

  it('a player cannot rename another player\'s adventurer', async () => {
    await assertFails(
      player().ref(`game/players/${OTHER_UID}/adventurers/${OTHER_UID}_adv_1/firstName`).set('Hax'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('admin-only config surfaces', () => {
  it('a player cannot write tiles directly', async () => {
    await assertFails(player().ref(`game/tiles/${TILE_AVAILABLE}/state`).set('complete'));
  });

  it('a player cannot grant themselves an orb', async () => {
    await assertFails(player().ref('game/orbState/fire').set({ method: 'admin', tileCoord: '' }));
  });

  it('a player cannot edit shops', async () => {
    await assertFails(player().ref('game/shops/centralia/orbId').set('fire'));
  });

  it('a player cannot edit orbConfig', async () => {
    await assertFails(player().ref('game/orbConfig/bossMinOrbs').set(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('claimable slots — delete (claim) allowed, create is not', () => {
  it('a player CAN delete an existing tile claimable slot (this is the claim)', async () => {
    await assertSucceeds(
      player().ref(`game/tiles/${TILE_INPROGRESS}/claimableSlots/slotA`).remove(),
    );
  });

  it('a player CANNOT create a tile claimable slot', async () => {
    await assertFails(
      player().ref(`game/tiles/${TILE_INPROGRESS}/claimableSlots/fake`).set([{ name: '', game: '' }]),
    );
  });

  it('a player CAN delete an existing mission claimable slot', async () => {
    await assertSucceeds(
      player().ref(`game/missions/${MISSION_ID}/claimableSlots/slotB`).remove(),
    );
  });

  it('a player CANNOT create a mission claimable slot', async () => {
    await assertFails(
      player().ref(`game/missions/${MISSION_ID}/claimableSlots/fake`).set([{ name: '', game: '' }]),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('notifications', () => {
  it('a player can delete their own notification', async () => {
    await assertSucceeds(player().ref(`game/notifications/${PLAYER_UID}/n1`).remove());
  });

  it('a player cannot write another player\'s notifications', async () => {
    await assertFails(
      other().ref(`game/notifications/${PLAYER_UID}/spoof`).set({ type: 'x', label: 'y', ts: 1 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Keymaster\'s Keep', () => {
  it('a player cannot create a KMK list', async () => {
    await assertFails(player().ref('kmkEvents/newList').set({ name: 'Mine', createdAt: 1 }));
  });

  it('a player can advance their OWN claimed task (Pending → Verifying)', async () => {
    await assertSucceeds(
      player()
        .ref(`kmkEvents/${KMK_LIST}/areas/${KMK_AREA}/tasks/${KMK_TASK}`)
        .update({ status: 'Verifying' }),
    );
  });

  it('a player cannot touch ANOTHER player\'s claimed task', async () => {
    await assertFails(
      other()
        .ref(`kmkEvents/${KMK_LIST}/areas/${KMK_AREA}/tasks/${KMK_TASK}`)
        .update({ status: 'Verifying' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('profiles are read-only to clients', () => {
  it('anyone can READ a profile', async () => {
    await assertSucceeds(anon().ref(`profiles/players/${PLAYER_UID}`).get());
  });

  it('a player cannot WRITE their own profile (functions own it)', async () => {
    await assertFails(player().ref(`profiles/players/${PLAYER_UID}/displayName`).set('Hax'));
  });

  it('a player cannot poison the handleIndex', async () => {
    await assertFails(player().ref('profiles/handleIndex/player1').set(OTHER_UID));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CASINO SECRECY — the deck and other players' hands must never be client-readable.
//
// 🔴 CONFIRMED VULNERABILITY (verified by this suite, 2026-07-13).
//
// database.rules.json sets `.read: false` on
// `game/missions/$m/participants/$p/deck` (and owner-only on `hand`), but the
// ANCESTOR `game` node sets `.read: true`.
//
// Firebase RTDB read/write rules CASCADE DOWNWARD: a grant at a shallower node
// cannot be revoked by a deeper one. `game/.read: true` therefore makes the
// entire subtree world-readable, and the deck/hand rules are INERT NO-OPS.
//
// Impact: ANY visitor — not even authenticated — can read the remaining draw
// deck (and thus engineer their hand) and read opponents' hands. Game-breaking
// for a casino season.
//
// `it.fails()` asserts the test DOES fail — i.e. it pins the bug in place and
// keeps the suite honest AND green. It is currently UNEXPLOITABLE (S1 has no
// live casino tables, and the deck is nulled at deploy / cleared at lock), and
// the whole `game/` tree is scheduled for deletion.
//
// The real fix is proven in seasons.rules.test.ts (`seasonSecrets`). These
// tests get DELETED along with the legacy `game/` block — if one of them
// starts passing, `it.fails` will go red and tell you to remove it.
// ═════════════════════════════════════════════════════════════════════════════
describe('casino secrecy (🔴 CONFIRMED BUG in legacy game/ — pinned, dies with the tree)', () => {
  it.fails('LEAK: a rival player CAN read the draw deck', async () => {
    await assertFails(
      other().ref(`game/missions/${MISSION_ID}/participants/${PLAYER_UID}/deck`).get(),
    );
  });

  it.fails('LEAK: an UNAUTHENTICATED visitor CAN read the draw deck', async () => {
    await assertFails(
      anon().ref(`game/missions/${MISSION_ID}/participants/${PLAYER_UID}/deck`).get(),
    );
  });

  it.fails('LEAK: a rival player CAN read another player\'s hand', async () => {
    await assertFails(
      other().ref(`game/missions/${MISSION_ID}/participants/${PLAYER_UID}/hand`).get(),
    );
  });

  it('the seat owner can read their own hand (passes, but for the wrong reason — everyone can)', async () => {
    await assertSucceeds(
      player().ref(`game/missions/${MISSION_ID}/participants/${PLAYER_UID}/hand`).get(),
    );
  });
});
