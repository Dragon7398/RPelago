import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onValueWritten, onValueCreated } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { defineSecret } from 'firebase-functions/params';
import {
  type DeckCard, type CasinoStats, type GambitDef, type CasinoDeckChoice, type CasinoGame,
  CASINO_MIN_ENLIST_GOLD, CASINO_POT_SEED,
  CASINO_START_STATS,
  CASINO_GAMES, CASINO_GAME_ORDER, potContribution, drawCommunity, rollTableSetup,
  initialDealCount, selectCommitted, gambitCasinoGold,
  GAMBIT_DEFS_BY_ID, DECK_VARIANTS,
  buildDeck, shuffle, makeDrawableDeck,
  handStake, applyGambit, rollCasinoOdds, cardsToSlots,
  deckChoiceOf, applyDeckBoost,
} from './casinoEngine';
import {
  sp, secret, getConfig, seasonInfo, isDraftSeason, resolveWriteSeason, tickableSeasons,
  type SeasonShell,
} from './seasonPaths';

// Season gold economy — MUST mirror CASINO_START_GOLD / CASINO_GOLD_FLOOR in
// src/lib/constants.ts (dual-copy, like ITEM_COSTS and the casino engine).
const CASINO_START_GOLD = 500;  // fresh casino player's starting balance
const CASINO_GOLD_FLOOR = 250;  // weekly top-up brings anyone below this up to it

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

// ── Season player records ─────────────────────────────────────────────────────

/**
 * Create a player's record for one season, shaped for that season's shell:
 * a casino season is gold-only (no adventurers/XP/feats), a map season gets the
 * full RPG record. Callers must check the record doesn't already exist.
 */
async function createSeasonPlayer(
  db: ReturnType<typeof getDatabase>,
  seasonId: string,
  shell: SeasonShell,
  uid: string,
  identity: { displayName: string; discordHandle?: string | null; avatarHash?: string | null },
): Promise<void> {
  const base = {
    id:          uid,
    displayName: identity.displayName,
    joinedAt:    Date.now(),
    ...(identity.discordHandle != null ? { discordHandle: identity.discordHandle } : {}),
    ...(identity.avatarHash    != null ? { avatarHash:    identity.avatarHash    } : {}),
  };

  const ref = db.ref(sp(seasonId, `players/${uid}`));
  if (shell === 'casino') {
    await ref.set({ ...base, gold: CASINO_START_GOLD });
    return;
  }

  const advId     = `${uid}_adv_1`;
  const firstName = ADV_NAMES_FIRST[Math.floor(Math.random() * ADV_NAMES_FIRST.length)];
  const lastName  = ADV_NAMES_LAST[Math.floor(Math.random() * ADV_NAMES_LAST.length)];
  const cls       = ADV_CLASSES[Math.floor(Math.random() * ADV_CLASSES.length)];
  await ref.set({
    ...base,
    xp:          0,
    gold:        0,
    adventurers: { [advId]: { id: advId, firstName, lastName, cls, busy: false, busyTile: null } },
    inventory:   {},
  });
}

/**
 * Give the caller a player record in the season they're actually looking at.
 *
 * exchangeDiscordCode only creates a record at Discord sign-in, and only for
 * whatever season was active THEN — so an already-signed-in player (restored
 * session), a season cutover, or an admin/alpha previewing a draft all land in a
 * season with no record and no gold. Idempotent; safe to call on every load.
 */
export const ensureSeasonPlayer = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { seasonId: reqSeason } = request.data as { seasonId?: string };

  const db = getDatabase();
  const { seasonId, status, shell } = await resolveWriteSeason(uid, reqSeason, db);

  // Archived seasons are frozen history — never mint a record into one.
  if (status === 'archived') return { created: false };

  const existing = await db.ref(sp(seasonId, `players/${uid}/id`)).get();
  if (existing.exists()) return { created: false };

  // Identity lives on the cross-season profile stub written at sign-in.
  const profSnap = await db.ref(`profiles/players/${uid}`).get();
  const prof = (profSnap.val() ?? {}) as { displayName?: string; discordHandle?: string | null; avatarHash?: string | null };

  await createSeasonPlayer(db, seasonId, shell, uid, {
    displayName:   prof.displayName ?? 'Unknown',
    discordHandle: prof.discordHandle ?? null,
    avatarHash:    prof.avatarHash ?? null,
  });
  return { created: true };
});

// ── Boss coord computation (mirrors src/lib/tileGen.ts) ───────────────────────
const ROWS = 5, COLS = 7;
const CORNER_POSITIONS: [number, number][] = [
  [0,        0       ],
  [0,        COLS - 1],
  [ROWS - 1, 0       ],
  [ROWS - 1, COLS - 1],
];

function seededShuffleFirst(arr: [number, number][], seed: number): [number, number] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a[0];
}

function bossCoordFromSeed(seed: number): string {
  const [r, c] = seededShuffleFirst(CORNER_POSITIONS, seed ^ 0xDEADBEEF);
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

// ── Elemental orb → boss traits (mirrors src/lib/constants.ts) ────────────────
const ELEMENTAL_ORB_TRAITS: Record<string, string[]> = {
  fire:  ['cursed', 'stunning'],
  air:   ['aerial', 'agile'],
  water: ['camouflage', 'taunt'],
  earth: ['enduring', 'sturdy'],
};
// Traits removable even while boss is in-progress (game already locked)
const BOSS_SOFT_TRAITS = new Set(['camouflage', 'enduring']);

// Firebase Admin SDK may return numeric-keyed data as a sparse JS array; for-of
// on a sparse array yields undefined for holes.  Object.values skips holes
// (and also handles plain objects), so use it unconditionally.
function normalizeArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  return Object.values(val) as T[];
}

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

      // Create or update the ACTIVE SEASON's player record via admin SDK
      // (bypasses security rules). The record shape depends on the season's
      // shell: a casino season has no adventurers/XP/feats, just gold; a map
      // season gets the full RPG record. Blocking on this before returning the
      // token guarantees the record exists the moment the client signs in.
      const config      = await getConfig(db);
      const seasonId    = config.activeSeasonId;
      const shell: SeasonShell = seasonInfo(config, seasonId)?.shell ?? 'map';
      const gamePlayerRef = db.ref(sp(seasonId, `players/${uid}`));
      const [gameExistsSnap, gameJoinedSnap] = await Promise.all([
        gamePlayerRef.child('id').get(),
        gamePlayerRef.child('joinedAt').get(),
      ]);

      if (!gameExistsSnap.exists()) {
        // New user this season — create the record for the season's shell.
        await createSeasonPlayer(db, seasonId, shell, uid, {
          displayName,
          discordHandle: discordUser.username,
          avatarHash:    discordUser.avatar,
        });
      } else {
        // Returning user — refresh Discord identity fields.
        const gameUpdates: Record<string, unknown> = {
          [sp(seasonId, `players/${uid}/discordHandle`)]: discordUser.username,
          [sp(seasonId, `players/${uid}/avatarHash`)]:    discordUser.avatar,
        };
        if (!gameJoinedSnap.exists()) {
          gameUpdates[sp(seasonId, `players/${uid}/joinedAt`)] = Date.now();
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

// Items that cannot be purchased more than once
const NON_CONSUMABLE_ITEMS = new Set(['coat_of_many_colors', 'wand_of_piercing', 'throwing_dagger', 'ring_of_resistance', 'warhammer']);

const ORB_SHOP_COST = 1500;

// ── purchaseShopItem ──────────────────────────────────────────────────────────
export const purchaseShopItem = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { itemId, coord, seasonId: reqSeason } = request.data as { itemId?: string; coord?: string; seasonId?: string };
  if (!itemId || !coord) throw new HttpsError('invalid-argument', 'Missing itemId or coord.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const tileSnap = await db.ref(sp(seasonId, `tiles/${coord}`)).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Tile not found.');

  const shopId = (tileSnap.val() as { shopId?: string }).shopId;
  if (!shopId) throw new HttpsError('failed-precondition', 'No shop at this tile.');

  const shopSnap = await db.ref(sp(seasonId, `shops/${shopId}`)).get();
  if (!shopSnap.exists()) throw new HttpsError('not-found', 'Shop not found.');

  const shop = shopSnap.val() as { itemIds?: string[]; name?: string };
  if (!(shop.itemIds ?? []).includes(itemId))
    throw new HttpsError('failed-precondition', 'Item not sold at this shop.');

  const cost = ITEM_COSTS[itemId];
  if (cost == null) throw new HttpsError('not-found', 'Unknown item.');

  type PlayerData = { displayName: string; gold: number; inventory?: Record<string, number>; disabled?: boolean };

  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const snapData = playerSnap.val() as PlayerData;

  let abortReason = 'Purchase failed. Please try again.';
  const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
    (current: PlayerData | null) => {
      const data = current ?? snapData;
      if (data.disabled) { abortReason = 'Account restricted.'; return undefined; }
      if (data.gold < cost) { abortReason = 'Not enough gold.'; return undefined; }
      if (NON_CONSUMABLE_ITEMS.has(itemId) && (data.inventory?.[itemId] ?? 0) > 0) {
        abortReason = 'Item already owned.'; return undefined;
      }
      return {
        ...data,
        gold:      data.gold - cost,
        inventory: { ...(data.inventory ?? {}), [itemId]: (data.inventory?.[itemId] ?? 0) + 1 },
      };
    },
  );

  if (!committed) throw new HttpsError('failed-precondition', abortReason);

  return { success: true };
});

