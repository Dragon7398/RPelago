import { ADV_ICONS } from '../../lib/constants';
import { resolveNameColor } from './lbHelpers';
import { AdvStatusIcons, AdvSlotBlock } from './AdvRow';
import type { Tile, TileAdventurer, AdvClass, Player } from '../../types';

interface Props {
  tile: Tile;
  coord: string;
  advEntries: TileAdventurer[];
  players: Record<string, Player>;
}

export default function CompleteState({ tile, coord, advEntries, players }: Props) {
  return (
    <>
      <div className="lb-complete-banner">✦ CHALLENGE CLEARED ✦</div>
      {advEntries.length > 0 && (
        <div className="lb-adv-list">
          {advEntries.map(entry => (
            <div key={entry.advId} className="lb-adv-entry">
              <div className="lb-adv-row">
                <span className="lb-adv-owner" style={{ color: resolveNameColor(players[entry.owner]?.nameColor) }}>
                  {entry.ownerName}
                  {players[entry.owner]?.discordHandle && (
                    <span className="lb-adv-discord">@{players[entry.owner].discordHandle}</span>
                  )}
                </span>
                <AdvStatusIcons advId={entry.advId} tile={tile} inventory={players[entry.owner]?.inventory ?? {}} />
                <span className="lb-adv-secondary">
                  <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                  <span className="lb-adv-name">{entry.name}</span>
                  <span className="lb-adv-class">{entry.cls}</span>
                </span>
              </div>
              <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={false} showPrompt={false} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
