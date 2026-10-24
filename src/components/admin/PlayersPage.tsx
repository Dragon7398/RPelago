import { useState, useMemo } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useSeason } from '../../contexts/SeasonContext';
import PlayerCard from './playersPage/PlayerCard';
import BanPanel from './playersPage/BanPanel';
import { comparePlayersForAdmin, claimActivity, type ClaimActivity } from '../../lib/gameLogic';
import type { Player } from '../../types';

// Band headings for the three claim-activity tiers the roster sorts into. The
// order here IS the sort order, and the copy has to read in both shells — a map
// season's "table" is a challenge tile — so it says neither table nor tile.
const BAND_LABEL: Record<ClaimActivity, string> = {
  active:  'In Play',
  settled: 'Played This Season',
  none:    'Not Yet Playing',
};
const BAND_HINT: Record<ClaimActivity, string> = {
  active:  'On a live table or challenge right now — including seats whose claim has already come back.',
  settled: 'Nothing live, but they have finished something this season.',
  none:    'Has not joined anything this season yet.',
};

export default function PlayersPage() {
  const { gameState } = useGameState();
  const { config } = useSeason();
  // Hooks must run before the loading bail-out below.
  const [filter, setFilter] = useState('');

  // Every real player, sorted. `createSeasonPlayer` always writes `id`, so a
  // record without one is NOT a player — it's a stub left by a write that
  // touched a leaf under `players/{uid}` for someone who was never in this
  // season (RTDB creates missing ancestors on write). Those rendered as
  // nameless DISABLED cards, so they're excluded from the roster entirely.
  //
  // Order is claim activity, then Discord username — see comparePlayersForAdmin.
  // Whoever is mid-something surfaces first without the roster stopping being a
  // roster; the filter box below narrows it without reordering.
  // What the band is derived from — shared by the sort and the grouping below, so
  // the two can never be reading different snapshots of the season.
  const activityCtx = useMemo(() => ({
    missions:        gameState?.missions,
    missionsHistory: gameState?.missionsHistory,
    tiles:           gameState?.tiles,
  }), [gameState?.missions, gameState?.missionsHistory, gameState?.tiles]);

  const roster = useMemo(
    () => Object.values(gameState?.players ?? {})
      .filter(p => !!p?.id)
      .sort((a, b) => comparePlayersForAdmin(a, b, activityCtx)),
    [gameState?.players, activityCtx],
  );

  const players = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return roster;
    // Partial match on either name — admins search by whichever one they know.
    return roster.filter(p =>
      (p.discordHandle ?? '').toLowerCase().includes(q)
      || (p.displayName ?? '').toLowerCase().includes(q));
  }, [roster, filter]);

  // Contiguous runs of one band, taken off the already-sorted list — so the
  // headings can never disagree with the order, and the counts reflect whatever
  // the filter has left rather than the whole roster.
  const bands = useMemo(() => {
    const out: { key: ClaimActivity; members: Player[] }[] = [];
    for (const p of players) {
      const key  = claimActivity(p, activityCtx);
      const last = out[out.length - 1];
      if (last && last.key === key) last.members.push(p);
      else out.push({ key, members: [p] });
    }
    return out;
  }, [players, activityCtx]);

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
      ) : bands.map(band => (
        <div key={band.key} className="dash-player-band-group">
          <div className={`dash-player-band dash-player-band--${band.key}`} title={BAND_HINT[band.key]}>
            <span>{BAND_LABEL[band.key]}</span>
            <span className="dash-player-band-count">{band.members.length}</span>
          </div>
          {band.members.map(player => (
            <PlayerCard
              key={player.id}
              player={player}
              tiles={gameState.tiles}
              adminId={adminId}
              missions={gameState.missions}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
