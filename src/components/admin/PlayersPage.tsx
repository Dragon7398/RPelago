import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { SHOP_ITEMS, FEATS } from '../../lib/constants';
import { calcLevel, adventurerCountForLevel } from '../../lib/gameLogic';
import { playerReset } from '../../firebase/db';
import type { Player, Tile } from '../../types';

const SLOT_MIN_LEVEL: Record<string, number> = { level3: 3, level5: 5, level7: 7 };
const SLOT_ALLOWED:   Record<string, number[]> = { level3: [3], level5: [3, 5], level7: [3, 5, 7] };

function getFeatWarnings(player: Player, tiles: Record<string, Tile>): string[] {
  const feats = player.feats ?? {};
  const level = calcLevel(player.xp);
  const warnings: string[] = [];
  for (const [slot, featId] of Object.entries(feats)) {
    if (!featId) continue;
    const def = FEATS.find(f => f.id === featId);
    if (!def) {
      warnings.push(`${slot}: unrecognised feat ID "${featId}"`);
      continue;
    }
    if (!(SLOT_ALLOWED[slot] ?? []).includes(def.availableAt)) {
      warnings.push(`${slot}: ${def.name} (tier ${def.availableAt}) is not valid for this slot`);
    }
    if (level < (SLOT_MIN_LEVEL[slot] ?? 99)) {
      warnings.push(`${slot}: ${def.name} requires level ${SLOT_MIN_LEVEL[slot]}, player is level ${level}`);
    }
  }
  const maxAdvs  = adventurerCountForLevel(level);
  const advCount = Object.keys(player.adventurers ?? {}).length;
  if (advCount > maxAdvs) {
    warnings.push(`Has ${advCount} adventurers but level ${level} allows ${maxAdvs}`);
  }

  // Check for any adventurer actively needed on more than one tile simultaneously.
  // A tile appearance is "active" if the adventurer has no slots yet, or at least
  // one slot is not yet at 100%/Goaled/Done. Appearances where all slots are
  // complete are legacy credit records from early-release and are not a conflict.
  const FREE_SLOT_STATUSES = new Set(['100%', 'Goaled', 'Done']);
  const isActiveOnTile = (slots: typeof tiles[string]['adventurers'][string]['slots']) => {
    if (!slots || slots.length === 0) return true;
    return !slots.every(s => s.status && FREE_SLOT_STATUSES.has(s.status));
  };
  const advTileMap: Record<string, string[]> = {};
  for (const [coord, tile] of Object.entries(tiles)) {
    for (const [advId, ta] of Object.entries(tile.adventurers ?? {})) {
      if (ta.owner === player.id && isActiveOnTile(ta.slots)) {
        (advTileMap[advId] ??= []).push(coord);
      }
    }
  }
  for (const [advId, coords] of Object.entries(advTileMap)) {
    if (coords.length > 1) {
      const adv  = player.adventurers?.[advId];
      const name = adv ? `${adv.firstName} ${adv.lastName}` : advId;
      warnings.push(`${name} is double-assigned: ${coords.join(', ')}`);
    }
  }

  return warnings;
}

export default function PlayersPage() {
  const { gameState, adminConsumeItem, adminDisablePlayer, adminEnablePlayer,
          adminAddWarning, adminDeleteWarning, adminClearWarnings } = useGameState();
  const [addingFor, setAddingFor]   = useState<string | null>(null);
  const [warningDraft, setWarningDraft] = useState('');

  if (!gameState) return null;

  const players   = Object.values(gameState.players ?? {});
  const adminId   = gameState.meta?.adminId;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">👥 Players</h2>
      {players.length === 0 ? (
        <div className="dash-empty">No players have joined yet.</div>
      ) : players.map(player => {
        const ownedItems    = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
        const busyAdvs      = Object.values(player.adventurers ?? {}).filter(a => a.busyTile);
        const isAdmin       = player.id === adminId;
        const level         = calcLevel(player.xp);
        const featWarnings  = getFeatWarnings(player, gameState.tiles);
        const playerWarnings = Object.entries(player.warnings ?? {})
          .sort(([, a], [, b]) => b.timestamp - a.timestamp);

        return (
          <div key={player.id} className={`dash-player-card${player.disabled ? ' disabled' : ''}`}>
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
                  const tile     = gameState.tiles[adv.busyTile!];
                  const tileName = tile?.name || adv.busyTile!;
                  return (
                    <div key={adv.id} className="dash-player-tile-row">
                      <span className="dash-player-adv-name">
                        {adv.firstName} {adv.lastName}
                      </span>
                      <span className="dash-player-tile-name">
                        — {tileName} ({adv.busyTile})
                      </span>
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
                    <button
                      className="dash-inv-use"
                      onClick={() => adminConsumeItem(player.id, item.id)}
                    >
                      Mark Used
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(playerWarnings.length > 0 || addingFor === player.id) && (
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
                {addingFor === player.id && (
                  <div className="dash-warning-add-row">
                    <input
                      className="dash-warning-input"
                      value={warningDraft}
                      onChange={e => setWarningDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && warningDraft.trim()) {
                          adminAddWarning(player.id, warningDraft.trim());
                          setAddingFor(null); setWarningDraft('');
                        } else if (e.key === 'Escape') {
                          setAddingFor(null); setWarningDraft('');
                        }
                      }}
                      placeholder="Warning message..."
                      autoFocus
                    />
                    <button
                      className="dash-warning-submit"
                      disabled={!warningDraft.trim()}
                      onClick={() => {
                        if (warningDraft.trim()) {
                          adminAddWarning(player.id, warningDraft.trim());
                          setAddingFor(null); setWarningDraft('');
                        }
                      }}
                    >Add</button>
                    <button
                      className="dash-warning-cancel"
                      onClick={() => { setAddingFor(null); setWarningDraft(''); }}
                    >Cancel</button>
                  </div>
                )}
              </div>
            )}

            <div className="dash-player-actions">
              <button
                className="dash-player-reset"
                onClick={() => {
                  if (confirm(`Reset ${player.displayName}'s stats? This archives their XP and cannot be undone.`))
                    playerReset(player.id);
                }}
              >
                Player Reset
              </button>
              <button
                className="dash-warning-add-btn"
                onClick={() => { setAddingFor(player.id); setWarningDraft(''); }}
              >
                + Warning
              </button>
              {isAdmin ? (
                <span className="dash-player-admin-badge">ADMIN</span>
              ) : player.disabled ? (
                <button
                  className="dash-player-enable"
                  onClick={() => adminEnablePlayer(player.id)}
                >
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
      })}
    </div>
  );
}
