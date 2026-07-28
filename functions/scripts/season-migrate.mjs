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
 *   reseed-casino       Wipe the casino DRAFT's playtest tables/secrets/log and
 *                       reset player gold, so the app can re-open tables at
 *                       current numbers. Draft-only; needs --force to commit.
 *   migrate-claims      Non-destructive: convert each player's legacy scalar
 *                       activeMission → the pooled activeMissions set, then clear
 *                       the scalar. Safe on a LIVE season with players mid-table;
 *                       idempotent. Run once when deploying pooled claims.
 *   ── run these two at LAUNCH, after wiping any draft playtest data ──
 *   bulk-seed-players   Create S1.5 player records from archived S1 players
 *                       (500 GP + retroactive Coat grant).
 *   launch-casino       Flip S1.5 to active + bump minClientVersion.
 *   ── final teardown, only after S1.5 is verified live (arch plan step 10) ──
 *   delete-game         Remove the legacy game/ tree (the dead copy left by
 *                       archive-s1). Guarded: archive must exist and the active
 *                       season must have moved off S1. profiles/ is untouched.
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
const CASINO = 'casino_s1';
const S2     = 'rpelago_s2';

const CASINO_START_GOLD    = 500;   // mirror of src/lib/constants.ts
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

// Wipe a casino DRAFT's playtest data so the app can re-open tables at current
// numbers. Tables bank their economy at creation (seats, odds, and pot are rolled
// by freshCasinoTable and then persisted), so tables rolled under older constants
// keep those numbers forever — the only way to re-price them is to delete and
// re-open. seedInitialMissions() only tops up to the target, so it is a no-op
// until the stale tables are gone; that's what this clears.
//
// Player records SURVIVE (identity, inventory, Coat grants), but gold resets to
// the current start and all held claims are cleared — a seat still pointing at a
// deleted table would lock that player out of the whole floor. Both the new
// `activeMissions` set and any legacy scalar `activeMission` are wiped.
//
// Draft-only, with no --force override: this deletes player-facing history, and
// a live season's tables have real gold in them.
async function reseedCasino(db) {
  const [draftSnap, listedSnap] = await Promise.all([
    db.ref(`config/draftSeasons/${CASINO}`).get(),
    db.ref(`config/seasonList/${CASINO}`).get(),
  ]);
  const status = listedSnap.val()?.status;
  if (!draftSnap.exists() || (status && status !== 'draft'))
    throw new Error(`${CASINO} is not a draft season (status: ${status ?? 'unlisted'}) — refusing to wipe live tables.`);
  if (!FORCE && !DRY_RUN)
    throw new Error('reseed-casino deletes data. Re-run with --dry-run to preview, or --force to commit.');

  const [missionsSnap, historySnap, playersSnap] = await Promise.all([
    db.ref(`seasons/${CASINO}/missions`).get(),
    db.ref(`seasons/${CASINO}/missionsHistory`).get(),
    db.ref(`seasons/${CASINO}/players`).get(),
  ]);
  const players = playersSnap.val() ?? {};

  const updates = {
    [`seasons/${CASINO}/missions`]:        null,  // the stale tables
    [`seasons/${CASINO}/missionsHistory`]: null,  // settled tables priced under old numbers
    [`seasons/${CASINO}/casinoSeries`]:    null,  // cohort counters → new tables start at I again
    [`seasons/${CASINO}/activityLog`]:     null,
    [`seasonSecrets/${CASINO}`]:           null,  // decks + hands of half-played seats
  };
  for (const uid of Object.keys(players)) {
    updates[`seasons/${CASINO}/players/${uid}/gold`]           = CASINO_START_GOLD;
    updates[`seasons/${CASINO}/players/${uid}/activeMissions`] = null;
    updates[`seasons/${CASINO}/players/${uid}/activeMission`]  = null;  // legacy scalar
  }

  console.log(`reseed-casino: clearing ${Object.keys(missionsSnap.val() ?? {}).length} table(s), ` +
              `${Object.keys(historySnap.val() ?? {}).length} settled, secrets, log`);
  console.log(`  ${Object.keys(players).length} player record(s) kept — gold → ${CASINO_START_GOLD} GP, seats released`);
  await commit('wipe casino playtest data', () => db.ref().update(updates));
  console.log('  next: Admin → Missions → "Open Casino Tables" to re-open at current numbers.');
}

// A participant's slots are all "free" (terminal) once every one is 100%/Goaled/
// Done — mirrors src/lib/slotHelpers.slotsAllFree and the tick's reclaim check.
// Empty/absent slots are NOT free (nothing played yet).
function slotsAllFreeMjs(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return false;
  return slots.every(s => s && (s.status === '100%' || s.status === 'Goaled' || s.status === 'Done'));
}

