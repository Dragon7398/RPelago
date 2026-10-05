import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { sp, resolveWriteSeason } from './seasonPaths';
import { yamlPath } from './yamlPaths';
import { hordeFloor, MIN_DECLARED_SLOTS, MAX_DECLARED_SLOTS, type TraitEntryLike } from './traits';

// ── Challenge joins (map plan §0.5.2) ─────────────────────────────────────────
//
// S2 moves tile joins off the client's direct RTDB write and onto these two
// callables. The reason is the config requirement: a DATABASE RULE CANNOT SEE A
// STORAGE OBJECT, so "you attached a YAML" is unenforceable on the old path.
//
// Converting also retires a genuinely subtle rule — the claimable-slot claim used
// a Firebase pre-write evaluation trick (the slot still exists in `data` during
// the atomic update that deletes it). Consuming the slot under the Admin SDK
// needs no such thing.

interface DeclaredSlot {
  name:     string;
  game:     string;
  details?: string;
  /**
   * Set only on a CLAIMED slot, so the claimant cannot pass it straight on to
   * a merc (see mercHireBlockers). Tile settlement never reads it. The join
   * path shares `cleanSlots` and must not stamp it, so it is stamped at the
   * claim site rather than in the cleaner.
   */
  claimed?: true;
}

interface TileAdvRecord {
  advId:      string;
  name:       string;
  cls:        string;
  owner:      string;
  ownerName:  string;
  slots?:     DeclaredSlot[];
  room?:      1 | 2;
  /**
   * When this player's config was verified present, ms epoch. §0.5.9: the host
   * board needs a type-agnostic "has submitted" signal it can read WITHOUT
   * hitting Storage once per seat, and the casino's `played` flag is
   * casino-only. Written in the same update as the join.
   */
  yamlAt?:    number;
}

/** Tile types that are doorways or facilities, never joinable challenges. */
const NON_CHALLENGE_TYPES = new Set(['castle', 'dungeon', 'tower', 'town', 'town_center']);

function cleanSlots(raw: unknown): DeclaredSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      name: String(s.name ?? '').trim(),
      game: String(s.game ?? '').trim(),
      ...(s.details ? { details: String(s.details).slice(0, 500) } : {}),
    }))
    .filter(s => s.name.length > 0 && s.game.length > 0);
}

/**
 * Validate a declared slot set against the tile's traits.
 *
 * Traits raise the FLOOR but never the ceiling: Horde demands at least N games,
 * and nothing lets a player exceed five. Constraints that bound *checks* rather
 * than slot count (Agile, Sturdy) are guidance shown at join, not enforced here
 * — the host grants exceptions routinely and an over-cap config must stay
 * submittable, exactly as `checkYamlLimits` is advisory.
 */
function assertSlotsValid(slots: DeclaredSlot[], traits: Record<string, TraitEntryLike> | undefined): void {
  if (slots.length < MIN_DECLARED_SLOTS || slots.length > MAX_DECLARED_SLOTS) {
    throw new HttpsError(
      'invalid-argument',
      `Declare between ${MIN_DECLARED_SLOTS} and ${MAX_DECLARED_SLOTS} slots.`,
    );
  }
  const floor = hordeFloor(traits);
  if (slots.length < floor) {
    throw new HttpsError('failed-precondition', `This challenge needs at least ${floor} games.`);
  }
}

/** The Storage bucket, resolved from the Functions runtime config. */
function bucket() {
  try {
    const cfg = JSON.parse(process.env.FIREBASE_CONFIG ?? '{}') as { storageBucket?: string };
    return cfg.storageBucket ? getStorage().bucket(cfg.storageBucket) : getStorage().bucket();
  } catch {
    return getStorage().bucket();
  }
}

/** Reject unless the player's config is actually sitting in Storage. */
async function assertYamlAttached(seasonId: string, containerId: string, uid: string): Promise<void> {
  const path = yamlPath(seasonId, 'challenge', containerId, uid);
  const [exists] = await bucket().file(path).exists();
  if (!exists) {
    throw new HttpsError('failed-precondition', 'Attach your Archipelago config before joining.');
  }
}

interface JoinCtx {
  uid: string;
  seasonId: string;
  coord: string;
  advId: string;
  slots: DeclaredSlot[];
}

/** Shared prelude: auth, season, and the player's own adventurer. */
async function loadJoinCtx(request: Parameters<Parameters<typeof onCall>[0]>[0]): Promise<JoinCtx> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const { coord, advId, slots, seasonId: reqSeason } = request.data as {
    coord?: string; advId?: string; slots?: unknown; seasonId?: string;
  };
  if (!coord || !advId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const player = playerSnap.val() as {
    displayName: string;
    disabled?: boolean;
    adventurers?: Record<string, { firstName: string; lastName: string; cls: string; busy?: boolean }>;
  };

  // `disabled` blocks joining outright. `restricted` deliberately does NOT — a
  // restricted player plays and settles normally; their penalty is only that
  // the claim comes back late (see CLAUDE.md, Player status).
  if (player.disabled) throw new HttpsError('permission-denied', 'Account restricted.');

  const adv = player.adventurers?.[advId];
  if (!adv) throw new HttpsError('not-found', 'Adventurer not found.');
  if (adv.busy) throw new HttpsError('failed-precondition', 'That adventurer is already out.');

  return { uid, seasonId, coord, advId, slots: cleanSlots(slots) };
}

