#!/usr/bin/env node
/**
 * One-time season migration / launch operations (RPelago S1 → S1.5 → S2).
 *
 * Run from the `functions/` directory so firebase-admin resolves:
 *
 *   node scripts/season-migrate.mjs <command> [--dry-run] [--force]
 *
 * Commands (run roughly in this order):
 *   archive-s1          Copy game/* → seasons/rpelago_s1/* and mark it archived.
 *                       Leaves game/ intact (rollback safety).
 *   seed-config         Create config/ (adminId, activeSeasonId, seasonList,
 *                       draftSeasons, alphaUsers, minClientVersion). Holds the
 *                       active season at S1 (archived, read-only) until launch.
 *   create-casino-draft Create the empty S1.5 season skeleton (draft).
 *   kmk-migrate         Convert game/meta/kmkActiveListId → per-list `active`.
 *   ── run these two at LAUNCH, after wiping any draft playtest data ──
 *   bulk-seed-players   Create S1.5 player records from archived S1 players
 *                       (200 GP + retroactive Coat grant).
 *   launch-casino       Flip S1.5 to active + bump minClientVersion.
 *
 * Connection:
 *   Emulator — set FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 (and
 *     optionally GCLOUD_PROJECT / DATABASE_URL). Always dry-run against an
 *     emulator loaded with a prod export before touching production.
 *   Production — set GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>
 *     and DATABASE_URL=<https://…firebaseio.com>.
 *
 * Every command is idempotent and refuses to clobber existing data unless
 * --force is given. --dry-run logs intended writes without committing.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

// ── Editable constants ────────────────────────────────────────────────────────
const S1     = 'rpelago_s1';
const CASINO = 'rpelago_casino_1_5';
const S2     = 'rpelago_s2';

const CASINO_START_GOLD    = 200;   // mirror of src/lib/constants.ts
const COAT_ITEM            = 'coat_of_many_colors';
const COAT_GOLD_THRESHOLD  = 750;   // S1 balance that "could have bought" the Coat
const CASINO_OPEN_TABLES   = 6;
const MIN_CLIENT_VERSION   = 1;     // bump on launch-casino to force stale reloads

// UIDs allowed to read + playtest draft seasons. Fill before seed-config.
const ALPHA_UIDS = [
  'discord_945171555770585130',
];

const SEASON_LABELS = {
  [S1]:     'Season 1',
  [CASINO]: 'The RPelago Casino',
  [S2]:     'Season 2',
};

// ── Args / connection ─────────────────────────────────────────────────────────
const [, , command, ...rest] = process.argv;
const DRY_RUN = rest.includes('--dry-run');
const FORCE   = rest.includes('--force');

function connect() {
  const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (emulator) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-rpelago';
    const databaseURL =
      process.env.DATABASE_URL || `http://${emulator}?ns=${projectId}-default-rtdb`;
    initializeApp({ projectId, databaseURL });
    console.log(`[connect] EMULATOR ${emulator} (project ${projectId})`);
  } else {
    const databaseURL = process.env.DATABASE_URL;
    if (!databaseURL) throw new Error('DATABASE_URL is required for production.');
    initializeApp({ credential: applicationDefault(), databaseURL });
    console.log(`[connect] PRODUCTION ${databaseURL}`);
  }
  return getDatabase();
}

// Commit helper — logs in dry-run, writes otherwise.
async function commit(label, fn) {
  if (DRY_RUN) { console.log(`  [dry-run] would ${label}`); return; }
  await fn();
  console.log(`  ✓ ${label}`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function archiveS1(db) {
  const gameSnap = await db.ref('game').get();
  if (!gameSnap.exists()) throw new Error('game/ not found — nothing to archive.');

  const existing = await db.ref(`seasons/${S1}`).get();
  if (existing.exists() && !FORCE)
    throw new Error(`seasons/${S1} already exists. Re-run with --force to overwrite.`);

  const game = gameSnap.val();
  // meta loses adminId (now global config/adminId) and the old KMK pointer.
  const archived = {
    ...game,
    meta: { initialized: true, seed: game?.meta?.seed ?? 0 },
  };

  const players  = Object.keys(archived.players  ?? {}).length;
  const missions = Object.keys(archived.missions ?? {}).length;
  console.log(`archive-s1: copying game/ → seasons/${S1} (${players} players, ${missions} missions)`);
  await commit(`write seasons/${S1}`, () => db.ref(`seasons/${S1}`).set(archived));
  console.log('  (game/ left intact for rollback)');
}

async function seedConfig(db) {
  const adminSnap = await db.ref('game/meta/adminId').get();
  const adminId = adminSnap.val();
  if (!adminId) throw new Error('game/meta/adminId not found — cannot determine admin.');

  const existing = await db.ref('config').get();
  if (existing.exists() && !FORCE)
    throw new Error('config/ already exists. Re-run with --force to overwrite.');

  const alphaUsers = {};
  for (const uid of ALPHA_UIDS) alphaUsers[uid] = true;

  const config = {
    adminId,
    // Hold the public site on the archived S1 map until launch-casino runs.
    activeSeasonId:   S1,
    minClientVersion: MIN_CLIENT_VERSION,
    seasonList: {
      [S1]: { label: SEASON_LABELS[S1], shell: 'map', status: 'archived' },
    },
    // Draft seasons are private (admin + alpha read only).
    draftSeasons: {
      [CASINO]: { label: SEASON_LABELS[CASINO], shell: 'casino', casinoOpenTables: CASINO_OPEN_TABLES },
      [S2]:     { label: SEASON_LABELS[S2],     shell: 'map' },
    },
    ...(Object.keys(alphaUsers).length ? { alphaUsers } : {}),
  };

  console.log(`seed-config: admin=${adminId}, active=${S1}, alphas=${ALPHA_UIDS.length}`);
  if (!ALPHA_UIDS.length)
    console.log('  ⚠ ALPHA_UIDS is empty — no one can preview drafts. Edit the script to add testers.');
  await commit('write config/', () => db.ref('config').set(config));
}

async function createCasinoDraft(db) {
  const existing = await db.ref(`seasons/${CASINO}/meta`).get();
  if (existing.exists() && !FORCE)
    throw new Error(`seasons/${CASINO} already initialized. Re-run with --force to reset meta.`);

  const seed = Math.floor(Math.random() * 0x7fffffff);
  console.log(`create-casino-draft: seasons/${CASINO}/meta (seed ${seed})`);
  console.log('  (players are bulk-seeded at launch; casino tables are seeded by the app)');
  await commit(`write seasons/${CASINO}/meta`,
    () => db.ref(`seasons/${CASINO}/meta`).set({ initialized: true, seed }));
}

async function kmkMigrate(db) {
  const [listsSnap, pointerSnap] = await Promise.all([
    db.ref('kmkEvents').get(),
    db.ref('game/meta/kmkActiveListId').get(),
  ]);
  if (!listsSnap.exists()) { console.log('kmk-migrate: no kmkEvents — nothing to do.'); return; }

  const activeId = pointerSnap.val();
  const lists = listsSnap.val();
  console.log(`kmk-migrate: ${Object.keys(lists).length} list(s), previously-active=${activeId ?? 'none'}`);

  const updates = {};
  for (const listId of Object.keys(lists)) {
    updates[`kmkEvents/${listId}/active`] = listId === activeId;
  }
  await commit('set per-list active flags', () => db.ref().update(updates));
}

async function bulkSeedPlayers(db) {
  const s1Snap = await db.ref(`seasons/${S1}/players`).get();
  if (!s1Snap.exists()) throw new Error(`seasons/${S1}/players not found — run archive-s1 first.`);
  const s1Players = s1Snap.val();

  const existing = await db.ref(`seasons/${CASINO}/players`).get();
  if (existing.exists() && !FORCE)
    throw new Error(`seasons/${CASINO}/players already exist. Wipe playtest data, then re-run with --force.`);

  const records = {};
  let coatGrants = 0;
  for (const [uid, p] of Object.entries(s1Players)) {
    const hadCoat   = (p.inventory?.[COAT_ITEM] ?? 0) > 0;
    const couldBuy  = (p.gold ?? 0) >= COAT_GOLD_THRESHOLD;
    const grantCoat = hadCoat || couldBuy;
    if (grantCoat) coatGrants++;

    records[uid] = {
      id:            uid,
      displayName:   p.displayName,
      gold:          CASINO_START_GOLD,
      ...(p.discordHandle != null ? { discordHandle: p.discordHandle } : {}),
      ...(p.avatarHash    != null ? { avatarHash:    p.avatarHash    } : {}),
      ...(p.joinedAt      != null ? { joinedAt:      p.joinedAt       } : {}),
      ...(p.nameColor     != null ? { nameColor:     p.nameColor      } : {}),
      // Coat ownership uses the existing inventory convention (name-color picker
      // checks inventory[coat_of_many_colors]), so no new field/logic is needed.
      ...(grantCoat ? { inventory: { [COAT_ITEM]: 1 } } : {}),
    };
  }

  console.log(`bulk-seed-players: ${Object.keys(records).length} record(s) @ ${CASINO_START_GOLD} GP, ${coatGrants} Coat grant(s)`);
  await commit(`write seasons/${CASINO}/players`,
    () => db.ref(`seasons/${CASINO}/players`).set(records));
}

async function launchCasino(db) {
  const configSnap = await db.ref('config').get();
  if (!configSnap.exists()) throw new Error('config/ not found — run seed-config first.');
  const config = configSnap.val();

  const draft = config.draftSeasons?.[CASINO];
  if (!draft && config.seasonList?.[CASINO]?.status === 'active') {
    console.log('launch-casino: already launched — nothing to do.'); return;
  }
  if (!draft) throw new Error(`${CASINO} is not a draft season — cannot launch.`);

  const newVersion = (config.minClientVersion ?? 0) + 1;
  const updates = {
    'config/activeSeasonId':               CASINO,
    'config/minClientVersion':             newVersion,
    [`config/seasonList/${CASINO}`]: {
      label:  draft.label,
      shell:  'casino',
      status: 'active',
      casinoOpenTables: draft.casinoOpenTables ?? CASINO_OPEN_TABLES,
    },
    [`config/draftSeasons/${CASINO}`]:      null,   // remove from the private list
  };

  console.log(`launch-casino: activeSeasonId → ${CASINO}, minClientVersion → ${newVersion}`);
  console.log('  ⚠ stale client bundles will force-reload. Ensure the versioned frontend is deployed first.');
  await commit('flip config to launch S1.5', () => db.ref().update(updates));
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const COMMANDS = {
  'archive-s1':          archiveS1,
  'seed-config':         seedConfig,
  'create-casino-draft': createCasinoDraft,
  'kmk-migrate':         kmkMigrate,
  'bulk-seed-players':   bulkSeedPlayers,
  'launch-casino':       launchCasino,
};

async function main() {
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(`Unknown command: ${command ?? '(none)'}`);
    console.error(`Commands: ${Object.keys(COMMANDS).join(', ')}`);
    console.error('Flags: --dry-run --force');
    process.exit(1);
  }
  if (DRY_RUN) console.log('=== DRY RUN — no writes will be committed ===');
  const db = connect();
  await fn(db);
  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
