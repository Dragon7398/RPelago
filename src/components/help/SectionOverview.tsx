export default function SectionOverview() {
  return (
    <div className="help-section">
      <h3>What is RPelago?</h3>
      <p>
        RPelago is a <strong>shared, collaborative metagame</strong> layered on top of
        the Archipelago randomizer. All players share a single persistent island — and
        every action you take affects the whole group.
      </p>
      <p>
        Your goal is to <strong>explore the archipelago</strong>, complete challenges
        together, collect Orbs, and ultimately defeat the Boss that guards the heart of
        the island. At least 5 Orbs are needed to face the Boss — and the more you gather,
        the weaker it becomes.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">⚔</span>
        <span>New here? Click <strong>ENTER RPelago</strong> to sign in with Discord, then click any glowing tile on the map to begin your first adventure.</span>
      </div>
      <h4>The Flow</h4>
      <ol className="help-list">
        <li>Sign in and meet your Adventurers.</li>
        <li>Click a glowing <strong>Available</strong> tile and deploy an Adventurer to a slot.</li>
        <li>Complete the Archipelago challenge that corresponds to your slot.</li>
        <li>Earn <strong>Gold</strong> and <strong>XP</strong> — use Gold at Town shops to buy useful items.</li>
        <li>Collect at least 5 Orbs to unlock the Boss — gather more to strip away its traits.</li>
        <li>Defeat the Boss together to claim victory for the island.</li>
      </ol>
    </div>
  );
}
