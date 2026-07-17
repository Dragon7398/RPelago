/**
 * Casino economy model — `npm run econ`
 *
 * Simulates whole tables against the LIVE engine values (casinoData /
 * casinoEngine / casinoGambits), so it can never drift from what the game
 * actually charges and pays. Re-run it after any tuning change.
 *
 * What it answers: does a seat profit, and by how much, across table quality,
 * cards committed, gambit choice, and season shell?
 *
 * Season shells differ in ONE economic way: a penalty gambit's xp is converted
 * to gold (xp x CASINO_GAMBIT_XP_TO_GP) only in a CASINO season. In a map
 * season that xp stays xp, so penalties pay the pot but no personal gold.
 *
 * KNOWN BLIND SPOT — the model assumes every card is equally playable, so a
 * seat always draws/keeps for maximum gold. Real players have games they won't
 * or can't play, which is precisely the risk Blackjack's push-your-luck is built
 * on: draw a card you can't use and you either stop early or flex into a game
 * you'd rather not. Blackjack's numbers here are therefore an UPPER bound; read
 * them as "if you can genuinely play anything", not as its true expected value.
 *
 * Knobs (env):
 *   ECON_ANTE_X=1.5   scale every entry cost (ante/reroll/play-on) — e.g. 1.5
 *                     models tripling the S1 base while the code sits at double.
 */
import {
  buildDeck, CASINO_GAMES, CASINO_GAME_ORDER, DECK_VARIANTS, seatSpend,
  type CasinoGame, type DeckCard,
} from '../src/lib/casinoData';
import { computeInitialPot, drawCommunity, potContribution } from '../src/lib/casinoEngine';
import { GAMBIT_DEFS, gambitCasinoGold, type GambitDef } from '../src/lib/casinoGambits';

const TRIALS = 20000;
const BOOST  = 1 + DECK_VARIANTS.purist.gpBoost;   // model the Purist seat (+10%)
const ANTE_X = Number(process.env.ECON_ANTE_X ?? 1);

/** What a seat pays to play, with the ECON_ANTE_X what-if applied. */
const spendFor = (game: CasinoGame): number =>
  Math.round(seatSpend(game, { playedOn: CASINO_GAMES[game].playOn > 0 }) * ANTE_X);

type Season = 'casino' | 'map';
type Pick   = 'best' | 'average';

const DECK    = buildDeck();
const AVG_CARD = DECK.reduce((s, c) => s + c.value, 0) / DECK.length;

