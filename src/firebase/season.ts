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

/**
 * Resolves the first time a season is published.
 *
 * Season-scoped work can be kicked off before SeasonContext has resolved config
 * — notably AuthContext's post-sign-in checks, because Firebase restores the
 * auth session well before `config` loads. Such callers `await whenSeasonReady()`
 * instead of racing `getCurrentSeason()` and throwing.
 *
 * This is a MODULE-level promise rather than the SeasonContext value on purpose:
 * React flushes child effects before parent ones, so a child gating on the
 * `season` context value could still run before SeasonProvider's
 * setCurrentSeason() effect has fired.
 */
let markSeasonReady: (() => void) | null = null;
const seasonReadyPromise = new Promise<void>(resolve => { markSeasonReady = resolve; });

export function setCurrentSeason(seasonId: string): void {
  currentSeasonId = seasonId;
  markSeasonReady?.();
  markSeasonReady = null;
}

/** Await this before any season-scoped read/write that may run pre-config. */
export function whenSeasonReady(): Promise<void> {
  return currentSeasonId ? Promise.resolve() : seasonReadyPromise;
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

/** Path to a participant's own hand (a secret a client may read). */
export function ownHandPath(missionId: string, uid: string): string {
  return secretPath(`missions/${missionId}/participants/${uid}/hand`);
}

/** Path to a Hold 'Em seat's own hole cards — kept past play-on for a resubmit pool rebuild. */
export function ownHolePath(missionId: string, uid: string): string {
  return secretPath(`missions/${missionId}/participants/${uid}/hole`);
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
