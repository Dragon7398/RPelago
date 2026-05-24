import { ALL_ORBS, ORB_SHOP_COST } from '../../lib/constants';

export default function SectionOrbs() {
  return (
    <div className="help-section">
      <h3>Orbs</h3>
      <p>
        There are <strong>9 Orbs</strong> hidden across the archipelago.
        Gathering at least 5 unlocks the Boss tile — collect more to strip away its most punishing traits.
      </p>
      <h4>The 9 Orbs</h4>
      <div className="help-orb-grid">
        {ALL_ORBS.map(orb => (
          <div key={orb.id} className="help-orb-row">
            <span className="help-orb-icon" style={{ color: orb.color }}>{orb.icon}</span>
            <span className="help-orb-label">{orb.label}</span>
          </div>
        ))}
      </div>
      <h4>Where to Find Them</h4>
      <ul className="help-list">
        <li><strong>Elite tiles 💀</strong> — Every Elite encounter awards an Orb on first completion.</li>
        <li><strong>Town shops 🏰</strong> — Some shops sell a specific Orb for {ORB_SHOP_COST.toLocaleString()} Gold.</li>
        <li>Keep your eyes open — Orbs can turn up in unexpected places.</li>
      </ul>
      <div className="help-callout">
        <span className="help-callout-icon">✨</span>
        <span>The <strong>Orb Bar</strong> below the HUD tracks how many Orbs have been found island-wide. Watch it fill!</span>
      </div>
    </div>
  );
}
