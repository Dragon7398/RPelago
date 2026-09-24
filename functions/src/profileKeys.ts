// Key encoding for the `profiles/` tree.
//
// Kept in its own pure module (like casinoEngine.ts) so the rules below can be
// pinned by unit tests without dragging in firebase-functions.

/** Trim + collapse internal whitespace. The stored, human-readable form. */
export function normalizeGameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Key for `profiles/players/{uid}/events/{eventId}/games/{key}`.
 *
 * RTDB forbids `.` `#` `$` `[` `]` `/` and control characters in a key.
 * `encodeURIComponent` escapes all of those EXCEPT `.`, which sits in its
 * unreserved set — so a game named "Plants vs. Zombies" produced an invalid
 * key, and because these keys are merge paths in one multi-path `update()`,
 * the Firebase SDK threw before writing ANYTHING. A single dotted game name
 * therefore silently dropped every participant's counters for that whole
 * table (30 casino completions were lost this way in casino_s1).
 *
 * The extra replace closes that one gap. `%2E` round-trips through
 * `decodeURIComponent`, so the profile site needs no change, and no existing
 * key can contain a dot (such a write could never have landed), so this
 * introduces no duplicates.
 */
export function gameKey(name: string): string {
  return encodeURIComponent(normalizeGameName(name)).replace(/\./g, '%2E');
}

/** Firebase-safe form of a Discord handle for `profiles/handleIndex`. */
export function handleKey(handle: string): string {
  return handle.replace(/\./g, '_');
}
