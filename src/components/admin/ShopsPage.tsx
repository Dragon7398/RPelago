import { useGameState } from '../../contexts/GameStateContext';
import { ALL_ORBS, SHOP_ITEMS, DEFAULT_S2_SHOP_ITEM_IDS } from '../../lib/constants';
import { activeBoard } from '../../lib/board';

const SHOP_ORDER = ['centralia', 'frostshear', 'flamefell', 'pinereach'] as const;

// The four passive items are deprecated (§1.8) — they negated traits, and the trait
// rework replaced that mechanic. They stay listed here so a host can SEE what is
// retired (and re-stock one deliberately if they ever want to), but they are badged
// rather than silently mixed in with live stock.
const DEPRECATED_ITEM_IDS = new Set([
  'wand_of_piercing', 'throwing_dagger', 'ring_of_resistance', 'warhammer',
]);

// ── S2: one global shop ───────────────────────────────────────────────────────
function GlobalShopEditor() {
  const { gameState, adminSetGlobalShopItems } = useGameState();
  // Absent until seeded — by a map reset, or by Stock defaults below.
  const stocked = gameState?.shop?.itemIds ?? null;
  const ids = stocked ?? [];

  const toggleItem = (itemId: string) => {
    const next = ids.includes(itemId)
      ? ids.filter(id => id !== itemId)
      : [...ids, itemId];
    void adminSetGlobalShopItems(next);
  };

  return (
    <div className="dash-shop-card">
      <div className="dash-shop-name">The Capital Shop</div>
      <div className="dash-shop-hint">
        One shop for the season, reached from the Capital Ward. No orb slot — S2
        sources every orb from an elite drop.
      </div>

      {stocked === null && (
        <div className="dash-shop-unseeded">
          This season has no shop node yet.{' '}
          <button
            className="dash-btn"
            onClick={() => void adminSetGlobalShopItems(DEFAULT_S2_SHOP_ITEM_IDS)}
          >
            Stock defaults
          </button>
        </div>
      )}

      <div className="dash-shop-items-section">
        <div className="dash-shop-label">Items available</div>
        {SHOP_ITEMS.map(item => {
          const deprecated = DEPRECATED_ITEM_IDS.has(item.id);
          return (
            <label
              key={item.id}
              className={`dash-shop-item-toggle${deprecated ? ' deprecated' : ''}`}
            >
              <input
                type="checkbox"
                checked={ids.includes(item.id)}
                onChange={() => toggleItem(item.id)}
              />
              <div className="dash-shop-item-info">
                <span className="dash-shop-item-name">
                  {item.name}
                  {deprecated && <span className="dash-shop-item-tag">RETIRED</span>}
                </span>
                <span className="dash-shop-item-cost">🪙 {item.cost}</span>
                <span className="dash-shop-item-desc">{item.description}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── S1: four per-town shops ───────────────────────────────────────────────────
function TownShopEditors() {
  const { gameState, adminUpdateShop } = useGameState();

  return (
    <>
      {SHOP_ORDER.map(shopId => {
        const shop = gameState?.shops?.[shopId];
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
    </>
  );
}

export default function ShopsPage() {
  const { gameState } = useGameState();
  if (!gameState) return null;

  // Which editor to draw follows the BOARD, not the data: an S2 season has no shop
  // tiles, so the four town cards would render nothing at all and leave the host
  // with a blank tab and no way to stock anything.
  const global = !activeBoard().hasShopTiles;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">🛒 {global ? 'Shop' : 'Shops'}</h2>
      {global ? <GlobalShopEditor /> : <TownShopEditors />}
    </div>
  );
}
