import { useState } from 'react';
import { useGameState } from '../../../contexts/GameStateContext';
import { useToast } from '../../../contexts/ToastContext';
import { useSeason } from '../../../contexts/SeasonContext';
import { SHOP_ITEMS } from '../../../lib/constants';
import { calcLevel, getFeatWarnings, adventurerCountForLevel } from '../../../lib/gameLogic';
import { missionDisplayLabel } from '../../../lib/missionLogic';
import { playerReset, syncPlayerProfile } from '../../../firebase/db';
import type { Player, Tile } from '../../../types';

interface Props {
  player: Player;
  tiles: Record<string, Tile>;
  adminId: string | undefined;
  missions?: Record<string, import('../../../types').GMMission>;
}

export default function PlayerCard({ player, tiles, adminId, missions }: Props) {
  const { adminConsumeItem, adminDisablePlayer, adminEnablePlayer,
          adminAddWarning, adminDeleteWarning, adminClearWarnings,
          adminGrantMissingAdventurers } = useGameState();
  const { addToast } = useToast();
  // The adventurer roster is a map-season concept — a casino-season player having
  // no adventurers isn't a gap to fix, so the grant action is hidden there.
  const isCasino = useSeason().season?.shell === 'casino';
  const [addingWarning, setAddingWarning] = useState(false);
  const [warningDraft, setWarningDraft]   = useState('');
  const [resetting, setResetting]         = useState(false);
  const [granting, setGranting]           = useState(false);
  const [syncing, setSyncing]             = useState(false);

  const ownedItems     = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
  const busyAdvs       = Object.values(player.adventurers ?? {}).filter(a => a.busyTile);
  const isAdmin        = player.id === adminId;
  const activeMission  = player.activeMission && missions ? missions[player.activeMission] : null;
  const activeMLabel   = activeMission ? missionDisplayLabel(activeMission) : null;
  // Casino-season players carry no `xp`/`gold` off the map economy, so treat a
  // missing value as 0 rather than crashing on `.toLocaleString()`.
  const xp                = player.xp ?? 0;
  const gold              = player.gold ?? 0;
  const level             = calcLevel(xp);
  const missingAdventurers = adventurerCountForLevel(level) - Object.keys(player.adventurers ?? {}).length;
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
          LV {level} · ✨ {xp.toLocaleString()} XP · 🪙 {gold.toLocaleString()} G
          · {Object.keys(player.adventurers ?? {}).length} adv
          {(player.xpHistory?.length ?? 0) > 0 && (
            <span className="dash-player-history">
              {' '}· prev: {player.xpHistory!.map(x => x.toLocaleString()).join(', ')} XP
            </span>
          )}
          {player.basicTrainingDone && (
            <span className="dash-mission-badge" style={{ marginLeft: '0.4rem', color: 'oklch(70% 0.12 145)', border: '1px solid oklch(42% 0.10 145)', borderRadius: '2px', padding: '0 0.3rem', fontSize: '0.6rem', fontFamily: "'Cinzel', serif" }}>
              ✓ BASIC TRAINING
            </span>
          )}
        </div>
        {activeMLabel && (
          <div className="dash-player-section-label" style={{ marginTop: '0.2rem', color: 'oklch(from var(--gm-accent) calc(l + 0.04) c h)' }}>
            ⚜ {activeMLabel}
          </div>
        )}
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
        {!isCasino && missingAdventurers > 0 && (
          <button
            className="dash-player-grant-adv"
            disabled={granting}
            onClick={async () => {
              setGranting(true);
              try {
                const granted = await adminGrantMissingAdventurers(player.id);
                if (granted > 0) addToast(`Granted ${granted} adventurer${granted !== 1 ? 's' : ''} to ${player.displayName}.`, 'success');
                else addToast(`${player.displayName} already has all adventurers for their level.`, 'info');
              } catch {
                addToast(`Failed to grant adventurers to ${player.displayName}.`, 'error');
              } finally {
                setGranting(false);
              }
            }}
          >
            {granting ? 'Granting…' : `Grant Adventurer${missingAdventurers !== 1 ? 's' : ''} (${missingAdventurers})`}
          </button>
        )}
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
          className="dash-player-sync"
          disabled={syncing}
          onClick={async () => {
            setSyncing(true);
            try {
              const { tileCount, missionCount, gameCount } = await syncPlayerProfile(player.id);
              addToast(`${player.displayName}: synced ${tileCount} tile${tileCount !== 1 ? 's' : ''}, ${missionCount} mission${missionCount !== 1 ? 's' : ''}, ${gameCount} game${gameCount !== 1 ? 's' : ''}.`, 'success');
            } catch {
              addToast(`Failed to sync profile for ${player.displayName}.`, 'error');
            } finally {
              setSyncing(false);
            }
          }}
        >
          {syncing ? 'Syncing…' : 'Sync Profile'}
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
