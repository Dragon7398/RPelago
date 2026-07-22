import { CASINO_GAMES, CASINO_GAME_ORDER, type CasinoGame } from '../../lib/casinoData';

// Costs are read from the engine's cost model rather than retyped, so this page
// can never drift from what the table actually charges.
function costLine(g: CasinoGame): string {
  const c = CASINO_GAMES[g];
  return [
    `${c.ante}g ante`,
    c.reroll ? `${c.rerollCost}g reroll` : '',
    c.playOn ? `${c.playOn}g play-on` : '',
  ].filter(Boolean).join(' · ');
}

const GAME_ICON: Record<CasinoGame, string> = {
  five_card_draw:  '♦',
  seven_card_stud: '♠',
  holdem:          '♥',
  blackjack:       '♣',
};

const GAME_BLURB: Record<CasinoGame, string> = {
  five_card_draw:
    'Dealt 5 cards. Mark any you would rather not play — reroll them once for a fresh draw, ' +
    'or simply leave them out. You commit up to 5, and you may discard as many as you like.',
  seven_card_stud:
    'Dealt 7 cards and no reroll. A bigger pool to choose from, but you commit at most 5, so ' +
    'two cards always go unplayed — and you may drop more than two if you want to.',
  holdem:
    "The only game played across two sittings. Ante for 2 hole cards and lock them in; once " +
    'every seat is dealt in, five shared community cards are revealed to the whole table. ' +
    'Then either pay the play-on and commit up to 5 from the 7 available to you — discarding ' +
    'as many as you like — or fold, which forfeits your ante and leaves the seat empty.',
  blackjack:
    'Push your luck: draw one card at a time, up to 6. The one game where you may discard at ' +
    'most a single card — and at 6 cards you must discard exactly one. Every card you take is ' +
    'a card you will almost certainly have to play.',
};

export default function SectionCasino({ variant = 'map' }: { variant?: 'map' | 'casino' }) {
  const casino = variant === 'casino';

  return (
    <div className="help-section">
      <h3>The Casino</h3>
      <p>
        {casino
          ? 'The floor runs several tables at once, and each table is pinned to a single card game — so choosing a table is choosing the game.'
          : 'Casino tables run alongside the other missions. Each table is pinned to a single card game — so choosing a table is choosing the game.'}{' '}
        They work differently from a standard mission: instead of picking your games and
        submitting a YAML, you sit down, pay an <strong>ante</strong>, and play a hand to
        decide which games you'll bring.
      </p>
      <p>
        Each card represents a game category — a genre, franchise, or platform. The cards you{' '}
        <strong>commit</strong> become your slots, and their gold values set your reward. You
        then fill in the real games and submit your YAML for the slots you won.
      </p>

      <h4>The Games</h4>
      <div className="help-tile-list">
        {CASINO_GAME_ORDER.map(g => (
          <div className="help-tile-row" key={g}>
            <span className="help-tile-icon">{GAME_ICON[g]}</span>
            <div>
              <strong>{CASINO_GAMES[g].label} ({costLine(g)})</strong> — {GAME_BLURB[g]}
            </div>
          </div>
        ))}
      </div>

      <h4>Committing Your Hand</h4>
      <p>
        Whatever you were dealt, you commit <strong>up to 5 cards</strong> — never more. That is a
        ceiling, <em>not</em> a requirement: you may discard as many cards as you want and commit as
        few as <strong>one</strong>. A discarded card is simply gone from your hand — it costs you
        nothing beyond the gold it would have been worth.
      </p>
      <p>
        So a Seven Card Stud hand must lose at least two cards, but you can drop three, four or five
        of them if you'd rather only play the cards you're confident you can fill. The same goes for
        Five Card Draw and Hold 'Em — commit two good cards instead of five awkward ones if that
        suits you.
      </p>
      <p>
        <strong>Blackjack is the exception.</strong> Because you chose to draw each card, you may
        discard <strong>at most one</strong> — and if you push all the way to 6 cards you{' '}
        <em>must</em> discard exactly one. Every card you hit for is a card you're committing to.
      </p>

      <h4>Your Deck</h4>
      <p>
        Before you're dealt in, you choose the <strong>deck</strong> you draw from.{' '}
        <strong>Purist</strong> keeps every card and pays <strong>+10%</strong> on your own
        reward for the flexibility. <strong>Unconsoled</strong> strips every Platform card, and{' '}
        <strong>Indie</strong> strips every Franchise card — no bonus, but no cards you'd
        rather not play.
      </p>

      <h4>Gambits</h4>
      <p>
        After you lock your hand you're offered a <strong>Gambit</strong> — a card that shifts
        the table's shared stats (Release Odds, Collect Odds, Hint Cost) for{' '}
        <em>everyone</em> seated. <strong>Bonus</strong> gambits improve the odds but cost you
        gold; <strong>penalty</strong> gambits worsen them, but pay you gold and feed the pot.
        You can always decline and play no gambit at all.
      </p>

      <h4>The Pot</h4>
      <p>
        40% of every fee — antes, rerolls and play-ons — feeds the table's{' '}
        <strong>shared pot</strong>. When the table settles, every seat that played splits it
        evenly, on top of the gold their own hand earned. A folded seat takes nothing.
      </p>

      <h4>Card Types</h4>
      <p>
        Cards come in five types, ranging from broad categories (easier to fill) to narrow ones
        (harder to fill, but generally worth more gold):
      </p>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🃏</span>
          <div><strong>Wild</strong> — Any game you like. Low value, but always playable.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🎲</span>
          <div><strong>Broad</strong> — A wide genre (e.g. Action RPG, Puzzle). Most common card in the deck.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🖥️</span>
          <div><strong>Platform</strong> — A specific console or family (e.g. SNES, Game Boy).</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>⭐</span>
          <div><strong>Franchise</strong> — A named series (e.g. Zelda, Final Fantasy).</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🎯</span>
          <div><strong>Narrow</strong> — A tight sub-genre (e.g. Metroidvania, Tactical RPG). Highest value, fewest copies in the deck.</div>
        </div>
      </div>

      <div className="help-callout">
        <span className="help-callout-icon">🧥</span>
        <span>
          {casino
            ? <>Successfully complete a table of <strong>all four games</strong> to earn the <strong>Coat of Many Colors</strong> and unlock your name colour.</>
            : <>Casino tables pay best when you can commit <strong>2 or more cards</strong>. If you only play a few specific games, a standard Patrol is likely the safer choice.</>}
        </span>
      </div>
    </div>
  );
}
