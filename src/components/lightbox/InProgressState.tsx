import { ADV_ICONS } from '../../lib/constants';
import { normalizeSlots } from '../../lib/slotHelpers';
import { resolveNameColor } from './lbHelpers';
import { AdvStatusIcons, AdvSlotBlock } from './AdvRow';
import PublicSlotsList from './PublicSlotsList';
import ClaimableSlots from './ClaimableSlots';
import type { Tile, TileAdventurer, AdvClass, AdvSlot, Player, Adventurer, AuthUser } from '../../types';

interface Props {
  tile: Tile;
  coord: string;
  advEntries: TileAdventurer[];
  user: AuthUser | null;
  players: Record<string, Player>;
  alreadySent: boolean;
  freeAdvs: Adventurer[];
  claimingSlotKey: string | null;
  setClaimingSlotKey: (key: string | null) => void;
  onClaimSlot: (slotKey: string, slots: AdvSlot[], advId: string) => Promise<void>;
}

export default function InProgressState({
  tile, coord, advEntries, user, players, alreadySent, freeAdvs,
  claimingSlotKey, setClaimingSlotKey, onClaimSlot,
}: Props) {
  const isBifurcated = tile.traits?.['bifurcated'] !== undefined;

  if (!isBifurcated) {
    return (
      <>
        {tile.link && (
          <div className="lb-archipelago-link">
            <a href={tile.link} target="_blank" rel="noopener noreferrer">🗺 Open Archipelago Game →</a>
          </div>
        )}
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
                <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // Bifurcated path
  const allPubSlots      = normalizeSlots(tile.publicSlots as AdvSlot[] | Record<string, AdvSlot> | undefined);
  const claimableEntries = Object.entries(tile.claimableSlots ?? {}) as [string, AdvSlot[] | Record<string, AdvSlot>][];

  const renderRoom = (roomNum: 1 | 2, label: string, link: string | undefined) => {
    const roomAdvs  = advEntries.filter(e => (e.room ?? 1) === roomNum);
    const roomPub   = allPubSlots.filter(s => (s.room ?? 1) === roomNum);
    const roomClaim = claimableEntries.filter(([, rawVal]) => {
      const arr = normalizeSlots(rawVal as AdvSlot[] | Record<string, AdvSlot>);
      return (arr[0]?.room ?? 1) === roomNum;
    });
    return (
      <div className="lb-bifurcated-room">
        <div className="lb-room-header">{label}</div>
        {link && (
          <div className="lb-archipelago-link">
            <a href={link} target="_blank" rel="noopener noreferrer">🗺 Open Archipelago Game →</a>
          </div>
        )}
        {roomAdvs.length > 0 && (
          <div className="lb-adv-list">
            {roomAdvs.map(entry => (
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
                <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
              </div>
            ))}
          </div>
        )}
        <PublicSlotsList slots={roomPub} />
        <ClaimableSlots
          entries={roomClaim}
          user={user}
          alreadySent={alreadySent}
          freeAdvs={freeAdvs}
          claimingSlotKey={claimingSlotKey}
          setClaimingSlotKey={setClaimingSlotKey}
          onClaimSlot={onClaimSlot}
        />
      </div>
    );
  };

  return (
    <>
      {renderRoom(1, 'Room 1', tile.link || undefined)}
      {renderRoom(2, 'Room 2', tile.link2 || undefined)}
    </>
  );
}
