import { useGameState } from '../../contexts/GameStateContext';
import { useSeason } from '../../contexts/SeasonContext';
import PlayerCard from './playersPage/PlayerCard';

export default function PlayersPage() {
  const { gameState } = useGameState();
  const { config } = useSeason();
  if (!gameState) return null;

  const players = Object.values(gameState.players ?? {});
  // Admin is global now (config/adminId), not stored per-season.
  const adminId = config?.adminId;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">👥 Players</h2>
      {players.length === 0 ? (
        <div className="dash-empty">No players have joined yet.</div>
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
