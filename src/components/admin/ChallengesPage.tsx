import { useGameState } from '../../contexts/GameStateContext';
import { TILE_TYPES, rcFromCoord } from '../../lib/constants';
import { getTypeKey } from '../../lib/tileGen';
import type { TileAdventurer, AdvSlot } from '../../types';

function slotsFromEntry(entry: TileAdventurer): AdvSlot[] {
  if (!entry.slots) return [];
  return Array.isArray(entry.slots)
    ? entry.slots
    : Object.values(entry.slots as Record<string, AdvSlot>);
}

function AdvSlotList({ entry }: { entry: TileAdventurer }) {
  const slots = slotsFromEntry(entry);
  return (
    <div className="dash-adv-entry">
      <span className="dash-player-tag">{entry.ownerName}</span>
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
    </div>
  );
}

export default function ChallengesPage() {
  const { gameState, adminMapReset } = useGameState();
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
          ) : availableTiles.map(([coord, tile]) => {
            const [r, c]  = rcFromCoord(coord);
            const typeKey = getTypeKey(r, c);
            const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
            const advs    = Object.values(tile.adventurers ?? {});
            const isFull  = tile.required > 0 && advs.length >= tile.required;
            return (
              <div key={coord} className="dash-tile-card">
                <div className="dash-tile-header">
                  <span className="dash-tile-icon">{info.icon}</span>
                  <span className="dash-tile-name">{tile.name || coord}</span>
                  <span className="dash-tile-coord">{coord}</span>
                  <span className={`dash-tile-slots${isFull ? ' full' : ''}`}>
                    {isFull ? '✓' : '○'} {advs.length}/{tile.required}
                  </span>
                </div>
                {advs.length > 0 && (
                  <div className="dash-tile-advs">
                    {advs.map(adv => <AdvSlotList key={adv.advId} entry={adv} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* In Progress column */}
        <div className="dash-col">
          <div className="dash-col-header">
            <span>In Progress</span>
            <span className="dash-col-count">{inProgressTiles.length}</span>
          </div>
          {inProgressTiles.length === 0 ? (
            <div className="dash-empty">No challenges in progress.</div>
          ) : inProgressTiles.map(([coord, tile]) => {
            const [r, c]  = rcFromCoord(coord);
            const typeKey = getTypeKey(r, c);
            const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
            const advs    = Object.values(tile.adventurers ?? {});
            return (
              <div key={coord} className="dash-tile-card">
                <div className="dash-tile-header">
                  <span className="dash-tile-icon">{info.icon}</span>
                  <span className="dash-tile-name">{tile.name || coord}</span>
                  <span className="dash-tile-coord">{coord}</span>
                  {tile.link && (
                    <a
                      className="dash-tile-link"
                      href={tile.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open Archipelago link"
                    >
                      🔗
                    </a>
                  )}
                </div>
                {advs.length > 0 && (
                  <div className="dash-tile-advs">
                    {advs.map(adv => <AdvSlotList key={adv.advId} entry={adv} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dash-danger">
        <button
          className="dash-danger-btn"
          onClick={() => {
            if (confirm('Reset the map? Player XP, gold, and adventurers are preserved. This cannot be undone.'))
              adminMapReset();
          }}
        >
          Map Reset
        </button>
      </div>
    </div>
  );
}