async function buildRecord(
  seasonId: string, uid: string, advId: string, extra: Partial<TileAdvRecord> = {},
): Promise<TileAdvRecord> {
  const db = getDatabase();
  const snap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  const p = snap.val() as {
    displayName: string;
    adventurers: Record<string, { firstName: string; lastName: string; cls: string }>;
  };
  const adv = p.adventurers[advId];
  return {
    advId,
    name:      `${adv.firstName} ${adv.lastName}`,
    cls:       adv.cls,
    owner:     uid,
    ownerName: p.displayName,
    ...extra,
  };
}

/**
 * Join an AVAILABLE challenge as a fresh adventurer.
 * Replaces the client's `assignAdventurer` write.
 */
export const joinChallenge = onCall(async (request) => {
  const ctx = await loadJoinCtx(request);
  const db  = getDatabase();
  const now = Date.now();

  const tileSnap = await db.ref(sp(ctx.seasonId, `tiles/${ctx.coord}`)).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Challenge not found.');
  const tile = tileSnap.val() as {
    state: string;
    typeKey?: string;
    required?: number;
    traits?: Record<string, TraitEntryLike>;
    adventurers?: Record<string, { owner: string }>;
  };

  if (tile.state !== 'available') {
    // Once a tile is in progress the Archipelago room is locked in; the only way
    // in is claiming a vacated slot.
    throw new HttpsError('failed-precondition', 'This challenge is not open to new adventurers.');
  }
  if (tile.typeKey && NON_CHALLENGE_TYPES.has(tile.typeKey)) {
    throw new HttpsError('failed-precondition', 'That is not a challenge.');
  }

  const advs = Object.values(tile.adventurers ?? {});
  if (advs.some(a => a.owner === ctx.uid)) {
    throw new HttpsError('failed-precondition', 'You are already on this challenge.');
  }
  if (advs.length >= (tile.required ?? 0)) {
    throw new HttpsError('failed-precondition', 'This challenge is already full.');
  }

  assertSlotsValid(ctx.slots, tile.traits);
  await assertYamlAttached(ctx.seasonId, ctx.coord, ctx.uid);

  const record = await buildRecord(ctx.seasonId, ctx.uid, ctx.advId, {
    slots: ctx.slots,
    yamlAt: now,
  });

  await db.ref().update({
    [sp(ctx.seasonId, `tiles/${ctx.coord}/adventurers/${ctx.advId}`)]:        record,
    [sp(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busy`)]:     true,
    [sp(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busyTile`)]: ctx.coord,
  });

  return { success: true };
});

/**
 * Claim a vacated slot on an IN-PROGRESS challenge.
 * Replaces the client's `claimClaimableSlot` write.
 *
 * Deliberately takes NO config: a claimable slot only ever exists on a world
 * whose Archipelago room is already generated, so the claimant adopts a LIVE
 * slot rather than submitting a new one (§0.5.8). Its declared slots are
 * inherited from the entry verbatim.
 */
export const claimChallengeSlot = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const { slotKey } = request.data as { slotKey?: string };
  if (!slotKey) throw new HttpsError('invalid-argument', 'Missing slotKey.');

  const ctx = await loadJoinCtx(request);
  const db  = getDatabase();

  const tileSnap = await db.ref(sp(ctx.seasonId, `tiles/${ctx.coord}`)).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Challenge not found.');
  const tile = tileSnap.val() as {
    state: string;
    adventurers?: Record<string, { owner: string }>;
    claimableSlots?: Record<string, DeclaredSlot[]>;
  };

  if (tile.state !== 'inprogress') {
    throw new HttpsError('failed-precondition', 'Nothing to claim here.');
  }
  if (Object.values(tile.adventurers ?? {}).some(a => a.owner === ctx.uid)) {
    throw new HttpsError('failed-precondition', 'You are already on this challenge.');
  }

  // Read-then-write under the Admin SDK: the entry either exists here or another
  // claimant already took it. This replaces the pre-write rule trick the client
  // path relied on.
  const entry = tile.claimableSlots?.[slotKey];
  if (!entry) throw new HttpsError('not-found', 'That slot has already been claimed.');

  const inherited = cleanSlots(entry).map(s => ({ ...s, claimed: true as const }));
  const room = (Array.isArray(entry) && entry[0] && (entry[0] as { room?: 1 | 2 }).room) || undefined;

  const record = await buildRecord(ctx.seasonId, ctx.uid, ctx.advId, {
    ...(inherited.length ? { slots: inherited } : {}),
    ...(room ? { room } : {}),
    // No yamlAt: the claimant never submitted one, and never should have.
  });

  await db.ref().update({
    [sp(ctx.seasonId, `tiles/${ctx.coord}/claimableSlots/${slotKey}`)]:       null,
    [sp(ctx.seasonId, `tiles/${ctx.coord}/adventurers/${ctx.advId}`)]:        record,
    [sp(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busy`)]:     true,
    [sp(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busyTile`)]: ctx.coord,
  });

  return { success: true };
});
