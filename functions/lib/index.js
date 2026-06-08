"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickGuildmasterMissions = exports.onMissionComplete = exports.adminForceDeploy = exports.adminKickMissionParticipant = exports.lockCasinoResult = exports.playCasinoGambit = exports.casinoFold = exports.casinoDraw = exports.dealCasinoHand = exports.claimMissionSlot = exports.setMissionParticipantStatusNote = exports.standDownFromMission = exports.enlistInMission = exports.pruneActivityLog = exports.onOrbAcquired = exports.onTileComplete = exports.purchaseShopOrb = exports.purchaseShopItem = exports.exchangeDiscordCode = void 0;
const https_1 = require("firebase-functions/v2/https");
const database_1 = require("firebase-functions/v2/database");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const database_2 = require("firebase-admin/database");
const params_1 = require("firebase-functions/params");
const casinoEngine_1 = require("./casinoEngine");
(0, app_1.initializeApp)();
const discordClientSecret = (0, params_1.defineSecret)('DISCORD_CLIENT_SECRET');
// ── Adventurer name/class pools (mirrors src/lib/constants.ts) ────────────────
const ADV_NAMES_FIRST = [
    'Aldric', 'Serana', 'Torvin', 'Mira', 'Dax', 'Lyra', 'Borin', 'Sylva',
    'Kael', 'Thessia', 'Oryn', 'Veda', 'Gareth', 'Nyx', 'Fenn', 'Isolde',
    'Caspian', 'Thalia', 'Riven', 'Vesper', 'Emric', 'Wren', 'Draven', 'Elara',
    'Caius', 'Branwen', 'Zephyr', 'Tarrin', 'Phaedra', 'Jorvin', 'Celeste', 'Rook',
    'Elowen', 'Hadeon', 'Solia', 'Corvus', 'Mirela', 'Dusk', 'Zinnia', 'Tybalt',
];
const ADV_NAMES_LAST = [
    'Stonefist', 'Ashveil', 'Ironwood', 'Dawnwhisper',
    'Greymantle', 'Blackthorn', 'Swiftarrow', 'Moonforge',
    'Emberveil', 'Shadowmend', 'Stormcaller', 'Nighthollow',
    'Firesong', 'Silverthorn', 'Ravenwing', 'Cinderspire',
    'Frosthollow', 'Starfall', 'Ashenbrow', 'Coppergate',
    'Galesong', 'Embercroft', 'Runeblade', 'Oakheart',
    'Brightholm', 'Coldwater', 'Wildstride',
];
const ADV_CLASSES = [
    'Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin', 'Bard', 'Druid',
];
// ── Boss coord computation (mirrors src/lib/tileGen.ts) ───────────────────────
const ROWS = 5, COLS = 7;
const CORNER_POSITIONS = [
    [0, 0],
    [0, COLS - 1],
    [ROWS - 1, 0],
    [ROWS - 1, COLS - 1],
];
function seededShuffleFirst(arr, seed) {
    const a = [...arr];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        const j = Math.abs(s) % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a[0];
}
function bossCoordFromSeed(seed) {
    const [r, c] = seededShuffleFirst(CORNER_POSITIONS, seed ^ 0xDEADBEEF);
    return `${String.fromCharCode(65 + c)}${r + 1}`;
}
// ── Elemental orb → boss traits (mirrors src/lib/constants.ts) ────────────────
const ELEMENTAL_ORB_TRAITS = {
    fire: ['cursed', 'stunning'],
    air: ['aerial', 'agile'],
    water: ['camouflage', 'taunt'],
    earth: ['enduring', 'sturdy'],
};
// Traits removable even while boss is in-progress (game already locked)
const BOSS_SOFT_TRAITS = new Set(['camouflage', 'enduring']);
exports.exchangeDiscordCode = (0, https_1.onRequest)({ secrets: [discordClientSecret], cors: ['https://rpelago.brisbe.org', 'http://localhost:5173'] }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) {
        res.status(400).json({ error: 'Missing code or redirectUri' });
        return;
    }
    try {
        console.log('Exchanging code — client_id:', process.env.DISCORD_CLIENT_ID, 'redirect_uri:', redirectUri);
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID ?? '',
                client_secret: discordClientSecret.value(),
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
            }).toString(),
        });
        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            res.status(500).json({ error: `Discord token exchange failed: ${body}` });
            return;
        }
        const { access_token } = await tokenRes.json();
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) {
            res.status(500).json({ error: 'Failed to fetch Discord user info' });
            return;
        }
        const discordUser = await userRes.json();
        const uid = `discord_${discordUser.id}`;
        const displayName = discordUser.global_name ?? discordUser.username;
        try {
            await (0, auth_1.getAuth)().updateUser(uid, { displayName });
        }
        catch {
            await (0, auth_1.getAuth)().createUser({ uid, displayName });
        }
        const customToken = await (0, auth_1.getAuth)().createCustomToken(uid, { discordId: discordUser.id });
        // Write a minimal profile stub so the profile site can show an identity card
        // and empty state even before the player completes any tiles.
        const db = (0, database_2.getDatabase)();
        const profileRef = db.ref(`profiles/players/${uid}`);
        const [joinedSnap, firstEventSnap] = await Promise.all([
            profileRef.child('joinedAt').get(),
            profileRef.child('firstEvent').get(),
        ]);
        const stub = {
            id: uid,
            displayName,
            discordHandle: discordUser.username,
            avatarHash: discordUser.avatar,
        };
        if (!joinedSnap.exists())
            stub.joinedAt = Date.now();
        if (!firstEventSnap.exists())
            stub.firstEvent = null;
        await profileRef.update(stub);
        if (discordUser.username) {
            await db.ref(`profiles/handleIndex/${discordUser.username.replace(/\./g, '_')}`).set(uid);
        }
        // Create or update game/players via admin SDK (bypasses security rules).
        // Blocking on this before returning the token guarantees the record exists
        // the moment the client signs in — no client-side writes needed for setup.
        const gamePlayerRef = db.ref(`game/players/${uid}`);
        const [gameAdvSnap, gameJoinedSnap] = await Promise.all([
            gamePlayerRef.child('adventurers').get(),
            gamePlayerRef.child('joinedAt').get(),
        ]);
        if (!gameAdvSnap.exists()) {
            // New user — create the full player record server-side.
            const advId = `${uid}_adv_1`;
            const firstName = ADV_NAMES_FIRST[Math.floor(Math.random() * ADV_NAMES_FIRST.length)];
            const lastName = ADV_NAMES_LAST[Math.floor(Math.random() * ADV_NAMES_LAST.length)];
            const cls = ADV_CLASSES[Math.floor(Math.random() * ADV_CLASSES.length)];
            await gamePlayerRef.set({
                id: uid,
                displayName,
                xp: 0,
                gold: 0,
                adventurers: {
                    [advId]: { id: advId, firstName, lastName, cls, busy: false, busyTile: null },
                },
                inventory: {},
                joinedAt: Date.now(),
                discordHandle: discordUser.username,
                avatarHash: discordUser.avatar,
            });
        }
        else {
            // Returning user — refresh Discord identity fields.
            const gameUpdates = {
                [`game/players/${uid}/discordHandle`]: discordUser.username,
                [`game/players/${uid}/avatarHash`]: discordUser.avatar,
            };
            if (!gameJoinedSnap.exists()) {
                gameUpdates[`game/players/${uid}/joinedAt`] = Date.now();
            }
            await db.ref().update(gameUpdates);
        }
        res.json({ customToken, displayName, uid, discordHandle: discordUser.username, avatarHash: discordUser.avatar });
    }
    catch (err) {
        console.error('exchangeDiscordCode error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Shop item costs and names (mirrors src/lib/constants.ts SHOP_ITEMS) ───────
const ITEM_COSTS = {
    map: 250,
    scroll_of_magnetism: 1000,
    scroll_of_generosity: 1000,
    coat_of_many_colors: 750,
    wand_of_piercing: 300,
    throwing_dagger: 400,
    ring_of_resistance: 500,
    warhammer: 600,
};
const ITEM_NAMES = {
    map: 'Map',
    scroll_of_magnetism: 'Scroll of Magnetism',
    scroll_of_generosity: 'Scroll of Generosity',
    coat_of_many_colors: 'Coat of Many Colors',
    wand_of_piercing: 'Wand of Piercing',
    throwing_dagger: 'Throwing Dagger',
    ring_of_resistance: 'Ring of Resistance',
    warhammer: 'Warhammer',
};
// Items that cannot be purchased more than once
const NON_CONSUMABLE_ITEMS = new Set(['coat_of_many_colors', 'wand_of_piercing', 'throwing_dagger', 'ring_of_resistance', 'warhammer']);
const ORB_SHOP_COST = 1500;
// ── purchaseShopItem ──────────────────────────────────────────────────────────
exports.purchaseShopItem = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { itemId, coord } = request.data;
    if (!itemId || !coord)
        throw new https_1.HttpsError('invalid-argument', 'Missing itemId or coord.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const tileSnap = await db.ref(`game/tiles/${coord}`).get();
    if (!tileSnap.exists())
        throw new https_1.HttpsError('not-found', 'Tile not found.');
    const shopId = tileSnap.val().shopId;
    if (!shopId)
        throw new https_1.HttpsError('failed-precondition', 'No shop at this tile.');
    const shopSnap = await db.ref(`game/shops/${shopId}`).get();
    if (!shopSnap.exists())
        throw new https_1.HttpsError('not-found', 'Shop not found.');
    const shop = shopSnap.val();
    if (!(shop.itemIds ?? []).includes(itemId))
        throw new https_1.HttpsError('failed-precondition', 'Item not sold at this shop.');
    const cost = ITEM_COSTS[itemId];
    if (cost == null)
        throw new https_1.HttpsError('not-found', 'Unknown item.');
    let abortReason = 'Purchase failed. Please try again.';
    const { committed, snapshot } = await db.ref(`game/players/${uid}`).transaction((current) => {
        if (!current) {
            abortReason = 'Player not found.';
            return undefined;
        }
        if (current.disabled) {
            abortReason = 'Account restricted.';
            return undefined;
        }
        if (current.gold < cost) {
            abortReason = 'Not enough gold.';
            return undefined;
        }
        if (NON_CONSUMABLE_ITEMS.has(itemId) && (current.inventory?.[itemId] ?? 0) > 0) {
            abortReason = 'Item already owned.';
            return undefined;
        }
        return {
            ...current,
            gold: current.gold - cost,
            inventory: { ...(current.inventory ?? {}), [itemId]: (current.inventory?.[itemId] ?? 0) + 1 },
        };
    });
    if (!committed)
        throw new https_1.HttpsError('failed-precondition', abortReason);
    const itemName = ITEM_NAMES[itemId] ?? itemId;
    const displayName = snapshot.val().displayName;
    await db.ref('game/activityLog').push().set({
        timestamp: Date.now(),
        type: 'item_purchased',
        message: `${displayName} purchased ${itemName} from ${shop.name ?? shopId}.`,
        icon: '🛒',
    });
    return { success: true };
});
// ── purchaseShopOrb ───────────────────────────────────────────────────────────
exports.purchaseShopOrb = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { coord } = request.data;
    if (!coord)
        throw new https_1.HttpsError('invalid-argument', 'Missing coord.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const tileSnap = await db.ref(`game/tiles/${coord}`).get();
    if (!tileSnap.exists())
        throw new https_1.HttpsError('not-found', 'Tile not found.');
    const shopId = tileSnap.val().shopId;
    if (!shopId)
        throw new https_1.HttpsError('failed-precondition', 'No shop at this tile.');
    const [shopSnap, playerSnap] = await Promise.all([
        db.ref(`game/shops/${shopId}`).get(),
        db.ref(`game/players/${uid}`).get(),
    ]);
    if (!shopSnap.exists())
        throw new https_1.HttpsError('not-found', 'Shop not found.');
    if (!playerSnap.exists())
        throw new https_1.HttpsError('not-found', 'Player not found.');
    const shop = shopSnap.val();
    const player = playerSnap.val();
    if (player.disabled)
        throw new https_1.HttpsError('permission-denied', 'Account restricted.');
    const orbId = shop.orbId ?? null;
    if (!orbId)
        throw new https_1.HttpsError('failed-precondition', 'No orb sold at this shop.');
    if (player.gold < ORB_SHOP_COST)
        throw new https_1.HttpsError('failed-precondition', 'Not enough gold.');
    const acquisition = {
        method: 'shop',
        tileCoord: coord,
        tileName: shop.name ?? coord,
        buyerName: player.displayName,
    };
    // Atomically claim the orb so two concurrent purchases can't both succeed.
    const { committed } = await db.ref(`game/orbState/${orbId}`).transaction(current => {
        if (current !== null)
            return; // abort — already claimed
        return acquisition;
    });
    if (!committed)
        throw new https_1.HttpsError('already-exists', 'This orb has already been claimed.');
    // Deduct gold via transaction so stale snapshot value can't cause incorrect set().
    let goldAbortReason = 'Gold deduction failed.';
    const { committed: goldCommitted } = await db.ref(`game/players/${uid}/gold`).transaction((current) => {
        if (typeof current !== 'number') {
            goldAbortReason = 'Player gold not found.';
            return undefined;
        }
        if (current < ORB_SHOP_COST) {
            goldAbortReason = 'Not enough gold.';
            return undefined;
        }
        return current - ORB_SHOP_COST;
    });
    if (!goldCommitted) {
        try {
            await db.ref(`game/orbState/${orbId}`).remove();
        }
        catch (e) {
            console.error(`[purchaseShopOrb] Rollback failed for orb ${orbId}, player ${uid}:`, e);
        }
        throw new https_1.HttpsError('failed-precondition', goldAbortReason);
    }
    const orbLabel = orbId.charAt(0).toUpperCase() + orbId.slice(1);
    await db.ref('game/activityLog').push().set({
        timestamp: Date.now(),
        type: 'orb_purchased',
        message: `${player.displayName} purchased the ${orbLabel} Orb from ${shop.name ?? coord}.`,
        icon: '🔮',
    });
    return { success: true, orbId };
});
function normalizeGameName(name) {
    return name.trim().replace(/\s+/g, ' ');
}
exports.onTileComplete = (0, database_1.onValueWritten)('game/tiles/{coord}/state', async (event) => {
    const prevState = event.data.before.val();
    const newState = event.data.after.val();
    // Only act on the transition into 'complete'; ignore re-writes to an already-complete tile.
    if (newState !== 'complete' || prevState === 'complete')
        return;
    const coord = event.params.coord;
    const db = (0, database_2.getDatabase)();
    // Read tile adventurers and all player records in parallel.
    // tile.adventurers at completion is the canonical claim list: players freed early
    // (slot completion) remain listed here; players who explicitly recalled do not.
    const [advSnap, playersSnap] = await Promise.all([
        db.ref(`game/tiles/${coord}/adventurers`).get(),
        db.ref('game/players').get(),
    ]);
    if (!advSnap.exists())
        return;
    const adventurers = advSnap.val();
    const players = playersSnap.val();
    // Group adventurers by owner; collect each owner's normalized game names.
    const byOwner = new Map();
    for (const adv of Object.values(adventurers)) {
        if (!byOwner.has(adv.owner))
            byOwner.set(adv.owner, new Set());
        const games = byOwner.get(adv.owner);
        for (const slot of adv.slots ?? []) {
            if (slot.game?.trim())
                games.add(normalizeGameName(slot.game));
        }
    }
    // Batch-read each player's current firstEvent so we only set it when null —
    // preserving a firstEvent from a different event that happened earlier.
    const playerIds = [...byOwner.keys()];
    const firstEventSnaps = await Promise.all(playerIds.map(uid => db.ref(`profiles/players/${uid}/firstEvent`).get()));
    const firstEventMap = new Map(playerIds.map((uid, i) => [uid, firstEventSnaps[i].val()]));
    const profileUpdates = {};
    for (const [playerId, games] of byOwner) {
        const player = players?.[playerId];
        if (!player)
            continue;
        const base = `profiles/players/${playerId}`;
        // Identity — refreshed on every tile so handle/avatar stay current.
        profileUpdates[`${base}/id`] = playerId;
        profileUpdates[`${base}/displayName`] = player.displayName;
        profileUpdates[`${base}/discordHandle`] = player.discordHandle ?? null;
        profileUpdates[`${base}/avatarHash`] = player.avatarHash ?? null;
        profileUpdates[`${base}/joinedAt`] = player.joinedAt ?? null;
        // Only set firstEvent when it hasn't been claimed by an earlier event.
        if (!firstEventMap.get(playerId)) {
            profileUpdates[`${base}/firstEvent`] = 'rpelago_s1';
        }
        // XP — reflect current value at the moment of tile completion.
        profileUpdates[`${base}/events/rpelago_s1/xp`] = player.xp ?? 0;
        // Tiles — ServerValue.increment avoids read-modify-write race conditions.
        profileUpdates[`${base}/events/rpelago_s1/tiles`] = database_2.ServerValue.increment(1);
        // Games — keyed record (encodedName → true) so each game write is atomic;
        // no pre-read needed and concurrent tile completions don't stomp each other.
        for (const g of games) {
            profileUpdates[`${base}/events/rpelago_s1/games/${encodeURIComponent(g)}`] = true;
        }
        // Handle index — lets the profile site resolve /p/<handle> to a UID.
        // Discord handles contain only letters, numbers, underscores, and periods;
        // replace '.' (invalid Firebase key char) with '_'.
        if (player.discordHandle) {
            profileUpdates[`profiles/handleIndex/${player.discordHandle.replace(/\./g, '_')}`] = playerId;
        }
    }
    if (Object.keys(profileUpdates).length > 0) {
        await db.ref().update(profileUpdates);
    }
});
// ── onOrbAcquired ─────────────────────────────────────────────────────────────
// Removes boss traits when an elemental orb is first acquired, regardless of
// which client or Cloud Function wrote the orb. Soft traits (camouflage,
// enduring) are skipped if the boss is already in-progress (YAML locked).
exports.onOrbAcquired = (0, database_1.onValueCreated)('game/orbState/{orbId}', async (event) => {
    const orbId = event.params.orbId;
    const traitIds = ELEMENTAL_ORB_TRAITS[orbId];
    if (!traitIds)
        return; // not an elemental orb
    const db = (0, database_2.getDatabase)();
    const metaSnap = await db.ref('game/meta').get();
    if (!metaSnap.exists())
        return;
    const seed = metaSnap.val().seed;
    const bossCoord = bossCoordFromSeed(seed);
    const bossSnap = await db.ref(`game/tiles/${bossCoord}`).get();
    if (!bossSnap.exists())
        return;
    const boss = bossSnap.val();
    if (boss.state === 'complete')
        return;
    const isInProgress = boss.state === 'inprogress';
    const next = { ...(boss.traits ?? {}) };
    let changed = false;
    for (const traitId of traitIds) {
        if (isInProgress && !BOSS_SOFT_TRAITS.has(traitId))
            continue;
        if (traitId in next) {
            delete next[traitId];
            changed = true;
        }
    }
    if (!changed)
        return;
    await db.ref(`game/tiles/${bossCoord}/traits`).set(Object.keys(next).length > 0 ? next : null);
});
// ── pruneActivityLog ──────────────────────────────────────────────────────────
// Fires on every new activity log entry and trims the log to 25 entries.
exports.pruneActivityLog = (0, database_1.onValueCreated)('game/activityLog/{entryId}', async () => {
    const db = (0, database_2.getDatabase)();
    const snap = await db.ref('game/activityLog').get();
    if (!snap.exists())
        return;
    const keys = Object.keys(snap.val()).sort();
    const MAX = 25;
    if (keys.length <= MAX)
        return;
    const updates = {};
    for (const k of keys.slice(0, keys.length - MAX))
        updates[`game/activityLog/${k}`] = null;
    await db.ref().update(updates);
});
const MISSION_DEFS = {
    basic: {
        label: 'Basic Training',
        baseMax: 5,
        xp: 100,
        gp: 0,
        traits: { sturdy: { value: 150 } },
        release: 'on',
        collect: 'off',
        hint: 8,
        special: true,
    },
    patrol: {
        label: 'Patrol',
        baseMax: 8,
        xp: 50,
        gp: 50,
        traits: null,
        release: 'on',
        collect: 'off',
        hint: 10,
        special: false,
    },
    casino: {
        label: 'A Night at the Casino',
        baseMax: 6,
        xp: 50,
        gp: 0,
        traits: null,
        release: 'special',
        collect: 'special',
        hint: 10,
        special: false,
        variableReward: true,
        tableUrl: '/casino/table',
        entryCosts: [
            { label: 'Poker ante', gold: 40 },
            { label: 'Blackjack ante', gold: 30 },
            { label: 'Reroll', gold: 20 },
        ],
        potSeed: casinoEngine_1.CASINO_POT_SEED,
    },
};
const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
// ── Mission logic helpers ─────────────────────────────────────────────────────
function gmCurrentMaxSlots(m, now) {
    if (m.firstJoinAt == null)
        return m.baseMax;
    const steps = Math.floor((now - m.firstJoinAt) / (24 * 3600_000));
    return Math.max(1, m.baseMax - steps);
}
function gmFilledCount(m) {
    return Object.keys(m.participants ?? {}).length;
}
function gmShouldDeploy(m, now) {
    if (m.state !== 'forming')
        return false;
    if (gmFilledCount(m) === 0)
        return false;
    if (gmFilledCount(m) < gmCurrentMaxSlots(m, now))
        return false;
    if (m.type === 'casino') {
        const parts = Object.values(m.participants ?? {});
        if (!parts.every(p => p.played === true))
            return false;
    }
    return true;
}
function gmFreshMission(type, series, now) {
    const def = MISSION_DEFS[type];
    const result = {
        type,
        series,
        label: def.label,
        state: 'forming',
        baseMax: def.baseMax,
        xp: def.xp,
        gp: def.gp,
        release: def.release,
        collect: def.collect,
        hint: def.hint,
        firstJoinAt: null,
        createdAt: now,
        participants: {},
    };
    if (def.traits)
        result.traits = { ...def.traits };
    if (type === 'casino') {
        result.variableReward = true;
        result.tableUrl = def.tableUrl;
        result.entryCosts = def.entryCosts ? [...def.entryCosts] : [];
        result.pot = casinoEngine_1.CASINO_POT_SEED;
        result.casinoStats = { ...casinoEngine_1.CASINO_START_STATS };
    }
    return result;
}
function gmMissionLabel(m) {
    const roman = ROMAN_NUMERALS[m.series] ?? String(m.series);
    return `${m.label} · Cohort ${roman}`;
}
// ── Deploy routine ────────────────────────────────────────────────────────────
async function deployMission(missionId, m, now) {
    const db = (0, database_2.getDatabase)();
    const newRef = db.ref('game/missions').push();
    const newId = newRef.key;
    const fresh = gmFreshMission(m.type, m.series + 1, now);
    const label = gmMissionLabel(m);
    const updates = {
        [`game/missions/${missionId}/state`]: 'inprogress',
        [`game/missions/${missionId}/deployedAt`]: now,
        [`game/missions/${newId}`]: { ...fresh, id: newId },
    };
    // Casino: roll the release/collect odds from the settled casinoStats, lock xp/hint,
    // and clear per-seat deck data (no longer needed once deployed).
    if (m.type === 'casino' && m.casinoStats) {
        const { releaseOn, collectOn } = (0, casinoEngine_1.rollCasinoOdds)(m.casinoStats);
        updates[`game/missions/${missionId}/release`] = releaseOn ? 'on' : 'off';
        updates[`game/missions/${missionId}/collect`] = collectOn ? 'on' : 'off';
        updates[`game/missions/${missionId}/hint`] = m.casinoStats.hint;
        updates[`game/missions/${missionId}/xp`] = m.casinoStats.xp;
        for (const uid of Object.keys(m.participants ?? {})) {
            updates[`game/missions/${missionId}/participants/${uid}/deck`] = null;
        }
    }
    // Notify each enrolled participant via push-keyed notification
    for (const uid of Object.keys(m.participants ?? {})) {
        const notifRef = db.ref(`game/notifications/${uid}`).push();
        updates[`game/notifications/${uid}/${notifRef.key}`] = {
            type: 'mission_deploy',
            label,
            ts: now,
        };
    }
    await db.ref().update(updates);
    await db.ref('game/activityLog').push().set({
        timestamp: now,
        type: 'mission_deploy',
        message: `${label} has deployed.`,
        icon: '⚜',
    });
}
// ── Player callables ──────────────────────────────────────────────────────────
exports.enlistInMission = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { missionId } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const now = Date.now();
    const [playerSnap, missionSnap] = await Promise.all([
        db.ref(`game/players/${uid}`).get(),
        db.ref(`game/missions/${missionId}`).get(),
    ]);
    if (!playerSnap.exists())
        throw new https_1.HttpsError('not-found', 'Player not found.');
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const player = playerSnap.val();
    const mission = missionSnap.val();
    if (player.disabled)
        throw new https_1.HttpsError('permission-denied', 'Account restricted.');
    if (player.activeMission)
        throw new https_1.HttpsError('failed-precondition', 'already-on-mission');
    if (mission.state !== 'forming')
        throw new https_1.HttpsError('failed-precondition', 'Mission is not forming.');
    if (mission.type === 'basic' && player.basicTrainingDone)
        throw new https_1.HttpsError('failed-precondition', 'basic-training-used');
    if (gmFilledCount(mission) >= gmCurrentMaxSlots(mission, now))
        throw new https_1.HttpsError('failed-precondition', 'Mission is full.');
    if (mission.type === 'casino' && (player.gold ?? 0) < casinoEngine_1.CASINO_MIN_ENLIST_GOLD)
        throw new https_1.HttpsError('failed-precondition', 'not-enough-gold');
    const participant = {
        playerId: uid,
        playerName: player.displayName,
        joinedAt: now,
        ...(mission.type === 'casino' ? { startBy: now + 3_600_000 } : {}),
    };
    const updates = {
        [`game/missions/${missionId}/participants/${uid}`]: participant,
        [`game/players/${uid}/activeMission`]: missionId,
    };
    if (mission.firstJoinAt == null) {
        updates[`game/missions/${missionId}/firstJoinAt`] = now;
    }
    await db.ref().update(updates);
    // Re-read updated mission to check if deploy fires
    const updatedSnap = await db.ref(`game/missions/${missionId}`).get();
    const updated = updatedSnap.val();
    if (gmShouldDeploy(updated, now)) {
        await deployMission(missionId, updated, now);
    }
    return { success: true };
});
exports.standDownFromMission = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { missionId } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const missionSnap = await db.ref(`game/missions/${missionId}`).get();
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const mission = missionSnap.val();
    if (mission.state !== 'forming')
        throw new https_1.HttpsError('failed-precondition', 'mission-committed');
    if (!(uid in (mission.participants ?? {})))
        throw new https_1.HttpsError('failed-precondition', 'not-a-participant');
    const updates = {
        [`game/missions/${missionId}/participants/${uid}`]: null,
        [`game/players/${uid}/activeMission`]: null,
    };
    const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== uid);
    if (remaining.length === 0) {
        updates[`game/missions/${missionId}/firstJoinAt`] = null;
    }
    await db.ref().update(updates);
    return { success: true };
});
exports.setMissionParticipantStatusNote = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { missionId, note } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const missionSnap = await db.ref(`game/missions/${missionId}`).get();
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const mission = missionSnap.val();
    if (!(uid in (mission.participants ?? {})))
        throw new https_1.HttpsError('failed-precondition', 'Not a participant.');
    const path = `game/missions/${missionId}/participants/${uid}/statusNote`;
    if (note == null) {
        await db.ref(path).remove();
    }
    else {
        await db.ref(path).set({ text: note, timestamp: Date.now() });
    }
    return { success: true };
});
// ── Claim an open spot on an in-progress mission (kicked player replacement) ──
exports.claimMissionSlot = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const { missionId, slotKey } = request.data;
    if (!missionId || !slotKey)
        throw new https_1.HttpsError('invalid-argument', 'Missing parameters.');
    const uid = request.auth.uid;
    const db = (0, database_2.getDatabase)();
    const now = Date.now();
    const [playerSnap, missionSnap] = await Promise.all([
        db.ref(`game/players/${uid}`).get(),
        db.ref(`game/missions/${missionId}`).get(),
    ]);
    if (!playerSnap.exists())
        throw new https_1.HttpsError('not-found', 'Player not found.');
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const player = playerSnap.val();
    const mission = missionSnap.val();
    if (player.disabled)
        throw new https_1.HttpsError('permission-denied', 'Account restricted.');
    if (player.activeMission)
        throw new https_1.HttpsError('failed-precondition', 'already-on-mission');
    if (mission.state !== 'inprogress')
        throw new https_1.HttpsError('failed-precondition', 'Mission is not in progress.');
    if (uid in (mission.participants ?? {}))
        throw new https_1.HttpsError('failed-precondition', 'already-a-participant');
    if (mission.type === 'basic' && player.basicTrainingDone)
        throw new https_1.HttpsError('failed-precondition', 'basic-training-used');
    const slotSnap = await db.ref(`game/missions/${missionId}/claimableSlots/${slotKey}`).get();
    if (!slotSnap.exists())
        throw new https_1.HttpsError('not-found', 'Slot no longer available.');
    const inheritedSlots = slotSnap.val();
    const participant = {
        playerId: uid,
        playerName: player.displayName,
        joinedAt: now,
        ...(inheritedSlots?.length ? { slots: inheritedSlots } : {}),
    };
    await db.ref().update({
        [`game/missions/${missionId}/claimableSlots/${slotKey}`]: null,
        [`game/missions/${missionId}/participants/${uid}`]: participant,
        [`game/players/${uid}/activeMission`]: missionId,
    });
    return { success: true };
});
// ── Casino callables ──────────────────────────────────────────────────────────
// Shared guard: reads and validates that the caller is seated and hasn't locked yet.
async function mustCasinoSeat(db, missionId, uid) {
    const snap = await db.ref(`game/missions/${missionId}`).get();
    if (!snap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const mission = snap.val();
    if (mission.type !== 'casino')
        throw new https_1.HttpsError('failed-precondition', 'Not a casino mission.');
    if (mission.state !== 'forming')
        throw new https_1.HttpsError('failed-precondition', 'Casino is no longer forming.');
    const seat = mission.participants?.[uid];
    if (!seat)
        throw new https_1.HttpsError('permission-denied', 'Not seated at this table.');
    if (seat.played)
        throw new https_1.HttpsError('failed-precondition', 'You have already locked your result.');
    return { mission, seat };
}
// Deal a fresh hand. Debits the ante from the player's gold, routes 40% to the pot,
// deals 5 cards (poker) or 2 cards (blackjack) from a freshly shuffled deck.
// Clears startBy — the player has started within their hour window.
exports.dealCasinoHand = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const uid = request.auth.uid;
    const { missionId, game } = request.data;
    if (!missionId || !game)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId or game.');
    if (game !== 'poker' && game !== 'blackjack')
        throw new https_1.HttpsError('invalid-argument', 'Invalid game.');
    const db = (0, database_2.getDatabase)();
    const { seat } = await mustCasinoSeat(db, missionId, uid);
    // Prevent re-dealing if a hand is already in progress (they must fold first).
    if (seat.hand && seat.hand.length > 0)
        throw new https_1.HttpsError('failed-precondition', 'A hand is already in progress. Fold first to redeal.');
    const ante = casinoEngine_1.CASINO_ANTE[game];
    const potCut = Math.floor(ante * casinoEngine_1.CASINO_POT_CUT_PCT);
    const drawCount = game === 'poker' ? 5 : 2;
    // Pre-read the player record to catch a genuinely missing record early.
    // The Admin SDK transaction callback always receives null on its first
    // invocation for any path (regardless of whether data exists), because the
    // SDK assumes no local state and doesn't share the get() cache with the
    // transaction mechanism. Using the pre-read value as a fallback (`?? snap`)
    // lets the transaction return a non-undefined value on that first null call,
    // which causes Firebase to attempt a conditional write. When the server has
    // real data (current ≠ null on the server), the conditional write fails and
    // Firebase retries the callback with the actual data — so the final commit
    // always uses the live server value.
    const playerSnap = await db.ref(`game/players/${uid}`).get();
    if (!playerSnap.exists())
        throw new https_1.HttpsError('not-found', 'Player not found.');
    const snapData = playerSnap.val();
    let abortReason = 'Gold deduction failed.';
    const { committed } = await db.ref(`game/players/${uid}`).transaction((current) => {
        const data = current ?? snapData;
        if (data.disabled) {
            abortReason = 'Account restricted.';
            return undefined;
        }
        const gold = data.gold ?? 0;
        if (gold < ante) {
            abortReason = 'Not enough gold for the ante.';
            return undefined;
        }
        return { ...data, gold: gold - ante };
    });
    if (!committed)
        throw new https_1.HttpsError('failed-precondition', abortReason);
    // Build deck, deal initial hand.
    const deckArr = (0, casinoEngine_1.shuffle)((0, casinoEngine_1.buildDeck)());
    const drawable = (0, casinoEngine_1.makeDrawableDeck)(deckArr);
    const hand = drawable.draw(drawCount);
    const remaining = drawable.toArray();
    await db.ref().update({
        [`game/missions/${missionId}/participants/${uid}/hand`]: hand,
        [`game/missions/${missionId}/participants/${uid}/deck`]: remaining,
        [`game/missions/${missionId}/participants/${uid}/startBy`]: null,
        [`game/missions/${missionId}/participants/${uid}/gameType`]: game,
        [`game/missions/${missionId}/participants/${uid}/rerolled`]: null, // clear from any previous session
        [`game/missions/${missionId}/pot`]: database_2.ServerValue.increment(potCut),
    });
    return { hand, deckRemaining: remaining.length, potAdd: potCut };
});
// Draw action: 'reroll' (poker, replaces rejected cards) or 'hit' (blackjack, draws one more).
// Reroll deducts the reroll cost and routes 40% to the pot.
exports.casinoDraw = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const uid = request.auth.uid;
    const { missionId, action, rejectUids } = request.data;
    if (!missionId || !action)
        throw new https_1.HttpsError('invalid-argument', 'Missing parameters.');
    const db = (0, database_2.getDatabase)();
    const { seat } = await mustCasinoSeat(db, missionId, uid);
    const hand = seat.hand ?? [];
    const deck = seat.deck ?? [];
    if (hand.length === 0)
        throw new https_1.HttpsError('failed-precondition', 'No hand in progress.');
    if (action === 'reroll') {
        if (!rejectUids || rejectUids.length === 0)
            throw new https_1.HttpsError('invalid-argument', 'No cards selected to reroll.');
        if (seat.rerolled)
            throw new https_1.HttpsError('failed-precondition', 'You may only reroll once per hand.');
        if (deck.length < rejectUids.length)
            throw new https_1.HttpsError('failed-precondition', 'Not enough cards left in the deck to reroll.');
        const potCut = Math.floor(casinoEngine_1.CASINO_REROLL_COST * casinoEngine_1.CASINO_POT_CUT_PCT);
        const rerollSnap = await db.ref(`game/players/${uid}`).get();
        if (!rerollSnap.exists())
            throw new https_1.HttpsError('not-found', 'Player not found.');
        const rerollSnapData = rerollSnap.val();
        let abortReason = 'Gold deduction failed.';
        const { committed } = await db.ref(`game/players/${uid}`).transaction((current) => {
            const data = current ?? rerollSnapData;
            const gold = data.gold ?? 0;
            if (gold < casinoEngine_1.CASINO_REROLL_COST) {
                abortReason = 'Not enough gold to reroll.';
                return undefined;
            }
            return { ...data, gold: gold - casinoEngine_1.CASINO_REROLL_COST };
        });
        if (!committed)
            throw new https_1.HttpsError('failed-precondition', abortReason);
        const rejectSet = new Set(rejectUids);
        const drawable = (0, casinoEngine_1.makeDrawableDeck)(deck);
        const fresh = drawable.draw(rejectUids.length);
        let fi = 0;
        const newHand = hand.map((card) => rejectSet.has(card.uid) ? fresh[fi++] : card);
        await db.ref().update({
            [`game/missions/${missionId}/participants/${uid}/hand`]: newHand,
            [`game/missions/${missionId}/participants/${uid}/deck`]: drawable.toArray(),
            [`game/missions/${missionId}/participants/${uid}/rerolled`]: true,
            [`game/missions/${missionId}/pot`]: database_2.ServerValue.increment(potCut),
        });
        return { hand: newHand, deckRemaining: drawable.remaining() };
    }
    if (action === 'hit') {
        if (hand.length >= 6)
            throw new https_1.HttpsError('failed-precondition', 'Maximum 6 cards reached.');
        if (deck.length === 0)
            throw new https_1.HttpsError('failed-precondition', 'Deck is empty.');
        const drawable = (0, casinoEngine_1.makeDrawableDeck)(deck);
        const card = drawable.drawOne();
        const newHand = [...hand, card];
        await db.ref().update({
            [`game/missions/${missionId}/participants/${uid}/hand`]: newHand,
            [`game/missions/${missionId}/participants/${uid}/deck`]: drawable.toArray(),
        });
        return { hand: newHand, deckRemaining: drawable.remaining() };
    }
    throw new https_1.HttpsError('invalid-argument', 'Unknown action.');
});
// Fold the current hand. Clears hand and deck, resets the 1-hour startBy clock.
// The ante already paid is not refunded (40% went to the pot, the rest is the house take).
exports.casinoFold = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const uid = request.auth.uid;
    const { missionId } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const db = (0, database_2.getDatabase)();
    const now = Date.now();
    await mustCasinoSeat(db, missionId, uid);
    await db.ref().update({
        [`game/missions/${missionId}/participants/${uid}/hand`]: null,
        [`game/missions/${missionId}/participants/${uid}/deck`]: null,
        [`game/missions/${missionId}/participants/${uid}/gameType`]: null,
        [`game/missions/${missionId}/participants/${uid}/rerolled`]: null,
        [`game/missions/${missionId}/participants/${uid}/startBy`]: now + 3_600_000,
    });
    return { startBy: now + 3_600_000 };
});
// Play a gambit. Validates the defId, applies it to the shared mission.casinoStats,
// deducts any gold cost from the player, adds to the pot. One gambit per seat.
exports.playCasinoGambit = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const uid = request.auth.uid;
    const { missionId, gambitDefId } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const db = (0, database_2.getDatabase)();
    const { mission, seat } = await mustCasinoSeat(db, missionId, uid);
    if (seat.gambitPlayed)
        throw new https_1.HttpsError('failed-precondition', 'Gambit phase already resolved.');
    if (!seat.hand || seat.hand.length === 0)
        throw new https_1.HttpsError('failed-precondition', 'No committed hand.');
    const updates = {
        [`game/missions/${missionId}/participants/${uid}/gambitPlayed`]: true,
    };
    if (gambitDefId) {
        const gambitDef = casinoEngine_1.GAMBIT_DEFS_BY_ID[gambitDefId];
        if (!gambitDef)
            throw new https_1.HttpsError('invalid-argument', 'Unknown gambit.');
        const currentStats = mission.casinoStats ?? { ...casinoEngine_1.CASINO_START_STATS };
        const result = (0, casinoEngine_1.applyGambit)(currentStats, gambitDef);
        if (gambitDef.goldCost > 0) {
            const gambitSnap = await db.ref(`game/players/${uid}`).get();
            if (!gambitSnap.exists())
                throw new https_1.HttpsError('not-found', 'Player not found.');
            const gambitSnapData = gambitSnap.val();
            let abortReason = 'Gold deduction failed.';
            const { committed } = await db.ref(`game/players/${uid}`).transaction((current) => {
                const data = current ?? gambitSnapData;
                const gold = data.gold ?? 0;
                if (gold < gambitDef.goldCost) {
                    abortReason = 'Not enough gold for this gambit.';
                    return undefined;
                }
                return { ...data, gold: gold - gambitDef.goldCost };
            });
            if (!committed)
                throw new https_1.HttpsError('failed-precondition', abortReason);
        }
        updates[`game/missions/${missionId}/casinoStats`] = result.stats;
        if (result.potAdd > 0) {
            updates[`game/missions/${missionId}/pot`] = database_2.ServerValue.increment(result.potAdd);
        }
        if (gambitDef.xp > 0) {
            updates[`game/missions/${missionId}/participants/${uid}/casinoXp`] =
                database_2.ServerValue.increment(gambitDef.xp);
        }
    }
    await db.ref().update(updates);
    return { ok: true };
});
// Lock in the player's result. Computes goldSwing from the committed hand, writes
// AdvSlots to the participant, marks the seat as played (immutable).
// If this is the last seat needed, triggers the deploy gate check.
exports.lockCasinoResult = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    const uid = request.auth.uid;
    const { missionId, discardUid } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const db = (0, database_2.getDatabase)();
    const now = Date.now();
    const { seat } = await mustCasinoSeat(db, missionId, uid);
    if (!seat.gambitPlayed)
        throw new https_1.HttpsError('failed-precondition', 'Resolve the gambit phase before locking.');
    let hand = seat.hand ?? [];
    if (hand.length === 0)
        throw new https_1.HttpsError('failed-precondition', 'No hand to lock.');
    if (hand.length > 5 && discardUid == null)
        throw new https_1.HttpsError('failed-precondition', 'A 6-card hand requires one discard before locking.');
    if (discardUid != null) {
        hand = hand.filter((c) => c.uid !== discardUid);
        if (hand.length === seat.hand.length)
            throw new https_1.HttpsError('invalid-argument', 'discardUid not found in hand.');
    }
    const goldSwing = (0, casinoEngine_1.handStake)(hand);
    const slots = (0, casinoEngine_1.cardsToSlots)(hand);
    const updates = {
        [`game/missions/${missionId}/participants/${uid}/played`]: true,
        [`game/missions/${missionId}/participants/${uid}/goldSwing`]: goldSwing,
        [`game/missions/${missionId}/participants/${uid}/slots`]: slots,
        [`game/missions/${missionId}/participants/${uid}/hand`]: null,
        [`game/missions/${missionId}/participants/${uid}/deck`]: null,
    };
    await db.ref().update(updates);
    // Re-read mission to check deploy gate.
    const updatedSnap = await db.ref(`game/missions/${missionId}`).get();
    const updated = updatedSnap.val();
    if (gmShouldDeploy(updated, now)) {
        await deployMission(missionId, updated, now);
    }
    return { goldSwing, slots };
});
// ── Admin callables ───────────────────────────────────────────────────────────
async function requireAdmin(uid) {
    const db = (0, database_2.getDatabase)();
    const snap = await db.ref('game/meta/adminId').get();
    if (!snap.exists() || snap.val() !== uid)
        throw new https_1.HttpsError('permission-denied', 'Admin only.');
}
exports.adminKickMissionParticipant = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    await requireAdmin(request.auth.uid);
    const { missionId, playerId } = request.data;
    if (!missionId || !playerId)
        throw new https_1.HttpsError('invalid-argument', 'Missing parameters.');
    const db = (0, database_2.getDatabase)();
    const missionSnap = await db.ref(`game/missions/${missionId}`).get();
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const mission = missionSnap.val();
    if (mission.state !== 'forming' && mission.state !== 'inprogress')
        throw new https_1.HttpsError('failed-precondition', 'Mission is not active.');
    const participant = mission.participants?.[playerId];
    if (!participant)
        throw new https_1.HttpsError('not-found', 'Participant not found.');
    const label = gmMissionLabel(mission);
    const warnRef = db.ref(`game/players/${playerId}/warnings`).push();
    const updates = {
        [`game/missions/${missionId}/participants/${playerId}`]: null,
        [`game/players/${playerId}/activeMission`]: null,
        [`game/players/${playerId}/warnings/${warnRef.key}`]: {
            timestamp: Date.now(),
            message: `Removed from ${label} by admin.`,
            auto: true,
        },
    };
    if (mission.state === 'forming') {
        // Reset the decay timer if this was the last participant.
        const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== playerId);
        if (remaining.length === 0) {
            updates[`game/missions/${missionId}/firstJoinAt`] = null;
        }
    }
    else {
        // inprogress — preserve slot info as a claimable slot for a replacement.
        const slotsToAdd = participant.slots?.length
            ? participant.slots.map(s => ({
                name: s.name, game: s.game,
                ...(s.bonusXP ? { bonusXP: s.bonusXP } : {}),
                ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}),
            }))
            : [{ name: '', game: '' }];
        const claimRef = db.ref(`game/missions/${missionId}/claimableSlots`).push();
        updates[`game/missions/${missionId}/claimableSlots/${claimRef.key}`] = slotsToAdd;
    }
    await db.ref().update(updates);
    return { success: true };
});
exports.adminForceDeploy = (0, https_1.onCall)(async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Not signed in.');
    await requireAdmin(request.auth.uid);
    const { missionId } = request.data;
    if (!missionId)
        throw new https_1.HttpsError('invalid-argument', 'Missing missionId.');
    const db = (0, database_2.getDatabase)();
    const missionSnap = await db.ref(`game/missions/${missionId}`).get();
    if (!missionSnap.exists())
        throw new https_1.HttpsError('not-found', 'Mission not found.');
    const mission = missionSnap.val();
    if (mission.state !== 'forming')
        throw new https_1.HttpsError('failed-precondition', 'Mission is not forming.');
    await deployMission(missionId, mission, Date.now());
    return { success: true };
});
// ── onMissionComplete ─────────────────────────────────────────────────────────
// Mirrors onTileComplete: fires when a completed mission is archived to
// missionsHistory and updates participant profiles with XP snapshot, mission
// count, games from slots, and identity fields.
exports.onMissionComplete = (0, database_1.onValueCreated)('game/missionsHistory/{missionId}', async (event) => {
    const mission = event.data.val();
    if (!mission || mission.state !== 'complete')
        return;
    const db = (0, database_2.getDatabase)();
    const participantIds = Object.keys(mission.participants ?? {});
    if (participantIds.length === 0)
        return;
    const playersSnap = await db.ref('game/players').get();
    const players = playersSnap.val();
    // Batch-read firstEvent for all participants to avoid overwriting an earlier claim.
    const firstEventSnaps = await Promise.all(participantIds.map(uid => db.ref(`profiles/players/${uid}/firstEvent`).get()));
    const firstEventMap = new Map(participantIds.map((uid, i) => [uid, firstEventSnaps[i].val()]));
    const profileUpdates = {};
    for (const [playerId, participant] of Object.entries(mission.participants ?? {})) {
        const player = players?.[playerId];
        if (!player)
            continue;
        const base = `profiles/players/${playerId}`;
        // Identity — kept current on every mission completion.
        profileUpdates[`${base}/id`] = playerId;
        profileUpdates[`${base}/displayName`] = player.displayName;
        profileUpdates[`${base}/discordHandle`] = player.discordHandle ?? null;
        profileUpdates[`${base}/avatarHash`] = player.avatarHash ?? null;
        profileUpdates[`${base}/joinedAt`] = player.joinedAt ?? null;
        if (!firstEventMap.get(playerId)) {
            profileUpdates[`${base}/firstEvent`] = 'rpelago_s1';
        }
        // XP — snapshot of the player's current total (already includes this mission's reward).
        profileUpdates[`${base}/events/rpelago_s1/xp`] = player.xp ?? 0;
        // Missions — separate counter from tiles.
        profileUpdates[`${base}/events/rpelago_s1/missions`] = database_2.ServerValue.increment(1);
        // Games — collect from this participant's slots, same encoding as onTileComplete.
        for (const slot of participant.slots ?? []) {
            if (slot.game?.trim()) {
                profileUpdates[`${base}/events/rpelago_s1/games/${encodeURIComponent(normalizeGameName(slot.game))}`] = true;
            }
        }
        if (player.discordHandle) {
            profileUpdates[`profiles/handleIndex/${player.discordHandle.replace(/\./g, '_')}`] = playerId;
        }
    }
    if (Object.keys(profileUpdates).length > 0) {
        await db.ref().update(profileUpdates);
    }
});
// ── Scheduled tick: auto-deploy cohorts when decay meets fill count ───────────
exports.tickGuildmasterMissions = (0, scheduler_1.onSchedule)('every 15 minutes', async () => {
    const db = (0, database_2.getDatabase)();
    const now = Date.now();
    const snap = await db.ref('game/missions').get();
    if (!snap.exists())
        return;
    const missions = snap.val();
    // Casino pass: auto-stand-down any seated player whose startBy deadline has expired.
    // This runs before the deploy pass so freed seats are visible to shouldDeploy.
    const standDownUpdates = {};
    for (const [id, m] of Object.entries(missions)) {
        if (m.type !== 'casino' || m.state !== 'forming')
            continue;
        let anyRemoved = false;
        for (const [uid, p] of Object.entries(m.participants ?? {})) {
            if (p.startBy && now > p.startBy && !p.played) {
                standDownUpdates[`game/missions/${id}/participants/${uid}`] = null;
                standDownUpdates[`game/players/${uid}/activeMission`] = null;
                delete m.participants[uid];
                anyRemoved = true;
            }
        }
        if (anyRemoved && Object.keys(m.participants ?? {}).length === 0) {
            standDownUpdates[`game/missions/${id}/firstJoinAt`] = null;
            m.firstJoinAt = null;
        }
    }
    if (Object.keys(standDownUpdates).length > 0) {
        await db.ref().update(standDownUpdates);
    }
    // Deploy pass: check all mission types.
    for (const [id, m] of Object.entries(missions)) {
        if (gmShouldDeploy(m, now)) {
            await deployMission(id, m, now);
        }
    }
});
//# sourceMappingURL=index.js.map