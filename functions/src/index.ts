import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onValueWritten } from 'firebase-functions/v2/database';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { defineSecret } from 'firebase-functions/params';

initializeApp();

const discordClientSecret = defineSecret('DISCORD_CLIENT_SECRET');

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

interface DiscordTokenResponse {
  access_token: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export const exchangeDiscordCode = onRequest(
  { secrets: [discordClientSecret], cors: ['https://rpelago.brisbe.org', 'http://localhost:5173'] },
  async (req, res): Promise<void> => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

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
          client_id:     process.env.DISCORD_CLIENT_ID ?? '',
          client_secret: discordClientSecret.value(),
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        res.status(500).json({ error: `Discord token exchange failed: ${body}` });
        return;
      }

      const { access_token } = await tokenRes.json() as DiscordTokenResponse;

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (!userRes.ok) {
        res.status(500).json({ error: 'Failed to fetch Discord user info' });
        return;
      }

      const discordUser = await userRes.json() as DiscordUser;
      const uid         = `discord_${discordUser.id}`;
      const displayName = discordUser.global_name ?? discordUser.username;

      try {
        await getAuth().updateUser(uid, { displayName });
      } catch {
        await getAuth().createUser({ uid, displayName });
      }

      const customToken = await getAuth().createCustomToken(uid, { discordId: discordUser.id });

      // Write a minimal profile stub so the profile site can show an identity card
      // and empty state even before the player completes any tiles.
      const db         = getDatabase();
      const profileRef = db.ref(`profiles/players/${uid}`);
      const [joinedSnap, firstEventSnap] = await Promise.all([
        profileRef.child('joinedAt').get(),
        profileRef.child('firstEvent').get(),
      ]);
      const stub: Record<string, unknown> = {
        id:            uid,
        displayName,
        discordHandle: discordUser.username,
        avatarHash:    discordUser.avatar,
      };
      if (!joinedSnap.exists())    stub.joinedAt   = Date.now();
      if (!firstEventSnap.exists()) stub.firstEvent = null;
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
        const advId    = `${uid}_adv_1`;
        const firstName = ADV_NAMES_FIRST[Math.floor(Math.random() * ADV_NAMES_FIRST.length)];
        const lastName  = ADV_NAMES_LAST[Math.floor(Math.random() * ADV_NAMES_LAST.length)];
        const cls       = ADV_CLASSES[Math.floor(Math.random() * ADV_CLASSES.length)];
        await gamePlayerRef.set({
          id:          uid,
          displayName,
          xp:          0,
          gold:        0,
          adventurers: {
            [advId]: { id: advId, firstName, lastName, cls, busy: false, busyTile: null },
          },
          inventory:     {},
          joinedAt:      Date.now(),
          discordHandle: discordUser.username,
          avatarHash:    discordUser.avatar,
        });
      } else {
        // Returning user — refresh Discord identity fields.
        const gameUpdates: Record<string, unknown> = {
          [`game/players/${uid}/discordHandle`]: discordUser.username,
          [`game/players/${uid}/avatarHash`]:    discordUser.avatar,
        };
        if (!gameJoinedSnap.exists()) {
          gameUpdates[`game/players/${uid}/joinedAt`] = Date.now();
        }
        await db.ref().update(gameUpdates);
      }

      res.json({ customToken, displayName, uid, discordHandle: discordUser.username, avatarHash: discordUser.avatar });
    } catch (err) {
      console.error('exchangeDiscordCode error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── Shop item costs and names (mirrors src/lib/constants.ts SHOP_ITEMS) ───────
const ITEM_COSTS: Record<string, number> = {
  map:                    250,
  scroll_of_magnetism:   1000,
  scroll_of_generosity:  1000,
  coat_of_many_colors:    750,
  wand_of_piercing:       300,
  throwing_dagger:        400,
  ring_of_resistance:     500,
  warhammer:              600,
};

const ITEM_NAMES: Record<string, string> = {
  map:                   'Map',
  scroll_of_magnetism:   'Scroll of Magnetism',
  scroll_of_generosity:  'Scroll of Generosity',
  coat_of_many_colors:   'Coat of Many Colors',
  wand_of_piercing:      'Wand of Piercing',
  throwing_dagger:       'Throwing Dagger',
  ring_of_resistance:    'Ring of Resistance',
  warhammer:             'Warhammer',
};

// Items that cannot be purchased more than once
const NON_CONSUMABLE_ITEMS = new Set(['coat_of_many_colors', 'wand_of_piercing', 'throwing_dagger', 'ring_of_resistance', 'warhammer']);

const ORB_SHOP_COST = 1500;

// ── purchaseShopItem ──────────────────────────────────────────────────────────
export const purchaseShopItem = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { itemId, coord } = request.data as { itemId?: string; coord?: string };
  if (!itemId || !coord) throw new HttpsError('invalid-argument', 'Missing itemId or coord.');

  const uid = request.auth.uid;
  const db  = getDatabase();

  const tileSnap = await db.ref(`game/tiles/${coord}`).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Tile not found.');

  const shopId = (tileSnap.val() as { shopId?: string }).shopId;
  if (!shopId) throw new HttpsError('failed-precondition', 'No shop at this tile.');

  const [shopSnap, playerSnap] = await Promise.all([
    db.ref(`game/shops/${shopId}`).get(),
    db.ref(`game/players/${uid}`).get(),
  ]);

  if (!shopSnap.exists())   throw new HttpsError('not-found', 'Shop not found.');
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');

  const shop   = shopSnap.val()   as { itemIds?: string[]; name?: string };
  const player = playerSnap.val() as { gold: number; displayName: string; inventory?: Record<string, number> };

  if (!(shop.itemIds ?? []).includes(itemId))
    throw new HttpsError('failed-precondition', 'Item not sold at this shop.');

  const cost = ITEM_COSTS[itemId];
  if (cost == null) throw new HttpsError('not-found', 'Unknown item.');
  if (NON_CONSUMABLE_ITEMS.has(itemId) && (player.inventory?.[itemId] ?? 0) > 0)
    throw new HttpsError('failed-precondition', 'Item already owned.');
  if (player.gold < cost) throw new HttpsError('failed-precondition', 'Not enough gold.');

  await db.ref().update({
    [`game/players/${uid}/gold`]:               player.gold - cost,
    [`game/players/${uid}/inventory/${itemId}`]: (player.inventory?.[itemId] ?? 0) + 1,
  });

  const itemName = ITEM_NAMES[itemId] ?? itemId;
  await db.ref('game/activityLog').push().set({
    timestamp: Date.now(),
    type:      'item_purchased',
    message:   `${player.displayName} purchased ${itemName} from ${shop.name ?? shopId}.`,
    icon:      '🛒',
  });

  return { success: true };
});