// Non-destructive: convert each player's legacy scalar `activeMission` into the
// pooled-claims `activeMissions` set, then clear the scalar. Safe to run on a
// LIVE season with players mid-table — it touches ONLY players that still carry
// the old scalar, keeps their seat/hand/progress, and is idempotent.
//
// It lands each player in the SAME state steady-state code would:
//   • table gone / no longer seated  → dead pointer, scalar just cleared.
//   • seated, slots NOT all done      → a HELD claim (counts against capacity).
//   • seated, slots ALL done          → FREED (no claim minted), so a player who
//                                        has personally finished is immediately
//                                        eligible to take a new table on deploy —
//                                        without waiting for the next tick to
//                                        reclaim. Forming tables are always held
//                                        (setup in progress, no finished slots).
// Runs across every season under seasons/ so drafts (alpha playtests) are covered.
async function migrateClaims(db) {
  const seasonsSnap = await db.ref('seasons').get();
  if (!seasonsSnap.exists()) throw new Error('seasons/ not found.');

  const updates = {};
  let held = 0, freed = 0, dropped = 0;
  const seasons = seasonsSnap.val();

  for (const seasonId of Object.keys(seasons)) {
    const season  = seasons[seasonId] ?? {};
    const players  = season.players  ?? {};
    const missions = season.missions ?? {};

    for (const uid of Object.keys(players)) {
      const am = players[uid]?.activeMission;
      if (typeof am !== 'string' || am === '') continue;  // no legacy scalar

      const m = missions[am];
      const seated = !!m
        && (m.state === 'forming' || m.state === 'inprogress')
        && !!m.participants?.[uid];

      if (!seated) {
        dropped++;                                        // dead pointer
      } else if (m.state === 'inprogress' && slotsAllFreeMjs(m.participants[uid].slots)) {
        freed++;                                          // finished — claim already back in the pool
      } else {
        updates[`seasons/${seasonId}/players/${uid}/activeMissions/${am}`] = true;
        held++;                                           // still on the hook
      }
      updates[`seasons/${seasonId}/players/${uid}/activeMission`] = null;
    }
  }

  const n = Object.keys(updates).length;
  if (n === 0) {
    console.log('migrate-claims: no legacy activeMission scalars found — nothing to do.');
    return;
  }
  console.log(`migrate-claims: ${held} held claim(s) carried over, ${freed} finished seat(s) left freed, ` +
              `${dropped} dead pointer(s) dropped across ${Object.keys(seasons).length} season(s).`);
  await commit(`convert activeMission → activeMissions (${n} writes)`,
    () => db.ref().update(updates));
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

// Final teardown: delete the legacy game/ tree. This is the last step of the
// season migration (arch plan step 10), taken only after S1.5 is verified live.
// game/ was COPIED, never moved (archive-s1), so this removes the dead second
// copy. profiles/ is a separate top-level node and is never touched.
//
// Two guards, because this is irreversible:
//   1. seasons/rpelago_s1 must be archived + populated — never delete the only copy.
//   2. config/activeSeasonId must have moved off S1 — the live site can't still be
//      rendering the legacy tree.
// Destructive: needs --force to commit; --dry-run previews.
async function deleteGame(db) {
  const gameSnap = await db.ref('game').get();
  if (!gameSnap.exists()) { console.log('delete-game: game/ already gone — nothing to do.'); return; }

  const archiveSnap = await db.ref(`seasons/${S1}/players`).get();
  if (!archiveSnap.exists())
    throw new Error(`seasons/${S1}/players not found — run archive-s1 before deleting game/.`);

  const active = (await db.ref('config/activeSeasonId').get()).val();
  if (active === S1)
    throw new Error(`config/activeSeasonId is still ${S1} — the site is live on the legacy tree. Launch a newer season first.`);

  const gamePlayers    = Object.keys(gameSnap.val()?.players ?? {}).length;
  const archivePlayers = Object.keys(archiveSnap.val() ?? {}).length;
  console.log(`delete-game: game/ has ${gamePlayers} player(s); seasons/${S1} archive has ${archivePlayers}. Active season: ${active}.`);
  if (gamePlayers !== archivePlayers)
    console.log('  ⚠ player counts differ (stale-bundle writes to the dead node are expected) — confirm the archive is the source of truth before proceeding.');

  if (!FORCE && !DRY_RUN)
    throw new Error('delete-game permanently removes game/. Re-run with --dry-run to preview, or --force to commit.');

  await commit('delete game/ (profiles/ untouched)', () => db.ref('game').remove());
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
const COMMANDS = {
  'archive-s1':          archiveS1,
  'seed-config':         seedConfig,
  'create-casino-draft': createCasinoDraft,
  'kmk-migrate':         kmkMigrate,
  'reseed-casino':       reseedCasino,
  'migrate-claims':      migrateClaims,
  'bulk-seed-players':   bulkSeedPlayers,
  'launch-casino':       launchCasino,
  'delete-game':         deleteGame,
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
