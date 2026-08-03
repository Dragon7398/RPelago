import { useState, useMemo } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useSeason } from '../../contexts/SeasonContext';
import PlayerCard from './playersPage/PlayerCard';
import BanPanel from './playersPage/BanPanel';

export default function PlayersPage() {
  const { gameState } = useGameState();
  const { config } = useSeason();
  // Hooks must run before the loading bail-out below.
  const [filter, setFilter] = useState('');

  // Every real player, sorted. `createSeasonPlayer` always writes `id`, so a
  // record without one is NOT a player — it's a stub left by a write that
  // touched a leaf under `players/{uid}` for someone who was never in this
  // season (RTDB creates missing ancestors on write). Those rendered as
  // nameless RESTRICTED cards, so they're excluded from the roster entirely.
  const roster = useMemo(() => {
    const all = Object.values(gameState?.players ?? {}).filter(p => !!p?.id);
    // Sort by Discord username. Older records may predate `discordHandle`, so
    // fall back to display name rather than sinking them all to one end.
    const sortKey = (p: typeof all[number]) => (p.discordHandle || p.displayName || '').toLowerCase();
    return all.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [gameState?.players]);

  const players = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return roster;
    // Partial match on either name — admins search by whichever one they know.
    return roster.filter(p =>
      (p.discordHandle ?? '').toLowerCase().includes(q)
      || (p.displayName ?? '').toLowerCase().includes(q));
  }, [roster, filter]);

  if (!gameState) return null;

  const total   = roster.length;
  const adminId = config?.adminId;  // Admin is global (config/adminId), not per-season.

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">👥 Players</h2>
      <BanPanel />

      {total > 0 && (
        <div className="dash-player-filter-row">
          <input
            className="dash-player-filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setFilter(''); }}
            placeholder="Filter by Discord username or display name…"
            aria-label="Filter players"
          />
          {filter && (
            <button
              className="dash-player-filter-clear"
              onClick={() => setFilter('')}
              title="Clear filter"
            >✕</button>
          )}
          <span className="dash-player-filter-count">
            {filter ? `${players.length} of ${total}` : `${total} player${total !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {total === 0 ? (
        <div className="dash-empty">No players have joined yet.</div>
      ) : players.length === 0 ? (
        <div className="dash-empty">No players match “{filter.trim()}”.</div>
      ) : players.map(player => (
        <PlayerCard
          key={player.id}
          player={player}
          tiles={gameState.tiles}
          adminId={adminId}
          missions={gameState.missions}
        />
      ))}
    </div>
  );
}
