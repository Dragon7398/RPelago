#!/usr/bin/env node
/**
 * Load a raw RTDB JSON export into the LOCAL EMULATOR (never production).
 *
 *   node scripts/emulator-import.mjs <export.json>
 *
 * Expects FIREBASE_DATABASE_EMULATOR_HOST to be set (as `emulators:start`
 * env, or export it yourself) — the script REFUSES to run without it, so it
 * can only ever write to the emulator.
 *
 * Produce the export first with:
 *   npx firebase database:get / --project <real-project-id> -o export.json
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/emulator-import.mjs <export.json>'); process.exit(1); }

const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!emulator) {
  console.error('Refusing to run: FIREBASE_DATABASE_EMULATOR_HOST is not set.');
  console.error('This script only ever writes to the emulator. Set it first, e.g.:');
  console.error('  $env:FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000"');
  process.exit(1);
}

const projectId   = process.env.GCLOUD_PROJECT || 'demo-rpelago';
const databaseURL = `http://${emulator}?ns=${projectId}-default-rtdb`;
initializeApp({ projectId, databaseURL });

const data = JSON.parse(readFileSync(file, 'utf8'));
const topKeys = Object.keys(data ?? {});
console.log(`Importing ${topKeys.length} top-level node(s) [${topKeys.join(', ')}] → ${databaseURL}`);

await getDatabase().ref().set(data);
console.log('✓ Imported into the emulator.');
process.exit(0);
