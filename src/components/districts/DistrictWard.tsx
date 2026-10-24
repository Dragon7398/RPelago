import DistrictCard from './DistrictCard';
import { DISTRICTS, type DistrictKey } from './districtData';

interface Props {
  /** Null when logged out — every card renders inert (decision 19). */
  loggedIn: boolean;
  onOpen:   (key: DistrictKey) => void;
}

// The Capital Ward — the bordered card holding the four districts, rendered below
// MapGrid. This is the only route to Guildmaster Missions and the shop on a board
// with no town tiles, which is every S2 board.
export default function DistrictWard({ loggedIn, onOpen }: Props) {
  return (
    <section className="ward" aria-label="The Capital Ward">
      <div className="ward-head">
        <span className="ward-rule" />
        🏛 THE CAPITAL WARD
        <span className="ward-rule r" />
      </div>
      {!loggedIn && (
        <div className="ward-note">Enter RPelago to visit the districts.</div>
      )}
      <div className="ward-grid">
        {DISTRICTS.map(def => (
          <DistrictCard
            key={def.key}
            def={def}
            disabled={!loggedIn}
            onOpen={() => onOpen(def.key)}
          />
        ))}
      </div>
    </section>
  );
}