// ── purchaseShopOrb ───────────────────────────────────────────────────────────
export const purchaseShopOrb = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { coord, seasonId: reqSeason } = request.data as { coord?: string; seasonId?: string };
  if (!coord) throw new HttpsError('invalid-argument', 'Missing coord.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const tileSnap = await db.ref(sp(seasonId, `tiles/${coord}`)).get();
  if (!tileSnap.exists()) throw new HttpsError('not-found', 'Tile not found.');

  const shopId = (tileSnap.val() as { shopId?: string }).shopId;
  if (!shopId) throw new HttpsError('failed-precondition', 'No shop at this tile.');

  const [shopSnap, playerSnap] = await Promise.all([
    db.ref(sp(seasonId, `shops/${shopId}`)).get(),
    db.ref(sp(seasonId, `players/${uid}`)).get(),
  ]);

  if (!shopSnap.exists())   throw new HttpsError('not-found', 'Shop not found.');
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');

  const shop   = shopSnap.val()   as { orbId?: string | null; name?: string };
  const player = playerSnap.val() as { gold: number; displayName: string; disabled?: boolean };

  if (player.disabled) throw new HttpsError('permission-denied', 'Account restricted.');

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
  const { committed } = await db.ref(sp(seasonId, `orbState/${orbId}`)).transaction(current => {
    if (current !== null) return; // abort — already claimed
    return acquisition;
  });
  if (!committed) throw new HttpsError('already-exists', 'This orb has already been claimed.');

  // Deduct gold via transaction so stale snapshot value can't cause incorrect set().
  const snapGold = player.gold;
  let goldAbortReason = 'Gold deduction failed.';
  const { committed: goldCommitted } = await db.ref(sp(seasonId, `players/${uid}/gold`)).transaction(
    (current: number | null) => {
      const gold = typeof current === 'number' ? current : snapGold;
      if (gold < ORB_SHOP_COST) { goldAbortReason = 'Not enough gold.'; return undefined; }
      return gold - ORB_SHOP_COST;
    },
  );
  if (!goldCommitted) {
    try {
      await db.ref(sp(seasonId, `orbState/${orbId}`)).remove();
    } catch (e) {
      console.error(`[purchaseShopOrb] Rollback failed for orb ${orbId}, player ${uid}:`, e);
    }
    throw new HttpsError('failed-precondition', goldAbortReason);
  }

  const orbLabel = orbId.charAt(0).toUpperCase() + orbId.slice(1);
  await db.ref(sp(seasonId, 'activityLog')).push().set({
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
  gold?:         number;
}

function normalizeGameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export const onTileComplete = onValueWritten(
  'seasons/{seasonId}/tiles/{coord}/state',
  async (event) => {
    const prevState = event.data.before.val() as string | null;
    const newState  = event.data.after.val()  as string | null;

    // Only act on the transition into 'complete'; ignore re-writes to an already-complete tile.
    if (newState !== 'complete' || prevState === 'complete') return;

    const seasonId = event.params.seasonId;
    const coord    = event.params.coord;
    const db       = getDatabase();

    // Never write real player history from a draft season being playtested.
    if (await isDraftSeason(seasonId, db)) return;

    // Read tile adventurers and all player records in parallel.
    // tile.adventurers at completion is the canonical claim list: players freed early
    // (slot completion) remain listed here; players who explicitly recalled do not.
    const [advSnap, playersSnap] = await Promise.all([
      db.ref(sp(seasonId, `tiles/${coord}/adventurers`)).get(),
      db.ref(sp(seasonId, 'players')).get(),
    ]);

    if (!advSnap.exists()) return;

    const adventurers = advSnap.val() as Record<string, AdvEntry>;
    const players     = playersSnap.val() as Record<string, PlayerRecord> | null;

    // Group adventurers by owner; collect each owner's normalized game names.
    const byOwner = new Map<string, Set<string>>();
    for (const adv of Object.values(adventurers)) {
      if (!byOwner.has(adv.owner)) byOwner.set(adv.owner, new Set());
      const games = byOwner.get(adv.owner)!;
      for (const slot of normalizeArray(adv.slots)) {
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
        profileUpdates[`${base}/firstEvent`] = seasonId;
      }

      // XP — reflect current value at the moment of tile completion.
      profileUpdates[`${base}/events/${seasonId}/xp`] = player.xp ?? 0;

      // Tiles — ServerValue.increment avoids read-modify-write race conditions.
      profileUpdates[`${base}/events/${seasonId}/tiles`] = ServerValue.increment(1);

      // Games — keyed record (encodedName → true) so each game write is atomic;
      // no pre-read needed and concurrent tile completions don't stomp each other.
      for (const g of games) {
        profileUpdates[`${base}/events/${seasonId}/games/${encodeURIComponent(g)}`] = true;
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

// ── onOrbAcquired ─────────────────────────────────────────────────────────────
// Removes boss traits when an elemental orb is first acquired, regardless of
// which client or Cloud Function wrote the orb. Soft traits (camouflage,
// enduring) are skipped if the boss is already in-progress (YAML locked).

export const onOrbAcquired = onValueCreated(
  'seasons/{seasonId}/orbState/{orbId}',
  async (event) => {
    const seasonId = event.params.seasonId;
    const orbId    = event.params.orbId;
    const traitIds = ELEMENTAL_ORB_TRAITS[orbId];
    if (!traitIds) return; // not an elemental orb

    const db = getDatabase();

    const metaSnap = await db.ref(sp(seasonId, 'meta')).get();
    if (!metaSnap.exists()) return;
    const seed      = (metaSnap.val() as { seed: number }).seed;
    const bossCoord = bossCoordFromSeed(seed);

    const bossSnap = await db.ref(sp(seasonId, `tiles/${bossCoord}`)).get();
    if (!bossSnap.exists()) return;
    const boss = bossSnap.val() as { state: string; traits?: Record<string, { value: number }> };
    if (boss.state === 'complete') return;

    const isInProgress = boss.state === 'inprogress';
    const next: Record<string, { value: number }> = { ...(boss.traits ?? {}) };
    let changed = false;

    for (const traitId of traitIds) {
      if (isInProgress && !BOSS_SOFT_TRAITS.has(traitId)) continue;
      if (traitId in next) { delete next[traitId]; changed = true; }
    }

    if (!changed) return;
    await db.ref(sp(seasonId, `tiles/${bossCoord}/traits`)).set(
      Object.keys(next).length > 0 ? next : null,
    );
  },
);

// ── pruneActivityLog ──────────────────────────────────────────────────────────
// Fires on every new activity log entry and trims the log to 25 entries.

export const pruneActivityLog = onValueCreated(
  'seasons/{seasonId}/activityLog/{entryId}',
  async (event) => {
    const seasonId = event.params.seasonId;
    const db   = getDatabase();
    const snap = await db.ref(sp(seasonId, 'activityLog')).get();
    if (!snap.exists()) return;
    const keys = Object.keys(snap.val() as Record<string, unknown>).sort();
    const MAX  = 25;
    if (keys.length <= MAX) return;
    const updates: Record<string, null> = {};
    for (const k of keys.slice(0, keys.length - MAX)) updates[sp(seasonId, `activityLog/${k}`)] = null;
    await db.ref().update(updates);
  },
);

// ═══════════════════════════════════════════════════════════════════
// Guildmaster Missions
// ═══════════════════════════════════════════════════════════════════

// ── Mission types (mirrors src/types/index.ts) ────────────────────────────────

type GMMissionType  = 'basic' | 'patrol' | 'casino';
type GMMissionState = 'forming' | 'inprogress' | 'complete';
type TriState = 'on' | 'off' | 'special';
type SlotStatus = 'Unstarted' | 'In-Progress' | '100%' | 'Goaled' | 'Done';

interface GMSlot {
  name:       string;
  game:       string;
  details?:   string;
  status?:    SlotStatus;
  bonusXP?:   number;
  bonusGold?: number;
}

interface CasinoLogEntry {
  ts:           number;
  uid:          string;
  playerName:   string;
  event:        'deal' | 'reroll' | 'gambit' | 'lock' | 'fold' | 'playon';
  game?:        CasinoGame;
  amount?:      number;
  potAdd?:      number;
  goldSwing?:   number;
  deckChoice?:  CasinoDeckChoice;
  gambitDefId?: string;
}

interface GMParticipant {
  playerId:     string;
  playerName:   string;
  joinedAt:     number;
  slots?:       GMSlot[];
  statusNote?:  { text: string; timestamp: number };
  // casino-only
  startBy?:     number;                    // deadline to start a casino round (epoch ms)
  played?:      boolean;                   // true once the seat is locked (immutable)
  goldSwing?:   number;                    // sum of committed card values
  casinoXp?:   number;                    // XP this seat contributed via gambits
  gambitPlayed?: boolean;                  // true once the gambit phase is resolved for this seat
  gameType?:    'poker' | 'blackjack';     // which game was chosen (for session recovery)
  rerolled?:    boolean;                   // true once the poker reroll has been used
  deck?:        DeckCard[];               // server-held remaining draw deck (cleared at lock)
  hand?:        DeckCard[];               // cards currently in the player's hand
  deckChoice?:  CasinoDeckChoice;         // which deck variant this seat is drawing from this cohort
  holeLocked?:  boolean;                   // Hold 'Em sitting 1: hole cards anted + locked
  playedOn?:    boolean;                   // Hold 'Em sitting 2: paid the play-on and selected
}

interface GMMission {
  id:           string;
  type:         GMMissionType;
  series:       number;
  label:        string;
  state:        GMMissionState;
  baseMax:      number;
  xp:           number;
  gp:           number;
  traits?:      Record<string, { value: number }>;
  release:      TriState;
  collect:      TriState;
  hint:         number;
  link?:        string;
  tracker?:     string;
  cheese?:      string;
  firstJoinAt:  number | null;
  createdAt:    number;
  deployedAt?:  number;
  participants: Record<string, GMParticipant>;
  claimableSlots?: Record<string, GMSlot[]>;
  // casino-only
  variableReward?: boolean;
  tableUrl?:       string;
  entryCosts?:     { label: string; gold: number }[];
  pot?:            number;
  casinoStats?:    CasinoStats;
  casinoOpenStats?: CasinoStats;                    // the odds rolled at creation, frozen
  casinoLog?:      Record<string, CasinoLogEntry>;
  casinoGame?:     CasinoGame;                      // which game this table is pinned to
  community?:      DeckCard[];                       // Hold 'Em: shared PUBLIC community cards
  communityDrawnAt?: number;                        // Hold 'Em: phase-2 gate / draw timestamp
}

// ── Tile types (minimal, mirrors src/types/index.ts) ─────────────────────────

interface TileSlot {
  name:    string;
  status?: SlotStatus;
  room?:   1 | 2;
}

interface TileAdv {
  advId:  string;
  owner:  string;
  room?:  1 | 2;
  slots?: TileSlot[];
}

interface Tile {
  state:        string;
  adventurers?: Record<string, TileAdv>;
  traits?:      Record<string, unknown>;
  cheese?:      string;
  cheese2?:     string;
  publicSlots?: TileSlot[];
}

// ── Mission definitions (mirrors src/lib/constants.ts MISSION_DEFS) ──────────

interface MissionDef {
  label:       string;
  baseMax:     number;
  xp:          number;
  gp:          number;
  traits:      Record<string, { value: number }> | null;
  release:     TriState;
  collect:     TriState;
  hint:        number;
  special:     boolean;
  // casino-only
  variableReward?: boolean;
  tableUrl?:       string;
  entryCosts?:     { label: string; gold: number }[];
  potSeed?:        number;
}

// Season-end control is now data-driven: cohort respawn is gated on the season's
// `status` (see gmSpawnAllowed) rather than a hand-flipped constant.

const MISSION_DEFS: Record<GMMissionType, MissionDef> = {
  basic: {
    label:   'Basic Training',
    baseMax: 5,
    xp:      100,
    gp:      0,
    traits:  { sturdy: { value: 150 } },
    release: 'on',
    collect: 'off',
    hint:    8,
    special: true,
  },
  patrol: {
    label:   'Patrol',
    baseMax: 8,
    xp:      50,
    gp:      50,
    traits:  null,
    release: 'on',
    collect: 'off',
    hint:    10,
    special: false,
  },
  casino: {
    label:   'A Night at the Casino',
    baseMax: 6,
    xp:      50,
    gp:      0,
    traits:  null,
    release: 'special',
    collect: 'special',
    hint:    10,
    special: false,
    variableReward: true,
    tableUrl:       '/casino/table',
    entryCosts: [
      { label: 'Poker ante',     gold: 40 },
      { label: 'Blackjack ante', gold: 30 },
      { label: 'Reroll',         gold: 20 },
    ],
    potSeed: CASINO_POT_SEED,
  },
};

function toRoman(n: number): string {
  const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const syms = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) { result += syms[i]; n -= vals[i]; }
  }
  return result || String(n);
}

// ── Mission logic helpers ─────────────────────────────────────────────────────

function gmDecayWindowMs(m: GMMission): number {
  return m.type === 'casino' ? 36 * 3600_000 : 24 * 3600_000;
}

function gmCurrentMaxSlots(m: GMMission, now: number): number {
  if (m.firstJoinAt == null) return m.baseMax;
  const steps = Math.floor((now - m.firstJoinAt) / gmDecayWindowMs(m));
  return Math.max(1, m.baseMax - steps);
}

function gmFilledCount(m: GMMission): number {
  return Object.keys(m.participants ?? {}).length;
}

function gmShouldDeploy(m: GMMission, now: number): boolean {
  if (m.state !== 'forming') return false;
  if (gmFilledCount(m) === 0) return false;
  if (gmFilledCount(m) < gmCurrentMaxSlots(m, now)) return false;
  if (m.type === 'casino') {
    const parts = Object.values(m.participants ?? {});
    if (!parts.every(p => p.played === true)) return false;
  }
  return true;
}

function gmFreshMission(type: GMMissionType, series: number, now: number): Omit<GMMission, 'id'> {
  const def = MISSION_DEFS[type];
  const result: Omit<GMMission, 'id'> = {
    type,
    series,
    label:        def.label,
    state:        'forming',
    baseMax:      def.baseMax,
    xp:           def.xp,
    gp:           def.gp,
    release:      def.release,
    collect:      def.collect,
    hint:         def.hint,
    firstJoinAt:  null,
    createdAt:    now,
    participants: {},
  };
  if (def.traits) result.traits = { ...def.traits };
  if (type === 'casino') {
    result.variableReward = true;
    result.tableUrl       = def.tableUrl;
    result.entryCosts     = def.entryCosts ? [...def.entryCosts] : [];
    result.pot            = CASINO_POT_SEED;
    result.casinoStats    = { ...CASINO_START_STATS };
  }
  return result;
}

function gmMissionLabel(m: GMMission): string {
  const roman = toRoman(m.series);
  return `${m.label} · Cohort ${roman}`;
}

// ── Casino multi-table model (mirror of src/lib/missionLogic.ts) ─────────────
// Keep in sync with casinoEntryCosts / pickNextCasinoGame / freshCasinoTable.

function gmCasinoEntryCosts(game: CasinoGame): { label: string; gold: number }[] {
  const g = CASINO_GAMES[game];
  const costs: { label: string; gold: number }[] = [{ label: 'Ante', gold: g.ante }];
  if (g.reroll) costs.push({ label: 'Reroll',  gold: g.rerollCost });
  if (g.playOn) costs.push({ label: 'Play-on', gold: g.playOn });
  return costs;
}

// Random game among the type(s) with the fewest currently-forming tables, so no
// game can be starved (which would make the all-four-games Coat unearnable).
function gmPickNextCasinoGame(
  missions: Record<string, GMMission> | undefined,
  rng: () => number = Math.random,
): CasinoGame {
  const counts: Record<CasinoGame, number> = {
    five_card_draw: 0, seven_card_stud: 0, holdem: 0, blackjack: 0,
  };
  for (const m of Object.values(missions ?? {})) {
    if (m.type === 'casino' && m.state === 'forming' && m.casinoGame) counts[m.casinoGame]++;
  }
  const min = Math.min(...CASINO_GAME_ORDER.map(g => counts[g]));
  const candidates = CASINO_GAME_ORDER.filter(g => counts[g] === min);
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
}

function gmFreshCasinoTable(game: CasinoGame, series: number, now: number, rng: () => number = Math.random): Omit<GMMission, 'id'> {
  const setup = rollTableSetup(rng);
  return {
    type:           'casino',
    casinoGame:     game,
    series,
    label:          CASINO_GAMES[game].label,
    state:          'forming',
    baseMax:        setup.seats,
    xp:             setup.stats.xp,
    gp:             0,
    release:        'special',
    collect:        'special',
    hint:           setup.stats.hint,
    firstJoinAt:    null,
    createdAt:      now,
    participants:   {},
    variableReward: true,
    tableUrl:       '/casino/table',
    entryCosts:     gmCasinoEntryCosts(game),
    pot:            setup.pot,
    casinoStats:    setup.stats,
    // Frozen copy of the same roll — gambits mutate casinoStats, so drift is
    // only measurable against this. Mirror of freshCasinoTable.
    casinoOpenStats: { ...setup.stats },
  };
}

// Next per-game cohort number — a persisted counter, transaction-incremented so
// concurrent table spawns never hand out duplicate cohort numbers.
async function gmNextCasinoSeries(db: ReturnType<typeof getDatabase>, seasonId: string, game: CasinoGame): Promise<number> {
  const res = await db.ref(sp(seasonId, `casinoSeries/${game}`)).transaction((cur: number | null) => (cur ?? 0) + 1);
  return (res.snapshot.val() as number) ?? 1;
}

// New mission cohorts spawn only while the season is draft or active (not while
// closing or archived — that's how a season winds down).
async function gmSpawnAllowed(db: ReturnType<typeof getDatabase>, seasonId: string): Promise<boolean> {
  const info = seasonInfo(await getConfig(db), seasonId);
  return info != null && (info.status === 'active' || info.status === 'draft');
}



// ── Deploy routine ────────────────────────────────────────────────────────────

async function deployMission(seasonId: string, missionId: string, m: GMMission, now: number): Promise<void> {
  const db    = getDatabase();
  const label = gmMissionLabel(m);

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/state`)]:      'inprogress',
    [sp(seasonId, `missions/${missionId}/deployedAt`)]: now,
  };

  // Spawn a replacement cohort on deploy — unless the season is winding down
  // (closing/archived). A casino table spawns a min-count replacement table
  // (holding the open-table count); other mission types spawn a same-type cohort.
  if (await gmSpawnAllowed(db, seasonId)) {
    const newRef = db.ref(sp(seasonId, 'missions')).push();
    const newId  = newRef.key!;
    if (m.type === 'casino') {
      const msnap    = await db.ref(sp(seasonId, 'missions')).get();
      const missions = (msnap.val() as Record<string, GMMission>) ?? {};
      delete missions[missionId];   // the deploying table is leaving 'forming'
      const game   = gmPickNextCasinoGame(missions);
      const series = await gmNextCasinoSeries(db, seasonId, game);
      updates[sp(seasonId, `missions/${newId}`)] = { ...gmFreshCasinoTable(game, series, now), id: newId };
    } else {
      updates[sp(seasonId, `missions/${newId}`)] = { ...gmFreshMission(m.type, m.series + 1, now), id: newId };
    }
  }

  // Casino: roll the release/collect odds from the settled casinoStats, lock xp/hint,
  // and clear per-seat deck data (no longer needed once deployed).
  if (m.type === 'casino' && m.casinoStats) {
    const { releaseOn, collectOn } = rollCasinoOdds(m.casinoStats);
    updates[sp(seasonId, `missions/${missionId}/release`)] = releaseOn ? 'on' : 'off';
    updates[sp(seasonId, `missions/${missionId}/collect`)] = collectOn ? 'on' : 'off';
    updates[sp(seasonId, `missions/${missionId}/hint`)]    = m.casinoStats.hint;
    updates[sp(seasonId, `missions/${missionId}/xp`)]      = m.casinoStats.xp;
    // Secrets live outside the season tree — clear the draw deck there.
    for (const uid of Object.keys(m.participants ?? {})) {
      updates[secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)] = null;
    }
  }

  // Notify each enrolled participant via push-keyed notification
  for (const uid of Object.keys(m.participants ?? {})) {
    const notifRef = db.ref(sp(seasonId, `notifications/${uid}`)).push();
    updates[sp(seasonId, `notifications/${uid}/${notifRef.key}`)] = {
      type:  'mission_deploy',
      label,
      ts:    now,
    };
  }

  await db.ref().update(updates);

  await db.ref(sp(seasonId, 'activityLog')).push().set({
    timestamp: now,
    type:      'mission_deploy',
    message:   `${label} has deployed.`,
    icon:      '⚜',
  });
}

// ── Player callables ──────────────────────────────────────────────────────────

export const enlistInMission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const [playerSnap, missionSnap] = await Promise.all([
    db.ref(sp(seasonId, `players/${uid}`)).get(),
    db.ref(sp(seasonId, `missions/${missionId}`)).get(),
  ]);

  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');

  const player  = playerSnap.val() as { displayName: string; gold: number; activeMission?: string | null; basicTrainingDone?: boolean; disabled?: boolean };
  const mission = missionSnap.val() as GMMission;

  if (player.disabled) throw new HttpsError('permission-denied', 'Account restricted.');
  if (player.activeMission) throw new HttpsError('failed-precondition', 'already-on-mission');
  if (mission.state !== 'forming') throw new HttpsError('failed-precondition', 'Mission is not forming.');
  if (mission.type === 'basic' && player.basicTrainingDone)
    throw new HttpsError('failed-precondition', 'basic-training-used');
  if (gmFilledCount(mission) >= gmCurrentMaxSlots(mission, now))
    throw new HttpsError('failed-precondition', 'Mission is full.');
  if (mission.type === 'casino' && (player.gold ?? 0) < CASINO_MIN_ENLIST_GOLD)
    throw new HttpsError('failed-precondition', 'not-enough-gold');

  const participant: GMParticipant = {
    playerId:   uid,
    playerName: player.displayName,
    joinedAt:   now,
    ...(mission.type === 'casino' ? { startBy: now + 3_600_000 } : {}),
  };

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${uid}`)]: participant,
    [sp(seasonId, `players/${uid}/activeMission`)]:              missionId,
  };
  if (mission.firstJoinAt == null) {
    updates[sp(seasonId, `missions/${missionId}/firstJoinAt`)] = now;
  }

  await db.ref().update(updates);

  // Re-read updated mission to check if deploy fires
  const updatedSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  const updated = updatedSnap.val() as GMMission;
  if (gmShouldDeploy(updated, now)) {
    await deployMission(seasonId, missionId, updated, now);
  }

  return { success: true };
});

