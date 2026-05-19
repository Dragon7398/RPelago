import {
  createContext, useContext, useState, useEffect, useRef,
  useCallback, type ReactNode,
} from 'react';
import {
  onAuthStateChanged, signInWithCustomToken,
  signOut as fbSignOut, type User,
} from 'firebase/auth';
import type { AuthUser, Adventurer, Player } from '../types';
import { auth as firebaseAuth, firebaseReady } from '../firebase/config';
import { playerExists, upsertPlayer, upsertPlayerDiscordFields, isPlayerDisabled } from '../firebase/db';
import { ADV_CLASSES } from '../lib/constants';
import { randomAdvName } from '../lib/tileGen';

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
  customToken:   string;
  displayName:   string;
  uid:           string;
  discordHandle: string;
  avatarHash:    string | null;
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

async function ensurePlayerRecord(fbUser: User, displayName: string): Promise<void> {
  const exists = await playerExists(fbUser.uid);
  if (exists) return;

  const advId          = `${fbUser.uid}_adv_1`;
  const { firstName, lastName } = randomAdvName();
  const cls            = ADV_CLASSES[Math.floor(Math.random() * ADV_CLASSES.length)];
  const startingAdv: Adventurer = { id: advId, firstName, lastName, cls, busy: false, busyTile: null };

  const player: Player = {
    id:          fbUser.uid,
    displayName,
    xp:          0,
    gold:        0,
    adventurers: { [advId]: startingAdv },
    inventory:   {},
  };
  await upsertPlayer(player);
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:       AuthUser | null;
  loading:    boolean;
  authError:  string | null;
  signIn:     () => void;
  signOut:    () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Prevents the null-user onAuthStateChanged tick from clearing loading
  // while we're still mid-exchange.
  const exchangingRef     = useRef(false);
  const pendingDiscordRef = useRef<{ handle: string; avatarHash: string | null } | null>(null);

  useEffect(() => {
    if (!firebaseReady || !firebaseAuth) {
      setLoading(false);
      return;
    }

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
        .then(({ customToken, discordHandle, avatarHash }) => {
          pendingDiscordRef.current = { handle: discordHandle, avatarHash };
          return signInWithCustomToken(firebaseAuth!, customToken);
        })
        .catch(err => {
          console.error('Discord auth exchange failed:', err);
          exchangingRef.current = false;
          setAuthError('Sign-in failed. Please try again.');
          setLoading(false);
        });
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async fbUser => {
      // Ignore the initial null tick while we're still exchanging the OAuth code
      if (exchangingRef.current && !fbUser) return;
      exchangingRef.current = false;

      if (fbUser) {
        const displayName = fbUser.displayName ?? 'Unknown';
        try {
          await ensurePlayerRecord(fbUser, displayName);
          const disabled = await isPlayerDisabled(fbUser.uid);
          if (disabled) {
            await fbSignOut(firebaseAuth!);
            setAuthError('Your account is currently restricted. Please ask the admin for assistance.');
            setLoading(false);
            return;
          }
          // Persist Discord identity fields on every login so handle/avatar stay current.
          // Only available when the user just exchanged an OAuth code; not on silent re-auth.
          const pending = pendingDiscordRef.current;
          if (pending) {
            pendingDiscordRef.current = null;
            await upsertPlayerDiscordFields(fbUser.uid, pending.handle, pending.avatarHash);
          }
        } catch (err) {
          console.error('Failed to create player record:', err);
        }
        setUser({ id: fbUser.uid, displayName });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
