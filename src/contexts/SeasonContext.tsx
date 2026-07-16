import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { onValue, ref } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { firebaseReady, db as firebaseDb, auth as firebaseAuth } from '../firebase/config';
import { setCurrentSeason, resolveSeason, selectableSeasons } from '../firebase/season';
import { CLIENT_VERSION } from '../lib/version';
import type { SeasonConfig, ResolvedSeason, SeasonStatus, SeasonListEntry, DraftSeasonEntry } from '../types';

interface SeasonContextValue {
  config:  SeasonConfig | null;
  season:  ResolvedSeason | null;
  loading: boolean;

  /** Global admin (config/adminId) — no longer per-season. */
  isAdmin: boolean;
  /** Alpha users may read AND playtest draft seasons. */
  isAlpha: boolean;

  /** Seasons this user may switch to (drafts only appear for admin/alpha). */
  available: { id: string; label: string; status: SeasonStatus }[];
  /** Preview/playtest another season. Pass null to return to the active one. */
  previewSeason: (seasonId: string | null) => void;
  previewingId: string | null;
}

const SeasonContext = createContext<SeasonContextValue | null>(null);

/**
 * Config is assembled from its individual children rather than one read of the
 * whole `config` node — see the subscription below for why. `undefined` means
 * "that read hasn't come back yet"; `null` / `{}` means "came back empty".
 */
interface ConfigParts {
  adminId?:          string | null;
  activeSeasonId?:   string | null;
  minClientVersion?: number;
  seasonList?:       Record<string, SeasonListEntry>;
  draftSeasons?:     Record<string, DraftSeasonEntry>;
  alphaUsers?:       Record<string, boolean>;
}

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [parts, setParts]         = useState<ConfigParts>({});
  const [uid, setUid]             = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Track the signed-in uid so admin/alpha can be derived.
  useEffect(() => {
    if (!firebaseReady || !firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, u => setUid(u?.uid ?? null));
  }, []);

  // Subscribe to global config — one child at a time, NOT the whole `config`
  // node.
  //
  // RTDB read rules cascade DOWNWARD and are evaluated at the node you actually
  // read: you may only read a node if `.read` is true AT it or ABOVE it. Child
  // grants never permit reading the parent. `config` deliberately has no `.read`
  // of its own — one there would cascade down and expose draftSeasons /
  // alphaUsers, which is exactly what the season architecture forbids — so
  // reading `config` outright is denied for everyone and must never be tried.
  //
  // The public children are readable by all; the private two are readable only
  // by admin/alpha, so their reads are best-effort: a denial is the EXPECTED
  // outcome for a normal player and just means "no drafts visible".
  useEffect(() => {
    if (!firebaseReady || !firebaseDb) return;
    const d = firebaseDb;
    const patch = (p: ConfigParts) => setParts(prev => ({ ...prev, ...p }));

    // A denied/failed PUBLIC read would otherwise hang the app on the loading
    // screen forever, so surface it loudly and settle the part as empty.
    const publicErr = (key: string) => (err: Error) => {
      console.error(`[RPelago] Could not read config/${key} — the app cannot resolve a season.`, err);
      patch({ [key]: null } as ConfigParts);
    };

    const subs = [
      onValue(ref(d, 'config/adminId'),          s => patch({ adminId: s.val() ?? null }),          publicErr('adminId')),
      onValue(ref(d, 'config/activeSeasonId'),   s => patch({ activeSeasonId: s.val() ?? null }),   publicErr('activeSeasonId')),
      onValue(ref(d, 'config/minClientVersion'), s => patch({ minClientVersion: s.val() ?? 0 }),    publicErr('minClientVersion')),
      onValue(ref(d, 'config/seasonList'),       s => patch({ seasonList: s.val() ?? {} }),         publicErr('seasonList')),
      // Private — denial is normal and silent.
      onValue(ref(d, 'config/draftSeasons'), s => patch({ draftSeasons: s.val() ?? {} }), () => patch({ draftSeasons: {} })),
      onValue(ref(d, 'config/alphaUsers'),   s => patch({ alphaUsers:   s.val() ?? {} }), () => patch({ alphaUsers:   {} })),
    ];
    return () => subs.forEach(unsub => unsub());
  }, []);

  // Settled once the two reads resolveSeason actually needs have come back.
  const loading = firebaseReady && !!firebaseDb
    && (parts.activeSeasonId === undefined || parts.seasonList === undefined);

  const config: SeasonConfig | null = (!loading && parts.activeSeasonId && parts.seasonList)
    ? {
        adminId:          parts.adminId ?? '',
        activeSeasonId:   parts.activeSeasonId,
        minClientVersion: parts.minClientVersion ?? 0,
        seasonList:       parts.seasonList,
        draftSeasons:     parts.draftSeasons,
        alphaUsers:       parts.alphaUsers,
      }
    : null;

  const isAdmin = !!uid && !!config && config.adminId === uid;
  const isAlpha = !!uid && !!config?.alphaUsers?.[uid];

  const season = config ? resolveSeason(config, previewingId) : null;

  // Publish the resolved season to the module-level path helpers DURING RENDER —
  // deliberately not in an effect.
  //
  // db.ts's path helpers throw until this has run, and React flushes CHILD
  // effects before PARENT ones: a descendant (GameStateProvider's
  // subscribeToGame, AuthContext's player checks) would otherwise fire its
  // season-scoped effect before this provider's effect had published the season.
  // A parent's render body always runs before its children render, so this is
  // the only placement that actually holds the guarantee. setCurrentSeason is
  // idempotent, so StrictMode's double-render is harmless.
  if (season) setCurrentSeason(season.id);

  // ── Version gate ───────────────────────────────────────────────────────────
  // The frontend (Netlify), rules, and functions deploy independently, so a
  // stale bundle can linger after a cutover and render the wrong season. Bump
  // config/minClientVersion to force every open client to reload.
  //
  // Caveat: this only protects clients that ALREADY have the gate, so it must
  // ship one release ahead of any cutover that relies on it.
  useEffect(() => {
    if (!config?.minClientVersion) return;
    if (CLIENT_VERSION >= config.minClientVersion) return;
    console.warn(
      `[RPelago] Client v${CLIENT_VERSION} is older than the required ` +
      `v${config.minClientVersion} — reloading.`,
    );
    window.location.reload();
  }, [config?.minClientVersion]);

  const previewSeason = useCallback((seasonId: string | null) => {
    setPreviewingId(seasonId);
  }, []);

  const available = config && (isAdmin || isAlpha) ? selectableSeasons(config) : [];

  return (
    <SeasonContext.Provider value={{
      config, season, loading,
      isAdmin, isAlpha,
      available, previewSeason, previewingId,
    }}>
      {children}
    </SeasonContext.Provider>
  );
}

export function useSeason(): SeasonContextValue {
  const ctx = useContext(SeasonContext);
  if (!ctx) throw new Error('useSeason must be used within SeasonProvider');
  return ctx;
}

/** Convenience: the single most-asked question in the UI. */
export function useIsAdmin(): boolean {
  return useSeason().isAdmin;
}
