import { useGameState } from '../../contexts/GameStateContext';
import { useAuth } from '../../contexts/AuthContext';
import DistrictModal from './DistrictModal';
import ShopItemList from '../shop/ShopItemList';

interface Props {
  open:    boolean;
  onClose: () => void;
  onLoginRequest: () => void;
}

// Shop — the ward's door to S2's single global shop (§1.8, decision 17).
//
// No orb slot, unlike S1's town shops: S2 sources all nine orbs from elite drops,
// so `purchaseShopOrb` is gone and nothing here is bought but items.
export default function ShopPanel({ open, onClose, onLoginRequest }: Props) {
  const { gameState } = useGameState();
  const { user } = useAuth();

  const player  = user && gameState ? gameState.players[user.id] : null;
  // Absent on an S1 season, and absent on an S2 season until it is seeded — both
  // read as "no stock", never as an error.
  const itemIds = gameState?.shop?.itemIds ?? [];

  return (
    <DistrictModal
      open={open}
      onClose={onClose}
      glyph="🛒"
      title="Shop"
      subtitle="The Capital · Supplies"
    >
      {!player ? (
        <div className="lb-login-prompt">
          Log in to browse the shop.{' '}
          <a onClick={() => { onClose(); onLoginRequest(); }}>Enter RPelago →</a>
        </div>
      ) : (
        <ShopItemList itemIds={itemIds} player={player} />
      )}
    </DistrictModal>
  );
}