export const standDownFromMission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const missionSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');

  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming')
    throw new HttpsError('failed-precondition', 'mission-committed');
  if (!(uid in (mission.participants ?? {})))
    throw new HttpsError('failed-precondition', 'not-a-participant');

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${uid}`)]: null,
    [sp(seasonId, `players/${uid}/activeMission`)]:              null,
  };

  const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== uid);
  if (remaining.length === 0) {
    updates[sp(seasonId, `missions/${missionId}/firstJoinAt`)] = null;
  }

  await db.ref().update(updates);
  return { success: true };
});

export const setMissionParticipantStatusNote = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId, note, seasonId: reqSeason } = request.data as { missionId?: string; note?: string | null; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const missionSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (!(uid in (mission.participants ?? {})))
    throw new HttpsError('failed-precondition', 'Not a participant.');

  const path = sp(seasonId, `missions/${missionId}/participants/${uid}/statusNote`);
  if (note == null) {
    await db.ref(path).remove();
  } else {
    await db.ref(path).set({ text: note, timestamp: Date.now() });
  }
  return { success: true };
});

// ── Claim an open spot on an in-progress mission (kicked player replacement) ──

export const claimMissionSlot = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId, slotKey, seasonId: reqSeason } = request.data as { missionId?: string; slotKey?: string; seasonId?: string };
  if (!missionId || !slotKey) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);

  const [playerSnap, missionSnap] = await Promise.all([
    db.ref(sp(seasonId, `players/${uid}`)).get(),
    db.ref(sp(seasonId, `missions/${missionId}`)).get(),
  ]);

  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');

  const player  = playerSnap.val() as { displayName: string; activeMission?: string | null; basicTrainingDone?: boolean; disabled?: boolean };
  const mission = missionSnap.val() as GMMission;

  if (player.disabled)      throw new HttpsError('permission-denied',  'Account restricted.');
  if (player.activeMission) throw new HttpsError('failed-precondition', 'already-on-mission');
  if (mission.state !== 'inprogress')
    throw new HttpsError('failed-precondition', 'Mission is not in progress.');
  if (uid in (mission.participants ?? {}))
    throw new HttpsError('failed-precondition', 'already-a-participant');
  if (mission.type === 'basic' && player.basicTrainingDone)
    throw new HttpsError('failed-precondition', 'basic-training-used');

  const slotSnap = await db.ref(sp(seasonId, `missions/${missionId}/claimableSlots/${slotKey}`)).get();
  if (!slotSnap.exists()) throw new HttpsError('not-found', 'Slot no longer available.');

  const inheritedSlots = slotSnap.val() as GMSlot[] | null;
  const participant: GMParticipant = {
    playerId:   uid,
    playerName: player.displayName,
    joinedAt:   now,
    ...(inheritedSlots?.length ? { slots: inheritedSlots } : {}),
  };

  await db.ref().update({
    [sp(seasonId, `missions/${missionId}/claimableSlots/${slotKey}`)]: null,
    [sp(seasonId, `missions/${missionId}/participants/${uid}`)]:        participant,
    [sp(seasonId, `players/${uid}/activeMission`)]:                    missionId,
  });

  return { success: true };
});

// ── Casino callables ──────────────────────────────────────────────────────────

// Shared guard: reads and validates that the caller is seated and hasn't locked yet.
//
// The seat's `deck` and `hand` are SECRETS and live in seasonSecrets/, not on
// the participant record. We read them separately and splice them onto the
// returned seat so all downstream `seat.hand` / `seat.deck` access is unchanged.
async function mustCasinoSeat(
  db: ReturnType<typeof getDatabase>,
  seasonId: string,
  missionId: string,
  uid: string,
): Promise<{ mission: GMMission; seat: GMParticipant }> {
  const [snap, deckSnap, handSnap] = await Promise.all([
    db.ref(sp(seasonId, `missions/${missionId}`)).get(),
    db.ref(secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)).get(),
    db.ref(secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)).get(),
  ]);
  if (!snap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = snap.val() as GMMission;
  if (mission.type !== 'casino') throw new HttpsError('failed-precondition', 'Not a casino mission.');
  if (mission.state !== 'forming') throw new HttpsError('failed-precondition', 'Casino is no longer forming.');
  const rawSeat = mission.participants?.[uid];
  if (!rawSeat) throw new HttpsError('permission-denied', 'Not seated at this table.');
  if (rawSeat.played) throw new HttpsError('failed-precondition', 'You have already locked your result.');
  const seat: GMParticipant = {
    ...rawSeat,
    deck: deckSnap.exists() ? (deckSnap.val() as DeckCard[]) : undefined,
    hand: handSnap.exists() ? (handSnap.val() as DeckCard[]) : undefined,
  };
  return { mission, seat };
}

// Append one audit-trail entry for a money-moving or outcome casino event.
// Returns an [path, value] pair to merge into the caller's own update() call
// so the log write stays atomic with whatever state change it's describing.
function casinoLogWrite(
  db: ReturnType<typeof getDatabase>,
  seasonId: string,
  missionId: string,
  entry: Omit<CasinoLogEntry, 'ts'>,
): [string, CasinoLogEntry] {
  const key = db.ref(sp(seasonId, `missions/${missionId}/casinoLog`)).push().key!;
  return [sp(seasonId, `missions/${missionId}/casinoLog/${key}`), { ts: Date.now(), ...entry }];
}

// Set (or change) which deck variant this seat draws from. Allowed any time the
// seat isn't mid-round; frozen once a hand has been dealt until it's locked or folded.
// Also remembers the choice on the player's own record as next cohort's default.
export const setCasinoDeckChoice = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, deckChoice, seasonId: reqSeason } = request.data as { missionId?: string; deckChoice?: CasinoDeckChoice; seasonId?: string };
  if (!missionId || !deckChoice) throw new HttpsError('invalid-argument', 'Missing missionId or deckChoice.');
  if (!DECK_VARIANTS[deckChoice]) throw new HttpsError('invalid-argument', 'Unknown deck.');

  const db = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { seat } = await mustCasinoSeat(db, seasonId, missionId, uid);
  if (seat.hand && seat.hand.length > 0)
    throw new HttpsError('failed-precondition', 'Finish or fold your current hand first.');

  await db.ref().update({
    [sp(seasonId, `missions/${missionId}/participants/${uid}/deckChoice`)]: deckChoice,
    [sp(seasonId, `players/${uid}/preferredDeckChoice`)]:                   deckChoice,
  });
  return { deckChoice };
});

// Deal a fresh hand. Debits the ante from the player's gold, routes 40% to the pot,
// deals 5 cards (poker) or 2 cards (blackjack) from a freshly shuffled deck.
// Clears startBy — the player has started within their hour window.
export const dealCasinoHand = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);

  // The game is fixed by the table (multi-table model). Hold 'Em has its own
  // two-sitting callables (dealHoldemHole / holdemPlayOn).
  const game = mission.casinoGame;
  if (!game) throw new HttpsError('failed-precondition', 'This table has no game assigned.');
  if (game === 'holdem')
    throw new HttpsError('failed-precondition', "Use the Hold 'Em table flow for this game.");

  // Prevent re-dealing if a hand is already in progress (they must fold first).
  if (seat.hand && seat.hand.length > 0)
    throw new HttpsError('failed-precondition', 'A hand is already in progress. Fold first to redeal.');

  const ante      = CASINO_GAMES[game].ante;      // per-variant cost model
  const potCut    = potContribution(ante);
  const drawCount = initialDealCount(game);        // FCD 5 · Stud 7 · Blackjack 2

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
  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const snapData = playerSnap.val() as { gold?: number; disabled?: boolean };

  let abortReason = 'Gold deduction failed.';
  const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
    (current: { gold?: number; disabled?: boolean } | null) => {
      const data = current ?? snapData;
      if (data.disabled) { abortReason = 'Account restricted.'; return undefined; }
      const gold = data.gold ?? 0;
      if (gold < ante) { abortReason = 'Not enough gold for the ante.'; return undefined; }
      return { ...data, gold: gold - ante };
    },
  );
  if (!committed) throw new HttpsError('failed-precondition', abortReason);

  // Build deck (respecting this seat's chosen deck variant), deal initial hand.
  const choice   = deckChoiceOf(seat);
  const deckArr  = shuffle(buildDeck(DECK_VARIANTS[choice].excludeTypes));
  const drawable = makeDrawableDeck(deckArr);
  const hand     = drawable.draw(drawCount);
  const remaining = drawable.toArray();

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'deal', game, amount: ante, potAdd: potCut,
  });

  // hand & deck are SECRETS → seasonSecrets/. Everything else on the seat is public.
  await db.ref().update({
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]: hand,
    [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]: remaining,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/startBy`)]:  null,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/rerolled`)]: null,  // clear from any previous session
    [sp(seasonId, `missions/${missionId}/pot`)]: ServerValue.increment(potCut),
    [logPath]: logEntry,
  });

  return { hand, deckRemaining: remaining.length, potAdd: potCut };
});

// Draw action: 'reroll' (poker, replaces rejected cards) or 'hit' (blackjack, draws one more).
// Reroll deducts the reroll cost and routes 40% to the pot.
export const casinoDraw = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, action, rejectUids, seasonId: reqSeason } = request.data as {
    missionId?: string;
    action?: 'reroll' | 'hit';
    rejectUids?: number[];
    seasonId?: string;
  };
  if (!missionId || !action) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const db = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);

  const game = mission.casinoGame;
  if (!game || game === 'holdem')
    throw new HttpsError('failed-precondition', 'This table has no reroll/hit action.');
  const cfg  = CASINO_GAMES[game];
  const hand = seat.hand ?? [];
  const deck = seat.deck ?? [];
  if (hand.length === 0) throw new HttpsError('failed-precondition', 'No hand in progress.');

  if (action === 'reroll') {
    if (!cfg.reroll)
      throw new HttpsError('failed-precondition', 'This game has no reroll.');
    if (!rejectUids || rejectUids.length === 0)
      throw new HttpsError('invalid-argument', 'No cards selected to reroll.');
    if (seat.rerolled)
      throw new HttpsError('failed-precondition', 'You may only reroll once per hand.');
    if (deck.length < rejectUids.length)
      throw new HttpsError('failed-precondition', 'Not enough cards left in the deck to reroll.');

    const rerollCost = cfg.rerollCost;
    const potCut     = potContribution(rerollCost);
    const rerollSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
    if (!rerollSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
    const rerollSnapData = rerollSnap.val() as { gold?: number };
    let abortReason = 'Gold deduction failed.';
    const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
      (current: { gold?: number } | null) => {
        const data = current ?? rerollSnapData;
        const gold = data.gold ?? 0;
        if (gold < rerollCost) { abortReason = 'Not enough gold to reroll.'; return undefined; }
        return { ...data, gold: gold - rerollCost };
      },
    );
    if (!committed) throw new HttpsError('failed-precondition', abortReason);

    const rejectSet = new Set(rejectUids);
    const drawable  = makeDrawableDeck(deck);
    const fresh     = drawable.draw(rejectUids.length);
    let fi = 0;
    const newHand = hand.map((card: DeckCard) => rejectSet.has(card.uid) ? fresh[fi++] : card);

    const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
      uid, playerName: seat.playerName, event: 'reroll', game,
      amount: rerollCost, potAdd: potCut,
    });

    await db.ref().update({
      [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]: newHand,
      [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]: drawable.toArray(),
      [sp(seasonId, `missions/${missionId}/participants/${uid}/rerolled`)]: true,
      [sp(seasonId, `missions/${missionId}/pot`)]: ServerValue.increment(potCut),
      [logPath]: logEntry,
    });
    return { hand: newHand, deckRemaining: drawable.remaining() };
  }

  if (action === 'hit') {
    if (game !== 'blackjack')
      throw new HttpsError('failed-precondition', 'This game has no hit.');
    if (hand.length >= cfg.maxDraw) throw new HttpsError('failed-precondition', `Maximum ${cfg.maxDraw} cards reached.`);
    if (deck.length === 0) throw new HttpsError('failed-precondition', 'Deck is empty.');
    const drawable = makeDrawableDeck(deck);
    const card     = drawable.drawOne();
    const newHand  = [...hand, card];
    await db.ref().update({
      [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]: newHand,
      [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]: drawable.toArray(),
    });
    return { hand: newHand, deckRemaining: drawable.remaining() };
  }

  throw new HttpsError('invalid-argument', 'Unknown action.');
});

// Fold the current hand. Clears hand and deck, resets the 1-hour startBy clock.
// The ante already paid is not refunded (40% went to the pot, the rest is the house take).
export const casinoFold = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'fold', game: mission.casinoGame,
  });

  await db.ref().update({
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]:        null,
    [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]:        null,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/rerolled`)]:    null,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/gambitPlayed`)]: null,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/startBy`)]:     now + 3_600_000,
    [logPath]: logEntry,
  });
  return { startBy: now + 3_600_000 };
});

