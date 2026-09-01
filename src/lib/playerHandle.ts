import type { Player } from '../types';

// The one identity the host can actually ACT on.
//
// Admin surfaces exist to *do* something about a player — ping them for a missing
// YAML, tell them their config was denied, chase a stalled slot — and all of that
// happens in Discord. A `displayName` is the name the player picked for the game:
// it isn't unique, it isn't searchable in Discord, and it can't be pasted into a
// message. The handle is both, so admin views name people by handle.
//
// The fallback chain never yields blank: records predating `discordHandle` (and
// log entries whose player has since been removed from the season) drop back to
// the display name, then to whatever name the caller had stored on the row, then
// to the raw uid.
export function playerHandle(
  players: Record<string, Player> | undefined,
  playerId: string,
  fallbackName?: string,
): string {
  const p = players?.[playerId];
  return '@' + (p?.discordHandle ?? p?.displayName ?? fallbackName ?? playerId);
}
