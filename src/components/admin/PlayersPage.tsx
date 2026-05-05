import { useGameState } from '../../contexts/GameStateContext';
import { SHOP_ITEMS } from '../../lib/constants';
import { playerReset } from '../../firebase/db';

export default function PlayersPage() {
  const { gameState, adminConsumeItem, adminDisablePlayer, adminEnablePlayer } = useGameState();
  if (!gameState) return null;

  const players   = Object.values(gameState.players ?? {});
  const adminId   = gameState.meta?.adminId;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">👥 Players</h2>
      {players.length === 0 ? (
        <div className="dash-empty">No players have joined yet.</div>
      ) : players.map(player => {
        const ownedItems = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
        const busyAdvs   = Object.values(player.adventurers ?? {}).filter(a => a.busyTile);

        const isAdmin = player.id === adminId;

        return (
          <div key={player.id} className={`dash-player-card${player.disabled ? ' disabled' : ''}`}>
            <div className="dash-player-header">
              <div className="dash-player-name">
                {player.displayName}
                {player.disabled && (
                  <span className="dash-player-disabled-badge">RESTRICTED</span>
                )}
              </div>
              <div className="dash-player-stats">
                ✨ {player.xp.toLocaleString()} XP · 🪙 {player.gold.toLocaleString()} G
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
