"use strict";
// Key encoding for the `profiles/` tree.
//
// Kept in its own pure module (like casinoEngine.ts) so the rules below can be
// pinned by unit tests without dragging in firebase-functions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeGameName = normalizeGameName;
exports.gameKey = gameKey;
exports.handleKey = handleKey;
exports.apSlotKey = apSlotKey;
/** Trim + collapse internal whitespace. The stored, human-readable form. */
function normalizeGameName(name) {
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
function gameKey(name) {
    return encodeURIComponent(normalizeGameName(name)).replace(/\./g, '%2E');
}
/** Firebase-safe form of a Discord handle for `profiles/handleIndex`. */
function handleKey(handle) {
    return handle.replace(/\./g, '_');
}
/**
 * Key for one Archipelago slot name under `roomTelemetry/…/{ts}/{key}`.
 *
 * Same escape as `gameKey` and for the same reason — a slot named "Dr. Mario"
 * would otherwise throw the tick's whole multi-path `update()`, taking every
 * other room's sample with it. Slot names are lifted verbatim from the tracker,
 * so they are exactly as arbitrary as game names.
 *
 * Unlike `gameKey` this does NOT normalize whitespace: the name must round-trip
 * to the same key from the client, which holds `slot.name` as stored. And it is
 * never decoded — the client re-encodes the name it already has to look a series
 * up — so only the forward direction has to agree.
 *
 * ⚠️ MIRRORED in `apSlotKey` in src/lib/slotHelpers.ts. A change to one is a
 * change to both, or the client silently stops finding any slot's history.
 */
function apSlotKey(name) {
    return encodeURIComponent(name).replace(/\./g, '%2E');
}
//# sourceMappingURL=profileKeys.js.map