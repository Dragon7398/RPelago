import { SHOP_ITEMS } from '../../lib/constants';
import { S2_TRAITS, isLeveled } from '../../lib/traits';

export default function SectionTraits() {
  const featuredTraits = S2_TRAITS.filter(t =>
    ['bifurcated', 'horde', 'agile', 'sturdy', 'stunning', 'cursed', 'aerial'].includes(t.id)
  );
  return (
    <div className="help-section">
      <h3>Traits & Items</h3>
      <p>
        Some tiles carry <strong>Traits</strong> — special rules that change how you must
        configure your Archipelago slot. Traits are shown in the tile detail panel when
        you click a tile.
      </p>
      <h4>Common Traits</h4>
      <div className="help-traits">
        {featuredTraits.map(t => (
          <div key={t.id} className="help-trait-row">
            <span className="help-trait-name">
              {t.name}
              {isLeveled(t) && <span className="help-trait-levels"> · {t.max} levels</span>}
            </span>
            <span className="help-trait-blurb">{t.blurb}</span>
            {/* Level 1 — the mildest form. The full per-level codex is a later
                pass (traits plan §7.2); this stays a summary. */}
            <span className="help-trait-desc">{t.describe(1)}</span>
          </div>
        ))}
      </div>
      <h4>Passive Items</h4>
      <p>Buy these at Town shops to permanently ignore certain traits:</p>
      <div className="help-items">
        {SHOP_ITEMS.filter(i => i.description.startsWith('Passive:')).map(item => (
          <div key={item.id} className="help-item-row">
            <span className="help-item-name">{item.name}</span>
            <span className="help-item-desc">{item.description.replace('Passive: ', '')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
