"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseShopOrb = exports.purchaseShopItem = exports.exchangeDiscordCode = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const database_1 = require("firebase-admin/database");
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
        res.json({ customToken, displayName, uid });
    }
    catch (err) {
        console.error('exchangeDiscordCode error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// ── Shop item costs (mirrors src/lib/constants.ts SHOP_ITEMS) ─────────────────
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
    const db = (0, database_1.getDatabase)();
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
    const db = (0, database_1.getDatabase)();
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
    const orbSnap = await db.ref(`game/orbState/${orbId}`).get();
    if (orbSnap.exists())
        throw new https_1.HttpsError('already-exists', 'This orb has already been claimed.');
    if (player.gold < ORB_SHOP_COST)
        throw new https_1.HttpsError('failed-precondition', 'Not enough gold.');
    const acquisition = {
        method: 'shop',
        tileCoord: coord,
        tileName: shop.name ?? coord,
        buyerName: player.displayName,
    };
    await db.ref().update({
        [`game/players/${uid}/gold`]: player.gold - ORB_SHOP_COST,
        [`game/orbState/${orbId}`]: acquisition,
    });
    return { success: true, orbId };
});
//# sourceMappingURL=index.js.map