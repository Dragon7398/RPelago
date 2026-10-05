"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimChallengeSlot = exports.joinChallenge = void 0;
const https_1 = require("firebase-functions/v2/https");
const database_1 = require("firebase-admin/database");
const storage_1 = require("firebase-admin/storage");
const seasonPaths_1 = require("./seasonPaths");
const yamlPaths_1 = require("./yamlPaths");
const traits_1 = require("./traits");
/** Tile types that are doorways or facilities, never joinable challenges. */
const NON_CHALLENGE_TYPES = new Set(['castle', 'dungeon', 'tower', 'town', 'town_center']);
function cleanSlots(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((s) => !!s && typeof s === 'object')
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
function assertSlotsValid(slots, traits) {
    if (slots.length < traits_1.MIN_DECLARED_SLOTS || slots.length > traits_1.MAX_DECLARED_SLOTS) {
        throw new https_1.HttpsError('invalid-argument', `Declare between ${traits_1.MIN_DECLARED_SLOTS} and ${traits_1.MAX_DECLARED_SLOTS} slots.`);
    }
    const floor = (0, traits_1.hordeFloor)(traits);
    if (slots.length < floor) {
        throw new https_1.HttpsError('failed-precondition', `This challenge needs at least ${floor} games.`);
    }
}
/** The Storage bucket, resolved from the Functions runtime config. */
function bucket() {
    try {
        const cfg = JSON.parse(process.env.FIREBASE_CONFIG ?? '{}');
        return cfg.storageBucket ? (0, storage_1.getStorage)().bucket(cfg.storageBucket) : (0, storage_1.getStorage)().bucket();
    }
    catch {
        return (0, storage_1.getStorage)().bucket();
    }
}
/** Reject unless the player's config is actually sitting in Storage. */
async function assertYamlAttached(seasonId, containerId, uid) {
    const path = (0, yamlPaths_1.yamlPath)(seasonId, 'challenge', containerId, uid);
    const [exists] = await bucket().file(path).exists();
    if (!exists) {
        throw new https_1.HttpsError('failed-precondition', 'Attach your Archipelago config before joining.');
    }
}
/** Shared prelude: auth, season, and the player's own adventurer. */
async function loadJoinCtx(request) {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { coord, advId, slots, seasonId: reqSeason } = request.data;
    if (!coord || !advId)
        throw new https_1.HttpsError('invalid-argument', 'Missing parameters.');
    const uid = request.auth.uid;
    const db = (0, database_1.getDatabase)();
    const { seasonId } = await (0, seasonPaths_1.resolveWriteSeason)(uid, reqSeason, db);
    const playerSnap = await db.ref((0, seasonPaths_1.sp)(seasonId, `players/${uid}`)).get();
    if (!playerSnap.exists())
        throw new https_1.HttpsError('not-found', 'Player not found.');
    const player = playerSnap.val();
    // `disabled` blocks joining outright. `restricted` deliberately does NOT — a
    // restricted player plays and settles normally; their penalty is only that
    // the claim comes back late (see CLAUDE.md, Player status).
    if (player.disabled)
        throw new https_1.HttpsError('permission-denied', 'Account restricted.');
    const adv = player.adventurers?.[advId];
    if (!adv)
        throw new https_1.HttpsError('not-found', 'Adventurer not found.');
    if (adv.busy)
        throw new https_1.HttpsError('failed-precondition', 'That adventurer is already out.');
    return { uid, seasonId, coord, advId, slots: cleanSlots(slots) };
}
async function buildRecord(seasonId, uid, advId, extra = {}) {
    const db = (0, database_1.getDatabase)();
    const snap = await db.ref((0, seasonPaths_1.sp)(seasonId, `players/${uid}`)).get();
    const p = snap.val();
    const adv = p.adventurers[advId];
    return {
        advId,
        name: `${adv.firstName} ${adv.lastName}`,
        cls: adv.cls,
        owner: uid,
        ownerName: p.displayName,
        ...extra,
    };
}
/**
 * Join an AVAILABLE challenge as a fresh adventurer.
 * Replaces the client's `assignAdventurer` write.
 */
exports.joinChallenge = (0, https_1.onCall)(async (request) => {
    const ctx = await loadJoinCtx(request);
    const db = (0, database_1.getDatabase)();
    const now = Date.now();
    const tileSnap = await db.ref((0, seasonPaths_1.sp)(ctx.seasonId, `tiles/${ctx.coord}`)).get();
    if (!tileSnap.exists())
        throw new https_1.HttpsError('not-found', 'Challenge not found.');
    const tile = tileSnap.val();
    if (tile.state !== 'available') {
        // Once a tile is in progress the Archipelago room is locked in; the only way
        // in is claiming a vacated slot.
        throw new https_1.HttpsError('failed-precondition', 'This challenge is not open to new adventurers.');
    }
    if (tile.typeKey && NON_CHALLENGE_TYPES.has(tile.typeKey)) {
        throw new https_1.HttpsError('failed-precondition', 'That is not a challenge.');
    }
    const advs = Object.values(tile.adventurers ?? {});
    if (advs.some(a => a.owner === ctx.uid)) {
        throw new https_1.HttpsError('failed-precondition', 'You are already on this challenge.');
    }
    if (advs.length >= (tile.required ?? 0)) {
        throw new https_1.HttpsError('failed-precondition', 'This challenge is already full.');
    }
    assertSlotsValid(ctx.slots, tile.traits);
    await assertYamlAttached(ctx.seasonId, ctx.coord, ctx.uid);
    const record = await buildRecord(ctx.seasonId, ctx.uid, ctx.advId, {
        slots: ctx.slots,
        yamlAt: now,
    });
    await db.ref().update({
        [(0, seasonPaths_1.sp)(ctx.seasonId, `tiles/${ctx.coord}/adventurers/${ctx.advId}`)]: record,
        [(0, seasonPaths_1.sp)(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busy`)]: true,
        [(0, seasonPaths_1.sp)(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busyTile`)]: ctx.coord,
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
exports.claimChallengeSlot = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { slotKey } = request.data;
    if (!slotKey)
        throw new https_1.HttpsError('invalid-argument', 'Missing slotKey.');
    const ctx = await loadJoinCtx(request);
    const db = (0, database_1.getDatabase)();
    const tileSnap = await db.ref((0, seasonPaths_1.sp)(ctx.seasonId, `tiles/${ctx.coord}`)).get();
    if (!tileSnap.exists())
        throw new https_1.HttpsError('not-found', 'Challenge not found.');
    const tile = tileSnap.val();
    if (tile.state !== 'inprogress') {
        throw new https_1.HttpsError('failed-precondition', 'Nothing to claim here.');
    }
    if (Object.values(tile.adventurers ?? {}).some(a => a.owner === ctx.uid)) {
        throw new https_1.HttpsError('failed-precondition', 'You are already on this challenge.');
    }
    // Read-then-write under the Admin SDK: the entry either exists here or another
    // claimant already took it. This replaces the pre-write rule trick the client
    // path relied on.
    const entry = tile.claimableSlots?.[slotKey];
    if (!entry)
        throw new https_1.HttpsError('not-found', 'That slot has already been claimed.');
    const inherited = cleanSlots(entry).map(s => ({ ...s, claimed: true }));
    const room = (Array.isArray(entry) && entry[0] && entry[0].room) || undefined;
    const record = await buildRecord(ctx.seasonId, ctx.uid, ctx.advId, {
        ...(inherited.length ? { slots: inherited } : {}),
        ...(room ? { room } : {}),
        // No yamlAt: the claimant never submitted one, and never should have.
    });
    await db.ref().update({
        [(0, seasonPaths_1.sp)(ctx.seasonId, `tiles/${ctx.coord}/claimableSlots/${slotKey}`)]: null,
        [(0, seasonPaths_1.sp)(ctx.seasonId, `tiles/${ctx.coord}/adventurers/${ctx.advId}`)]: record,
        [(0, seasonPaths_1.sp)(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busy`)]: true,
        [(0, seasonPaths_1.sp)(ctx.seasonId, `players/${ctx.uid}/adventurers/${ctx.advId}/busyTile`)]: ctx.coord,
    });
    return { success: true };
});
//# sourceMappingURL=challengeJoin.js.map