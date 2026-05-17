export default function SectionChallenges() {
  return (
    <div className="help-section">
      <h3>Challenges</h3>
      <p>
        Every non-town tile represents an <strong>Archipelago challenge</strong>: a
        multiplayer randomizer session your party must complete. Each slot in the challenge
        corresponds to one Adventurer's games.
      </p>
      <h4>How It Works</h4>
      <ol className="help-list">
        <li>Click an <strong>Available</strong> tile and assign one of your idle Adventurers to an open slot.</li>
        <li>Submit your <strong>YAML</strong> to the game thread on Discord.</li>
        <li>Other players fill the remaining slots. Once all slots are full, an Admin will move the tile to <strong>In Progress</strong>.</li>
        <li>Each player plays their assigned Archipelago games (either goaling all slots, or completing the tile's special challenge.)</li>
        <li>
          Once your slot reaches <strong>100%, Goaled, or Done</strong>, your Adventurer is freed and can
          be sent to a new challenge immediately.  If not <strong>Done</strong>, you must still finish any remaining necessary
          tasks on the slot while working elsewhere.
        </li>
        <li>An admin verifies and marks the tile <strong>Complete</strong>. Rewards are distributed to all participants.</li>
      </ol>
      <h4>Rewards</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">💰</span>
          <div><strong>Gold</strong> — Spend at town shops on items or Orbs.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">⭐</span>
          <div><strong>XP</strong> — Raises your level, shown in the HUD.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">✨</span>
          <div><strong>Orbs</strong> — Rare drops from certain tiles and shops.</div>
        </div>
      </div>
      <div className="help-callout">
        <span className="help-callout-icon">🧩</span>
        <span>Some tiles have <strong>public slots</strong> — extra Archipelago worlds open to anyone, not tied to a specific player.</span>
      </div>
    </div>
  );
}
