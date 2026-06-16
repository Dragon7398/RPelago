import type { GameState, AdvSlot, TileTypeKey, GMMissionType, AdvClass } from '../../types';
import { TILE_TRAITS } from '../../lib/constants';
import { typeKeyForCoord } from '../../lib/tileGen';

export interface AgendaSlot {
  name: string;
  game: string;
  status: string;
  hasGame: boolean;
}

export interface AgendaTile {
  coord: string;
  name: string;
  typeKey: TileTypeKey;
  link: string;
  roomLabel: string | null;
  traits: string[];
  slots: AgendaSlot[];
  freedEarly: boolean;
}

export interface AgendaAdv {
  id: string;
  name: string;
  cls: AdvClass;
  tiles: AgendaTile[];
}

export interface AgendaMissionData {
  id: string;
  label: string;
  type: GMMissionType;
  typeLabel: string;
  reward: string;
  link: string;
  slots: AgendaSlot[];
  xp: number;
  gp: number;
  variableReward: boolean;
  pot: number | null;
  roster: string;
}

export interface AgendaData {
  mission: AgendaMissionData | null;
  advGroups: AgendaAdv[];
  activeCount: number;
}

const OBLIGATION_STATUSES = new Set<string>(['100%', 'Goaled']);

function slotsToAgenda(slots: AdvSlot[] | undefined): AgendaSlot[] {
  if (!slots || slots.length === 0) return [];
  return slots.map(s => ({
    name: s.name,
    game: s.game ?? '',
    status: s.status ?? 'Unstarted',
    hasGame: !!(s.game && s.game.trim()),
  }));
}

function hasObligations(slots: AdvSlot[] | undefined): boolean {
  if (!slots) return false;
  return slots.some(s => OBLIGATION_STATUSES.has(s.status ?? ''));
}

function buildTile(
  coord: string,
  tileAdv: { slots?: AdvSlot[]; room?: 1 | 2 },
  tileName: string,
  tileLink: string,
  tileLink2: string | undefined,
  tileTraits: Record<string, { value: number }> | undefined,
  freedEarly: boolean,
): AgendaTile {
  const room = tileAdv.room ?? null;
  const typeKey = typeKeyForCoord(coord);

  // room-specific link for bifurcated tiles
  const link = (room === 2 && tileLink2) ? tileLink2 : tileLink;
  const roomLabel = room === 1 ? 'ROOM 1' : room === 2 ? 'ROOM 2' : null;

  const traitNames = tileTraits
    ? Object.keys(tileTraits).map(id => {
        const def = TILE_TRAITS.find(t => t.id === id);
        return def?.name ?? id;
      })
    : [];

  return {
    coord,
    name: tileName,
    typeKey,
    link,
    roomLabel,
    traits: traitNames,
    slots: slotsToAgenda(tileAdv.slots),
    freedEarly,
  };
}

export function deriveAgendaData(gameState: GameState, userId: string): AgendaData {
  const player = gameState.players?.[userId];
  if (!player) return { mission: null, advGroups: [], activeCount: 0 };

  // ── Mission ───────────────────────────────────────────────────────────────
  let mission: AgendaMissionData | null = null;
  if (player.activeMission) {
    const m = gameState.missions?.[player.activeMission];
    if (m && m.state !== 'complete') {
      const participant = m.participants?.[userId];
      const typeLabelMap: Record<GMMissionType, string> = {
        basic: 'BASIC', patrol: 'PATROL', casino: 'CASINO',
      };
      const reward = m.variableReward
        ? 'Reward: 50+ XP / ? GP · variable payout'
        : `Reward: ${m.xp} XP / ${m.gp} GP`;
      const participantCount = Object.keys(m.participants ?? {}).length;
      mission = {
        id: m.id,
        label: m.label,
        type: m.type,
        typeLabel: typeLabelMap[m.type],
        reward,
        link: m.link ?? '',
        slots: slotsToAgenda(participant?.slots),
        xp: m.xp,
        gp: m.gp,
        variableReward: !!m.variableReward,
        pot: m.pot ?? null,
        roster: `${participantCount} participant${participantCount !== 1 ? 's' : ''}`,
      };
    }
  }

  // ── Adventurers ───────────────────────────────────────────────────────────
  const advGroups: AgendaAdv[] = [];

  for (const [advId, adv] of Object.entries(player.adventurers ?? {})) {
    const tiles: AgendaTile[] = [];

    // 1. Current busy tile
    if (adv.busyTile) {
      const tile = gameState.tiles?.[adv.busyTile];
      const tileAdv = tile?.adventurers?.[advId];
      if (tile && tileAdv) {
        tiles.push(buildTile(
          adv.busyTile,
          tileAdv,
          tile.name,
          tile.link,
          tile.link2,
          tile.traits,
          false,
        ));
      }
    }

    // 2. Freed-early tiles with obligations
    for (const [coord, tile] of Object.entries(gameState.tiles ?? {})) {
      if (coord === adv.busyTile) continue;
      if (tile.state !== 'inprogress') continue;
      const tileAdv = tile.adventurers?.[advId];
      if (!tileAdv) continue;
      if (!hasObligations(tileAdv.slots)) continue;
      tiles.push(buildTile(
        coord,
        tileAdv,
        tile.name,
        tile.link,
        tile.link2,
        tile.traits,
        true,
      ));
    }

    if (tiles.length === 0) continue;

    advGroups.push({
      id: advId,
      name: `${adv.firstName} ${adv.lastName}`,
      cls: adv.cls,
      tiles,
    });
  }

  const tileTotal = advGroups.reduce((n, g) => n + g.tiles.length, 0);
  const activeCount = (mission ? 1 : 0) + tileTotal;

  return { mission, advGroups, activeCount };
}
