import DistrictModal from './DistrictModal';

interface Props {
  open:    boolean;
  onClose: () => void;
}

// Barn — Field Work, and in Phase 2 the Companions roster.
//
// A STUB by plan (§1.7): Field Work is a real Guildmaster Mission type that does
// not exist yet, and Companions are Phase 2. The card is live so the ward reads as
// a complete place rather than three doors and a gap.
export default function BarnPanel({ open, onClose }: Props) {
  return (
    <DistrictModal
      open={open}
      onClose={onClose}
      glyph="🌾"
      title="Barn"
      subtitle="The Capital · Fields Beyond the Wall"
    >
      <div className="district-pending">
        The fields are not yet sown. Work out here opens later in the season.
      </div>
    </DistrictModal>
  );
}
