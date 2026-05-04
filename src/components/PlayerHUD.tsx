import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { calcLevel } from '../lib/gameLogic';
import { ADV_ICONS } from '../lib/constants';

interface Props {
  onLoginClick: () => void;
  onProfileClick: () => void;
  onTileClick: (coord: string) => void;
}

export default function PlayerHUD({ onLoginClick, onProfileClick, onTileClick }: Props) {
  const { user, signOut } = useAuth();
  const { gameState }     = useGameState();

  const player = user && gameState ? gameState.players[user.id] : null;
  const level  = player ? calcLevel(player.xp) : 1;
  const adventurers = player ? Object.values(player.adventurers) : [];

  if (!user) {
    return (
      <div className="player-hud">
        <button className="hud-login-btn" onClick={onLoginClick}>⚔ ENTER RPelago</button>
      </div>
    );
  }

  return (
    <div className="player-hud">
      <span className="hud-name" onClick={onProfileClick} title="View your profile">
        <span>⚔ {user.displayName.toUpperCase()}</span>
        <span className="hud-level-badge">LV {level}</span>
      </span>
      <div className="hud-divider" />
      <div className="hud-adventurers">
        <span className="hud-adv-label">ADVENTURERS</span>
        <div className="hud-adv-chips">
          {adventurers.map(adv => (
            <div
              key={adv.id}
              className={`adv-chip ${adv.busy ? 'busy' : 'available'}${adv.busy && adv.busyTile ? ' clickable' : ''}`}
              title={`${adv.firstName} ${adv.lastName} — ${adv.cls}${adv.busy && adv.busyTile ? ` | On mission at ${adv.busyTile}` : ''}`}
              onClick={adv.busy && adv.busyTile ? () => onTileClick(adv.busyTile!) : undefined}
            >
              {ADV_ICONS[adv.cls]} {adv.firstName}{adv.busy && adv.busyTile ? ` (${adv.busyTile})` : ''}
            </div>
          ))}
        </div>
      </div>
      <div className="hud-divider" />
      <button className="hud-logout-btn" onClick={signOut}>LEAVE</button>
    </div>
  );
}
