import DistrictModal from './DistrictModal';

interface Props {
  open:    boolean;
  onClose: () => void;
}

// Shop — the ward's door to the global shop.
//
// DELIBERATELY EMPTY until §1.8. The shop's data model is still S1's
// `seasons/{id}/shops/{shopId}`, keyed by the town tile that hosts it, and S2 has
// no town tiles — so there is no shop node for an S2 season to read. §1.8 collapses
// that to a single `seasons/{id}/shop`, retires `DEFAULT_SHOPS`, makes
// `purchaseShopItem`'s `coord` optional, and moves TownLightbox's shop markup in
// here as that file is deleted.
//
// Building a shop against the per-town model first would mean writing it twice and
// throwing the first one away. The door exists now so the ward is complete and the
// routing is exercised; what it opens onto arrives with the model that fits it.
export default function ShopPanel({ open, onClose }: Props) {
  return (
    <DistrictModal
      open={open}
      onClose={onClose}
      glyph="🛒"
      title="Shop"
      subtitle="The Capital · Supplies"
    >
      <div className="district-pending">
        The shopkeeper is still unpacking. Supplies open for trade shortly.
      </div>
    </DistrictModal>
  );
}
