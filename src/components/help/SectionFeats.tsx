import { FEATS } from '../../lib/constants';
import { useAuth } from '../../contexts/AuthContext';
import { useGameState } from '../../contexts/GameStateContext';
import { getPlayerFeatIds } from '../../lib/gameLogic';

export default function SectionFeats() {
  const { user }      = useAuth();
  const { gameState } = useGameState();
  const player        = user && gameState ? gameState.players[user.id] : null;
  const featIds       = getPlayerFeatIds(player?.feats);

  const level3Feats = FEATS.filter(f => f.availableAt === 3);
  const level5Feats = FEATS.filter(f => f.availableAt === 5);
  const level7Feats = FEATS.filter(f => f.availableAt === 7);

  return (
    <div className="help-section">
      <h3>Feats</h3>
      <p>
        As you level up, you unlock <strong>Feats</strong> — permanent abilities that enhance
        your capabilities. You choose one feat at levels 3, 5, and 7. Higher-level selections
        also let you pick from lower tiers you haven't chosen yet.
      </p>
      <p>
        Select your feat from your <strong>Profile</strong> once you reach the unlock level.
      </p>

      {[
        { label: 'Level 3', feats: level3Feats },
        { label: 'Level 5', feats: level5Feats, note: '(or any unchosen Level 3 feat)' },
        { label: 'Level 7', feats: level7Feats, note: '(or any unchosen Level 3 or Level 5 feat)' },
      ].map(({ label, feats, note }) => (
        <div key={label}>
          <h4>{label}{note && <span className="help-feat-note"> {note}</span>}</h4>
          <div className="help-feats">
            {feats.map(feat => {
              const owned = featIds.includes(feat.id);
              return (
                <div key={feat.id} className={`help-feat-row${owned ? ' owned' : ''}`}>
                  <span className="help-feat-icon">{feat.icon}</span>
                  <div>
                    <span className="help-feat-name">{feat.name}</span>
                    {owned && <span className="help-feat-owned-badge">✦ YOURS</span>}
                    <p className="help-feat-desc">{feat.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
