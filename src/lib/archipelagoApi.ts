import type { SlotStatus } from '../types';

// When a player aliases a slot in AP, the cheese name field becomes
// "alias text (RealSlotName)" — extract the parenthetical as the real key.
export function extractApSlotName(name: string): string {
  const m = name.match(/\(([^)]+)\)$/);
  return m ? m[1].trim() : name;
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

