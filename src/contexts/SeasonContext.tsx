import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { onValue, ref } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { firebaseReady, db as firebaseDb, auth as firebaseAuth } from '../firebase/config';
import { setCurrentSeason, resolveSeason, selectableSeasons } from '../firebase/season';
import { CLIENT_VERSION } from '../lib/version';
import type { SeasonConfig, ResolvedSeason, SeasonStatus } from '../types';

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

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [config, setConfig]       = useState<SeasonConfig | null>(null);
  // Nothing to wait for when Firebase isn't configured — start settled rather
  // than setting state from inside the effect body.
  const [loading, setLoading]     = useState(firebaseReady && !!firebaseDb);
  const [uid, setUid]             = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Track the signed-in uid so admin/alpha can be derived.
  useEffect(() => {
    if (!firebaseReady || !firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, u => setUid(u?.uid ?? null));
  }, []);

  // Subscribe to global config. Note draftSeasons/alphaUsers simply come back
  // absent for normal players — the rules deny them, so a player cannot even
  // discover that an unlaunched season exists.
  useEffect(() => {
    if (!firebaseReady || !firebaseDb) return;
    return onValue(ref(firebaseDb, 'config'), snap => {
      setConfig(snap.exists() ? (snap.val() as SeasonConfig) : null);
      setLoading(false);
    });
  }, []);

  const isAdmin = !!uid && !!config && config.adminId === uid;
  const isAlpha = !!uid && !!config?.alphaUsers?.[uid];

  const season = config ? resolveSeason(config, previewingId) : null;

  // Publish the resolved season to the module-level path helpers BEFORE any
  // subscription or write happens. db.ts throws if this hasn't run.
  useEffect(() => {
    if (season) setCurrentSeason(season.id);
  }, [season?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
