import {
  useState, useEffect, useRef, useCallback, type ReactNode,
} from 'react';
import {
  onAuthStateChanged, signInWithCustomToken,
  signOut as fbSignOut,
} from 'firebase/auth';
import type { AuthUser } from '../types';
import { auth as firebaseAuth, firebaseReady } from '../firebase/config';
import { playerExists, isPlayerDisabled } from '../firebase/db';
import { whenSeasonReady } from '../firebase/season';
import { AuthContext } from './AuthContext';

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;
const REDIRECT_PATH     = '/auth/callback';
const OAUTH_STATE_KEY   = 'discord_oauth_state';

function getRedirectUri(): string {
  return `${window.location.origin}${REDIRECT_PATH}`;
}

function generateState(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

function buildDiscordAuthUrl(): string {
  const state = generateState();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  getRedirectUri(),
    response_type: 'code',
    scope:         'identify',
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

interface ExchangeResult {
  customToken: string;
}

async function exchangeCodeForToken(code: string): Promise<ExchangeResult> {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
  const url       = `https://us-central1-${projectId}.cloudfunctions.net/exchangeDiscordCode`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code, redirectUri: getRedirectUri() }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as { error?: string }).error ?? 'Exchange failed');
  }

  return res.json() as Promise<ExchangeResult>;
}

// Passive guard — the exchangeDiscordCode Cloud Function creates the record
// server-side before returning the custom token. This just warns if something
// went wrong with that step (e.g. a Cloud Function deployment issue).
async function ensurePlayerRecord(uid: string): Promise<void> {
  const exists = await playerExists(uid);
  if (!exists) {
    console.warn(`[RPelago] Player record missing for ${uid} — check exchangeDiscordCode logs.`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  // Start "loading" only if there's actually a Firebase auth session to resolve;
  // with no Firebase configured nothing will ever load, so we're settled at once.
  // (Lazy init instead of a setState in the effect's not-ready guard below.)
  const [loading,   setLoading]   = useState(() => firebaseReady && !!firebaseAuth);
  const [authError, setAuthError] = useState<string | null>(null);

  // Prevents the null-user onAuthStateChanged tick from clearing loading
  // while we're still mid-exchange.
  const exchangingRef = useRef(false);

  useEffect(() => {
    if (!firebaseReady || !firebaseAuth) return;

    // Check for Discord OAuth callback (?code=&state=)
    const params      = new URLSearchParams(window.location.search);
    const code        = params.get('code');
    const returnedState = params.get('state');
    const storedState = sessionStorage.getItem(OAUTH_STATE_KEY);

    if (code && returnedState && returnedState === storedState) {
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      // Clear the code from the URL immediately so a refresh doesn't re-attempt
      window.history.replaceState({}, '', window.location.pathname);
      exchangingRef.current = true;

      exchangeCodeForToken(code)
        .then(({ customToken }) => signInWithCustomToken(firebaseAuth!, customToken))
        .catch(err => {
          console.error('Discord auth exchange failed:', err);
          exchangingRef.current = false;
          setAuthError('Sign-in failed. Please try again.');
          setLoading(false);
        });
    }

    // Resolve identity only. The player-record checks below are season-scoped
    // and must NOT run here: Firebase restores the session long before
    // SeasonContext publishes the active season, so reading them here would
    // throw (and, being caught, would silently skip the disabled check).
    const unsubscribe = onAuthStateChanged(firebaseAuth, fbUser => {
      // Ignore the initial null tick while we're still exchanging the OAuth code
      if (exchangingRef.current && !fbUser) return;
      exchangingRef.current = false;

      setUser(fbUser ? { id: fbUser.uid, displayName: fbUser.displayName ?? 'Unknown' } : null);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Post-sign-in checks against `seasons/{id}/players/{uid}` — deferred until
  // SeasonContext has published the season. Kept out of the auth callback so
  // sign-in is never blocked on config loading.
  //
  // On a season-less route (e.g. #keep/, which mounts no SeasonProvider) this
  // simply never resolves and the checks are skipped — KMK is season-independent
  // and doesn't need the season player record.
  useEffect(() => {
    if (!user || !firebaseReady || !firebaseAuth) return;
    let cancelled = false;

    void (async () => {
      try {
        await whenSeasonReady();
        if (cancelled) return;

        await ensurePlayerRecord(user.id);
        if (cancelled) return;

        if (await isPlayerDisabled(user.id)) {
          // Set the message before signing out — signOut re-fires the auth
          // callback, which cancels this effect before a later setState.
          setAuthError('Your account is currently restricted. Please ask the admin for assistance.');
          await fbSignOut(firebaseAuth!);
        }
      } catch (err) {
        console.error('Auth setup failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  const signIn = useCallback(() => {
    if (!DISCORD_CLIENT_ID) {
      setAuthError('VITE_DISCORD_CLIENT_ID is not configured.');
      return;
    }
    window.location.href = buildDiscordAuthUrl();
  }, []);

  const signOut = useCallback(async () => {
    if (firebaseAuth) await fbSignOut(firebaseAuth);
    setUser(null);
  }, []);

  const clearError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, authError, signIn, signOut, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}
