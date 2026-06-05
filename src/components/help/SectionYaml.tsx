import { useAuth } from '../../contexts/AuthContext';
import { useGameState } from '../../contexts/GameStateContext';
import { getPlayerFeatIds } from '../../lib/gameLogic';

function YamlVal({ base, bonus }: { base: number; bonus: number }) {
  if (bonus === 0) return <strong>{base}</strong>;
  return (
    <>
      <span className="help-yaml-struck">{base}</span>{' '}
      <strong className="help-yaml-new">{base + bonus}</strong>
    </>
  );
}

export default function SectionYaml() {
  const { user }      = useAuth();
  const { gameState } = useGameState();
  const player        = user && gameState ? gameState.players[user.id] : null;
  const featIds       = getPlayerFeatIds(player?.feats);

  const hasKnow = featIds.includes('knowledgeable');
  const hasPick = featIds.includes('picky');
  const hasHelp = featIds.includes('helpful');
  const hasPrep = featIds.includes('prepared');

  return (
    <div className="help-section">
      <h3>YAML Rules</h3>
      {player && featIds.some(id => ['knowledgeable','picky','helpful','prepared'].includes(id)) && (
        <div className="help-callout">
          <span className="help-callout-icon">🏅</span>
          <span>Feat bonuses appear as <span className="help-yaml-new">highlighted</span> values below.</span>
        </div>
      )}
      <p>
        New to Archipelago? Start with the{' '}
        <a href="https://archipelago.gg/tutorial/Archipelago/setup_en" target="_blank" rel="noopener noreferrer">official YAML setup guide</a>.
      </p>
      <ul className="help-list">
        <li>
          Submit <strong>1 YAML per slot</strong>. Your YAML may include up to <strong>5 games</strong>;
          duplicates are allowed. If submitting multiple games, combine them into one file using{' '}
          <code>---</code> between entries — do not submit separate files.
        </li>
        <li>
          <strong>Game eligibility:</strong> Unsupported games are allowed if they are listed as
          allowed for Async or Sync on{' '}
          <a href="https://docs.google.com/spreadsheets/d/14tVjBURZgqDlmFDrEB9WanuG_-7D_iduwwLNAkBABhM" target="_blank" rel="noopener noreferrer">Drago's list</a>.
          Manuals and Keymaster's Keep are not allowed.
        </li>
        <li>
          <strong>Meta games</strong> (such as AP Bingo and Autopelago) are allowed, but may be
          at most <strong>50%</strong> of your total checks. For example, a 5×5 Bingo board alone
          (25 checks) is not permitted, but pairing it with a Checksfinder (25 checks) is fine.
        </li>
        <li>
          <strong>Check limits:</strong> At least <strong>50 checks</strong> and no more than{' '}
          <strong>1,500 checks</strong> total, unless otherwise approved.
        </li>
        <li>
          <strong>Keep it fun!</strong>  Please use your best judgment on games to keep things fun for everyone.
          Unless you're confident of your ability to keep things moving,
          please don't submit, for example, a fully-maxed Stardew Valley.
          Likewise, please don't submit trivially easy slots or goal excessively out-of-logic
          [e.g. using BLJ to reach goal early in SM64].
        </li>
        <li>
          <strong>YAML settings:</strong> Unless approved by special permission, a challenge, or a feat, you are limited to:
          <ul className="help-list help-list-sub">
            <li><YamlVal base={0} bonus={hasPrep ? 1 : 0} /> starting inventory item{hasPrep ? 's' : ''} per game</li>
            <li><YamlVal base={2} bonus={hasHelp ? 2 : 0} /> priority locations per game</li>
            <li><YamlVal base={2} bonus={hasPick ? 4 : 0} /> excluded locations per game</li>
            <li>
              Either <YamlVal base={0} bonus={hasKnow ? 1 : 0} /> starting hint{hasKnow ? '' : 's'} and{' '}
              <YamlVal base={1} bonus={hasKnow ? 2 : 0} /> hint location{hasKnow ? 's' : ''} per game, or{' '}
              <YamlVal base={1} bonus={hasKnow ? 1 : 0} /> starting hint{hasKnow ? 's' : ''} and{' '}
              <YamlVal base={0} bonus={hasKnow ? 2 : 0} /> hint locations per game
              <ul className="help-list help-list-sub">
                <li>Starting hints that affect too many items, such as hinting your primary macguffin [e.g. Yoshi Eggs in SMW] are not allowed.</li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  );
}
