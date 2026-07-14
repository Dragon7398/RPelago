import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  makeTestEnv, seed,
  ADMIN_UID, PLAYER_UID, OTHER_UID, ALPHA_UID,
  MISSION_ID, S1, CASINO, S2,
} from './setup';

let testEnv: RulesTestEnvironment;

const admin  = () => testEnv.authenticatedContext(ADMIN_UID).database();
const player = () => testEnv.authenticatedContext(PLAYER_UID).database();
const other  = () => testEnv.authenticatedContext(OTHER_UID).database();
const alpha  = () => testEnv.authenticatedContext(ALPHA_UID).database();
const anon   = () => testEnv.unauthenticatedContext().database();

beforeAll(async () => { testEnv = await makeTestEnv('demo-rpelago-seasons'); });
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await seed(testEnv); });

// ═════════════════════════════════════════════════════════════════════════════
// 🔒 THE FIX — casino secrets live OUTSIDE the world-readable season tree.
//
// The legacy `game/` tree leaked the draw deck and every hand to anyone,
// unauthenticated, because `game/.read: true` cascades over its descendants and
// a deeper `.read: false` cannot revoke it. These tests prove `seasonSecrets`
// closes that hole: no ancestor grants read, so default-deny stands.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔒 seasonSecrets — the draw deck is readable by NOBODY on the client', () => {
  const deck = `seasonSecrets/${CASINO}/missions/${MISSION_ID}/participants/${PLAYER_UID}/deck`;

  it('an unauthenticated visitor cannot read the deck', async () => {
    await assertFails(anon().ref(deck).get());
  });

  it('a rival player cannot read the deck', async () => {
    await assertFails(other().ref(deck).get());
  });

  it('even the seat OWNER cannot read their own deck', async () => {
    // Seeing the remaining cards would let them engineer their hand.
    await assertFails(player().ref(deck).get());
  });

  it('even the ADMIN cannot read the deck from a client', async () => {
    // Cloud Functions use the Admin SDK, which bypasses rules — the *client*
    // never needs this, so no client identity gets it.
    await assertFails(admin().ref(deck).get());
  });

  it('nobody can WRITE the deck from a client', async () => {
    await assertFails(player().ref(deck).set([{ uid: 9, type: 'wild', value: 99 }]));
    await assertFails(admin().ref(deck).set([{ uid: 9, type: 'wild', value: 99 }]));
  });
});