// Play a gambit. Validates the defId, applies it to the shared mission.casinoStats,
// deducts any gold cost from the player, adds to the pot. One gambit per seat.
export const playCasinoGambit = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, gambitDefId, seasonId: reqSeason } = request.data as { missionId?: string; gambitDefId?: string | null; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db = getDatabase();
  const { seasonId, shell } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);

  if (seat.gambitPlayed) throw new HttpsError('failed-precondition', 'Gambit phase already resolved.');
  if (!seat.hand || seat.hand.length === 0) throw new HttpsError('failed-precondition', 'No committed hand.');

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${uid}/gambitPlayed`)]: true,
  };

  if (gambitDefId) {
    const gambitDef = GAMBIT_DEFS_BY_ID[gambitDefId] as GambitDef | undefined;
    if (!gambitDef) throw new HttpsError('invalid-argument', 'Unknown gambit.');

    const currentStats: CasinoStats = mission.casinoStats ?? { ...CASINO_START_STATS };
    const result = applyGambit(currentStats, gambitDef);

    if (gambitDef.goldCost > 0) {
      // Bonus gambit — the player PAYS gold to improve the room's shared odds.
      const gambitSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
      if (!gambitSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
      const gambitSnapData = gambitSnap.val() as { gold?: number };
      let abortReason = 'Gold deduction failed.';
      const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
        (current: { gold?: number } | null) => {
          const data = current ?? gambitSnapData;
          const gold = data.gold ?? 0;
          if (gold < gambitDef.goldCost) { abortReason = 'Not enough gold for this gambit.'; return undefined; }
          return { ...data, gold: gold - gambitDef.goldCost };
        },
      );
      if (!committed) throw new HttpsError('failed-precondition', abortReason);
    }

    // Penalty gambit reward: in a CASINO season the (inert) XP is paid to the
    // player as gold (xp × rate) and the XP is NOT accrued; in a map season the
    // XP is awarded normally. Bonuses have xp 0, so neither branch fires.
    const casinoGold = shell === 'casino' ? gambitCasinoGold(gambitDef) : 0;
    let logAmount = gambitDef.goldCost;                 // + = paid by player
    if (gambitDef.xp > 0) {
      if (shell === 'casino') {
        updates[sp(seasonId, `players/${uid}/gold`)] = ServerValue.increment(casinoGold);
        logAmount = -casinoGold;                        // − = paid TO the player (gold entering the economy)
      } else {
        updates[sp(seasonId, `missions/${missionId}/participants/${uid}/casinoXp`)] =
          ServerValue.increment(gambitDef.xp);
      }
    }

    // In a casino season the gambit XP is converted to gold, so don't let it
    // accrue into the (inert) shared xp floor.
    updates[sp(seasonId, `missions/${missionId}/casinoStats`)] =
      shell === 'casino' ? { ...result.stats, xp: currentStats.xp } : result.stats;
    if (result.potAdd > 0) {
      updates[sp(seasonId, `missions/${missionId}/pot`)] = ServerValue.increment(result.potAdd);
    }

    const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
      uid, playerName: seat.playerName, event: 'gambit', gambitDefId,
      amount: logAmount, potAdd: result.potAdd,
    });
    updates[logPath] = logEntry;
  }

  await db.ref().update(updates);
  return { ok: true };
});

// Lock in the player's result. Computes goldSwing from the committed hand, writes
// AdvSlots to the participant, marks the seat as played (immutable).
// If this is the last seat needed, triggers the deploy gate check.
export const lockCasinoResult = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, keepUids, seasonId: reqSeason } = request.data as {
    missionId?: string;
    keepUids?: number[] | null;   // cards to commit (≤ pickMax); omit to commit the whole hand
    seasonId?: string;
  };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);

  if (!seat.gambitPlayed)
    throw new HttpsError('failed-precondition', 'Resolve the gambit phase before locking.');

  const rawHand = seat.hand ?? [];
  if (rawHand.length === 0) throw new HttpsError('failed-precondition', 'No hand to lock.');

  // Validate the committed selection against the game's pickMax (≤5 everywhere).
  // Blackjack is push-your-luck: every drawn card is a committed game, and a seat
  // may discard AT MOST one (mandatory at the six-card cap). So its floor is
  // handLength−1 — you cannot cherry-pick a big hand down to a couple of cards.
  const pickMax = mission.casinoGame ? CASINO_GAMES[mission.casinoGame].pickMax : 5;
  const minKeep = mission.casinoGame === 'blackjack' ? Math.max(1, rawHand.length - 1) : 1;
  const sel = selectCommitted(rawHand, keepUids, pickMax, minKeep);
  if (!sel.ok) throw new HttpsError('invalid-argument', sel.reason);
  const hand = sel.committed;

  const choice    = deckChoiceOf(seat);
  const goldSwing = applyDeckBoost(handStake(hand), choice);
  const slots     = cardsToSlots(hand);

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'lock', game: mission.casinoGame, goldSwing, deckChoice: choice,
  });

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${uid}/played`)]:    true,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/goldSwing`)]: goldSwing,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/slots`)]:     slots,
    // Clear the secret hand/deck now that the seat is locked.
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]:  null,
    [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]:  null,
    [logPath]: logEntry,
  };
  await db.ref().update(updates);

  // Re-read mission to check deploy gate.
  const updatedSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  const updated = updatedSnap.val() as GMMission;
  if (gmShouldDeploy(updated, now)) {
    await deployMission(seasonId, missionId, updated, now);
  }

  return { goldSwing, slots };
});

