import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  makeTestEnv, seed,
  ADMIN_UID, PLAYER_UID, OTHER_UID,
  KMK_LIST, KMK_AREA, KMK_TASK,
} from './setup';

let testEnv: RulesTestEnvironment;

// Global (season-independent) rule invariants: Keymaster's Keep and profiles.
// The legacy `game/` tree — and the suites that exercised it (admin identity,
// player economy, tiles/orbs/shops, claimable slots, notifications, and the
// pinned casino-secrecy leak) — was deleted once S1 was archived under
// seasons/rpelago_s1. The season-scoped invariants that replaced them live in
// seasons.rules.test.ts; the deck/hand secrecy fix is proven there via
// seasonSecrets. What remains here is the two trees that are NOT season-scoped:
// kmkEvents/ (global, admin keyed off config/adminId) and profiles/.

const admin  = () => testEnv.authenticatedContext(ADMIN_UID).database();
const player = () => testEnv.authenticatedContext(PLAYER_UID).database();
const other  = () => testEnv.authenticatedContext(OTHER_UID).database();
const anon   = () => testEnv.unauthenticatedContext().database();

beforeAll(async () => { testEnv = await makeTestEnv('demo-rpelago-global'); });
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await seed(testEnv); });

// ─────────────────────────────────────────────────────────────────────────────
describe('Keymaster\'s Keep', () => {
  it('a player cannot create a KMK list', async () => {
    await assertFails(player().ref('kmkEvents/newList').set({ name: 'Mine', createdAt: 1 }));
  });

  it('admin (config/adminId) can create a KMK list', async () => {
    await assertSucceeds(admin().ref('kmkEvents/newList').set({ name: 'Admin List', createdAt: 1 }));
  });

  it('admin (config/adminId) can toggle a list active flag', async () => {
    await assertSucceeds(admin().ref(`kmkEvents/${KMK_LIST}/active`).set(true));
  });

  it('a player cannot toggle a list active flag', async () => {
    await assertFails(player().ref(`kmkEvents/${KMK_LIST}/active`).set(true));
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
