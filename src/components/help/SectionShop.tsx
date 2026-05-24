import { SHOP_ITEMS, ORB_SHOP_COST } from '../../lib/constants';

export default function SectionShop() {
  return (
    <div className="help-section">
      <h3>The Shop</h3>
      <p>
        Town tiles (🏰) contain shops where you can spend your hard-earned <strong>Gold</strong>.
        There are four towns on the island, each stocking a different selection of goods.
      </p>
      <h4>All Items</h4>
      <div className="help-items">
        {SHOP_ITEMS.map(item => (
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
      <div className="help-callout">
        <span className="help-callout-icon">🏰</span>
        <span>Shops also sell specific <strong>Orbs</strong> for {ORB_SHOP_COST.toLocaleString()} Gold each. If the group is close to unlocking the Boss, saving gold for an Orb can be worth it.</span>
      </div>
    </div>
  );
}
