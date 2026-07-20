/**
 * The opening paragraph is true of every season; everything after it is
 * season-specific. `variant` splits map-vs-casino today — when S2 lands with
 * different goals from S1, its copy will want its own branch here too.
 */
export default function SectionOverview({ variant = 'map' }: { variant?: 'map' | 'casino' }) {
  const casino = variant === 'casino';

  return (
    <div className="help-section">
      <h3>What is RPelago?</h3>
      <p>
        RPelago is a <strong>shared, collaborative metagame</strong> layered on top of
        the Archipelago randomizer. All players share a single persistent island — and
        every action you take affects the whole group.
      </p>

      {casino ? (
        <p>
          This season is <strong>The Casino</strong> — an interlude between full seasons.
          There is no map, no adventurers and no XP: the only thing that counts is your{' '}
          <strong>gold</strong>. You take a seat at a card table and play a hand to decide
          which games you'll bring, and the cards you commit set both your slots and your
          payout. Win, and you carry the winnings into Season 2.
        </p>
      ) : (
        <p>
          Your goal is to <strong>explore the archipelago</strong>, complete challenges
          together, collect Orbs, and ultimately defeat the Boss that guards the heart of
          the island. At least 5 Orbs are needed to face the Boss — and the more you gather,
          the weaker it becomes.
        </p>
      )}

      <div className="help-callout">
        <span className="help-callout-icon">{casino ? '🂡' : '⚔'}</span>
        {casino ? (
          <span>
            New here? Click <strong>ENTER RPelago</strong> to sign in with Discord, then pick
            any open table and <strong>take a seat</strong> to play your first hand.
          </span>
        ) : (
          <span>
            New here? Click <strong>ENTER RPelago</strong> to sign in with Discord, then click
            any glowing tile on the map to begin your first adventure.
          </span>
        )}
      </div>

      <h4>The Flow</h4>
      {casino ? (
        <ol className="help-list">
          <li>Sign in and check your <strong>gold</strong> — everyone starts the season with the same stake.</li>
          <li>Pick a table. Each one is pinned to a single game, so choosing the table chooses the game.</li>
          <li>Pay the ante and play your hand. The cards you <strong>commit</strong> become your slots.</li>
          <li>Take a <strong>Gambit</strong> to shift the table's shared odds — or skip it.</li>
          <li>Submit one YAML covering the games you committed.</li>
          <li>Play out the Archipelago the table spawns.</li>
          <li>When the table settles, collect your winnings and your share of the <strong>pot</strong> — then pull up a chair again.</li>
        </ol>
      ) : (
        <ol className="help-list">
          <li>Sign in and meet your Adventurers.</li>
          <li>Click a glowing <strong>Available</strong> tile and deploy an Adventurer to a slot.</li>
          <li>Complete the Archipelago challenge that corresponds to your slot.</li>
          <li>Earn <strong>Gold</strong> and <strong>XP</strong> — use Gold at Town shops to buy useful items.</li>
          <li>Collect at least 5 Orbs to unlock the Boss — gather more to strip away its traits.</li>
          <li>Defeat the Boss together to claim victory for the island.</li>
        </ol>
      )}
    </div>
  );
}
