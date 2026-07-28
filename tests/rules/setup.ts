import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

// "demo-" prefix keeps the emulator fully offline — it never contacts a real
// Firebase project, so these tests cannot touch production.
//
// Each test FILE passes its own projectId, which gives it a separate database
// namespace in the emulator. Files each seed the root, so without this they
// would clobber each other when run in parallel.
export const ADMIN_UID  = 'discord_admin';
export const PLAYER_UID = 'discord_player1';
export const OTHER_UID  = 'discord_player2';
export const ALPHA_UID  = 'discord_alpha';

export const MISSION_ID      = 'mission1';
export const KMK_LIST        = 'list1';
export const KMK_AREA        = 'area1';
export const KMK_TASK        = 'task1';

// Seasons
export const S1      = 'rpelago_s1';          // archived → public, read-only
export const CASINO  = 'casino_s1';  // active   → public, live
export const S2      = 'rpelago_s2';          // DRAFT    → admin/alpha only

export async function makeTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    database: {
      rules: readFileSync('database.rules.json', 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
}

/**
 * Seed a realistic game state with rules bypassed.
 * Mirrors the shapes the live app actually writes.
 */
export async function seed(testEnv: RulesTestEnvironment): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().set({
      kmkEvents: {
        [KMK_LIST]: {
          name: 'Trial List',
          createdAt: 1_700_000_000_000,
          areas: {
            [KMK_AREA]: {
              name: 'Area One',
              tasks: {
                [KMK_TASK]: {
                  trial: 'Trial A',
                  desc: 'Do the thing',
                  order: 0,
                  status: 'Pending',
                  playerId: PLAYER_UID,
                  playerName: 'Player One',
                },
              },
            },
          },
        },
      },

      profiles: {
        players: {
          [PLAYER_UID]: { id: PLAYER_UID, displayName: 'Player One' },
        },
        handleIndex: { player1: PLAYER_UID },
      },

      // ── New season-scoped tree ──────────────────────────────────────────
      config: {
        adminId:          ADMIN_UID,
        activeSeasonId:   CASINO,
        minClientVersion: 1,
        // PUBLIC list — drafts are deliberately absent.
        seasonList: {
          [S1]:     { label: 'Season 1',   shell: 'map',    status: 'archived' },
          [CASINO]: { label: 'The Casino', shell: 'casino', status: 'active'   },
        },
        // PRIVATE — admin + alpha only.
        draftSeasons: {
          [S2]: { label: 'Season 2', shell: 'map' },
        },
        alphaUsers: { [ALPHA_UID]: true },
      },

      seasons: {
        [S1]: {
          meta:   { seed: 1 },
          tiles:  { D3: { state: 'complete', name: 'Centralia', adventurers: {} } },
          players: {
            [PLAYER_UID]: { id: PLAYER_UID, displayName: 'Player One', xp: 900, gold: 800 },
          },
        },

        [CASINO]: {
          meta:    { seed: 2 },
          players: {
            [PLAYER_UID]: { id: PLAYER_UID, displayName: 'Player One', xp: 0, gold: 200 },
            [OTHER_UID]:  { id: OTHER_UID,  displayName: 'Player Two', xp: 0, gold: 200 },
          },
          missions: {
            [MISSION_ID]: {
              id: MISSION_ID,
              type: 'casino',
              casinoGame: 'holdem',
              state: 'forming',
              pot: 100,
              participants: {
                // NOTE: no deck/hand here — secrets live in seasonSecrets.
                [PLAYER_UID]: {
                  playerId: PLAYER_UID,
                  playerName: 'Player One',
                  joinedAt: 1_700_000_000_000,
                },
              },
              claimableSlots: { slotB: [{ name: '', game: '' }] },
            },
          },
          notifications: {
            [PLAYER_UID]: { n1: { type: 'mission_deploy', label: 'X', ts: 1 } },
          },
        },

        // DRAFT — unlaunched. Must be invisible to normal players.
        [S2]: {
          meta:  { seed: 3 },
          tiles: { A1: { state: 'hidden', name: 'SPOILER Boss Lair', adventurers: {} } },
          players: {
            [ALPHA_UID]: { id: ALPHA_UID, displayName: 'Alpha', xp: 0, gold: 0 },
          },
        },
      },

      // Secrets: no permissive ancestor anywhere above these leaves.
      seasonSecrets: {
        [CASINO]: {
          missions: {
            [MISSION_ID]: {
              participants: {
                [PLAYER_UID]: {
                  deck: [{ uid: 1, type: 'broad',  value: 40 }],
                  hand: [{ uid: 2, type: 'narrow', value: 25 }],
                },
              },
            },
          },
        },
      },
    });
  });
}
