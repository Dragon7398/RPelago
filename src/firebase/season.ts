import { ref, type Database, type DatabaseReference } from 'firebase/database';
import type { SeasonConfig, ResolvedSeason, SeasonStatus } from '../types';

/**
 * Season-aware path helpers.
 *
 * All game data lives under `seasons/{seasonId}/…`. Rather than thread a
 * seasonId parameter through ~40 db.ts functions, the active season is held in
 * module state and set once, before any subscription or write — mirroring how
 * `tileGen.initializeGrid()` already seeds a module-level grid.
 *
 * The setter is called from SeasonContext as soon as config resolves, and the
 * getters THROW if it hasn't been — so a missed initialization fails loudly at
 * the first read instead of silently writing to `seasons/undefined/…`.
 */

let currentSeasonId: string | null = null;

export function setCurrentSeason(seasonId: string): void {
  currentSeasonId = seasonId;
}

export function getCurrentSeason(): string {
  if (!currentSeasonId) {
    throw new Error(
      '[RPelago] No active season set. setCurrentSeason() must run before any ' +
      'season-scoped read or write (SeasonContext does this once config loads).',
    );
  }
  return currentSeasonId;
}

/** True once a season is set — lets callers no-op instead of throwing. */
export function hasCurrentSeason(): boolean {
  return currentSeasonId !== null;
}

/** `sPath('tiles/D3')` → `seasons/{active}/tiles/D3`. For multi-path update() keys. */
export function sPath(sub = ''): string {
  const base = `seasons/${getCurrentSeason()}`;
  return sub ? `${base}/${sub}` : base;
}

/** `sRef(db, 'tiles/D3')` → ref at `seasons/{active}/tiles/D3`. */
export function sRef(d: Database, sub = ''): DatabaseReference {
  return ref(d, sPath(sub));
}

/**
 * Secrets live OUTSIDE the world-readable season tree — see
 * docs/season-architecture-plan.md. RTDB read rules cascade downward, so a
 * `.read: true` anywhere above a node cannot be revoked beneath it; anything
 * secret therefore CANNOT live under `seasons/{id}/`.
 *
 * Client use is limited to reading one's OWN hand. The deck is server-only
 * (Cloud Functions bypass rules via the Admin SDK).
 */
export function secretPath(sub = ''): string {
  const base = `seasonSecrets/${getCurrentSeason()}`;
  return sub ? `${base}/${sub}` : base;
}

export function secretRef(d: Database, sub = ''): DatabaseReference {
  return ref(d, secretPath(sub));
}

/** Path to a participant's own hand (the only secret a client may read). */
export function ownHandPath(missionId: string, uid: string): string {
  return secretPath(`missions/${missionId}/participants/${uid}/hand`);
}

// ── Config resolution ────────────────────────────────────────────────────────

/**
 * Work out which season to render, and with what permissions.
 *
 * Normal players always get the active season. Admin/alpha users may preview a
 * draft season by passing `previewSeasonId` — that season is invisible to
 * everyone else (it isn't in the public seasonList at all).
 */
export function resolveSeason(
  config: SeasonConfig,
  previewSeasonId?: string | null,
): ResolvedSeason | null {
  if (previewSeasonId) {
    const draft = config.draftSeasons?.[previewSeasonId];
    if (draft) {
      return {
        id:       previewSeasonId,
        label:    draft.label,
        shell:    draft.shell,
        status:   'draft',
        isDraft:  true,
        writable: true,   // alphas/admin playtest drafts
      };
    }
    // Not a draft — fall through and treat it as a normal listed season.
  }

  const id    = previewSeasonId ?? config.activeSeasonId;
  const entry = config.seasonList?.[id];
  if (!entry) return null;

  const status: SeasonStatus = entry.status;
  return {
    id,
    label:    entry.label,
    shell:    entry.shell,
    status,
    isDraft:  false,
    // Archived seasons are frozen history.
    writable: status === 'active' || status === 'closing',
  };
}

/** Seasons an admin/alpha may switch to (live + archived + any drafts they can see). */
export function selectableSeasons(config: SeasonConfig): { id: string; label: string; status: SeasonStatus }[] {
  const listed = Object.entries(config.seasonList ?? {}).map(([id, e]) => ({
    id, label: e.label, status: e.status as SeasonStatus,
  }));
  const drafts = Object.entries(config.draftSeasons ?? {}).map(([id, e]) => ({
    id, label: e.label, status: 'draft' as SeasonStatus,
  }));
  return [...drafts, ...listed];
}
