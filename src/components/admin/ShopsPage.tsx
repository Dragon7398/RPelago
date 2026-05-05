import { useGameState } from '../../contexts/GameStateContext';
import { ALL_ORBS, SHOP_ITEMS } from '../../lib/constants';

const SHOP_ORDER = ['centralia', 'frostshear', 'flamefell', 'pinereach'] as const;

export default function ShopsPage() {
  const { gameState, adminUpdateShop } = useGameState();
  if (!gameState) return null;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">🛒 Shops</h2>
      {SHOP_ORDER.map(shopId => {
        const shop = gameState.shops?.[shopId];
        if (!shop) return null;

        function toggleItem(itemId: string) {
          const ids  = shop!.itemIds ?? [];
          const next = ids.includes(itemId)
            ? ids.filter(id => id !== itemId)
            : [...ids, itemId];
          adminUpdateShop(shopId, { itemIds: next });
        }

        return (
          <div key={shopId} className="dash-shop-card">
            <div className="dash-shop-name">{shop.name}</div>

            <div className="dash-shop-row">
              <label className="dash-shop-label">Orb for sale</label>
              <select
                className="dash-select"
                value={shop.orbId ?? ''}
                onChange={e => adminUpdateShop(shopId, { orbId: e.target.value || null })}
              >
                <option value="">— None —</option>
                {ALL_ORBS.map(orb => (
                  <option key={orb.id} value={orb.id}>{orb.icon} {orb.label}</option>
                ))}
              </select>
            </div>

            <div className="dash-shop-items-section">
              <div className="dash-shop-label">Items available</div>
              {SHOP_ITEMS.map(item => (
                <label key={item.id} className="dash-shop-item-toggle">
                  <input
                    type="checkbox"
                    checked={(shop.itemIds ?? []).includes(item.id)}
                    onChange={() => toggleItem(item.id)}
                  />
                  <div className="dash-shop-item-info">
                    <span className="dash-shop-item-name">{item.name}</span>
                    <span className="dash-shop-item-cost">🪙 {item.cost}</span>
                    <span className="dash-shop-item-desc">{item.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
