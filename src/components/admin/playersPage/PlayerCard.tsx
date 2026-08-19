import { useState } from 'react';
import { useGameState } from '../../../contexts/GameStateContext';
import { useToast } from '../../../contexts/ToastContext';
import { useSeason } from '../../../contexts/SeasonContext';
import { SHOP_ITEMS } from '../../../lib/constants';
import { calcLevel, getFeatWarnings, adventurerCountForLevel } from '../../../lib/gameLogic';
import { missionDisplayLabel } from '../../../lib/missionLogic';
import { playerReset, syncPlayerProfile, banDiscordId } from '../../../firebase/db';
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
          adminGrantGold, adminGrantMissingAdventurers } = useGameState();
  const { addToast } = useToast();
  // The adventurer roster is a map-season concept — a casino-season player having
  // no adventurers isn't a gap to fix, so the grant action is hidden there.
  const isCasino = useSeason().season?.shell === 'casino';
  const [addingWarning, setAddingWarning] = useState(false);
  const [warningDraft, setWarningDraft]   = useState('');
  const [adjustingGold, setAdjustingGold] = useState(false);
  const [goldDraft, setGoldDraft]         = useState('');
  const [goldReason, setGoldReason]       = useState('');
  const [resetting, setResetting]         = useState(false);
  const [granting, setGranting]           = useState(false);
  const [goldBusy, setGoldBusy]           = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [banning, setBanning]             = useState(false);

  const ownedItems     = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
  const busyAdvs       = Object.values(player.adventurers ?? {}).filter(a => a.busyTile);
  const isAdmin        = player.id === adminId;
  // Every table the player is currently on (forming + in-progress), by participant
  // membership — NOT just `activeMissions`, so finished-but-settling tables (claim
  // auto-freed, still a participant) show too. `held` marks the ones still holding
  // a claim; freed tables are tagged "settling". Held first, mirroring the shell.
  const onTables = missions
    ? Object.values(missions)
        .filter(m => (m.state === 'forming' || m.state === 'inprogress') && !!m.participants?.[player.id])
        .map(m => ({ id: m.id, label: missionDisplayLabel(m), held: !!player.activeMissions?.[m.id] }))
        .sort((a, b) => Number(b.held) - Number(a.held) || a.label.localeCompare(b.label))
    : [];
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

  // Manual gold adjustment. A negative amount is a clawback; `adminGrantGold`
  // clamps it so the balance can't go below zero, and the preview clamps the same
  // way so the admin sees the figure that will actually land.
  const rawGold   = Math.trunc(Number(goldDraft));
  const goldValid = goldDraft.trim() !== '' && Number.isFinite(rawGold) && rawGold !== 0;
  const goldDelta = goldValid ? (rawGold < 0 ? Math.max(rawGold, -gold) : rawGold) : 0;
  const signed    = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString()}g`;

  const closeGold = () => { setAdjustingGold(false); setGoldDraft(''); setGoldReason(''); };

  const submitGold = async () => {
    if (!goldValid || goldBusy) return;
    setGoldBusy(true);
    try {
      const balance = await adminGrantGold(player.id, goldDelta, goldReason.trim() || undefined);
      addToast(`${player.displayName}: ${signed(goldDelta)} → ${balance.toLocaleString()}g.`, 'success');
      closeGold();
    } catch (err) {
      addToast((err as { message?: string }).message
        ?? `Failed to adjust gold for ${player.displayName}.`, 'error');
    } finally {
      setGoldBusy(false);
    }
  };

  return (
    <div className={`dash-player-card${player.disabled ? ' disabled' : ''}`}>
      <div className="dash-player-header">
        <div className="dash-player-name">
          {player.displayName}
          {player.discordHandle && (
            <span className="dash-player-handle">@{player.discordHandle}</span>
          )}
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
        {onTables.map(t => (
          <div key={t.id} className="dash-player-section-label" style={{ marginTop: '0.2rem', color: 'oklch(from var(--gm-accent) calc(l + 0.04) c h)' }}>
            ⚜ {t.label}
            {!t.held && <span style={{ opacity: 0.6, fontWeight: 'normal' }}> · settling</span>}
          </div>
        ))}
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

      {adjustingGold && (
        <div className="dash-grant-panel">
          <div className="dash-player-section-label">Adjust gold</div>
          <div className="dash-grant-row">
            <input
              className="dash-grant-amt"
              type="number"
              step="1"
              value={goldDraft}
              onChange={e => setGoldDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitGold();
                else if (e.key === 'Escape') closeGold();
              }}
              placeholder="500"
              aria-label={`Gold adjustment for ${player.displayName}`}
              autoFocus
            />
            <input
              className="dash-grant-reason"
              value={goldReason}
              onChange={e => setGoldReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitGold();
                else if (e.key === 'Escape') closeGold();
              }}
              placeholder="Reason (optional — shown in the money-in audit)…"
              aria-label="Reason for the adjustment"
            />
            <button
              className="dash-grant-submit"
              disabled={!goldValid || goldBusy}
              onClick={submitGold}
            >{goldBusy ? 'Applying…' : 'Apply'}</button>
            <button className="dash-grant-cancel" onClick={closeGold}>Cancel</button>
          </div>
          <div className="dash-grant-preview">
            {goldValid ? (
              <>
                🪙 {gold.toLocaleString()}g <span className="dash-grant-arrow">→</span>{' '}
                <b className={goldDelta < 0 ? 'down' : 'up'}>{(gold + goldDelta).toLocaleString()}g</b>
                <span className="dash-grant-delta">({signed(goldDelta)})</span>
                {/* A clawback bigger than the balance is clamped, not rejected. */}
                {goldDelta !== rawGold && (
                  <span className="dash-grant-clamp">clamped — can't go below 0</span>
                )}
              </>
            ) : (
              <span className="dash-grant-hint">
                Negative takes gold away. Logged either way to the season money-in audit.
              </span>
            )}
          </div>
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
          className="dash-grant-btn"
          onClick={() => {
            if (adjustingGold) closeGold();
            else { setAdjustingGold(true); setGoldDraft(''); setGoldReason(''); }
          }}
        >
          🪙 Adjust Gold
        </button>
        <button
          className="dash-warning-add-btn"
          onClick={() => { setAddingWarning(true); setWarningDraft(''); }}
        >
          + Warning
        </button>
        {isAdmin ? (
          <span className="dash-player-admin-badge">ADMIN</span>
        ) : (
          <>
            {player.disabled ? (
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
            {/* Ban is the harder version of Disable: it also writes the pre-emptive
                ban entry, so deleting their season record (or a new season starting)
                can't quietly let them back in. Lifting it is the Players page's
                Banned Discord Accounts panel, not this button. */}
            <button
              className="dash-player-ban"
              disabled={banning}
              onClick={async () => {
                if (!confirm(
                  `Ban ${player.displayName} outright?\n\n`
                  + `They will be blocked at sign-in across all seasons, and cannot rejoin `
                  + `with this Discord account. Lift it from the Banned Discord Accounts panel.`,
                )) return;
                const why = prompt('Reason (optional — shown to them at sign-in):') ?? '';
                setBanning(true);
                try {
                  await banDiscordId(player.id, why.trim() || undefined);
                  addToast(`${player.displayName} has been banned.`, 'success');
                } catch (err) {
                  addToast((err as { message?: string }).message ?? `Failed to ban ${player.displayName}.`, 'error');
                } finally {
                  setBanning(false);
                }
              }}
            >
              {banning ? 'Banning…' : '⛔ Ban'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