// ── Texas Hold 'Em (two-sitting) ──────────────────────────────────────────────
// Hold 'Em is the only casino game played across two sittings, both within
// `forming`. Sitting 1: ante + 2 hole cards, locked. Once the table is full
// (against its decayed max) and every seat has locked its holes, 5 shared
// community cards are dealt. Sitting 2: each seat either PLAYS ON (pays the
// play-on, picks ≤5 of hole+community, then the normal gambit → lock flow) or
// FOLDS (forfeits the ante; the seat is emptied and never reopened). If every
// seat folds, the table resets to its opening state but keeps its pot.

const HOLDEM_ANTE    = CASINO_GAMES.holdem.ante;    // 30
const HOLDEM_PLAY_ON = CASINO_GAMES.holdem.playOn;  // 50

function assertHoldem(mission: GMMission): void {
  if (mission.casinoGame !== 'holdem')
    throw new HttpsError('failed-precondition', "This table is not Texas Hold 'Em.");
}

// Deal the 5 shared community cards iff the table is at its decayed max and every
// seat has locked its holes. A transaction on communityDrawnAt claims the draw,
// so concurrent hole-locks (or a tick) can only deal the community once.
async function maybeDrawCommunity(
  db: ReturnType<typeof getDatabase>,
  seasonId: string,
  missionId: string,
  now: number,
): Promise<void> {
  const snap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  if (!snap.exists()) return;
  const m = snap.val() as GMMission;
  if (m.type !== 'casino' || m.casinoGame !== 'holdem') return;
  if (m.state !== 'forming' || m.community || m.communityDrawnAt) return;
  const parts = Object.values(m.participants ?? {});
  if (parts.length === 0) return;
  if (gmFilledCount(m) < gmCurrentMaxSlots(m, now)) return;   // not full (after decay)
  if (!parts.every(p => p.holeLocked === true)) return;       // some hole not yet locked

  // Claim the draw atomically — first writer wins, others abort.
  const { committed } = await db.ref(sp(seasonId, `missions/${missionId}/communityDrawnAt`)).transaction(
    (current: number | null) => (current ? undefined : now),
  );
  if (!committed) return;
  await db.ref(sp(seasonId, `missions/${missionId}/community`)).set(drawCommunity());
}

