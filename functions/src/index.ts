import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onValueWritten, onValueCreated } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
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

  const shopSnap = await db.ref(`game/shops/${shopId}`).get();
  if (!shopSnap.exists()) throw new HttpsError('not-found', 'Shop not found.');

  const shop = shopSnap.val() as { itemIds?: string[]; name?: string };
  if (!(shop.itemIds ?? []).includes(itemId))
    throw new HttpsError('failed-precondition', 'Item not sold at this shop.');

  const cost = ITEM_COSTS[itemId];
  if (cost == null) throw new HttpsError('not-found', 'Unknown item.');

  type PlayerData = { displayName: string; gold: number; inventory?: Record<string, number>; disabled?: boolean };

  let abortReason = 'Purchase failed. Please try again.';
  const { committed, snapshot } = await db.ref(`game/players/${uid}`).transaction(
    (current: PlayerData | null) => {
      if (!current) { abortReason = 'Player not found.'; return undefined; }
      if (current.disabled) { abortReason = 'Account restricted.'; return undefined; }
      if (current.gold < cost) { abortReason = 'Not enough gold.'; return undefined; }
      if (NON_CONSUMABLE_ITEMS.has(itemId) && (current.inventory?.[itemId] ?? 0) > 0) {
        abortReason = 'Item already owned.'; return undefined;
      }
      return {
        ...current,
        gold:      current.gold - cost,
        inventory: { ...(current.inventory ?? {}), [itemId]: (current.inventory?.[itemId] ?? 0) + 1 },
      };
    },
  );

  if (!committed) throw new HttpsError('failed-precondition', abortReason);

  const itemName    = ITEM_NAMES[itemId] ?? itemId;
  const displayName = (snapshot.val() as PlayerData).displayName;
  await db.ref('game/activityLog').push().set({
    timestamp: Date.now(),
    type:      'item_purchased',
    message:   `${displayName} purchased ${itemName} from ${shop.name ?? shopId}.`,
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
  const { committed } = await db.ref(`game/orbState/${orbId}`).transaction(current => {
    if (current !== null) return; // abort — already claimed
    return acquisition;
  });
  if (!committed) throw new HttpsError('already-exists', 'This orb has already been claimed.');

  // Deduct gold via transaction so stale snapshot value can't cause incorrect set().
  let goldAbortReason = 'Gold deduction failed.';
  const { committed: goldCommitted } = await db.ref(`game/players/${uid}/gold`).transaction(
    (current: number | null) => {
      if (typeof current !== 'number') { goldAbortReason = 'Player gold not found.'; return undefined; }
      if (current < ORB_SHOP_COST)     { goldAbortReason = 'Not enough gold.';       return undefined; }
      return current - ORB_SHOP_COST;
    },
  );
  if (!goldCommitted) {
    try {
      await db.ref(`game/orbState/${orbId}`).remove();
    } catch (e) {
      console.error(`[purchaseShopOrb] Rollback failed for orb ${orbId}, player ${uid}:`, e);
    }
    throw new HttpsError('failed-precondition', goldAbortReason);
  }

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

// ── onOrbAcquired ─────────────────────────────────────────────────────────────
// Removes boss traits when an elemental orb is first acquired, regardless of
// which client or Cloud Function wrote the orb. Soft traits (camouflage,
// enduring) are skipped if the boss is already in-progress (YAML locked).

export const onOrbAcquired = onValueCreated(
  'game/orbState/{orbId}',
  async (event) => {
    const orbId    = event.params.orbId;
    const traitIds = ELEMENTAL_ORB_TRAITS[orbId];
    if (!traitIds) return; // not an elemental orb

    const db = getDatabase();

    const metaSnap = await db.ref('game/meta').get();
    if (!metaSnap.exists()) return;
    const seed      = (metaSnap.val() as { seed: number }).seed;
    const bossCoord = bossCoordFromSeed(seed);

    const bossSnap = await db.ref(`game/tiles/${bossCoord}`).get();
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
    await db.ref(`game/tiles/${bossCoord}/traits`).set(
      Object.keys(next).length > 0 ? next : null,
    );
  },
);

// ── pruneActivityLog ──────────────────────────────────────────────────────────
// Fires on every new activity log entry and trims the log to 25 entries.

export const pruneActivityLog = onValueCreated(
  'game/activityLog/{entryId}',
  async () => {
    const db   = getDatabase();
    const snap = await db.ref('game/activityLog').get();
    if (!snap.exists()) return;
    const keys = Object.keys(snap.val() as Record<string, unknown>).sort();
    const MAX  = 25;
    if (keys.length <= MAX) return;
    const updates: Record<string, null> = {};
    for (const k of keys.slice(0, keys.length - MAX)) updates[`game/activityLog/${k}`] = null;
    await db.ref().update(updates);
  },
);

// ═══════════════════════════════════════════════════════════════════
// Guildmaster Missions
// ═══════════════════════════════════════════════════════════════════

// ── Mission types (mirrors src/types/index.ts) ────────────────────────────────

type GMMissionType  = 'basic' | 'patrol';
type GMMissionState = 'forming' | 'inprogress' | 'complete';
type TriState = 'on' | 'off' | 'special';
type SlotStatus = 'Unstarted' | 'In-Progress' | '100%' | 'Goaled' | 'Done';

interface GMSlot {
  name:       string;
  game:       string;
  status?:    SlotStatus;
  bonusXP?:   number;
  bonusGold?: number;
}

interface GMParticipant {
  playerId:  string;
  playerName: string;
  joinedAt:  number;
  slots?:    GMSlot[];
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
  firstJoinAt:  number | null;
  createdAt:    number;
  deployedAt?:  number;
  participants: Record<string, GMParticipant>;
  claimableSlots?: Record<string, GMSlot[]>;
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
}

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
};

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// ── Mission logic helpers ─────────────────────────────────────────────────────

function gmCurrentMaxSlots(m: GMMission, now: number): number {
  if (m.firstJoinAt == null) return m.baseMax;
  const steps = Math.floor((now - m.firstJoinAt) / (24 * 3600_000));
  return Math.max(1, m.baseMax - steps);
}

function gmFilledCount(m: GMMission): number {
  return Object.keys(m.participants ?? {}).length;
}

function gmShouldDeploy(m: GMMission, now: number): boolean {
  return m.state === 'forming'
    && gmFilledCount(m) > 0
    && gmFilledCount(m) >= gmCurrentMaxSlots(m, now);
}

function gmFreshMission(type: GMMissionType, series: number, now: number): Omit<GMMission, 'id'> {
  const def = MISSION_DEFS[type];
  const result: Omit<GMMission, 'id'> = {
    type,
    series,
    label:       def.label,
    state:       'forming',
    baseMax:     def.baseMax,
    xp:          def.xp,
    gp:          def.gp,
    release:     def.release,
    collect:     def.collect,
    hint:        def.hint,
    firstJoinAt: null,
    createdAt:   now,
    participants: {},
  };
  if (def.traits) result.traits = { ...def.traits };
  return result;
}

function gmMissionLabel(m: GMMission): string {
  const roman = ROMAN_NUMERALS[m.series] ?? String(m.series);
  return `${m.label} · Cohort ${roman}`;
}



// ── Deploy routine ────────────────────────────────────────────────────────────

async function deployMission(missionId: string, m: GMMission, now: number): Promise<void> {
  const db     = getDatabase();
  const newRef = db.ref('game/missions').push();
  const newId  = newRef.key!;
  const fresh  = gmFreshMission(m.type, m.series + 1, now);
  const label  = gmMissionLabel(m);

  const updates: Record<string, unknown> = {
    [`game/missions/${missionId}/state`]:      'inprogress',
    [`game/missions/${missionId}/deployedAt`]: now,
    [`game/missions/${newId}`]:                { ...fresh, id: newId },
  };

  // Notify each enrolled participant via push-keyed notification
  for (const uid of Object.keys(m.participants ?? {})) {
    const notifRef = db.ref(`game/notifications/${uid}`).push();
    updates[`game/notifications/${uid}/${notifRef.key}`] = {
      type:  'mission_deploy',
      label,
      ts:    now,
    };
  }

  await db.ref().update(updates);

  await db.ref('game/activityLog').push().set({
    timestamp: now,
    type:      'mission_deploy',
    message:   `${label} has deployed.`,
    icon:      '⚜',
  });
}

// ── Player callables ──────────────────────────────────────────────────────────

export const enlistInMission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId } = request.data as { missionId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const now = Date.now();

  const [playerSnap, missionSnap] = await Promise.all([
    db.ref(`game/players/${uid}`).get(),
    db.ref(`game/missions/${missionId}`).get(),
  ]);

  if (!playerSnap.exists()) throw new HttpsError('not-found', 'Player not found.');
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');

  const player  = playerSnap.val() as { displayName: string; activeMission?: string | null; basicTrainingDone?: boolean; disabled?: boolean };
  const mission = missionSnap.val() as GMMission;

  if (player.disabled) throw new HttpsError('permission-denied', 'Account restricted.');
  if (player.activeMission) throw new HttpsError('failed-precondition', 'already-on-mission');
  if (mission.state !== 'forming') throw new HttpsError('failed-precondition', 'Mission is not forming.');
  if (mission.type === 'basic' && player.basicTrainingDone)
    throw new HttpsError('failed-precondition', 'basic-training-used');
  if (gmFilledCount(mission) >= gmCurrentMaxSlots(mission, now))
    throw new HttpsError('failed-precondition', 'Mission is full.');

  const participant: GMParticipant = {
    playerId:   uid,
    playerName: player.displayName,
    joinedAt:   now,
  };

  const updates: Record<string, unknown> = {
    [`game/missions/${missionId}/participants/${uid}`]: participant,
    [`game/players/${uid}/activeMission`]:              missionId,
  };
  if (mission.firstJoinAt == null) {
    updates[`game/missions/${missionId}/firstJoinAt`] = now;
  }

  await db.ref().update(updates);

  // Re-read updated mission to check if deploy fires
  const updatedSnap = await db.ref(`game/missions/${missionId}`).get();
  const updated = updatedSnap.val() as GMMission;
  if (gmShouldDeploy(updated, now)) {
    await deployMission(missionId, updated, now);
  }

  return { success: true };
});

