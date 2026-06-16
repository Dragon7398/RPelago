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
