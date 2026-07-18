import { createContext, useContext } from 'react';
import type { SeasonConfig, ResolvedSeason, SeasonStatus } from '../types';

// The Provider component lives in ./SeasonProvider so this file exports only the
// hooks and context object (react-refresh can't hot-swap a module that mixes a
// component with hooks, and the hooks are imported all over the app).

export interface SeasonContextValue {
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

export const SeasonContext = createContext<SeasonContextValue | null>(null);

export function useSeason(): SeasonContextValue {
  const ctx = useContext(SeasonContext);
  if (!ctx) throw new Error('useSeason must be used within SeasonProvider');
  return ctx;
}

/** Convenience: the single most-asked question in the UI. */
export function useIsAdmin(): boolean {
  return useSeason().isAdmin;
}