// ── purchaseShopOrb ───────────────────────────────────────────────────────────
export const purchaseShopOrb = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { coord } = request.data as { coord?: string };
  if (!coord) throw new HttpsError('invalid-argument', 'Missing coord.');

  const uid = request.auth.uid;
  const db  = getDatabase();

  const tileSnap = await db.ref(`game/tiles/${coord}`).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Tile not found.');

  const shopId = (tileSnap.val() as { shopId?: string }).shopId;
  if (!shopId) throw new HttpsError('failed-precondition', 'No shop at this tile.');

  const [shopSnap, playerSnap] = await Promise.all([
    db.ref(`game/shops/${shopId}`).get(),
    db.ref(`game/players/${uid}`).get(),
  ]);

  if (!shopSnap.exists())   throw new HttpsError('not-found', 'Shop not found.');
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');

  const shop   = shopSnap.val()   as { orbId?: string | null; name?: string };
  const player = playerSnap.val() as { gold: number; displayName: string };

  const orbId = shop.orbId ?? null;
  if (!orbId) throw new HttpsError('failed-precondition', 'No orb sold at this shop.');

  if (player.gold < ORB_SHOP_COST)
    throw new HttpsError('failed-precondition', 'Not enough gold.');

  const acquisition = {
    method:    'shop',
    tileCoord: coord,
    tileName:  shop.name ?? coord,
    buyerName: player.displayName,
  };

  // Atomically claim the orb so two concurrent purchases can't both succeed.
  const { committed } = await db.ref(`game/orbState/${orbId}`).transaction(current => {
    if (current !== null) return; // abort — already claimed
    return acquisition;
  });
  if (!committed) throw new HttpsError('already-exists', 'This orb has already been claimed.');

  await db.ref(`game/players/${uid}/gold`).set(player.gold - ORB_SHOP_COST);

  const orbLabel = orbId.charAt(0).toUpperCase() + orbId.slice(1);
  await db.ref('game/activityLog').push().set({
    timestamp: Date.now(),
    type:      'orb_purchased',
    message:   `${player.displayName} purchased the ${orbLabel} Orb from ${shop.name ?? coord}.`,
    icon:      '🔮',
  });

  return { success: true, orbId };
});

