import { activeBoard } from '../../lib/board';
// The new tile icons are read from TILE_TYPES rather than retyped here: hand-copying
// them put the Castle's glyph on the Tower on the first pass, and the help disagreeing
// with the board about what a tile looks like is worse than no entry at all.
import { TILE_TYPES } from '../../lib/constants';

// BOARD-AWARE rather than rewritten for S2 (map plan §1.11). The help modal is
// season-agnostic — an archived S1 season is still fully readable — so the handful
// of facts that actually differ between boards are read from the BoardSpec instead
// of being restated for whichever season happens to be newest. The alternative,
// hardcoding S2's numbers, would have made S1's own documentation wrong.
export default function SectionMap() {
  const board = activeBoard();
  return (
    <div className="help-section">
      <h3>The Map</h3>
      <p>
        The island is a <strong>{board.cols} × {board.rows} grid</strong> of tiles. Most
        start hidden and are revealed as adjacent tiles are completed. The map is
        procedurally generated — each new season brings a fresh layout.
      </p>
      {!board.hasTowns && (
        <p>
          Your expedition begins at the <strong>Castle</strong> ({board.startCoord}), and the
          city districts below the map — the Town Hall, Shop, Casino and Barn — are where
          you take commissions and spend your Gold. See <strong>The Districts</strong>.
        </p>
      )}
      <h4>Tile Types</h4>
      <div className="help-tile-list">
        {board.hasTowns && (
          <div className="help-tile-row">
            <span className="help-tile-icon">🏰</span>
            <div><strong>Town</strong> — Safe haven. Contains a shop where you can spend Gold on items and Orbs.</div>
          </div>
        )}
        {!board.hasTowns && (
          <div className="help-tile-row">
            <span className="help-tile-icon">{TILE_TYPES.castle.icon}</span>
            <div><strong>Castle</strong> — Where you begin. The city districts sit below the map.</div>
          </div>
        )}
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
        {board.hasBoss && (
          <div className="help-tile-row">
            <span className="help-tile-icon">🐉</span>
            <div><strong>Boss</strong> — The final challenge. Locked until at least 5 Orbs have been gathered.</div>
          </div>
        )}
        {!board.hasBoss && (
          <>
            <div className="help-tile-row">
              <span className="help-tile-icon">{TILE_TYPES.dungeon.icon}</span>
              <div>
                <strong>Dungeon</strong> — A sealed door into its own small map. Each holds two
                Elites and two treasure dead-ends, and opens once revealed.
              </div>
            </div>
            <div className="help-tile-row">
              <span className="help-tile-icon">{TILE_TYPES.tower.icon}</span>
              <div>
                <strong>Tower</strong> — Three floors, each sealed behind a number of Orbs. The
                Sorcerer waits at the top. See <strong>The Tower</strong>.
              </div>
            </div>
          </>
        )}
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