describe('🔒 seasonSecrets — a hand is readable only by its owner', () => {
  const hand = (uid: string) =>
    `seasonSecrets/${CASINO}/missions/${MISSION_ID}/participants/${uid}/hand`;

  it('the seat owner CAN read their own hand (session recovery)', async () => {
    await assertSucceeds(player().ref(hand(PLAYER_UID)).get());
  });

  it('a rival player cannot read that hand', async () => {
    await assertFails(other().ref(hand(PLAYER_UID)).get());
  });

  it('an unauthenticated visitor cannot read that hand', async () => {
    await assertFails(anon().ref(hand(PLAYER_UID)).get());
  });

  it('the owner cannot WRITE their own hand (server-owned)', async () => {
    await assertFails(player().ref(hand(PLAYER_UID)).set([{ uid: 9, type: 'wild', value: 99 }]));
  });

  it('the secrets root is not enumerable', async () => {
    await assertFails(anon().ref('seasonSecrets').get());
    await assertFails(player().ref(`seasonSecrets/${CASINO}`).get());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Draft-season isolation — the spoiler protection.
// ═════════════════════════════════════════════════════════════════════════════
describe('draft seasons are invisible to players', () => {
  it('an unauthenticated visitor cannot read a draft season', async () => {
    await assertFails(anon().ref(`seasons/${S2}`).get());
  });

  it('a normal player cannot read a draft season', async () => {
    await assertFails(player().ref(`seasons/${S2}`).get());
  });

  it('a normal player cannot read draft tiles (the actual spoilers)', async () => {
    await assertFails(player().ref(`seasons/${S2}/tiles`).get());
  });

  it('a normal player cannot even DISCOVER that a draft season exists', async () => {
    await assertFails(player().ref('config/draftSeasons').get());
  });

  it('an ALPHA user can read a draft season', async () => {
    await assertSucceeds(alpha().ref(`seasons/${S2}`).get());
  });

  it('an ALPHA user can discover draft seasons', async () => {
    await assertSucceeds(alpha().ref('config/draftSeasons').get());
  });

  it('the ADMIN can read a draft season', async () => {
    await assertSucceeds(admin().ref(`seasons/${S2}`).get());
  });
});

describe('alpha users can PLAYTEST a draft season; players cannot touch it', () => {
  it('an alpha user can write their own player data in a draft season', async () => {
    await assertSucceeds(
      alpha().ref(`seasons/${S2}/players/${ALPHA_UID}/nameColor`).set('crimson'),
    );
  });

  it('a normal player cannot write into a draft season', async () => {
    await assertFails(
      player().ref(`seasons/${S2}/players/${PLAYER_UID}/nameColor`).set('crimson'),
    );
  });

  it('an alpha user still cannot mint themselves gold in a draft season', async () => {
    await assertFails(alpha().ref(`seasons/${S2}/players/${ALPHA_UID}/gold`).set(999999));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Public seasons: active is live, archived is read-only.
// ═════════════════════════════════════════════════════════════════════════════
describe('public seasons are readable by anyone', () => {
  it('anyone can read the ACTIVE season', async () => {
    await assertSucceeds(anon().ref(`seasons/${CASINO}`).get());
  });

  it('anyone can read an ARCHIVED season', async () => {
    await assertSucceeds(anon().ref(`seasons/${S1}`).get());
  });

  it('anyone can read config needed to boot the client', async () => {
    await assertSucceeds(anon().ref('config/activeSeasonId').get());
    await assertSucceeds(anon().ref('config/seasonList').get());
    await assertSucceeds(anon().ref('config/minClientVersion').get());
  });
});

describe('archived seasons are frozen', () => {
  it('a player cannot write to an archived season', async () => {
    await assertFails(
      player().ref(`seasons/${S1}/players/${PLAYER_UID}/nameColor`).set('crimson'),
    );
  });

  it('the admin CAN still write to an archived season', async () => {
    await assertSucceeds(
      admin().ref(`seasons/${S1}/players/${PLAYER_UID}/nameColor`).set('crimson'),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Active-season player permissions (mirrors the legacy game/ invariants).
// ═════════════════════════════════════════════════════════════════════════════
describe('active season — player economy is server-owned', () => {
  it('a player cannot write their own gold', async () => {
    await assertFails(player().ref(`seasons/${CASINO}/players/${PLAYER_UID}/gold`).set(999999));
  });

  it('a player cannot write their own xp', async () => {
    await assertFails(player().ref(`seasons/${CASINO}/players/${PLAYER_UID}/xp`).set(999999));
  });

  it('a player cannot write another player\'s gold', async () => {
    await assertFails(player().ref(`seasons/${CASINO}/players/${OTHER_UID}/gold`).set(999999));
  });

  it('a player CAN set their own nameColor', async () => {
    await assertSucceeds(
      player().ref(`seasons/${CASINO}/players/${PLAYER_UID}/nameColor`).set('crimson'),
    );
  });

  it('a player cannot set another player\'s nameColor', async () => {
    await assertFails(
      player().ref(`seasons/${CASINO}/players/${OTHER_UID}/nameColor`).set('crimson'),
    );
  });
});

describe('active season — mission claimable slots', () => {
  it('a player CAN delete (claim) an existing slot', async () => {
    await assertSucceeds(
      player().ref(`seasons/${CASINO}/missions/${MISSION_ID}/claimableSlots/slotB`).remove(),
    );
  });

  it('a player CANNOT create a slot', async () => {
    await assertFails(
      player()
        .ref(`seasons/${CASINO}/missions/${MISSION_ID}/claimableSlots/fake`)
        .set([{ name: '', game: '' }]),
    );
  });
});

describe('active season — admin-only surfaces', () => {
  it('a player cannot write meta (the !initialized bootstrap loophole is gone)', async () => {
    await assertFails(player().ref(`seasons/${CASINO}/meta/seed`).set(999));
  });

  it('a player cannot write meta of a season that does not exist yet', async () => {
    // The old rules let ANY authed user seize an uninitialized game.
    await assertFails(player().ref('seasons/brand_new_season/meta').set({ adminId: PLAYER_UID }));
  });

  it('a player cannot write mission state', async () => {
    await assertFails(
      player().ref(`seasons/${CASINO}/missions/${MISSION_ID}/state`).set('complete'),
    );
  });

  it('a player cannot write the pot', async () => {
    await assertFails(player().ref(`seasons/${CASINO}/missions/${MISSION_ID}/pot`).set(999999));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// config/ is admin-owned.
// ═════════════════════════════════════════════════════════════════════════════
describe('config is admin-owned', () => {
  it('a player cannot seize adminId', async () => {
    await assertFails(player().ref('config/adminId').set(PLAYER_UID));
  });

  it('a player cannot switch the active season', async () => {
    await assertFails(player().ref('config/activeSeasonId').set(S2));
  });

  it('a player cannot make themselves an alpha user', async () => {
    await assertFails(player().ref(`config/alphaUsers/${PLAYER_UID}`).set(true));
  });

  it('an ALPHA user cannot promote anyone (alpha ≠ admin)', async () => {
    await assertFails(alpha().ref(`config/alphaUsers/${OTHER_UID}`).set(true));
    await assertFails(alpha().ref('config/adminId').set(ALPHA_UID));
  });

  it('a player cannot publish a draft season by listing it', async () => {
    await assertFails(
      player().ref(`config/seasonList/${S2}`).set({ label: 'x', shell: 'map', status: 'active' }),
    );
  });

  it('the admin CAN launch a season', async () => {
    await assertSucceeds(
      admin().ref(`config/seasonList/${S2}`).set({ label: 'Season 2', shell: 'map', status: 'active' }),
    );
  });
});