export const standDownFromMission = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId } = request.data as { missionId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();

  const missionSnap = await db.ref(`game/missions/${missionId}`).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');

  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming')
    throw new HttpsError('failed-precondition', 'mission-committed');
  if (!(uid in (mission.participants ?? {})))
    throw new HttpsError('failed-precondition', 'not-a-participant');

  const updates: Record<string, unknown> = {
    [`game/missions/${missionId}/participants/${uid}`]: null,
    [`game/players/${uid}/activeMission`]:              null,
  };

  const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== uid);
  if (remaining.length === 0) {
    updates[`game/missions/${missionId}/firstJoinAt`] = null;
  }

  await db.ref().update(updates);
  return { success: true };
});

export const setMissionParticipantStatusNote = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');

  const { missionId, note } = request.data as { missionId?: string; note?: string | null };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const uid = request.auth.uid;
  const db  = getDatabase();

  const missionSnap = await db.ref(`game/missions/${missionId}`).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (!(uid in (mission.participants ?? {})))
    throw new HttpsError('failed-precondition', 'Not a participant.');

  const path = `game/missions/${missionId}/participants/${uid}/statusNote`;
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

  const { missionId, slotKey } = request.data as { missionId?: string; slotKey?: string };
  if (!missionId || !slotKey) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const uid = request.auth.uid;
  const db  = getDatabase();
  const now = Date.now();

  const [playerSnap, missionSnap] = await Promise.all([
    db.ref(`game/players/${uid}`).get(),
    db.ref(`game/missions/${missionId}`).get(),
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

  const slotSnap = await db.ref(`game/missions/${missionId}/claimableSlots/${slotKey}`).get();
  if (!slotSnap.exists()) throw new HttpsError('not-found', 'Slot no longer available.');

  const inheritedSlots = slotSnap.val() as GMSlot[] | null;
  const participant: GMParticipant = {
    playerId:   uid,
    playerName: player.displayName,
    joinedAt:   now,
    ...(inheritedSlots?.length ? { slots: inheritedSlots } : {}),
  };

  await db.ref().update({
    [`game/missions/${missionId}/claimableSlots/${slotKey}`]: null,
    [`game/missions/${missionId}/participants/${uid}`]:        participant,
    [`game/players/${uid}/activeMission`]:                    missionId,
  });

  return { success: true };
});

