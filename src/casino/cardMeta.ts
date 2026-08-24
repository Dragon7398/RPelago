// Per-card-type rendering metadata (mirrors CARD_TYPES in casinoData.ts).
//
// Its own module rather than a corner of CardFace.tsx because things that tint by
// card type without drawing a card face — the host-view chips in the seat rail —
// need the same hues, and importing them from a component file breaks fast refresh.
import type { CardTypeKey } from '../lib/casinoData';

export const TYPE_META: Record<CardTypeKey, { label: string; suit: string; hue: number }> = {
  wild:      { label: 'Wild',      suit: '✦', hue: 75  },
  broad:     { label: 'Broad',     suit: '♦', hue: 200 },
  platform:  { label: 'Platform',  suit: '♠', hue: 295 },
  franchise: { label: 'Franchise', suit: '♥', hue: 30  },
  narrow:    { label: 'Narrow',    suit: '♣', hue: 150 },
};

// The hue behind a card type. The --acc-* theme tokens carry the same idea, but
// they are tuned to sit on a card's dark stock; anything drawing on a panel needs
// the raw hue so it can pick its own lightness (see --stat-l in play.css).
export function cardTypeHue(type: CardTypeKey): number {
  return TYPE_META[type].hue;
}
