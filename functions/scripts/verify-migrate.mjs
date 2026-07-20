#!/usr/bin/env node
/**
 * End-to-end check for season-migrate.mjs against the RTDB emulator.
 * Run via:  firebase emulators:exec --only database --project demo-rpelago "node scripts/verify-migrate.mjs"
 *
 * Seeds a realistic game/ + kmkEvents/ dataset, runs every migration command as
 * a subprocess (exactly as an operator would), and asserts the resulting tree.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { spawnSync } from 'node:child_process';

const projectId   = process.env.GCLOUD_PROJECT || 'demo-rpelago';
const emulator    = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const databaseURL = `http://${emulator}?ns=${projectId}-default-rtdb`;
initializeApp({ credential: applicationDefault(), databaseURL });
const db = getDatabase();

const ADMIN = 'discord_admin';
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { console.error(`  ✗ ${msg}`); failures++; }
}
function run(cmd) {
  console.log(`\n$ node scripts/season-migrate.mjs ${cmd}`);
  const r = spawnSync('node', ['scripts/season-migrate.mjs', ...cmd.split(' ')], {
    stdio: 'inherit', env: process.env,
  });
  if (r.status !== 0) { console.error(`command failed: ${cmd}`); process.exit(1); }
}

async function seed() {
  await db.ref().set({
    game: {
      meta: { adminId: ADMIN, initialized: true, seed: 42, kmkActiveListId: 'listA' },
      players: {
        // Owns the Coat outright.
        p_coat:   { id: 'p_coat',  displayName: 'Coat Owner', gold: 120, nameColor: 'crimson',
                    inventory: { coat_of_many_colors: 1 }, discordHandle: 'coat', joinedAt: 1 },
        // No coat, but ≥750 gold → retroactive grant.
        p_rich:   { id: 'p_rich',  displayName: 'Rich',       gold: 900, inventory: {}, joinedAt: 2 },
        // No coat, <750 gold → no grant.
        p_poor:   { id: 'p_poor',  displayName: 'Poor',       gold: 300, inventory: {}, joinedAt: 3 },
      },
      tiles:    { D3: { state: 'complete', name: 'Centralia' } },
      missions: { m1: { id: 'm1', type: 'patrol', state: 'complete' } },
    },
    kmkEvents: {
      listA: { name: 'Active List',   createdAt: 1, areas: {} },
      listB: { name: 'Inactive List', createdAt: 2, areas: {} },
    },
  });
  console.log('seeded game/ + kmkEvents/');
}

async function main() {
  await seed();

  run('archive-s1');
  run('seed-config');
  run('create-casino-draft');
  run('kmk-migrate');

  console.log('\n── after migration ──');
  const s1   = (await db.ref('seasons/rpelago_s1').get()).val();
  const conf = (await db.ref('config').get()).val();
  const kmk  = (await db.ref('kmkEvents').get()).val();
  const game = (await db.ref('game').get()).val();

  assert(!!s1, 'seasons/rpelago_s1 created');
  assert(s1?.meta?.adminId === undefined, 'archived meta drops adminId');
  assert(s1?.meta?.seed === 42, 'archived meta keeps seed');
  assert(Object.keys(s1?.players ?? {}).length === 3, 'S1 players copied');
  assert(!!game, 'game/ left intact (rollback safety)');

  assert(conf?.adminId === ADMIN, 'config.adminId from game/meta');
  assert(conf?.activeSeasonId === 'rpelago_s1', 'active season held at S1 (pre-launch)');
  assert(conf?.seasonList?.rpelago_s1?.status === 'archived', 'S1 listed archived');
  assert(conf?.seasonList?.casino_s1 === undefined, 'casino NOT in public list yet');
  assert(!!conf?.draftSeasons?.casino_s1, 'casino is a draft season');
  assert(!!conf?.draftSeasons?.rpelago_s2, 'S2 is a draft season');

  assert(kmk?.listA?.active === true,  'previously-active KMK list → active:true');
  assert(kmk?.listB?.active === false, 'other KMK list → active:false');

  // Launch phase.
  run('bulk-seed-players');
  run('launch-casino');

  console.log('\n── after launch ──');
  const players = (await db.ref('seasons/casino_s1/players').get()).val();
  const conf2   = (await db.ref('config').get()).val();

  assert(players?.p_coat?.gold === 200, 'seeded player starts at 200 GP');
  assert(players?.p_coat?.inventory?.coat_of_many_colors === 1, 'coat owner keeps Coat');
  assert(players?.p_rich?.inventory?.coat_of_many_colors === 1, '≥750 GP player granted Coat');
  assert(players?.p_poor?.inventory === undefined, '<750 GP player gets no Coat');
  assert(players?.p_coat?.nameColor === 'crimson', 'nameColor carried over');
  assert(players?.p_coat?.xp === undefined, 'casino record has no XP');

  assert(conf2?.activeSeasonId === 'casino_s1', 'launch: active season → casino');
  assert(conf2?.seasonList?.casino_s1?.status === 'active', 'launch: casino listed active');
  assert(conf2?.seasonList?.casino_s1?.casinoOpenTables === 6, 'launch: casinoOpenTables carried');
  assert(conf2?.draftSeasons?.casino_s1 === undefined, 'launch: casino removed from drafts');
  assert(conf2?.minClientVersion === 2, 'launch: minClientVersion bumped');

  // Idempotency spot-check.
  run('launch-casino');

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error('HARNESS FAILED:', err); process.exit(1); });