// ── onTileComplete ────────────────────────────────────────────────────────────

interface AdvEntry {
  owner:    string;
  ownerName: string;
  slots?: Array<{ game?: string }>;
}

interface PlayerRecord {
  displayName:   string;
  discordHandle?: string;
  avatarHash?:   string | null;
  joinedAt?:     number;
  xp?:           number;
}

function normalizeGameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export const onTileComplete = onValueWritten(
  'game/tiles/{coord}/state',
  async (event) => {
    const prevState = event.data.before.val() as string | null;
    const newState  = event.data.after.val()  as string | null;

    // Only act on the transition into 'complete'; ignore re-writes to an already-complete tile.
    if (newState !== 'complete' || prevState === 'complete') return;

    const coord = event.params.coord;
    const db    = getDatabase();

    // Read tile adventurers and all player records in parallel.
    // tile.adventurers at completion is the canonical claim list: players freed early
    // (slot completion) remain listed here; players who explicitly recalled do not.
    const [advSnap, playersSnap] = await Promise.all([
      db.ref(`game/tiles/${coord}/adventurers`).get(),
      db.ref('game/players').get(),
    ]);

    if (!advSnap.exists()) return;

    const adventurers = advSnap.val() as Record<string, AdvEntry>;
    const players     = playersSnap.val() as Record<string, PlayerRecord> | null;

    // Group adventurers by owner; collect each owner's normalized game names.
    const byOwner = new Map<string, Set<string>>();
    for (const adv of Object.values(adventurers)) {
      if (!byOwner.has(adv.owner)) byOwner.set(adv.owner, new Set());
      const games = byOwner.get(adv.owner)!;
      for (const slot of adv.slots ?? []) {
        if (slot.game?.trim()) games.add(normalizeGameName(slot.game));
      }
    }

    // Batch-read each player's current firstEvent so we only set it when null —
    // preserving a firstEvent from a different event that happened earlier.
    const playerIds = [...byOwner.keys()];
    const firstEventSnaps = await Promise.all(
      playerIds.map(uid => db.ref(`profiles/players/${uid}/firstEvent`).get()),
    );
    const firstEventMap = new Map(
      playerIds.map((uid, i) => [uid, firstEventSnaps[i].val() as string | null]),
    );

    const profileUpdates: Record<string, unknown> = {};

    for (const [playerId, games] of byOwner) {
      const player = players?.[playerId];
      if (!player) continue;

      const base = `profiles/players/${playerId}`;

      // Identity — refreshed on every tile so handle/avatar stay current.
      profileUpdates[`${base}/id`]            = playerId;
      profileUpdates[`${base}/displayName`]   = player.displayName;
      profileUpdates[`${base}/discordHandle`] = player.discordHandle ?? null;
      profileUpdates[`${base}/avatarHash`]    = player.avatarHash    ?? null;
      profileUpdates[`${base}/joinedAt`]      = player.joinedAt      ?? null;

      // Only set firstEvent when it hasn't been claimed by an earlier event.
      if (!firstEventMap.get(playerId)) {
        profileUpdates[`${base}/firstEvent`] = 'rpelago_s1';
      }

      // XP — reflect current value at the moment of tile completion.
      profileUpdates[`${base}/events/rpelago_s1/xp`] = player.xp ?? 0;

      // Tiles — ServerValue.increment avoids read-modify-write race conditions.
      profileUpdates[`${base}/events/rpelago_s1/tiles`] = ServerValue.increment(1);

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
  },
);
