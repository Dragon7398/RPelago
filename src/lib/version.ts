/**
 * Build version for the client version gate.
 *
 * Bump this whenever a deploy must force stale bundles to reload (notably the
 * season cutover), then set `config/minClientVersion` in Firebase to the same
 * value. Any open client running an older build reloads itself.
 *
 * See SeasonContext → "Version gate".
 */
export const CLIENT_VERSION = 1;