// ── Admin callables ───────────────────────────────────────────────────────────

async function requireAdmin(uid: string): Promise<void> {
  const db   = getDatabase();
  const snap = await db.ref('game/meta/adminId').get();
  if (!snap.exists() || snap.val() !== uid)
    throw new HttpsError('permission-denied', 'Admin only.');
}


export const adminKickMissionParticipant = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  await requireAdmin(request.auth.uid);

  const { missionId, playerId } = request.data as { missionId?: string; playerId?: string };
  if (!missionId || !playerId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const db = getDatabase();
  const missionSnap = await db.ref(`game/missions/${missionId}`).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming' && mission.state !== 'inprogress')
    throw new HttpsError('failed-precondition', 'Mission is not active.');

  const participant = mission.participants?.[playerId];
  if (!participant) throw new HttpsError('not-found', 'Participant not found.');

  const label   = gmMissionLabel(mission);
  const warnRef = db.ref(`game/players/${playerId}/warnings`).push();

  const updates: Record<string, unknown> = {
    [`game/missions/${missionId}/participants/${playerId}`]: null,
    [`game/players/${playerId}/activeMission`]:             null,
    [`game/players/${playerId}/warnings/${warnRef.key}`]: {
      timestamp: Date.now(),
      message:   `Removed from ${label} by admin.`,
      auto:      true,
    },
  };

  if (mission.state === 'forming') {
    // Reset the decay timer if this was the last participant.
    const remaining = Object.keys(mission.participants ?? {}).filter(id => id !== playerId);
    if (remaining.length === 0) {
      updates[`game/missions/${missionId}/firstJoinAt`] = null;
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
    const claimRef = db.ref(`game/missions/${missionId}/claimableSlots`).push();
    updates[`game/missions/${missionId}/claimableSlots/${claimRef.key}`] = slotsToAdd;
  }

  await db.ref().update(updates);
  return { success: true };
});