// Sitting 1 — ante and lock two hole cards, then run the community-draw gate.
export const dealHoldemHole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);
  assertHoldem(mission);
  if (seat.holeLocked) throw new HttpsError('failed-precondition', 'Your hole cards are already locked.');

  const potCut = potContribution(HOLDEM_ANTE);

  // Debit the ante (mirrors dealCasinoHand's transaction pattern).
  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const snapData = playerSnap.val() as { gold?: number; disabled?: boolean };
  let abortReason = 'Gold deduction failed.';
  const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
    (current: { gold?: number; disabled?: boolean } | null) => {
      const data = current ?? snapData;
      if (data.disabled) { abortReason = 'Account restricted.'; return undefined; }
      const gold = data.gold ?? 0;
      if (gold < HOLDEM_ANTE) { abortReason = 'Not enough gold for the ante.'; return undefined; }
      return { ...data, gold: gold - HOLDEM_ANTE };
    },
  );
  if (!committed) throw new HttpsError('failed-precondition', abortReason);

  // Deal 2 hole cards from this seat's chosen deck variant (a SECRET).
  const choice = deckChoiceOf(seat);
  const hole   = makeDrawableDeck(shuffle(buildDeck(DECK_VARIANTS[choice].excludeTypes))).draw(2);

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'deal', game: 'holdem', amount: HOLDEM_ANTE, potAdd: potCut,
  });

  await db.ref().update({
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]:   hole,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/holeLocked`)]: true,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/startBy`)]:    null,
    [sp(seasonId, `missions/${missionId}/pot`)]: ServerValue.increment(potCut),
    [logPath]: logEntry,
  });

  await maybeDrawCommunity(db, seasonId, missionId, now);
  return { hole };
});

// Sitting 2 — play on: pay the play-on, choose ≤5 of the 2 hole + 5 community
// cards as the final hand, then proceed to the normal gambit → lock flow.
export const holdemPlayOn = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, selectedUids, seasonId: reqSeason } = request.data as {
    missionId?: string; selectedUids?: number[]; seasonId?: string;
  };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');
  if (!Array.isArray(selectedUids) || selectedUids.length === 0)
    throw new HttpsError('invalid-argument', 'Select at least one card.');
  if (selectedUids.length > 5)
    throw new HttpsError('invalid-argument', 'You may keep at most 5 cards.');
  if (new Set(selectedUids).size !== selectedUids.length)
    throw new HttpsError('invalid-argument', 'Duplicate card selected.');

  const db = getDatabase();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);
  assertHoldem(mission);
  if (!mission.community || !mission.communityDrawnAt)
    throw new HttpsError('failed-precondition', 'The community cards have not been dealt yet.');
  if (!seat.holeLocked) throw new HttpsError('failed-precondition', 'Lock your hole cards first.');
  if (seat.playedOn) throw new HttpsError('failed-precondition', 'You have already played on.');

  // Selectable pool = this seat's 2 hole cards (secret) + the 5 shared community.
  const pool  = [...(seat.hand ?? []), ...mission.community];
  const byUid = new Map(pool.map(c => [c.uid, c]));
  const chosen: DeckCard[] = [];
  for (const u of selectedUids) {
    const card = byUid.get(u);
    if (!card) throw new HttpsError('invalid-argument', 'Selected a card not in your hand or the community.');
    chosen.push(card);
  }

  const potCut = potContribution(HOLDEM_PLAY_ON);

  // Debit the play-on.
  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const snapData = playerSnap.val() as { gold?: number };
  let abortReason = 'Gold deduction failed.';
  const { committed } = await db.ref(sp(seasonId, `players/${uid}`)).transaction(
    (current: { gold?: number } | null) => {
      const data = current ?? snapData;
      const gold = data.gold ?? 0;
      if (gold < HOLDEM_PLAY_ON) { abortReason = 'Not enough gold for the play-on.'; return undefined; }
      return { ...data, gold: gold - HOLDEM_PLAY_ON };
    },
  );
  if (!committed) throw new HttpsError('failed-precondition', abortReason);

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'playon', game: 'holdem', amount: HOLDEM_PLAY_ON, potAdd: potCut,
  });

  // Write the chosen final hand as the seat's SECRET hand; the normal gambit →
  // lock flow (playCasinoGambit, then lockCasinoResult) takes it from here.
  await db.ref().update({
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]: chosen,
    [sp(seasonId, `missions/${missionId}/participants/${uid}/playedOn`)]: true,
    [sp(seasonId, `missions/${missionId}/pot`)]: ServerValue.increment(potCut),
    [logPath]: logEntry,
  });

  return { hand: chosen };
});

