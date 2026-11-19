// Return-to-hash for the Discord OAuth round trip.
//
// Discord redirects only to the exact registered URI (`/auth/callback`), and a
// redirect_uri may not carry a fragment — so the `#keep/{listId}` a player
// signed in from is lost on the way back, and they land on the main app.
// `App()` picks its route from the hash ONCE, at first render, so the hash has
// to be back in the URL before React mounts: `restoreOAuthReturnHash()` is
// called from `main.tsx` ahead of `createRoot`, not from an effect.
//
// Kept out of AuthProvider.tsx so that file still exports only a component.

const RETURN_HASH_KEY = 'discord_oauth_return_hash';

/** Remember where sign-in started. Called just before leaving for Discord. */
export function saveOAuthReturnHash(): void {
  try {
    const hash = window.location.hash;
    if (hash && hash !== '#') sessionStorage.setItem(RETURN_HASH_KEY, hash);
    else sessionStorage.removeItem(RETURN_HASH_KEY);
  } catch { /* storage blocked — the player just lands on the main app */ }
}

/**
 * On the OAuth callback, put the saved hash back into the URL. Keys off
 * `state` rather than `code` so a CANCELLED sign-in (`?error=…&state=…`) also
 * returns the player to where they were. The query string is left intact —
 * AuthProvider still needs `code` / `state` to finish the exchange, and strips
 * them itself afterwards. The path is reset to `/` so the Keep's URL ends up
 * in its canonical, shareable `/#keep/{listId}` form.
 */
export function restoreOAuthReturnHash(): void {
  try {
    const hash = sessionStorage.getItem(RETURN_HASH_KEY);
    if (!hash) return;
    if (!new URLSearchParams(window.location.search).has('state')) return;
    sessionStorage.removeItem(RETURN_HASH_KEY);
    window.history.replaceState(null, '', `/${window.location.search}${hash}`);
  } catch { /* storage blocked — nothing was saved to restore */ }
}
