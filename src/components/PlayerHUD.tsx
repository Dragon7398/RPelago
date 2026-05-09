import { useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { useToast } from '../contexts/ToastContext';
import { calcLevel, pendingFeatSlot } from '../lib/gameLogic';
import { ADV_ICONS } from '../lib/constants';

interface Props {
  onLoginClick: () => void;
  onProfileClick: () => void;
  onTileClick: (coord: string) => void;
  onHelpClick: () => void;
}

export default function PlayerHUD({ onLoginClick, onProfileClick, onTileClick, onHelpClick }: Props) {
  const { user, signOut } = useAuth();
  const { gameState }     = useGameState();
  const { addToast }      = useToast();

  const player = user && gameState ? gameState.players[user.id] : null;
  const level  = player ? calcLevel(player.xp) : 1;
  const adventurers = player ? Object.values(player.adventurers) : [];
  const pending = player ? pendingFeatSlot(level, player.feats ?? {}) : null;

  const prevXpRef = useRef<number | null>(null);
  useEffect(() => {
    if (!player) { prevXpRef.current = null; return; }
    const xp = player.xp;
    if (prevXpRef.current === null) { prevXpRef.current = xp; return; }
    if (xp <= prevXpRef.current) { prevXpRef.current = xp; return; }
    const prevLevel = calcLevel(prevXpRef.current);
    const newLevel  = calcLevel(xp);
    prevXpRef.current = xp;
    if (newLevel <= prevLevel) return;
    for (const threshold of [3, 5, 7] as const) {
      if (prevLevel < threshold && newLevel >= threshold) {
        const slot = `level${threshold}` as 'level3' | 'level5' | 'level7';
        if (!player.feats?.[slot]) {
          addToast(`Level ${threshold} reached! Open your Profile to choose a Feat.`, 'success');
        }
      }
    }
  }, [player?.xp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) {
    return (
      <div className="player-hud">
        <button className="hud-login-btn" onClick={onLoginClick}>⚔ ENTER RPelago</button>
        <button className="hud-help-btn" onClick={onHelpClick} title="How to play">?</button>
      </div>
    );
  }

  return (
    <div className="player-hud">
      <span className="hud-name" onClick={onProfileClick} title={pending ? 'View your profile — feat available!' : 'View your profile'}>
        <span>⚔ {user.displayName.toUpperCase()}</span>
        <span className="hud-level-badge">LV {level}</span>
        {pending && <span className="hud-feat-notify">!</span>}
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
      <button className="hud-help-btn" onClick={onHelpClick} title="How to play">?</button>
      <button className="hud-logout-btn" onClick={signOut}>LEAVE</button>
    </div>
  );
}
