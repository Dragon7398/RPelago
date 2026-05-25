import { useState } from 'react';
import { useGameState } from '../../../contexts/GameStateContext';
import { useToast } from '../../../contexts/ToastContext';
import { SHOP_ITEMS } from '../../../lib/constants';
import { calcLevel, getFeatWarnings } from '../../../lib/gameLogic';
import { playerReset } from '../../../firebase/db';
import type { Player, Tile } from '../../../types';

interface Props {
  player: Player;
  tiles: Record<string, Tile>;
  adminId: string | undefined;
}

export default function PlayerCard({ player, tiles, adminId }: Props) {
  const { adminConsumeItem, adminDisablePlayer, adminEnablePlayer,
          adminAddWarning, adminDeleteWarning, adminClearWarnings } = useGameState();
  const { addToast } = useToast();
  const [addingWarning, setAddingWarning] = useState(false);
  const [warningDraft, setWarningDraft]   = useState('');
  const [resetting, setResetting]         = useState(false);

  const ownedItems     = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
  const busyAdvs       = Object.values(player.adventurers ?? {}).filter(a => a.busyTile);
  const isAdmin        = player.id === adminId;
  const level          = calcLevel(player.xp);
  const featWarnings   = getFeatWarnings(player, tiles);
  const playerWarnings = Object.entries(player.warnings ?? {})
    .sort(([, a], [, b]) => b.timestamp - a.timestamp);

  const submitWarning = () => {
    if (!warningDraft.trim()) return;
    adminAddWarning(player.id, warningDraft.trim());
    setAddingWarning(false);
    setWarningDraft('');
  };

  return (
    <div className={`dash-player-card${player.disabled ? ' disabled' : ''}`}>
      <div className="dash-player-header">
        <div className="dash-player-name">
          {player.displayName}
          {featWarnings.length > 0 && (
            <span className="dash-feat-warning" title={featWarnings.join('\n')}>⚠</span>
          )}
          {playerWarnings.length > 0 && (
            <span className="dash-player-warn-badge" title={`${playerWarnings.length} warning${playerWarnings.length !== 1 ? 's' : ''}`}>
              ⚑ {playerWarnings.length}
            </span>
          )}
          {player.disabled && (
            <span className="dash-player-disabled-badge">RESTRICTED</span>
          )}
        </div>
        <div className="dash-player-stats">
          LV {level} · ✨ {player.xp.toLocaleString()} XP · 🪙 {player.gold.toLocaleString()} G
          · {Object.keys(player.adventurers ?? {}).length} adv
          {(player.xpHistory?.length ?? 0) > 0 && (
            <span className="dash-player-history">
              {' '}· prev: {player.xpHistory!.map(x => x.toLocaleString()).join(', ')} XP
            </span>
          )}
        </div>
      </div>

      {busyAdvs.length > 0 && (
        <div className="dash-player-tiles">
          <div className="dash-player-section-label">Active challenges</div>
          {busyAdvs.map(adv => {
            const tile     = tiles[adv.busyTile!];
            const tileName = tile?.name || adv.busyTile!;
            return (
              <div key={adv.id} className="dash-player-tile-row">
                <span className="dash-player-adv-name">{adv.firstName} {adv.lastName}</span>
                <span className="dash-player-tile-name">— {tileName} ({adv.busyTile})</span>
              </div>
            );
          })}
        </div>
      )}

      {ownedItems.length > 0 && (
        <div className="dash-player-inv">
          {ownedItems.map(item => (
            <div key={item.id} className="dash-inv-item">
              <span className="dash-inv-name">{item.name}</span>
              <span className="dash-inv-qty">×{player.inventory![item.id]}</span>
              <button className="dash-inv-use" onClick={() => adminConsumeItem(player.id, item.id)}>
                Mark Used
              </button>
            </div>
          ))}
        </div>
      )}

      {(playerWarnings.length > 0 || addingWarning) && (
        <div className="dash-player-warnings">
          <div className="dash-player-section-label">
            Warnings
            {playerWarnings.length > 1 && (
              <button
                className="dash-warnings-clear"
                onClick={() => {
                  if (confirm(`Clear all warnings for ${player.displayName}?`))
                    adminClearWarnings(player.id);
                }}
              >
                Clear all
              </button>
            )}
          </div>
          {playerWarnings.map(([key, w]) => (
            <div key={key} className="dash-warning-row">
              <span className={`dash-warning-tag${w.auto ? ' auto' : ''}`}>
                {w.auto ? 'AUTO' : 'ADMIN'}
              </span>
              <span className="dash-warning-date">
                {new Date(w.timestamp).toLocaleDateString()}
              </span>
              <span className="dash-warning-msg">{w.message}</span>
              <button
                className="dash-warning-del"
                title="Delete warning"
                onClick={() => adminDeleteWarning(player.id, key)}
              >×</button>
            </div>
          ))}
          {addingWarning && (
            <div className="dash-warning-add-row">
              <input
                className="dash-warning-input"
                value={warningDraft}
                onChange={e => setWarningDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitWarning();
                  else if (e.key === 'Escape') { setAddingWarning(false); setWarningDraft(''); }
                }}
                placeholder="Warning message..."
                autoFocus
              />
              <button
                className="dash-warning-submit"
                disabled={!warningDraft.trim()}
                onClick={submitWarning}
              >Add</button>
              <button
                className="dash-warning-cancel"
                onClick={() => { setAddingWarning(false); setWarningDraft(''); }}
              >Cancel</button>
            </div>
          )}
        </div>
      )}

      <div className="dash-player-actions">
        <button
          className="dash-player-reset"
          disabled={resetting}
          onClick={async () => {
            if (!confirm(`Reset ${player.displayName}'s stats? This archives their XP and cannot be undone.`)) return;
            setResetting(true);
            try {
              await playerReset(player.id);
              addToast(`${player.displayName} has been reset.`, 'success');
            } catch {
              addToast(`Failed to reset ${player.displayName}. Please try again.`, 'error');
            } finally {
              setResetting(false);
            }
          }}
        >
          {resetting ? 'Resetting…' : 'Player Reset'}
        </button>
        <button
          className="dash-warning-add-btn"
          onClick={() => { setAddingWarning(true); setWarningDraft(''); }}
        >
          + Warning
        </button>
        {isAdmin ? (
          <span className="dash-player-admin-badge">ADMIN</span>
        ) : player.disabled ? (
          <button className="dash-player-enable" onClick={() => adminEnablePlayer(player.id)}>
            Re-enable Player
          </button>
        ) : (
          <button
            className="dash-player-disable"
            onClick={() => {
              if (confirm(`Restrict ${player.displayName}? They will be unable to log in.`))
                adminDisablePlayer(player.id);
            }}
          >
            Disable Player
          </button>
        )}
      </div>
    </div>
  );
}
