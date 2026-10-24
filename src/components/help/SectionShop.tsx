import { SHOP_ITEMS, ORB_SHOP_COST, DEFAULT_S2_SHOP_ITEM_IDS } from '../../lib/constants';
import { activeBoard } from '../../lib/board';

export default function SectionShop() {
  const board = activeBoard();
  // S1 listed the whole catalogue because its four shops between them stocked it.
  // S2 stocks four items and the rest are retired, so listing everything would
  // advertise goods no shop sells — see DEFAULT_S2_SHOP_ITEM_IDS.
  const items = board.hasShopTiles
    ? SHOP_ITEMS
    : SHOP_ITEMS.filter(i => DEFAULT_S2_SHOP_ITEM_IDS.includes(i.id));
  return (
    <div className="help-section">
      <h3>The Shop</h3>
      {board.hasShopTiles ? (
        <p>
          Town tiles (🏰) contain shops where you can spend your hard-earned <strong>Gold</strong>.
          There are four towns on the island, each stocking a different selection of goods.
        </p>
      ) : (
        <p>
          The <strong>Shop</strong> in the Capital Ward is where you spend your hard-earned{' '}
          <strong>Gold</strong>. There is one for the whole season — no longer one per town —
          and it carries no Orbs: every Orb this season is won from an Elite.
        </p>
      )}
      <h4>{board.hasShopTiles ? 'All Items' : 'In Stock'}</h4>
      <div className="help-items">
        {items.map(item => (
          <div key={item.id} className="help-item-row">
            <div className="help-item-header">
              <span className="help-item-name">{item.name}</span>
              <span className="help-item-cost">{item.cost.toLocaleString()} Gold</span>
              <span className={`help-item-badge ${item.consumable ? 'consumable' : 'passive'}`}>
                {item.consumable ? 'Consumable' : 'Passive'}
              </span>
            </div>
            <span className="help-item-desc">
              {item.description.replace(/^(Consumable|Passive|Cosmetic): /, '')}
            </span>
          </div>
        ))}
      </div>
      {board.hasShopTiles && (
        <div className="help-callout">
          <span className="help-callout-icon">🏰</span>
          <span>Shops also sell specific <strong>Orbs</strong> for {ORB_SHOP_COST.toLocaleString()} Gold each. If the group is close to unlocking the Boss, saving gold for an Orb can be worth it.</span>
        </div>
      )}
    </div>
  );
}
