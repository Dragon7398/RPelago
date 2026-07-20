import { getDatabase } from 'firebase-admin/database';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Server-side season path + permission helpers.
 *
 * Mirrors the client's src/firebase/season.ts. All game data lives under
 * `seasons/{seasonId}/…`; secrets (casino deck/hand) live under
 * `seasonSecrets/{seasonId}/…`, which has NO publicly-readable ancestor.
 *
 * Cloud Functions bypass security rules via the Admin SDK, so these helpers are
 * about correctness (writing to the right season) and policy (not letting a
 * client act on a season it shouldn't), not access control.
 */

export type SeasonStatus = 'draft' | 'active' | 'closing' | 'archived';
export type SeasonShell   = 'map' | 'casino';

/** `sp(id, 'tiles/D3')` → `seasons/{id}/tiles/D3`. */
export function sp(seasonId: string, sub = ''): string {
  const base = `seasons/${seasonId}`;
  return sub ? `${base}/${sub}` : base;
}

/** `secret(id, 'missions/m1/participants/u/deck')` → `seasonSecrets/{id}/…`. */
export function secret(seasonId: string, sub = ''): string {
  const base = `seasonSecrets/${seasonId}`;
  return sub ? `${base}/${sub}` : base;
}

interface SeasonListEntry { label: string; shell: SeasonShell; status: Exclude<SeasonStatus, 'draft'>; casinoOpenTables?: number }
interface DraftSeasonEntry { label: string; shell: SeasonShell; casinoOpenTables?: number }

export interface SeasonConfig {
  adminId:          string;
  activeSeasonId:   string;
  minClientVersion: number;
  seasonList:       Record<string, SeasonListEntry>;
  draftSeasons?:    Record<string, DraftSeasonEntry>;
  alphaUsers?:      Record<string, boolean>;
}

export async function getConfig(db = getDatabase()): Promise<SeasonConfig> {
  const snap = await db.ref('config').get();
  if (!snap.exists()) throw new HttpsError('failed-precondition', 'Season config missing.');
  return snap.val() as SeasonConfig;
}

/** Status + shell of a season, from config. Drafts live in a separate list. */
export function seasonInfo(config: SeasonConfig, seasonId: string): { status: SeasonStatus; shell: SeasonShell } | null {
  const listed = config.seasonList?.[seasonId];
  if (listed) return { status: listed.status, shell: listed.shell };
  const draft = config.draftSeasons?.[seasonId];
  if (draft) return { status: 'draft', shell: draft.shell };
  return null;
}

/** True when the season is a draft — used to suppress profile writes. */
export async function isDraftSeason(seasonId: string, db = getDatabase()): Promise<boolean> {
  const config = await getConfig(db);
  return seasonInfo(config, seasonId)?.status === 'draft';
}

/**
 * Season ids a scheduled function should process. Scheduled functions have no
 * `event.params.seasonId`, so they must fan out over seasons explicitly.
 *
 * - includeDraft: process draft seasons too (mission tick, so alphas can
 *   playtest deploy). The weekly gold top-up passes false — it runs live only.
 * Archived seasons are always skipped (frozen).
 */
export async function tickableSeasons(
  db = getDatabase(),
  includeDraft = true,
): Promise<Array<{ seasonId: string; status: SeasonStatus; shell: SeasonShell }>> {
  const config = await getConfig(db);
  const out: Array<{ seasonId: string; status: SeasonStatus; shell: SeasonShell }> = [];
  for (const [seasonId, e] of Object.entries(config.seasonList ?? {})) {
    if (e.status === 'active' || e.status === 'closing') out.push({ seasonId, status: e.status, shell: e.shell });
  }
  if (includeDraft) {
    for (const [seasonId, e] of Object.entries(config.draftSeasons ?? {})) {
      out.push({ seasonId, status: 'draft', shell: e.shell });
    }
  }
  return out;
}

/**
 * Resolve the season a player callable should act on, and authorize it.
 *
 * - No requested id → the active season (the normal case; keeps player calls
 *   from having to know the season id).
 * - A requested id → must be writable BY THIS USER:
 *     active / closing → anyone
 *     draft            → admin or alpha only (playtesting)
 *     archived         → admin only (frozen history)
 *
 * Returns the resolved id plus its status/shell.
 */
export async function resolveWriteSeason(
  uid: string,
  requestedSeasonId: string | undefined | null,
  db = getDatabase(),
): Promise<{ seasonId: string; status: SeasonStatus; shell: SeasonShell }> {
  const config   = await getConfig(db);
  const seasonId = requestedSeasonId || config.activeSeasonId;
  const info     = seasonInfo(config, seasonId);
  if (!info) throw new HttpsError('not-found', 'Unknown season.');

  const isAdmin = config.adminId === uid;
  const isAlpha = !!config.alphaUsers?.[uid];

  if (info.status === 'draft' && !isAdmin && !isAlpha)
    throw new HttpsError('permission-denied', 'Season not available.');
  if (info.status === 'archived' && !isAdmin)
    throw new HttpsError('failed-precondition', 'Season is archived.');

  return { seasonId, status: info.status, shell: info.shell };
}
