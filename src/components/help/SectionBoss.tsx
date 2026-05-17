export default function SectionBoss() {
  return (
    <div className="help-section">
      <h3>The Boss</h3>
      <p>
        Somewhere on the island lurks the <strong>final Boss 🐉</strong>.
        It starts locked — gathering at least 5 Orbs awakens it. The four elemental Orbs
        are especially potent: each one strips two of its traits, making it easier to defeat.
      </p>
      <h4>Orb Traits</h4>
      <p>
        While certain Orbs are missing, the Boss gains extra traits that make it harder.
        Each of the four <strong>elemental Orbs</strong> suppresses two boss traits:
      </p>
      <div className="help-boss-traits">
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(62% 0.22 35)' }}>🔥 Fire</span>
          <span>removes <em>Cursed</em> + <em>Stunning</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(72% 0.10 200)' }}>🌪️ Air</span>
          <span>removes <em>Aerial</em> + <em>Agile</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(60% 0.18 220)' }}>💧 Water</span>
          <span>removes <em>Camouflage</em> + <em>Taunt</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(58% 0.15 130)' }}>🪨 Earth</span>
          <span>removes <em>Enduring</em> + <em>Sturdy</em></span>
        </div>
      </div>
      <div className="help-callout">
        <span className="help-callout-icon">🐉</span>
        <span>The Boss uses the <strong>highest hint%</strong> (fewest hints to players) and <strong>highest complexity</strong> settings of any challenge. Coordinate with everyone before diving in.</span>
      </div>
    </div>
  );
}
