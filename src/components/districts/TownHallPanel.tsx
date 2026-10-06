import DistrictModal from './DistrictModal';
import GuildmasterMissions from '../lightbox/GuildmasterMissions';

interface Props {
  open:    boolean;
  onClose: () => void;
}

// Town Hall — the Guildmaster's commission board. On S1 this lived on the centre
// town tile; S2 has no towns, so this panel is the only route to it.
//
// `basic` and `patrol` only: casino tables belong to the Casino district and Field
// Work to the Barn, so each district shows exactly the commissions it issues.
const TOWN_HALL_TYPES = ['basic', 'patrol'] as const;

export default function TownHallPanel({ open, onClose }: Props) {
  return (
    <DistrictModal
      open={open}
      onClose={onClose}
      glyph="⚜"
      title="Town Hall"
      subtitle="The Capital · Guild Hall"
    >
      <GuildmasterMissions types={TOWN_HALL_TYPES} />
    </DistrictModal>
  );
}
