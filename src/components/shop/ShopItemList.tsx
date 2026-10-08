import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import { SHOP_ITEMS, ITEM_TRAIT_REFS } from '../../lib/constants';
import { renderTraitDesc } from '../lightbox/lbHelpers';
import type { Player } from '../../types';

interface Props {
  /** Item ids this shop stocks, in display order. */
  itemIds: readonly string[];
  player:  Player;
  /**
   * S1 passes the town tile's coord, which the server validates the item against.
   * S2 omits it — there is one shop at a fixed path and no tile to name (§1.8).
   */
  coord?:  string;
}

// The buyable item rows, shared by S1's per-town `TownLightbox` and S2's global
// `ShopPanel`. Extracted rather than duplicated: the purchase flow, the
// owned/afford states and the trait underlining are all logic neither copy should
// own alone.
export default function ShopItemList({ itemIds, player, coord }: Props) {
  const { purchaseItem } = useGameState();
  const { addToast } = useToast();
  const [purchasing, setPurchasing] = useState(false);

  // `SHOP_ITEMS` is a catalogue, not a stock list, so an id that isn't in it is a
  // stale config rather than a crash — drop it.
  const defs = itemIds
    .map(id => SHOP_ITEMS.find(i => i.id === id))
    .filter(Boolean) as typeof SHOP_ITEMS[number][];

  if (defs.length === 0) {
    return <div className="lb-shop-note">The shelves are bare today. Check back after your next adventure.</div>;
  }

  return (
    <>
      {defs.map(item => {
        const qty       = player.inventory?.[item.id] ?? 0;
        const itemOwned = !item.consumable && qty > 0;
        const canAfford = !itemOwned && player.gold >= item.cost;
        return (
          <div key={item.id} className="lb-shop-item">
            <div className="lb-shop-item-info">
              <div className="lb-shop-item-name">{item.name}</div>
              <div className="lb-shop-item-desc">
                {renderTraitDesc(item.description, ITEM_TRAIT_REFS[item.id] ?? [])}
              </div>
              {item.consumable && qty > 0 && <div className="lb-shop-item-owned">Owned: {qty}</div>}
            </div>
            <div className="lb-shop-item-right">
              <div className="lb-shop-item-cost">🪙 {item.cost}</div>
              <button
                className={`lb-shop-item-btn${itemOwned ? ' owned' : !canAfford ? ' cant-afford' : ''}`}
                onClick={canAfford && !purchasing ? async () => {
                  setPurchasing(true);
                  try {
                    await purchaseItem(item.id, coord);
                    addToast(`${item.name} purchased.`, 'success');
                  } catch {
                    addToast('Purchase failed. Please try again.', 'error');
                  } finally {
                    setPurchasing(false);
                  }
                } : undefined}
                disabled={!canAfford || itemOwned || purchasing}
              >
                {itemOwned ? '✓ OWNED' : canAfford ? 'BUY' : 'NOT ENOUGH GOLD'}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