// Sitting 2 — fold after the reveal. Forfeits the ante (already paid; no refund).
// The seat is EMPTIED and not reopened. If this empties the table, it resets
// (participants cleared, decay reset, community cleared) but KEEPS its pot.
export const holdemFold = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const uid = request.auth.uid;
  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db  = getDatabase();
  const now = Date.now();
  const { seasonId } = await resolveWriteSeason(uid, reqSeason, db);
  const { mission, seat } = await mustCasinoSeat(db, seasonId, missionId, uid);
  assertHoldem(mission);
  if (!mission.community)
    throw new HttpsError('failed-precondition', 'You can only fold after the community reveal.');
  if (!seat.holeLocked)
    throw new HttpsError('failed-precondition', 'Nothing to fold — no hole cards locked.');

  const [logPath, logEntry] = casinoLogWrite(db, seasonId, missionId, {
    uid, playerName: seat.playerName, event: 'fold', game: 'holdem',
  });

  // Remove the seat and free the player's activeMission immediately; clear secrets.
  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${uid}`)]:          null,
    [secret(seasonId, `missions/${missionId}/participants/${uid}/hand`)]: null,
    [secret(seasonId, `missions/${missionId}/participants/${uid}/deck`)]: null,
    [sp(seasonId, `players/${uid}/activeMission`)]:                       null,
    [logPath]: logEntry,
  };

  // All-fold reset: if this empties the table, return it to its opening state —
  // clear participants/community, un-decay — but KEEP the pot.
  const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== uid);
  if (remaining.length === 0) {
    updates[sp(seasonId, `missions/${missionId}/community`)]        = null;
    updates[sp(seasonId, `missions/${missionId}/communityDrawnAt`)] = null;
    updates[sp(seasonId, `missions/${missionId}/firstJoinAt`)]      = null;
  }

  await db.ref().update(updates);

  // A fold lowers the fill count; the remaining played seats may now be
  // deployable against the decayed max.
  if (remaining.length > 0) {
    const updatedSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
    const updated = updatedSnap.val() as GMMission;
    if (gmShouldDeploy(updated, now)) await deployMission(seasonId, missionId, updated, now);
  }

  return { folded: true, tableReset: remaining.length === 0 };
});

// ── Admin callables ───────────────────────────────────────────────────────────

async function requireAdmin(uid: string): Promise<void> {
  const db   = getDatabase();
  const snap = await db.ref('config/adminId').get();
  if (!snap.exists() || snap.val() !== uid)
    throw new HttpsError('permission-denied', 'Admin only.');
}


export const adminKickMissionParticipant = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  await requireAdmin(request.auth.uid);

  const { missionId, playerId, seasonId: reqSeason } = request.data as { missionId?: string; playerId?: string; seasonId?: string };
  if (!missionId || !playerId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const db = getDatabase();
  const { seasonId } = await resolveWriteSeason(request.auth.uid, reqSeason, db);
  const missionSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming' && mission.state !== 'inprogress')
    throw new HttpsError('failed-precondition', 'Mission is not active.');

  const participant = mission.participants?.[playerId];
  if (!participant) throw new HttpsError('not-found', 'Participant not found.');

  const label   = gmMissionLabel(mission);
  const warnRef = db.ref(sp(seasonId, `players/${playerId}/warnings`)).push();

  const updates: Record<string, unknown> = {
    [sp(seasonId, `missions/${missionId}/participants/${playerId}`)]: null,
    [sp(seasonId, `players/${playerId}/activeMission`)]:             null,
    [sp(seasonId, `players/${playerId}/warnings/${warnRef.key}`)]: {
      timestamp: Date.now(),
      message:   `Removed from ${label} by admin.`,
      auto:      true,
    },
  };

  if (mission.state === 'forming') {
    // Reset the decay timer if this was the last participant.
    const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== playerId);
    if (remaining.length === 0) {
      updates[sp(seasonId, `missions/${missionId}/firstJoinAt`)] = null;
    }
  } else {
    // inprogress — preserve slot info as a claimable slot for a replacement.
    const slotsToAdd: GMSlot[] = participant.slots?.length
      ? participant.slots.map(s => ({
          name: s.name, game: s.game,
          ...(s.bonusXP   ? { bonusXP:   s.bonusXP   } : {}),
          ...(s.bonusGold ? { bonusGold: s.bonusGold } : {}),
        }))
      : [{ name: '', game: '' }];
    const claimRef = db.ref(sp(seasonId, `missions/${missionId}/claimableSlots`)).push();
    updates[sp(seasonId, `missions/${missionId}/claimableSlots/${claimRef.key}`)] = slotsToAdd;
  }

  await db.ref().update(updates);
  return { success: true };
});

export const adminForceDeploy = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  await requireAdmin(request.auth.uid);

  const { missionId, seasonId: reqSeason } = request.data as { missionId?: string; seasonId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db          = getDatabase();
  const { seasonId } = await resolveWriteSeason(request.auth.uid, reqSeason, db);
  const missionSnap = await db.ref(sp(seasonId, `missions/${missionId}`)).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming')
    throw new HttpsError('failed-precondition', 'Mission is not forming.');

  await deployMission(seasonId, missionId, mission, Date.now());
  return { success: true };
});


// ── syncPlayerProfile ─────────────────────────────────────────────────────────
// Callable by the player themselves (or admin targeting any uid via targetUid).
// Performs a full audit of completed tiles and missionsHistory to set the exact
// tile count, mission count, and game list on the player's profile — replacing
// incremental counts that may have been missed due to Cloud Function failures.

export const syncPlayerProfile = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { targetUid, seasonId: reqSeason } = request.data as { targetUid?: string; seasonId?: string };
  const callerUid = request.auth.uid;
  const db = getDatabase();

  const config   = await getConfig(db);
  const seasonId = reqSeason || config.activeSeasonId;
  const isAdmin  = config.adminId === callerUid;

  let uid = callerUid;
  if (targetUid && targetUid !== callerUid) {
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only.');
    uid = targetUid;
  }
  // A non-admin may only sync their own profile for the active season.
  if (!isAdmin && seasonId !== config.activeSeasonId)
    throw new HttpsError('permission-denied', 'Season not available.');

  const playerSnap = await db.ref(sp(seasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const player = playerSnap.val() as PlayerRecord;

  const [tilesSnap, historySnap] = await Promise.all([
    db.ref(sp(seasonId, 'tiles')).get(),
    db.ref(sp(seasonId, 'missionsHistory')).get(),
  ]);

  let tileCount = 0;
  const gameNames = new Set<string>();

  if (tilesSnap.exists()) {
    const tiles = tilesSnap.val() as Record<string, { state: string; adventurers?: Record<string, AdvEntry> }>;
    for (const tile of Object.values(tiles)) {
      if (tile.state !== 'complete') continue;
      let playerWasHere = false;
      for (const adv of Object.values(tile.adventurers ?? {})) {
        if (adv.owner !== uid) continue;
        playerWasHere = true;
        for (const slot of normalizeArray(adv.slots)) {
          if (slot.game?.trim()) gameNames.add(normalizeGameName(slot.game));
        }
      }
      if (playerWasHere) tileCount++;
    }
  }

  let missionCount = 0;
  if (historySnap.exists()) {
    const missions = historySnap.val() as Record<string, GMMission>;
    for (const mission of Object.values(missions)) {
      if (mission.state !== 'complete') continue;
      const participant = mission.participants?.[uid];
      if (!participant) continue;
      missionCount++;
      for (const slot of normalizeArray(participant.slots as GMSlot[] | Record<string, GMSlot> | undefined)) {
        if (slot.game?.trim()) gameNames.add(normalizeGameName(slot.game));
      }
    }
  }

  const base = `profiles/players/${uid}`;
  const updates: Record<string, unknown> = {
    [`${base}/id`]:            uid,
    [`${base}/displayName`]:   player.displayName,
    [`${base}/discordHandle`]: player.discordHandle ?? null,
    [`${base}/avatarHash`]:    player.avatarHash    ?? null,
    [`${base}/joinedAt`]:      player.joinedAt      ?? null,
    [`${base}/events/${seasonId}/xp`]:       player.xp ?? 0,
    [`${base}/events/${seasonId}/tiles`]:    tileCount,
    [`${base}/events/${seasonId}/missions`]: missionCount,
  };

  if (tileCount > 0 || missionCount > 0) {
    updates[`${base}/firstEvent`] = seasonId;
  }

  for (const g of gameNames) {
    updates[`${base}/events/${seasonId}/games/${encodeURIComponent(g)}`] = true;
  }

  if (player.discordHandle) {
    updates[`profiles/handleIndex/${player.discordHandle.replace(/\./g, '_')}`] = uid;
  }

  await db.ref().update(updates);
  return { tileCount, missionCount, gameCount: gameNames.size };
});


// ── onMissionComplete ─────────────────────────────────────────────────────────
// Mirrors onTileComplete: fires when a completed mission is archived to
// missionsHistory and updates participant profiles with XP snapshot, mission
// count, games from slots, and identity fields.

export const onMissionComplete = onValueCreated(
  'seasons/{seasonId}/missionsHistory/{missionId}',
  async (event) => {
    const mission = event.data.val() as GMMission | null;
    if (!mission || mission.state !== 'complete') return;

    const seasonId = event.params.seasonId;
    const db = getDatabase();

    // Never write real player history from a draft season being playtested.
    if (await isDraftSeason(seasonId, db)) return;

    const participantIds = Object.keys(mission.participants ?? {});
    if (participantIds.length === 0) return;

    const playersSnap = await db.ref(sp(seasonId, 'players')).get();
    const players = playersSnap.val() as Record<string, PlayerRecord> | null;

    // Batch-read firstEvent for all participants to avoid overwriting an earlier claim.
    const firstEventSnaps = await Promise.all(
      participantIds.map(uid => db.ref(`profiles/players/${uid}/firstEvent`).get()),
    );
    const firstEventMap = new Map(
      participantIds.map((uid, i) => [uid, firstEventSnaps[i].val() as string | null]),
    );

    const profileUpdates: Record<string, unknown> = {};

    for (const [playerId, participant] of Object.entries(mission.participants ?? {})) {
      const player = players?.[playerId];
      if (!player) continue;

      const base = `profiles/players/${playerId}`;

      // Identity — kept current on every mission completion.
      profileUpdates[`${base}/id`]            = playerId;
      profileUpdates[`${base}/displayName`]   = player.displayName;
      profileUpdates[`${base}/discordHandle`] = player.discordHandle ?? null;
      profileUpdates[`${base}/avatarHash`]    = player.avatarHash    ?? null;
      profileUpdates[`${base}/joinedAt`]      = player.joinedAt      ?? null;

      if (!firstEventMap.get(playerId)) {
        profileUpdates[`${base}/firstEvent`] = seasonId;
      }

      if (mission.type === 'casino') {
        // Casino season records gold + handsPlayed (this season's "missions
        // completed"). A folded seat never reaches here (removed at fold), so
        // every archived casino participant played. See profile-site-handoff.
        profileUpdates[`${base}/events/${seasonId}/gold`]        = player.gold ?? 0;
        profileUpdates[`${base}/events/${seasonId}/handsPlayed`] = ServerValue.increment(1);
      } else {
        // XP — snapshot of the player's current total (already includes this mission's reward).
        profileUpdates[`${base}/events/${seasonId}/xp`] = player.xp ?? 0;
        // Missions — separate counter from tiles.
        profileUpdates[`${base}/events/${seasonId}/missions`] = ServerValue.increment(1);
      }

      // Games — collect from this participant's slots, same encoding as onTileComplete.
      for (const slot of normalizeArray(participant.slots)) {
        if (slot.game?.trim()) {
          profileUpdates[`${base}/events/${seasonId}/games/${encodeURIComponent(normalizeGameName(slot.game))}`] = true;
        }
      }

      if (player.discordHandle) {
        profileUpdates[`profiles/handleIndex/${player.discordHandle.replace(/\./g, '_')}`] = playerId;
      }
    }

    if (Object.keys(profileUpdates).length > 0) {
      await db.ref().update(profileUpdates);
    }
  },
);

// ── Scheduled tick: auto-deploy cohorts when decay meets fill count ───────────

export const tickGuildmasterMissions = onSchedule('every 15 minutes', async () => {
  const db  = getDatabase();
  const now = Date.now();

  // Scheduled functions have no season param, so fan out over every live
  // season plus drafts (so alphas can playtest mission deploy).
  const seasons = await tickableSeasons(db, true);

  for (const { seasonId } of seasons) {
    const snap = await db.ref(sp(seasonId, 'missions')).get();
    if (!snap.exists()) continue;
    const missions = snap.val() as Record<string, GMMission>;

    // Casino pass: auto-stand-down any seated player whose startBy deadline has expired.
    // This runs before the deploy pass so freed seats are visible to shouldDeploy.
    const standDownUpdates: Record<string, unknown> = {};
    for (const [id, m] of Object.entries(missions)) {
      if (m.type !== 'casino' || m.state !== 'forming') continue;
      let anyRemoved = false;
      for (const [uid, p] of Object.entries(m.participants ?? {})) {
        if (p.startBy && now > p.startBy && !p.played) {
          standDownUpdates[sp(seasonId, `missions/${id}/participants/${uid}`)] = null;
          standDownUpdates[sp(seasonId, `players/${uid}/activeMission`)]      = null;
          delete m.participants[uid];
          anyRemoved = true;
        }
      }
      if (anyRemoved && Object.keys(m.participants ?? {}).length === 0) {
        standDownUpdates[sp(seasonId, `missions/${id}/firstJoinAt`)] = null;
        m.firstJoinAt = null;
      }
    }
    if (Object.keys(standDownUpdates).length > 0) {
      await db.ref().update(standDownUpdates);
    }

    // Hold 'Em pass: deal the shared community once a table is full (against its
    // decayed max) with every seat hole-locked, in case decay — not a hole-lock —
    // was what closed the gap. maybeDrawCommunity re-reads and is idempotent.
    for (const [id, m] of Object.entries(missions)) {
      if (m.type === 'casino' && m.casinoGame === 'holdem' && m.state === 'forming' && !m.community) {
        await maybeDrawCommunity(db, seasonId, id, now);
      }
    }

    // Deploy pass: check all mission types.
    for (const [id, m] of Object.entries(missions)) {
      if (gmShouldDeploy(m, now)) {
        await deployMission(seasonId, id, m, now);
      }
    }
  }
});

// ── Scheduled: weekly gold floor top-up ──────────────────────────────────────
//
// Any player below CASINO_GOLD_FLOOR is set UP TO it (never additive, so the
// economy doesn't inflate) — a safety net so a busted player can keep playing.
// Runs on LIVE seasons only (active/closing), never drafts.
//
// The top-up is the ONLY place gold enters the economy from outside a table, so
// each grant is written to the casino audit log — without it the audit can't
// see gold being pumped in via the perpetual-floor free roll.
//
// Cron: Saturdays 06:00 America/Chicago. `timeZone` is required — without it
// onSchedule anchors to UTC.
export const weeklyGoldTopUp = onSchedule(
  { schedule: '0 6 * * 6', timeZone: 'America/Chicago' },
  async () => {
    const db  = getDatabase();
    const now = Date.now();

    // Live seasons only — a draft season's economy is throwaway.
    const seasons = await tickableSeasons(db, false);

    for (const { seasonId, shell } of seasons) {
      if (shell !== 'casino') continue; // the floor is a casino-season mechanic
      const playersSnap = await db.ref(sp(seasonId, 'players')).get();
      if (!playersSnap.exists()) continue;
      const players = playersSnap.val() as Record<string, { displayName?: string; gold?: number }>;

      const updates: Record<string, unknown> = {};
      for (const [uid, p] of Object.entries(players)) {
        const gold = p.gold ?? 0;
        if (gold >= CASINO_GOLD_FLOOR) continue;
        const granted = CASINO_GOLD_FLOOR - gold;
        updates[sp(seasonId, `players/${uid}/gold`)] = CASINO_GOLD_FLOOR;
        // Audit entry — the only visibility the admin has into outside gold inflow.
        const logRef = db.ref(sp(seasonId, 'goldTopUpLog')).push();
        updates[sp(seasonId, `goldTopUpLog/${logRef.key}`)] = {
          ts: now, uid, playerName: p.displayName ?? uid,
          granted, resultingBalance: CASINO_GOLD_FLOOR,
        };
      }
      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
      }
    }
  },
);

function extractApSlotName(name: string): string {
  const m = name.match(/\(([^)]+)\)$/);
  return m ? m[1].trim() : name;
}

// ── Scheduled tick: auto-sync slot statuses from Cheesetracker ───────────────

export const tickSlotStatuses = onSchedule('every 15 minutes', async () => {
  const db = getDatabase();

  async function getCheeseGames(cheeseId: string): Promise<
    Array<{ name: string; tracker_status: string; checks_done: number; checks_total: number }> | null
  > {
    const res = await fetch(`https://cheesetrackers.theincrediblewheelofchee.se/api/tracker/${cheeseId}`);
    if (!res.ok) return null;
    const data = await res.json() as {
      games?: Array<{ name: string; tracker_status: string; checks_done: number; checks_total: number }>;
    };
    return data.games ?? null;
  }

  function deriveStatus(g: { tracker_status: string; checks_done: number; checks_total: number }): SlotStatus | null {
    const isGoal        = g.tracker_status === 'goal_completed';
    const is100         = g.checks_total > 0 && g.checks_done === g.checks_total;
    const isInProgress  = !isGoal && g.checks_done > 0 && g.checks_done < g.checks_total;
    if (isGoal && is100) return 'Done';
    if (isGoal)          return 'Goaled';
    if (is100)           return '100%';
    if (isInProgress)    return 'In-Progress';
    return null;
  }

  function hasActiveSlots(slots: Array<{ status?: SlotStatus }>): boolean {
    return slots.some(s => !s.status || s.status === 'Unstarted' || s.status === 'In-Progress');
  }

  const updates: Record<string, unknown> = {};

  type RawAdv = { busy?: boolean; busyTile?: string | null };

  // Fan out over live + draft seasons (scheduled functions have no season param).
  const seasons = await tickableSeasons(db, true);
  for (const { seasonId } of seasons) {
    const playersSnap = await db.ref(sp(seasonId, 'players')).get();
    const rawPlayers = (playersSnap.exists() ? playersSnap.val() : {}) as Record<string, { adventurers?: Record<string, RawAdv> }>;

    // ── Tiles ──────────────────────────────────────────────────────────────
    const tilesSnap = await db.ref(sp(seasonId, 'tiles')).get();
    if (tilesSnap.exists()) {
      const tiles = tilesSnap.val() as Record<string, Tile>;
      for (const [coord, tile] of Object.entries(tiles)) {
        if (tile.state !== 'inprogress') continue;
        const advs         = Object.values(tile.adventurers ?? {});
        const isBifurcated = tile.traits?.['bifurcated'] !== undefined;

        for (const roomNum of [1, 2] as const) {
          if (roomNum === 2 && !isBifurcated) continue;
          const cheeseId = roomNum === 1 ? tile.cheese : tile.cheese2;
          if (!cheeseId) continue;
          const roomAdvs    = isBifurcated ? advs.filter(a => (a.room ?? 1) === roomNum) : advs;
          const allPubSlots = tile.publicSlots ?? [];
          const roomPubSlots = isBifurcated
            ? allPubSlots.filter(s => !s.room || s.room === roomNum)
            : allPubSlots;
          const roomSlots = [...roomAdvs.flatMap(a => a.slots ?? []), ...roomPubSlots];
          if (!hasActiveSlots(roomSlots)) continue;
          const games = await getCheeseGames(cheeseId);
          if (!games) continue;
          const statusMap = new Map(games.flatMap(g => {
            const s = deriveStatus(g);
            return s ? [[extractApSlotName(g.name), s] as [string, SlotStatus]] : [];
          }));
          for (const adv of roomAdvs) {
            const slots = adv.slots ?? [];
            for (let i = 0; i < slots.length; i++) {
              const newStatus = statusMap.get(slots[i].name);
              if (newStatus && slots[i].status !== newStatus) {
                updates[sp(seasonId, `tiles/${coord}/adventurers/${adv.advId}/slots/${i}/status`)] = newStatus;
              }
            }
            if (
              slots.length > 0 &&
              slots.every(s => {
                const resolved = statusMap.get(s.name) ?? s.status;
                return resolved === 'Done' || resolved === '100%' || resolved === 'Goaled';
              }) &&
              rawPlayers[adv.owner]?.adventurers?.[adv.advId]?.busyTile === coord
            ) {
              updates[sp(seasonId, `players/${adv.owner}/adventurers/${adv.advId}/busy`)]     = false;
              updates[sp(seasonId, `players/${adv.owner}/adventurers/${adv.advId}/busyTile`)] = null;
            }
          }
          for (let i = 0; i < allPubSlots.length; i++) {
            const ps = allPubSlots[i];
            if (isBifurcated && ps.room && ps.room !== roomNum) continue;
            const newStatus = statusMap.get(ps.name);
            if (newStatus && ps.status !== newStatus) {
              updates[sp(seasonId, `tiles/${coord}/publicSlots/${i}/status`)] = newStatus;
            }
          }
        }
      }
    }

    // ── Missions ─────────────────────────────────────────────────────────────
    const missionsSnap = await db.ref(sp(seasonId, 'missions')).get();
    if (missionsSnap.exists()) {
      const missions = missionsSnap.val() as Record<string, GMMission>;
      for (const [missionId, mission] of Object.entries(missions)) {
        if (mission.state !== 'inprogress' || !mission.cheese) continue;
        const allSlots = Object.values(mission.participants ?? {}).flatMap(p => p.slots ?? []);
        if (!hasActiveSlots(allSlots)) continue;
        const games = await getCheeseGames(mission.cheese);
        if (!games) continue;
        const statusMap = new Map(games.flatMap(g => {
          const s = deriveStatus(g);
          return s ? [[extractApSlotName(g.name), s] as [string, SlotStatus]] : [];
        }));
        for (const [pid, p] of Object.entries(mission.participants ?? {})) {
          const slots = p.slots ?? [];
          for (let i = 0; i < slots.length; i++) {
            const newStatus = statusMap.get(slots[i].name);
            if (newStatus && slots[i].status !== newStatus) {
              updates[sp(seasonId, `missions/${missionId}/participants/${pid}/slots/${i}/status`)] = newStatus;
            }
          }
        }
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }
});

