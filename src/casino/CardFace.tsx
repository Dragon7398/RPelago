import type { DeckCard, CardTypeKey } from '../lib/casinoData';

// Per-type rendering metadata (mirrors CARD_TYPES in casinoData.ts)
const TYPE_META: Record<CardTypeKey, { label: string; suit: string; hue: number }> = {
  wild:      { label: 'Wild',      suit: '✦', hue: 75  },
  broad:     { label: 'Broad',     suit: '♦', hue: 200 },
  platform:  { label: 'Platform',  suit: '♠', hue: 295 },
  franchise: { label: 'Franchise', suit: '♥', hue: 30  },
  narrow:    { label: 'Narrow',    suit: '♣', hue: 150 },
};

function typeAccent(type: CardTypeKey): string {
  return `oklch(66% 0.145 ${TYPE_META[type].hue})`;
}

function cardVars(card: DeckCard, width: number): React.CSSProperties {
  const t = TYPE_META[card.type];
  return {
    '--cw':  `${width}px`,
    // Theme token first; JS fallback keeps the original look when no theme is active.
    '--acc': `var(--acc-${card.type}, ${typeAccent(card.type)})`,
    '--hue': t.hue,
  } as React.CSSProperties;
}

// ── Look renders ──────────────────────────────────────────────────────────────

function LookSigil({ card }: { card: DeckCard }) {
  const t = TYPE_META[card.type];
  return (
    <>
      <span className="sg-corner sg-tl">✦</span>
      <span className="sg-corner sg-br">✦</span>
      <div className="sg-watermark">{t.suit}</div>
      <div className="sg-top">
        <span className="sg-type">{t.label}</span>
        <span className="sg-suit-sm">{t.suit}</span>
      </div>
      <div className="sg-body">
        <div className="sg-name">{card.name}</div>
        {card.blurb && <div className="sg-blurb">{card.blurb}</div>}
      </div>
      <div className="sg-foot">
        <span className="ck-coin">{card.value}<small>g</small></span>
      </div>
    </>
  );
}

function LookCourt({ card }: { card: DeckCard }) {
  const t = TYPE_META[card.type];
  const corner = <><span className="crt-rank">{card.value}</span><span className="crt-suit">{t.suit}</span></>;
  return (
    <>
      <div className="crt-corner crt-tl">{corner}</div>
      <div className="crt-corner crt-br">{corner}</div>
      <div className="crt-center">
        <div className="crt-bigsuit">{t.suit}</div>
        <div className="crt-banner">
          <div className="crt-name">{card.name}</div>
          <div className="crt-type">{t.label}</div>
        </div>
      </div>
    </>
  );
}

function LookArcana({ card }: { card: DeckCard }) {
  const t = TYPE_META[card.type];
  return (
    <>
      <div className="arc-frame" />
      <span className="arc-fil tl">❧</span><span className="arc-fil tr">❧</span>
      <span className="arc-fil bl">❧</span><span className="arc-fil br">❧</span>
      <div className="arc-inner">
        <div className="arc-numeral">{card.value} GOLD</div>
        <div className="arc-emblem"><span className="arc-suit">{t.suit}</span></div>
        <div className="arc-foot">
          <div className="arc-name">{card.name}</div>
          <div className="arc-type">{card.blurb ?? `the ${t.label.toLowerCase()} arcana`}</div>
        </div>
      </div>
    </>
  );
}

function LookFoil({ card }: { card: DeckCard }) {
  const t = TYPE_META[card.type];
  return (
    <>
      <div className="fl-top">
        <span className="fl-tag"><span className="fl-suit">{t.suit}</span>{t.label}</span>
      </div>
      <div className="fl-hero">
        <div className="fl-line" />
        <div className="fl-value">{card.value}</div>
        <div className="fl-gold">GOLD</div>
      </div>
      <div className="fl-name">{card.name}</div>
    </>
  );
}

function LookPlate({ card }: { card: DeckCard }) {
  const t = TYPE_META[card.type];
  return (
    <>
      <div className="pl-guilloche" />
      <div className="pl-frame" />
      <span className="pl-corner tl">❧</span><span className="pl-corner tr">❧</span>
      <span className="pl-corner bl">❧</span><span className="pl-corner br">❧</span>
      <div className="pl-inner">
        <div className="pl-ribbon">{t.label}</div>
        <div className="pl-seal"><span className="pl-suit">{t.suit}</span></div>
        <div className="pl-titleblock">
          <div className="pl-name">{card.name}</div>
          {card.blurb && <div className="pl-note">{card.blurb}</div>}
          <div className="pl-rule" />
          <div className="pl-value">
            <span className="pl-coin" />
            <span className="pl-num">{card.value}</span>
          </div>
        </div>
      </div>
    </>
  );
}

type Look = 'sigil' | 'court' | 'arcana' | 'foil' | 'plate';

const LOOK_COMPONENTS: Record<Look, (props: { card: DeckCard }) => React.ReactElement> = {
  sigil:  LookSigil,
  court:  LookCourt,
  arcana: LookArcana,
  foil:   LookFoil,
  plate:  LookPlate,
};

const LOOK_CSS: Record<Look, string> = {
  sigil:  'look-sigil',
  court:  'look-court',
  arcana: 'look-arcana',
  foil:   'look-foil',
  plate:  'look-plate',
};

// ── Public components ─────────────────────────────────────────────────────────

interface CardFaceProps {
  card: DeckCard;
  look?: Look;
  width: number;
  className?: string;
  style?: React.CSSProperties;
}

export function CardFace({ card, look = 'plate', width, className, style }: CardFaceProps) {
  const Comp = LOOK_COMPONENTS[look] ?? LookSigil;
  return (
    <div
      className={`ck ck-noise ${LOOK_CSS[look] ?? 'look-sigil'}${className ? ` ${className}` : ''}`}
      style={{ ...cardVars(card, width), ...style }}
    >
      <Comp card={card} />
    </div>
  );
}

interface CardBackProps {
  width: number;
  variant?: 'lattice' | 'medallion';
  className?: string;
  style?: React.CSSProperties;
}

export function CardBack({ width, variant = 'lattice', className, style }: CardBackProps) {
  return (
    <div
      className={`ck ck-back ${variant === 'medallion' ? 'back-medallion' : 'back-lattice'}${className ? ` ${className}` : ''}`}
      style={{ '--cw': `${width}px`, ...style } as React.CSSProperties}
    >
      <div className="ck-back-mark">
        <span className="ck-back-star">✦</span>
        {variant !== 'medallion' && <span className="ck-back-word">RPELAGO</span>}
      </div>
    </div>
  );
}
