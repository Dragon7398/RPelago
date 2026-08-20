import type { SlotStatus } from '../types';

// When a player aliases a slot in AP, the cheese name field becomes
// "alias text (RealSlotName)" — extract the parenthetical as the real key.
export function extractApSlotName(name: string): string {
  const m = name.match(/\(([^)]+)\)$/);
  return m ? m[1].trim() : name;
}

// Players may end a slot name with `{NUMBER}` so the room still generates when two
// people pick the same name: Archipelago expands the token to nothing for the first
// such slot and to a digit for each one after it ("jam_minit", then "jam_minit2").
// The name we store keeps the token, so it never matches what the room reports.
const NUMBER_TOKEN_RE = /\{NUMBER\}$/i;

export function hasNumberToken(name: string): boolean {
  return NUMBER_TOKEN_RE.test(name);
}

// Resolve a `{NUMBER}` slot name against the names the room actually generated.
// Only an UNAMBIGUOUS token resolves — exactly one room name matching the base
// (bare, or with the digits AP appended). Zero matches and 2+ matches both return
// null and stay for the admin to map by hand, which is the whole point: with two
// real `jam_minit` slots there is no way to tell whose is whose from the name.
// A name without the token returns null too (nothing to resolve).
export function resolveNumberedSlotName(name: string, apNames: Iterable<string>): string | null {
  if (!hasNumberToken(name)) return null;
  const base = name.replace(NUMBER_TOKEN_RE, '');
  if (!base) return null;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d*$`);
  const matches = Array.from(new Set(apNames)).filter(n => re.test(n));
  return matches.length === 1 ? matches[0] : null;
}

// Cheesetracker timestamps (last_checked / last_activity) arrive as ISO strings,
// or are absent. Normalize to ms epoch, or null when missing/unparseable.
export function parseCheeseTs(v?: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Derive a slot's status from a Cheesetracker game row, or null to leave the slot
// unchanged (i.e. Unstarted). In-Progress is gated on `last_activity` (the STRONG
// server-verified signal that the player is actually playing) being present, NOT on
// checks_done: `collect` mechanics can inflate a player's check count without them
// ever launching the game, so checks alone don't prove they've played. `last_checked`
// is only a weak manual self-report and does not qualify a slot as In-Progress.
// Done/Goaled/100% still take priority — those are terminal regardless.
export function deriveSlotStatus(g: {
  tracker_status: string; checks_done: number; checks_total: number; last_activity?: string | null;
}): SlotStatus | null {
  const isGoal = g.tracker_status === 'goal_completed';
  const is100  = g.checks_total > 0 && g.checks_done === g.checks_total;
  if (isGoal && is100)             return 'Done';
  if (isGoal)                      return 'Goaled';
  if (is100)                       return '100%';
  if (parseCheeseTs(g.last_activity) != null) return 'In-Progress';
  return null;
}

export interface ArchipelagoRoomStatus {
  players: [string, string][];
  tracker: string;
}

export function extractRoomId(link: string): string | null {
  const m = link.match(/archipelago\.gg\/room\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function fetchRoomStatus(link: string): Promise<ArchipelagoRoomStatus> {
  const roomId = extractRoomId(link);
  if (!roomId) throw new Error('Invalid Archipelago room link');
  const res = await fetch(`https://archipelago.gg/api/room_status/${roomId}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return { players: data.players ?? [], tracker: data.tracker ?? '' };
}

