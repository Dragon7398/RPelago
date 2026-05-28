import { ADV_ICONS } from '../../lib/constants';
import { resolveNameColor } from './lbHelpers';
import { AdvStatusIcons, AdvFeatIcons, AdvSlotBlock } from './AdvRow';
import type { Tile, TileAdventurer, AdvClass, Player, Adventurer, AuthUser } from '../../types';

interface Props {
  tile: Tile;
  coord: string;
  advEntries: TileAdventurer[];
  user: AuthUser | null;
  players: Record<string, Player>;
  alreadySent: boolean;
  freeAdvs: Adventurer[];
  onSendAdventurer: (advId: string) => Promise<void>;
  onRecall: (advId: string) => Promise<void>;
  onLoginRequest: () => void;
  onClose: () => void;
}

export default function AvailableState({
  tile, coord, advEntries, user, players, alreadySent, freeAdvs,
  onSendAdventurer, onRecall, onLoginRequest, onClose,
}: Props) {
  return (
    <>
      <div className="lb-progress-wrap">
        <div className="lb-progress-label">ADVENTURERS: {advEntries.length} / {tile.required}</div>
        <div className="lb-progress-bar-bg">
          <div
            className={`lb-progress-bar-fill${advEntries.length >= tile.required ? ' full' : ''}`}
            style={{ width: `${tile.required > 0 ? Math.round((advEntries.length / tile.required) * 100) : 100}%` }}
          />
        </div>
      </div>
      {advEntries.length > 0 && (
        <>
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
                  <AdvFeatIcons playerId={entry.owner} players={players} />
                  <AdvStatusIcons advId={entry.advId} tile={tile} inventory={players[entry.owner]?.inventory ?? {}} />
                  <span className="lb-adv-secondary">
                    <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                    <span className="lb-adv-name">{entry.name}</span>
                    <span className="lb-adv-class">{entry.cls}</span>
                  </span>
                  {user && entry.owner === user.id && (
                    <button className="lb-recall-btn" onClick={() => onRecall(entry.advId)}>RECALL</button>
                  )}
                </div>
                <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
              </div>
            ))}
          </div>
          <div className="lb-divider" />
        </>
      )}
      {!user ? (
        <div className="lb-login-prompt">
          Log in to send an Adventurer to this challenge.{' '}
          <a onClick={() => { onClose(); onLoginRequest(); }}>Enter RPelago →</a>
        </div>
      ) : alreadySent ? (
        <div className="lb-no-adv">Your Adventurer is already assigned here. Recall them above if you change your mind.</div>
      ) : (
        <div className="lb-send-section">
          <div className="lb-send-label">SEND AN ADVENTURER</div>
          {freeAdvs.length === 0 ? (
            <div className="lb-no-adv">All your Adventurers are currently on missions.</div>
          ) : (
            <div className="lb-adv-picker">
              {freeAdvs.map(adv => (
                <button key={adv.id} className="lb-adv-pick-btn" onClick={() => onSendAdventurer(adv.id)}>
                  <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
                  <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
                  <span className="btn-adv-class">{adv.cls}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
