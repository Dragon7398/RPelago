import { type GambitDef, gambitCasinoGold } from '../lib/casinoGambits';

const SIZE_LABELS: Record<GambitDef['size'], string> = {
  small:  'Minor',
  medium: 'Bold',
  large:  'Grand',
};

// The casino table is always a casino season, so a penalty's inert XP is shown
// as the gold it converts to (xp × CASINO_GAMBIT_XP_TO_GP), not as XP.
function effectText(card: GambitDef): string {
  if (card.kind === 'bonus') {
    return card.goldCost ? `−${card.goldCost} gold` : 'No cost';
  }
  const bits: string[] = [];
  const gold = gambitCasinoGold(card);
  if (gold)     bits.push(`+${gold} gold`);
  if (card.pot) bits.push(`+${card.pot} pot`);
  return bits.join(' · ') || '—';
}

interface GambitCardFaceProps {
  card: GambitDef;
  width: number;
  className?: string;
  style?: React.CSSProperties;
}

export function GambitCardFace({ card, width, className, style }: GambitCardFaceProps) {
  const fallbackAcc = card.kind === 'bonus' ? 'oklch(72% 0.16 150)' : 'oklch(70% 0.17 30)';
  const statHue     = card.kind === 'bonus' ? 150 : 28;
  const vars = {
    '--cw':       `${width}px`,
    // gambit-bonus / gambit-raise stay LIGHT in every theme — gambit faces are always dark
    '--acc':      card.kind === 'bonus'
      ? `var(--gambit-bonus, ${fallbackAcc})`
      : `var(--gambit-raise, ${fallbackAcc})`,
    '--stat-hue': String(statHue),
  } as React.CSSProperties;
  const arrow = card.delta > 0 ? '▲' : '▼';

  return (
    <div
      className={`ck ck-noise gambit${className ? ` ${className}` : ''}`}
      style={{ ...vars, ...style }}
    >
      <div className="gm-frame" />
      <span className="gm-corner tl">✦</span>
      <span className="gm-corner br">✦</span>
      <span className="gm-size">{SIZE_LABELS[card.size]}</span>
      <div className="gm-inner">
        <div className="gm-ribbon">{card.statFull}</div>
        <div className="gm-hero">
          <span className="gm-arrow">{arrow}</span>
          <span className="gm-delta">{card.deltaLabel}</span>
        </div>
        <div className="gm-kind">{card.kind === 'bonus' ? 'Bonus' : 'Raises the stakes'}</div>
        <div className="gm-effect">{effectText(card)}</div>
      </div>
    </div>
  );
}
