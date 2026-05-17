import { ADV_ICONS } from '../../lib/constants';

export default function SectionAdventurers() {
  const classes = Object.entries(ADV_ICONS) as [string, string][];
  return (
    <div className="help-section">
      <h3>Adventurers</h3>
      <p>
        When you join RPelago you start with <strong>1 Adventurer</strong>, randomly named
        and classed. You earn more as you level up — a second at level 2, a third at level 4,
        and a fourth at level 6 (the maximum). They are your means of tackling challenges
        across the island.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">⚔</span>
        <span>Your Adventurers appear in the <strong>HUD bar</strong> at the top of the page — green when idle, red when deployed. Click a busy Adventurer chip to jump to their tile.</span>
      </div>
      <h4>Classes</h4>
      <p>Classes are <strong>decorative only</strong> — they have no mechanical effect on challenges.</p>
      <div className="help-class-grid">
        {classes.map(([cls, icon]) => (
          <div key={cls} className="help-class-row">
            <span className="help-class-icon">{icon}</span>
            <span className="help-class-name">{cls}</span>
          </div>
        ))}
      </div>
      <h4>Managing Your Party</h4>
      <ul className="help-list">
        <li>Open your <strong>Profile</strong> (click your name in the HUD) to rename Adventurers and view your inventory.</li>
        <li>An Adventurer can only be <strong>actively working</strong> on one challenge at a time.</li>
        <li>
          Once every slot belonging to your Adventurer reaches <strong>100%, Goaled, or Done</strong>,
          they are freed automatically — you can redeploy them to a new challenge right away.
          You are still responsible for helping finish the challenge they are on (e.g.
          collecting any checks other players still need or goaling the slot) if the slot is not <strong>Done</strong>.
        </li>
      </ul>
    </div>
  );
}
