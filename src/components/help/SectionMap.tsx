export default function SectionMap() {
  return (
    <div className="help-section">
      <h3>The Map</h3>
      <p>
        The island is a <strong>7 × 5 grid</strong> of tiles. Most start hidden and
        are revealed as adjacent tiles are completed. The map is procedurally generated —
        each new season brings a fresh layout.
      </p>
      <h4>Tile Types</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">🏰</span>
          <div><strong>Town</strong> — Safe haven. Contains a shop where you can spend Gold on items and Orbs.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">⚔️</span>
          <div><strong>Battle</strong> — Standard encounter. The most common tile type.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">🧩</span>
          <div><strong>Puzzle</strong> — A tricky problem to solve. May have unusual challenge traits.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">💀</span>
          <div><strong>Elite</strong> — A powerful enemy. Higher difficulty with more slots needed. Always awards an Orb on first completion.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">🐉</span>
          <div><strong>Boss</strong> — The final challenge. Locked until at least 5 Orbs have been gathered.</div>
        </div>
      </div>
      <h4>Tile States</h4>
      <div className="help-states">
        <div className="help-state-row">
          <div className="help-swatch sw-hidden" />
          <div><strong>Hidden</strong> — Unknown territory. Revealed by completing adjacent tiles.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-available" />
          <div><strong>Available</strong> — Ready to enter. Click to assign Adventurers.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-inprogress" />
          <div><strong>In Progress</strong> — Adventurers deployed; the challenge is underway.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-complete" />
          <div><strong>Complete</strong> — Challenge finished. Click to review.</div>
        </div>
      </div>
    </div>
  );
}