// ── kmkClaimTrial ─────────────────────────────────────────────────────────────
// Atomically claims a KMK trial: Incomplete → Pending.
// Rejects disabled players, locked areas, one-per-area violations, and already-claimed tasks.
export const kmkClaimTrial = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { listId, areaId, taskId } =
    request.data as { listId?: string; areaId?: string; taskId?: string };
  if (!listId || !areaId || !taskId)
    throw new HttpsError('invalid-argument', 'Missing listId, areaId, or taskId.');

  const uid = request.auth.uid;
  const db  = getDatabase();

  // KMK is global, but disabled-status and displayName come from the player's
  // ACTIVE-season record.
  const { activeSeasonId } = await getConfig(db);
  const playerSnap = await db.ref(sp(activeSeasonId, `players/${uid}`)).get();
  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  const player = playerSnap.val() as { displayName: string; disabled?: boolean };
  if (player.disabled) throw new HttpsError('permission-denied', 'Account restricted.');

  // Load the whole area: check locked + one-per-area in one read.
  // Also serves as the pre-read fallback for the transaction's null-on-first-invocation probe.
  type RawTask = { trial: string; desc: string; order: number; status: string; playerId?: string | null; playerName?: string | null; claimedAt?: number | null };
  const areaSnap = await db.ref(`kmkEvents/${listId}/areas/${areaId}`).get();
  if (!areaSnap.exists()) throw new HttpsError('not-found', 'Area not found.');
  const area = areaSnap.val() as { locked: boolean; tasks?: Record<string, RawTask> };
  if (area.locked) throw new HttpsError('failed-precondition', 'Area is locked.');

  // One-per-area: player may not hold a Pending or Verifying trial in the same area.
  const tasks = area.tasks ?? {};
  const hasActive = Object.values(tasks).some(
    t => t.playerId === uid && (t.status === 'Pending' || t.status === 'Verifying'),
  );
  if (hasActive) throw new HttpsError('failed-precondition', 'You already have an active trial in this area.');

  const taskData = tasks[taskId];
  if (!taskData) throw new HttpsError('not-found', 'Trial not found.');

  // Transaction: claim only if still Incomplete (guards against simultaneous claims).
  let abortReason = 'Trial is no longer available.';

  const { committed } = await db.ref(`kmkEvents/${listId}/areas/${areaId}/tasks/${taskId}`)
    .transaction((current: RawTask | null) => {
      const task = current ?? taskData; // use pre-read on null probe; server retries if stale
      if (task.status !== 'Incomplete') { abortReason = 'Trial is no longer available.'; return undefined; }
      return { ...task, status: 'Pending', playerId: uid, playerName: player.displayName, claimedAt: Date.now() };
    });

  if (!committed) throw new HttpsError('failed-precondition', abortReason);
  return { success: true };
});

// ── fetchCheesetracker ────────────────────────────────────────────────────────
// Proxies the POST to cheesetrackers.theincrediblewheelofchee.se, which does
// not set CORS headers and therefore cannot be called directly from the browser.
export const fetchCheesetracker = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { trackerId } = request.data as { trackerId?: string };
  if (!trackerId) throw new HttpsError('invalid-argument', 'Missing trackerId.');

  const url = `https://archipelago.gg/tracker/${trackerId}`;
  const res = await fetch('https://cheesetrackers.theincrediblewheelofchee.se/api/tracker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new HttpsError('internal', `Cheesetracker API error: ${res.status}`);
  const data = await res.json() as { tracker_id: string };
  return { tracker_id: data.tracker_id };
});

// ── fetchCheeseDetails ────────────────────────────────────────────────────────
// Proxies the GET to cheesetrackers.theincrediblewheelofchee.se for full
// tracker data so slot statuses can be auto-updated from game completion.
export const fetchCheeseDetails = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { cheeseId } = request.data as { cheeseId?: string };
  if (!cheeseId) throw new HttpsError('invalid-argument', 'Missing cheeseId.');

  const res = await fetch(`https://cheesetrackers.theincrediblewheelofchee.se/api/tracker/${cheeseId}`);
  if (!res.ok) throw new HttpsError('internal', `Cheesetracker API error: ${res.status}`);
  const data = await res.json() as {
    games?: Array<{ name: string; game: string; tracker_status: string; checks_done: number; checks_total: number }>;
  };
  return {
    games: (data.games ?? []).map(g => ({
      name: g.name,
      game: g.game ?? '',
      tracker_status: g.tracker_status,
      checks_done: g.checks_done,
      checks_total: g.checks_total,
    })),
  };
});
