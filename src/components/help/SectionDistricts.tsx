import { DISTRICTS } from '../districts/districtData';

// Shown only on a board with no town tiles (see HelpModal) — the districts exist
// precisely because there is no town to hang the shop and the mission board off.
//
// The list is read from DISTRICTS rather than retyped, so a district added or
// renamed there cannot leave this page describing a city that no longer exists.
export default function SectionDistricts() {
  return (
    <div className="help-section">
      <h3>The Districts</h3>
      <p>
        Below the map sits the <strong>Capital Ward</strong> — the city you return to
        between challenges. Earlier seasons scattered this across town tiles on the
        board; now it has four doors of its own.
      </p>
      <div className="help-tile-list">
        {DISTRICTS.map(d => (
          <div key={d.key} className="help-tile-row">
            <span className="help-tile-icon">{d.glyph}</span>
            <div><strong>{d.label}</strong> — {d.line}</div>
          </div>
        ))}
      </div>
      <h4>What each one is for</h4>
      <p>
        <strong>Town Hall</strong> holds the Guildmaster&rsquo;s commissions — Basic
        Training and Patrols. <strong>Casino</strong> tables are their own kind of
        commission, where the cards decide which games you bring, so they live in the
        Casino rather than on the board. The <strong>Shop</strong> is a single shop for
        the whole season, no longer one per town. The <strong>Barn</strong> opens later
        in the season.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">🏛</span>
        <span>
          The districts are visible before you log in, but you need to be signed in to
          walk into one.
        </span>
      </div>
    </div>
  );
}