export const adminForceDeploy = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  await requireAdmin(request.auth.uid);

  const { missionId } = request.data as { missionId?: string };
  if (!missionId) throw new HttpsError('invalid-argument', 'Missing missionId.');

  const db          = getDatabase();
  const missionSnap = await db.ref(`game/missions/${missionId}`).get();
  if (!missionSnap.exists()) throw new HttpsError('not-found', 'Mission not found.');
  const mission = missionSnap.val() as GMMission;
  if (mission.state !== 'forming')
    throw new HttpsError('failed-precondition', 'Mission is not forming.');

  await deployMission(missionId, mission, Date.now());
  return { success: true };
});


// ── onMissionComplete ─────────────────────────────────────────────────────────
// Mirrors onTileComplete: fires when a completed mission is archived to
// missionsHistory and updates participant profiles with XP snapshot, mission
// count, games from slots, and identity fields.

export const onMissionComplete = onValueCreated(
  'game/missionsHistory/{missionId}',
  async (event) => {
    const mission = event.data.val() as GMMission | null;
    if (!mission || mission.state !== 'complete') return;

    const db = getDatabase();

    const participantIds = Object.keys(mission.participants ?? {});
    if (participantIds.length === 0) return;

    const playersSnap = await db.ref('game/players').get();
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
        profileUpdates[`${base}/firstEvent`] = 'rpelago_s1';
      }

      // XP — snapshot of the player's current total (already includes this mission's reward).
      profileUpdates[`${base}/events/rpelago_s1/xp`] = player.xp ?? 0;

      // Missions — separate counter from tiles.
      profileUpdates[`${base}/events/rpelago_s1/missions`] = ServerValue.increment(1);

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
  },
);

// ── Scheduled tick: auto-deploy cohorts when decay meets fill count ───────────

export const tickGuildmasterMissions = onSchedule('every 15 minutes', async () => {
  const db      = getDatabase();
  const now     = Date.now();
  const snap    = await db.ref('game/missions').get();
  if (!snap.exists()) return;
  const missions = snap.val() as Record<string, GMMission>;
  for (const [id, m] of Object.entries(missions)) {
    if (gmShouldDeploy(m, now)) {
      await deployMission(id, m, now);
    }
  }
});
