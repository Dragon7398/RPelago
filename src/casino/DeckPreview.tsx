// Lightbox listing every card in a deck variant, grouped by type, with a
// copy-count badge per card — lets a player see exactly what they're opting
// into (or out of) before picking a deck.

import type { CasinoDeckChoice } from '../types';
import { CARD_DEFS, CARD_TYPES, DECK_VARIANTS } from '../lib/casinoData';
import { CardFace } from './CardFace';

interface DeckPreviewProps {
  choice: CasinoDeckChoice;
  onClose: () => void;
}

export function DeckPreview({ choice, onClose }: DeckPreviewProps) {
  const variant = DECK_VARIANTS[choice];
  const excl    = new Set(variant.excludeTypes);

  const groupsFor = (want: boolean) => Object.values(CARD_TYPES)
    .filter(t => excl.has(t.key) === want)
    .sort((a, b) => a.order - b.order)
    .map(t => ({ type: t, cards: CARD_DEFS.filter(d => d.type === t.key) }));

  const groups   = groupsFor(false);  // in this deck
  const excluded = groupsFor(true);   // pulled from this deck (empty for Purist)

  return (
    <div className="cz-preview-overlay" onClick={onClose}>
      <div className="cz-preview-panel" onClick={e => e.stopPropagation()}>
        <div className="cz-preview-head">
          <h2>{variant.label} deck</h2>
          <button className="cz-preview-close" onClick={onClose} aria-label="Close preview">✕</button>
        </div>
        <div className="cz-preview-body">
          {groups.map(g => (
            <div key={g.type.key} className="cz-preview-group">
              <div className="cz-preview-group-head">
                <span className="cz-preview-suit">{g.type.suit}</span> {g.type.label}
              </div>
              <div className="cz-preview-grid">
                {g.cards.map(card => (
                  <div key={card.name} className="cz-preview-card">
                    <CardFace card={{ ...card, uid: 0, copyIndex: 0 }} look="plate" width={92} />
                    <span className="cz-preview-count">×{card.copies}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {excluded.length > 0 && (
            <div className="cz-preview-excluded">
              <div className="cz-preview-excluded-head">Not in this deck</div>
              {excluded.map(g => (
                <div key={g.type.key} className="cz-preview-group">
                  <div className="cz-preview-group-head">
                    <span className="cz-preview-suit">{g.type.suit}</span> {g.type.label}
                  </div>
                  <div className="cz-preview-grid">
                    {g.cards.map(card => (
                      <div key={card.name} className="cz-preview-card">
                        <CardFace card={{ ...card, uid: 0, copyIndex: 0 }} look="plate" width={92} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
