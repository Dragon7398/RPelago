import { TOWER_FLOOR_ORBS, TILE_TYPES, ALL_ORBS } from '../../lib/constants';

// The S2 replacement for SectionBoss, which is kept and still shown on a board that
// has a boss (see HelpModal) — an archived S1 season must keep describing the
// Dragon, not a Tower it never had.
//
// Floor gates come from TOWER_FLOOR_ORBS so the page cannot drift from the live
// unlock check (`towerFloorsUnlocked`).
export default function SectionTower() {
  return (
    <div className="help-section">
      <h3>The Tower</h3>
      <p>
        The Tower is the season&rsquo;s final challenge: <strong>three floors</strong>,
        each sealed behind a number of <strong>Orbs</strong>. The Sorcerer waits on the
        top floor, and the season ends when they fall.
      </p>
      <h4>Unlocking the floors</h4>
      <div className="help-states">
        {TOWER_FLOOR_ORBS.map((orbs, i) => (
          <div key={i} className="help-state-row">
            <span className="help-tile-icon">{TILE_TYPES.tower.icon}</span>
            <div>
              <strong>Floor {i + 1}</strong> — opens at <strong>{orbs} Orbs</strong>
              {i === TOWER_FLOOR_ORBS.length - 1 ? ' — the Sorcerer.' : '.'}
            </div>
          </div>
        ))}
      </div>
      <p>
        There are <strong>{ALL_ORBS.length} Orbs</strong> in the season, so the Tower never
        demands a complete set — you can reach the Sorcerer having missed two. Each floor
        is its own small map with its own challenges, ending in an Elite that guards the
        stairs up.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">{TILE_TYPES.tower.icon}</span>
        <span>
          Floors are <strong>sequential</strong>: the stairs to the next one only appear
          once the floor you are on is finished, even if you already hold enough Orbs for
          it.
        </span>
      </div>
    </div>
  );
}
