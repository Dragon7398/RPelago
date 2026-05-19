"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTileComplete = exports.purchaseShopOrb = exports.purchaseShopItem = exports.exchangeDiscordCode = void 0;
const https_1 = require("firebase-functions/v2/https");
const database_1 = require("firebase-functions/v2/database");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const database_2 = require("firebase-admin/database");
const params_1 = require("firebase-functions/params");
(0, app_1.initializeApp)();
const discordClientSecret = (0, params_1.defineSecret)('DISCORD_CLIENT_SECRET');
exports.exchangeDiscordCode = (0, https_1.onRequest)({ secrets: [discordClientSecret], cors: true }, async (req, res) => {
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
    if (!(shop.itemIds ?? []).includes(itemId))
        throw new https_1.HttpsError('failed-precondition', 'Item not sold at this shop.');
    const cost = ITEM_COSTS[itemId];
    if (cost == null)
        throw new https_1.HttpsError('not-found', 'Unknown item.');
    if (NON_CONSUMABLE_ITEMS.has(itemId) && (player.inventory?.[itemId] ?? 0) > 0)
        throw new https_1.HttpsError('failed-precondition', 'Item already owned.');
    if (player.gold < cost)
        throw new https_1.HttpsError('failed-precondition', 'Not enough gold.');
    await db.ref().update({
        [`game/players/${uid}/gold`]: player.gold - cost,
        [`game/players/${uid}/inventory/${itemId}`]: (player.inventory?.[itemId] ?? 0) + 1,
    });
    const itemName = ITEM_NAMES[itemId] ?? itemId;
    await db.ref('game/activityLog').push().set({
        timestamp: Date.now(),
        type: 'item_purchased',
        message: `${player.displayName} purchased ${itemName} from ${shop.name ?? shopId}.`,
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
    await db.ref(`game/players/${uid}/gold`).set(player.gold - ORB_SHOP_COST);
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
//# sourceMappingURL=index.js.map