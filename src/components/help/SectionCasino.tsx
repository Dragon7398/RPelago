import {
  CASINO_GAMES, CASINO_GAME_ORDER, COAT_TABLE_TYPES, COAT_TYPES_REQUIRED,
  DECK_VARIANTS, DECK_VARIANT_ORDER, deckSizeFor, FINALE_GAME,
  FINALE_ROWS, FINALE_ROW_REELS, FINALE_MAX_REROLL_REELS,
  type CasinoGame,
} from '../../lib/casinoData';
import {
  FINALE_BASE_GOLD, FINALE_GOLD_PER_STAR, FINALE_MIN_GOLD, FINALE_MAX_GOLD,
  FINALE_REBUY_GOLD,
} from '../../lib/finaleStars';
import { findFinale } from '../../lib/missionLogic';
import { useGameState } from '../../contexts/GameStateContext';

// Costs and deck variants are read from the engine rather than retyped, so this
// page can never drift from what the table actually charges or deals. Adding a
// deck variant lands here automatically — do not re-enumerate them in prose.
function costLine(g: CasinoGame): string {
  const c = CASINO_GAMES[g];
  // The finale's ante, reroll and play-on are all 0 — it is free — so the generic
  // line would read "0g ante" and say nothing. Its one charge is the fold rebuy.
  if (g === FINALE_GAME) return `free · ${FINALE_REBUY_GOLD}g rebuy after a fold`;
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
  finale:          '✦',
};

// ⚠️ The list below iterates CASINO_GAME_ORDER — the ROTATION, which deliberately
// excludes the finale — and appends the finale only when the host has actually
// opened it. Do NOT add the finale to that array to get it listed: it drives
// respawn, the per-game series counters and `minCasinoAnte`. The list answers
// *what can I sit down at*, so a permanent entry would advertise a one-off table
// in every season, including seasons where it does not exist.
const GAME_BLURB: Record<CasinoGame, string> = {
  finale:
    'The season closer, run once and free to enter. Pull the arm for a board of 3 rows × 5 ' +
    'reels, respin up to three reels once at no cost, then take ONE row and keep as many of its ' +
    'five cards as you are willing to play. Each card is worth 1–5 stars set by how far the ' +
    'season UNDER-picked it, and you are paid 50g plus 10g a star — so the games nobody chose ' +
    'pay the most, and keeping one means playing it.',
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
  // The finale is described only once it exists. Both HelpModal call sites (the map
  // App and CasinoShell) sit inside GameStateProvider, which is what makes reading
  // the season here safe — the same thing SectionYaml does for feat-raised caps.
  const { gameState } = useGameState();
  const finale = !!findFinale(gameState?.missions, gameState?.missionsHistory);
  const games  = finale ? [...CASINO_GAME_ORDER, FINALE_GAME] : CASINO_GAME_ORDER;

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
        {games.map(g => (
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
        Before you're dealt in, you choose the <strong>deck</strong> you draw from. A narrower
        deck means fewer cards you'd rather not play — but the wider the deck you accept, the
        better it pays. Any bonus or penalty applies to <em>your own hand only</em>: your share
        of the pot and anything a gambit pays you are never affected.
      </p>
      <div className="help-tile-list">
        {DECK_VARIANT_ORDER.map(key => (
          <div className="help-tile-row" key={key}>
            <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🂠</span>
            <div>
              <strong>{DECK_VARIANTS[key].label}</strong> — {DECK_VARIANTS[key].blurb}{' '}
              <em>{deckSizeFor(key)} of {deckSizeFor('purist')} cards.</em>
            </div>
          </div>
        ))}
      </div>

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

      {finale && (
        <>
          <h4>The Finale</h4>
          <p>
            The season's closing table, and it plays like nothing else on the floor. It is{' '}
            <strong>free</strong>, you may play it <strong>once</strong>, and it{' '}
            <strong>costs you no claim</strong> — so you can enter it however many other tables
            you are already holding, and a restricted account can enter too.
          </p>
          <p>
            It is <strong>time-limited rather than seat-limited</strong>: there is no cap on how
            many players sit down, and nothing decays. Instead entry closes at a deadline. The
            table does <em>not</em> start then — everyone who already pulled the arm still gets
            to finish choosing their row and attaching their config, however long that takes.
            The room is generated once the last of them has locked in.
          </p>
          <p>
            Pull the arm for a board of <strong>{FINALE_ROWS} rows × {FINALE_ROW_REELS} reels</strong>.
            You may respin up to <strong>{FINALE_MAX_REROLL_REELS} reels</strong> once, free. Then
            take <strong>one row</strong> and keep as many of its {FINALE_ROW_REELS} cards as you are
            willing to play — keeping a card means playing it, and you must keep at least one. If
            nothing on the board is worth it you can <strong>fold</strong>, but a fresh board then
            costs <strong>{FINALE_REBUY_GOLD}g</strong>.
          </p>
          <div className="help-callout">
            <span className="help-callout-icon">✦</span>
            <span>
              <strong>Card values run backwards here.</strong> Every card is worth{' '}
              <strong>1–5 ★</strong> set <em>inverse</em> to how often this season actually picked
              it: the games the floor passed over all season are the ones worth the most, and the
              crowd favourites are worth the least. You are paid{' '}
              <strong>{FINALE_BASE_GOLD}g</strong> for sitting down plus{' '}
              <strong>{FINALE_GOLD_PER_STAR}g a ★</strong> across the cards you keep — so{' '}
              {FINALE_MIN_GOLD}g for a single 1★ card up to {FINALE_MAX_GOLD}g for a full row of
              5★, before your deck's boost. There is no pot and no gambit.
            </span>
          </div>
          <p>
            The star values are <strong>frozen when the host opens the table</strong> and never
            recomputed, so they do not drift while the finale is being played.
          </p>
        </>
      )}

      <div className="help-callout">
        <span className="help-callout-icon">🧥</span>
        <span>
          {casino
            ? <>Successfully complete a table of <strong>any {COAT_TYPES_REQUIRED} of the {COAT_TABLE_TYPES.length} table types</strong> — the four games, or three of them plus the season finale — to earn the <strong>Coat of Many Colors</strong> and unlock your name colour.</>
            : <>Casino tables pay best when you can commit <strong>2 or more cards</strong>. If you only play a few specific games, a standard Patrol is likely the safer choice.</>}
        </span>
      </div>
    </div>
  );
}
