import { useGameState } from '../../contexts/GameStateContext';
import { TILE_TYPES, FEATS } from '../../lib/constants';
import { typeKeyForCoord } from '../../lib/tileGen';
import { getPlayerFeatIds } from '../../lib/gameLogic';
import type { TileAdventurer } from '../../types';
import { slotsFromEntry } from '../../lib/slotHelpers';

function AdvSlotList({ entry, players }: {
  entry: TileAdventurer;
  players: Record<string, import('../../types').Player>;
}) {
  const slots   = slotsFromEntry(entry);
  const featIds = getPlayerFeatIds(players[entry.owner]?.feats);
  return (
    <div className="dash-adv-entry">
      <span className="dash-player-tag">
        {entry.ownerName}
        {featIds.length > 0 && (
          <span className="dash-feat-icons">
            {featIds.map(id => {
              const def = FEATS.find(f => f.id === id);
              return def ? (
                <span key={id} className="dash-feat-icon" title={def.name + ': ' + def.description}>
                  {def.icon}
                </span>
              ) : null;
            })}
          </span>
        )}
      </span>
      {slots.length > 0 ? (
        <div className="dash-adv-slots">
          {slots.map((s, i) => (
            <div key={i} className="dash-adv-slot-row">
              <span className="dash-adv-slot-name">{s.name}</span>
              <span className="dash-adv-slot-sep">—</span>
              <span className="dash-adv-slot-game">{s.game}</span>
              {s.status && <span className={`slot-status-badge ss-${s.status.replace('%', 'pct').replace('-', '')}`}>{s.status}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="dash-adv-no-game">No game currently set</div>
      )}
      {entry.statusNote && (
        <div className="dash-adv-note">
          <span className="dash-adv-note-text">{entry.statusNote.text}</span>
          <span className="dash-adv-note-time">
            {new Date(entry.statusNote.timestamp).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  );
}

interface TileCardProps {
  coord: string;
  tile: import('../../types').Tile;
  players: Record<string, import('../../types').Player>;
  navigateToMap: (coord: string) => void;
  variant: 'available' | 'inprogress';
  onKick: (advId: string, ownerId: string) => void;
}

function TileCard({ coord, tile, players, navigateToMap, variant, onKick }: TileCardProps) {
  const typeKey      = typeKeyForCoord(coord);
  const info         = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
  const advs         = Object.values(tile.adventurers ?? {});
  const isBifurcated = tile.traits?.['bifurcated'] !== undefined;

  return (
    <div className="dash-tile-card">
      <div className="dash-tile-header">
        <span className="dash-tile-icon">{info.icon}</span>
        <span className="dash-tile-name">{tile.name || coord}</span>
        <button className="dash-tile-coord-link" onClick={() => navigateToMap(coord)}>{coord}</button>
        {variant === 'available' ? (
          <span className={`dash-tile-slots${tile.required > 0 && advs.length >= tile.required ? ' full' : ''}`}>
            {tile.required > 0 && advs.length >= tile.required ? '✓' : '○'} {advs.length}/{tile.required}
          </span>
        ) : (
          <>
            {tile.link && (
              <a className="dash-tile-link" href={tile.link} target="_blank" rel="noopener noreferrer" title="Open Archipelago link">
                🔗
              </a>
            )}
            {tile.link && (
              <button
                className="dash-copy-room-btn"
                onClick={() => {
                  const title = tile.name ? `${coord} - ${tile.name}` : coord;
                  const advList = Object.values(tile.adventurers ?? {});
                  const handles = advList.map(adv => {
                    const p = players[adv.owner];
                    return '@' + (p?.discordHandle ?? p?.displayName ?? adv.ownerName);
                  }).join(', ');
                  navigator.clipboard.writeText(`New room generated:  ${title}!\n${tile.link}\n${handles}`);
                }}
              >Copy Room Text</button>
            )}
          </>
        )}
      </div>
      {advs.length > 0 && (
        <div className="dash-tile-advs">
          {isBifurcated ? (
            ([1, 2] as const).map(roomNum => {
              const roomAdvs = advs.filter(a => (a.room ?? 1) === roomNum);
              return (
                <div key={roomNum} className="dash-room-group">
                  <div className="dash-room-group-header">Room {roomNum}</div>
                  {roomAdvs.map(adv => (
                    <div key={adv.advId} className="dash-adv-kickable">
                      <AdvSlotList entry={adv} players={players} />
                      <button
                        className={`dash-kick-btn${variant === 'inprogress' ? ' dash-kick-btn--takeover' : ''}`}
                        title={variant === 'inprogress' ? 'Kick Adventurer and open their slot for a replacement' : 'Remove Adventurer from this tile'}
                        onClick={() => onKick(adv.advId, adv.owner)}
                      >Kick</button>
                    </div>
                  ))}
                  {roomAdvs.length === 0 && <div className="dash-room-empty">No players</div>}
                </div>
              );
            })
          ) : (
            advs.map(adv => (
              <div key={adv.advId} className="dash-adv-kickable">
                <AdvSlotList entry={adv} players={players} />
                <button
                  className={`dash-kick-btn${variant === 'inprogress' ? ' dash-kick-btn--takeover' : ''}`}
                  title={variant === 'inprogress' ? 'Kick Adventurer and open their slot for a replacement' : 'Remove Adventurer from this tile'}
                  onClick={() => onKick(adv.advId, adv.owner)}
                >Kick</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function ChallengesPage({ navigateToMap }: { navigateToMap: (coord: string) => void }) {
  const { gameState, adminMapReset, adminKickAdventurer } = useGameState();
  if (!gameState) return null;

  const allTiles = Object.entries(gameState.tiles);

  const availableTiles = allTiles
    .filter(([, t]) => t.state === 'available')
    .sort(([a], [b]) => a.localeCompare(b));

  const inProgressTiles = allTiles
    .filter(([, t]) => t.state === 'inprogress')
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">⚔ Challenges</h2>

      <div className="dash-challenges-cols">
        {/* Available column */}
        <div className="dash-col">
          <div className="dash-col-header">
            <span>Available</span>
            <span className="dash-col-count">{availableTiles.length}</span>
          </div>
          {availableTiles.length === 0 ? (
            <div className="dash-empty">No available challenges.</div>
          ) : availableTiles.map(([coord, tile]) => (
            <TileCard
              key={coord} coord={coord} tile={tile} players={gameState.players}
              navigateToMap={navigateToMap} variant="available"
              onKick={(advId, ownerId) => {
                if (confirm(`Remove ${tile.adventurers[advId]?.ownerName} from ${tile.name || coord}? Their slot will be freed.`))
                  adminKickAdventurer(coord, advId, ownerId, false);
              }}
            />
          ))}
        </div>

        {/* In Progress column */}
        <div className="dash-col">
          <div className="dash-col-header">
            <span>In Progress</span>
            <span className="dash-col-count">{inProgressTiles.length}</span>
          </div>
          {inProgressTiles.length === 0 ? (
            <div className="dash-empty">No challenges in progress.</div>
          ) : inProgressTiles.map(([coord, tile]) => (
            <TileCard
              key={coord} coord={coord} tile={tile} players={gameState.players}
              navigateToMap={navigateToMap} variant="inprogress"
              onKick={(advId, ownerId) => {
                if (confirm(`Kick ${tile.adventurers[advId]?.ownerName} from ${tile.name || coord}? Their slot will be converted to an open slot for someone else to take over.`))
                  adminKickAdventurer(coord, advId, ownerId, true);
              }}
            />
          ))}
        </div>
      </div>

      <div className="dash-danger">
        <button
          className="dash-danger-btn"
          onClick={() => {
            if (confirm('Reset the map? Player XP, gold, and Adventurers are preserved. This cannot be undone.'))
              adminMapReset();
          }}
        >
          Map Reset
        </button>
      </div>
    </div>
  );
}