const shuffled = () => {
  const a = DECK.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** The pool of cards a seat can commit from, per game. */
function pool(game: CasinoGame): DeckCard[] {
  switch (game) {
    case 'five_card_draw':  return shuffled().slice(0, 5);
    case 'seven_card_stud': return shuffled().slice(0, 7);
    case 'holdem':          return [...shuffled().slice(0, 2), ...drawCommunity()];
    case 'blackjack':       return shuffled().slice(0, 6);   // pushed to the cap
  }
}

/** Gold a seat's committed cards are worth. `average` = they pick by taste, not value. */
function reward(game: CasinoGame, n: number, pick: Pick): number {
  const cap = Math.min(n, CASINO_GAMES[game].pickMax);
  if (pick === 'average') return Math.round(cap * AVG_CARD * BOOST);
  const p = pool(game).map(c => c.value).sort((a, b) => b - a);
  return Math.round(p.slice(0, cap).reduce((s, v) => s + v, 0) * BOOST);
}

const gambitBy = (stat: string, delta: number): GambitDef =>
  GAMBIT_DEFS.find(g => g.stat === stat && g.delta === delta)!;

const GAMBITS: Record<string, GambitDef | null> = {
  'no gambit':      null,
  'small penalty':  gambitBy('release', -3),
  'large penalty':  gambitBy('release', -7),
  'medium bonus':   gambitBy('release',  5),
  'large bonus':    gambitBy('release',  7),
};

interface TableOpts {
  season: Season; game: CasinoGame; seats: number;
  R: number; C: number; n: number; gambit: GambitDef | null; pick: Pick;
}

/** One whole table; returns the average net gold for a seat at it. */
function simulate(o: TableOpts): { net: number; pot: number; injected: number } {
  let netSum = 0, potSum = 0, injSum = 0;

  for (let t = 0; t < TRIALS; t++) {
    const pot0 = computeInitialPot(o.seats, o.R, o.C);
    let pot = pot0;
    let houseIn = 0, houseOut = pot0;

    // every seat pays in and plays the same way (a uniform table)
    const spendEach = spendFor(o.game);
    for (let s = 0; s < o.seats; s++) {
      pot += potContribution(spendEach);
      houseIn += spendEach;
      if (o.gambit) {
        if (o.gambit.goldCost > 0) houseIn += o.gambit.goldCost;      // bonus: seat pays
        if (o.gambit.pot > 0) { pot += o.gambit.pot; houseOut += o.gambit.pot; }
        if (o.season === 'casino') houseOut += gambitCasinoGold(o.gambit);
      }
    }

    const share = Math.floor(pot / o.seats);
    const rew   = reward(o.game, o.n, o.pick);
    houseOut += rew * o.seats;

    const gambitCost = o.gambit?.goldCost ?? 0;
    const gambitPay  = o.gambit && o.season === 'casino' ? gambitCasinoGold(o.gambit) : 0;

    netSum += rew + share - spendEach - gambitCost + gambitPay;
    potSum += pot;
    injSum += houseOut - houseIn;
  }
  return { net: netSum / TRIALS, pot: potSum / TRIALS, injected: injSum / TRIALS };
}

// ── report ───────────────────────────────────────────────────────────────────
const g = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}`.padStart(6);
const out: string[] = [];
const say = (s = '') => out.push(s);

const TABLES = [
  { name: 'CHEAP  (easy odds R70/C50)',  R: 70, C: 50 },
  { name: 'AVERAGE (R55/C40)',           R: 55, C: 40 },
  { name: 'VALUABLE (hard odds R40/C25)', R: 40, C: 25 },
];

say('RPelago Casino — economy model');
say(`deck ${DECK.length} cards · avg card ${AVG_CARD.toFixed(1)}g · Purist +${DECK_VARIANTS.purist.gpBoost * 100}% · ${TRIALS} tables/cell`);
say(`antes: ${CASINO_GAME_ORDER.map(x => `${CASINO_GAMES[x].label.split(' ')[0]} ${spendFor(x)}g`).join(' · ')}${ANTE_X !== 1 ? `   [ECON_ANTE_X=${ANTE_X}]` : ''}`);

for (const table of TABLES) {
  const pot = computeInitialPot(5, table.R, table.C);
  say(`\n${'═'.repeat(78)}\n${table.name} — pot at creation ≈ ${pot}g (5 seats)\n${'═'.repeat(78)}`);
  for (const season of ['casino', 'map'] as Season[]) {
    say(`\n  ${season === 'casino' ? 'CASINO season (penalty gambits pay gold)' : 'MAP season (penalty gambits pay XP, not gold)'}`);
    say('  net/seat, 5 seats, cards picked by TASTE (average value)');
    say('  ' + 'gambit'.padEnd(16) + CASINO_GAME_ORDER.map(x => CASINO_GAMES[x].label.split(' ')[0].padStart(8)).join('') + '   (n=2 / n=5)');
    for (const [label, gambit] of Object.entries(GAMBITS)) {
      for (const n of [2, 5]) {
        const cells = CASINO_GAME_ORDER.map(game =>
          g(simulate({ season, game, seats: 5, R: table.R, C: table.C, n, gambit, pick: 'average' }).net).padStart(8));
        say(`  ${(n === 2 ? label : '').padEnd(16)}${cells.join('')}   n=${n}`);
      }
    }
  }
}

// ── how the levers compare, on an average table ──
say(`\n${'═'.repeat(78)}\nLEVER SIZES (average table, Five Card Draw, 5 seats, casino season)\n${'═'.repeat(78)}`);
const base = (n: number, gambit: GambitDef | null, pick: Pick = 'average') =>
  simulate({ season: 'casino', game: 'five_card_draw', seats: 5, R: 55, C: 40, n, gambit, pick }).net;
say(`  cards 2 → 5 (taste):        ${g(base(2, null))} → ${g(base(5, null))}   (+${Math.round(base(5, null) - base(2, null))}g for 3 more games)`);
say(`  cards 2 → 5 (best-of-hand): ${g(base(2, null, 'best'))} → ${g(base(5, null, 'best'))}`);
say(`  no gambit → large penalty:  ${g(base(3, null))} → ${g(base(3, GAMBITS['large penalty']))}   (+${Math.round(base(3, GAMBITS['large penalty']) - base(3, null))}g)`);
say(`  no gambit → large bonus:    ${g(base(3, null))} → ${g(base(3, GAMBITS['large bonus']))}   (${Math.round(base(3, GAMBITS['large bonus']) - base(3, null))}g)`);
say(`  cheap → valuable table:     ${g(simulate({ season: 'casino', game: 'five_card_draw', seats: 5, R: 70, C: 50, n: 3, gambit: null, pick: 'average' }).net)} → ${g(simulate({ season: 'casino', game: 'five_card_draw', seats: 5, R: 40, C: 25, n: 3, gambit: null, pick: 'average' }).net)}`);

// ── table size + house flow ──
say(`\n${'═'.repeat(78)}\nSEAT COUNT & HOUSE FLOW (average table, FCD, 3 cards, no gambit, casino)\n${'═'.repeat(78)}`);
for (const seats of [5, 6, 7, 8]) {
  const r = simulate({ season: 'casino', game: 'five_card_draw', seats, R: 55, C: 40, n: 3, gambit: null, pick: 'average' });
  say(`  ${seats} seats: net/seat ${g(r.net)}   pot ${String(Math.round(r.pot)).padStart(4)}g   house injects ${String(Math.round(r.injected)).padStart(5)}g/table`);
}

console.log(out.join('\n'));
