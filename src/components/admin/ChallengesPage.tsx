import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { TILE_TYPES, FEATS } from '../../lib/constants';
import { typeKeyForCoord } from '../../lib/tileGen';
import { getPlayerFeatIds } from '../../lib/gameLogic';
import type { TileAdventurer, SlotStatus } from '../../types';
import { slotsFromEntry } from '../../lib/slotHelpers';
import { setTileTracker, setTileTracker2, setTileCheese, setTileCheese2, fetchCheesetrackerId, fetchCheeseDetails, adminUpdateAdvSlotStatus } from '../../firebase/db';
import { fetchRoomStatus } from '../../lib/archipelagoApi';

function AdvSlotList({ entry, players, mismatchedNames }: {
  entry: TileAdventurer;
  players: Record<string, import('../../types').Player>;
  mismatchedNames?: Set<string>;
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
              {mismatchedNames?.has(s.name) && (
                <span className="ap-sync-warn" title="Slot name not found in Archipelago room">⚠</span>
              )}
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
  const [syncing1, setSyncing1] = useState(false);
  const [syncing2, setSyncing2] = useState(false);
  const [mismatched1, setMismatched1] = useState<Set<string>>(new Set());
  const [mismatched2, setMismatched2] = useState<Set<string>>(new Set());

  const handleSync = async (room: 1 | 2) => {
    const roomLink = room === 1 ? tile.link : tile.link2;
    if (!roomLink) return;
    const setSyncing = room === 1 ? setSyncing1 : setSyncing2;
    const setMismatched = room === 1 ? setMismatched1 : setMismatched2;
    const roomAdvs = isBifurcated ? advs.filter(a => (a.room ?? 1) === room) : advs;
    setSyncing(true);
    try {
      const status = await fetchRoomStatus(roomLink);
      const apNames = new Set(status.players.map(([name]: [string, string]) => name));
      const allSlots = roomAdvs.flatMap(adv => adv.slots ?? []);
      const mismatched = new Set(allSlots.map(s => s.name).filter(n => n && !apNames.has(n)));
      setMismatched(mismatched);
      if (status.tracker) {
        await (room === 1 ? setTileTracker(coord, status.tracker) : setTileTracker2(coord, status.tracker));
        try {
          const cheeseId = await fetchCheesetrackerId(status.tracker);
          await (room === 1 ? setTileCheese(coord, cheeseId) : setTileCheese2(coord, cheeseId));
          try {
            const games = await fetchCheeseDetails(cheeseId);
            const statusMap = new Map<string, SlotStatus>();
            for (const g of games) {
              const isGoal = g.tracker_status === 'goal_completed';
              const is100 = g.checks_total > 0 && g.checks_done === g.checks_total;
              const isInProgress = !isGoal && g.checks_done > 0 && g.checks_done < g.checks_total;
              const s = isGoal && is100 ? 'Done' as const : isGoal ? 'Goaled' as const : is100 ? '100%' as const : isInProgress ? 'In-Progress' as const : null;
              if (s) statusMap.set(g.name, s);
            }
            for (const adv of roomAdvs) {
              const slots = adv.slots ?? [];
              for (let i = 0; i < slots.length; i++) {
                const newStatus = statusMap.get(slots[i].name);
                if (newStatus) await adminUpdateAdvSlotStatus(coord, adv.advId, i, newStatus);
              }
            }
          } catch { /* cheese details fetch is best-effort */ }
        } catch {
          // cheese fetch is best-effort
        }
      }
    } catch (err) {
      console.error('AP sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

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
            {!isBifurcated && tile.link && (
              <a className="dash-tile-link" href={tile.link} target="_blank" rel="noopener noreferrer" title="Open Archipelago link">
                🔗
              </a>
            )}
            {!isBifurcated && tile.tracker && (
              <a className="dash-tile-link" href={`https://archipelago.gg/tracker/${tile.tracker}`} target="_blank" rel="noopener noreferrer" title="Open Archipelago tracker">
                📊
              </a>
            )}
            {!isBifurcated && tile.cheese && (
              <a className="dash-tile-link" href={`https://cheesetrackers.theincrediblewheelofchee.se/tracker/${tile.cheese}`} target="_blank" rel="noopener noreferrer" title="Open Cheesetracker">
                🧀
              </a>
            )}
            {!isBifurcated && tile.link && (
              <button
                className="dash-copy-room-btn"
                onClick={() => {
                  const title = tile.name ? `${coord} - ${tile.name}` : coord;
                  const advList = Object.values(tile.adventurers ?? {});
                  const handles = advList.map(adv => {
                    const p = players[adv.owner];
                    return '@' + (p?.discordHandle ?? p?.displayName ?? adv.ownerName);
                  }).join(' ');
                  let text = `New room generated:  ${title}!\n${tile.link}`;
                  if (tile.tracker) text += `\nhttps://archipelago.gg/tracker/${tile.tracker}`;
                  text += `\n${handles}`;
                  const pubSlots = tile.publicSlots ?? [];
                  if (pubSlots.length > 0) {
                    const slotLines = pubSlots.map(s =>
                      `\`\`${s.name}\`\`: ${s.game}${s.details ? ` [${s.details}]` : ''}`
                    ).join('\n');
                    text += `\n\nThis world has the following Public slots.  These are available for anyone to play, whether they are on this tile or not:\n${slotLines}`;
                  }
                  navigator.clipboard.writeText(text);
                }}
              >Copy Room Text</button>
            )}
            {!isBifurcated && tile.link && (
              <button className="dash-copy-room-btn ap-sync-btn" onClick={() => handleSync(1)} disabled={syncing1}>
                {syncing1 ? '…' : 'Sync'}
              </button>
            )}
          </>
        )}
      </div>
      {advs.length > 0 && (
        <div className="dash-tile-advs">
          {isBifurcated ? (
            ([1, 2] as const).map(roomNum => {
              const roomAdvs    = advs.filter(a => (a.room ?? 1) === roomNum);
              const roomLink       = roomNum === 1 ? tile.link    : tile.link2;
              const roomTracker    = roomNum === 1 ? tile.tracker : tile.tracker2;
              const roomCheese     = roomNum === 1 ? tile.cheese  : tile.cheese2;
              const roomSyncing    = roomNum === 1 ? syncing1     : syncing2;
              const roomMismatched = roomNum === 1 ? mismatched1  : mismatched2;
              return (
                <div key={roomNum} className="dash-room-group">
                  <div className="dash-room-group-header">
                    <span>Room {roomNum}</span>
                    {variant === 'inprogress' && (
                      <span className="dash-room-header-controls">
                        {roomLink && (
                          <a className="dash-tile-link" href={roomLink} target="_blank" rel="noopener noreferrer" title={`Open Archipelago link (Room ${roomNum})`}>🔗</a>
                        )}
                        {roomTracker && (
                          <a className="dash-tile-link" href={`https://archipelago.gg/tracker/${roomTracker}`} target="_blank" rel="noopener noreferrer" title={`Open tracker (Room ${roomNum})`}>📊</a>
                        )}
                        {roomCheese && (
                          <a className="dash-tile-link" href={`https://cheesetrackers.theincrediblewheelofchee.se/tracker/${roomCheese}`} target="_blank" rel="noopener noreferrer" title={`Open Cheesetracker (Room ${roomNum})`}>🧀</a>
                        )}
                        {roomLink && (
                          <button
                            className="dash-copy-room-btn"
                            onClick={() => {
                              const base = tile.name ? `${coord} - ${tile.name}` : coord;
                              const title = `${base} - Room ${roomNum}`;
                              const handles = roomAdvs.map(adv => {
                                const p = players[adv.owner];
                                return '@' + (p?.discordHandle ?? p?.displayName ?? adv.ownerName);
                              }).join(' ');
                              let text = `New room generated:  ${title}!\n${roomLink}`;
                              if (roomTracker) text += `\nhttps://archipelago.gg/tracker/${roomTracker}`;
                              text += `\n${handles}`;
                              const pubSlots = (tile.publicSlots ?? []).filter(s => !s.room || s.room === roomNum);
                              if (pubSlots.length > 0) {
                                const slotLines = pubSlots.map(s =>
                                  `\`\`${s.name}\`\`: ${s.game}${s.details ? ` [${s.details}]` : ''}`
                                ).join('\n');
                                text += `\n\nThis world has the following Public slots.  These are available for anyone to play, whether they are on this tile or not:\n${slotLines}`;
                              }
                              navigator.clipboard.writeText(text);
                            }}
                          >Copy Room Text</button>
                        )}
                        {roomLink && (
                          <button className="dash-copy-room-btn ap-sync-btn" onClick={() => handleSync(roomNum)} disabled={roomSyncing}>
                            {roomSyncing ? '…' : 'Sync'}
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {roomAdvs.map(adv => (
                    <div key={adv.advId} className="dash-adv-kickable">
                      <AdvSlotList entry={adv} players={players} mismatchedNames={roomMismatched} />
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
                <AdvSlotList entry={adv} players={players} mismatchedNames={mismatched1} />
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
