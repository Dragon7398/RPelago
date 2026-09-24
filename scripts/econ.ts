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
  buildDeck, CASINO_GAMES, CASINO_GAME_ORDER, DECK_VARIANTS, DECK_VARIANT_ORDER,
  deckSizeFor, seatSpend, type CasinoGame, type DeckCard,
} from '../src/lib/casinoData';
import { computeInitialPot, drawCommunity, potContribution } from '../src/lib/casinoEngine';
import { GAMBIT_DEFS, gambitCasinoGold, type GambitDef } from '../src/lib/casinoGambits';
import { applyDeckBoost, handStake } from '../src/lib/casinoSlots';
import type { CasinoDeckChoice } from '../src/types';

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


// ── CEILING: best-5 by deck variant ──────────────────────────────────────────
// The matrix above assumes a seat picks by TASTE. This one assumes the opposite
// extreme: a "high-end" seat that can play anything and therefore always commits
// the highest-value cards its pool allows. Read it as the THEORETICAL CEILING of
// each game × deck pairing, not as an expected value.
//
// Two deck-variant subtleties the model has to honour, or the ranking lies:
//   1. gpBoost is SIGNED and applied via the live applyDeckBoost (Purist +10%,
//      Safety −10%), so the boost is in every number below.
//   2. Hold 'Em's community is drawn from a FULL PURIST deck regardless of the
//      seat's variant (see drawCommunity), so a narrowed deck still sees the
//      card types it excluded — on the 5 shared cards only.

const VARIANT_DECKS = Object.fromEntries(
  DECK_VARIANT_ORDER.map(k => [k, buildDeck(DECK_VARIANTS[k].excludeTypes)]),
) as Record<CasinoDeckChoice, DeckCard[]>;

const VARIANT_MEAN = Object.fromEntries(
  DECK_VARIANT_ORDER.map(k => [k, VARIANT_DECKS[k].reduce((s, c) => s + c.value, 0) / VARIANT_DECKS[k].length]),
) as Record<CasinoDeckChoice, number>;

const shuffleDeck = (d: readonly DeckCard[]): DeckCard[] => {
  const a = d.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * One optimally-played hand for a seat on this deck variant, returned as the
 * gold its committed cards are worth (deck boost applied, exactly as settlement
 * applies it). `reroll` opts Five Card Draw into optimal reroll play.
 */
function ceilingHand(game: CasinoGame, choice: CasinoDeckChoice, reroll = false): { gold: number; rerolled: boolean } {
  const cfg  = CASINO_GAMES[game];
  const deck = shuffleDeck(VARIANT_DECKS[choice]);
  let pool: DeckCard[];
  let didReroll = false;

  switch (game) {
    case 'five_card_draw': {
      let hand = deck.slice(0, 5);
      if (reroll) {
        // Reroll replaces only the cards you reject, once, at a flat cost. So the
        // rule is per-card: reject anything below the deck's mean card, and only
        // pay if the summed expected gain clears the fee.
        const mean = VARIANT_MEAN[choice];
        const rejects = hand.filter(c => c.value < mean);
        const gain = rejects.reduce((s, c) => s + (mean - c.value), 0);
        if (rejects.length > 0 && gain > cfg.rerollCost) {
          const rejectSet = new Set(rejects.map(c => c.uid));
          let fi = 5;
          hand = hand.map(c => (rejectSet.has(c.uid) ? deck[fi++] : c));
          didReroll = true;
        }
      }
      pool = hand;
      break;
    }
    case 'seven_card_stud': pool = deck.slice(0, 7); break;
    case 'holdem':          pool = [...deck.slice(0, 2), ...drawCommunity()]; break;  // community = full Purist deck
    case 'blackjack':       pool = deck.slice(0, cfg.maxDraw); break;                  // no bust: always draw to the cap
  }

  const top = pool.slice().sort((a, b) => b.value - a.value).slice(0, cfg.pickMax);
  return { gold: applyDeckBoost(handStake(top), choice), rerolled: didReroll };
}

/** Average best-5 hand gold, and net/seat once the table's costs and share land. */
function ceiling(game: CasinoGame, choice: CasinoDeckChoice, R: number, C: number, reroll = false) {
  const seats = 5;
  let handSum = 0, netSum = 0, rrCount = 0;
  const base = spendFor(game);
  // ⚠️ The reroll fee is only paid by the hands that actually TAKE the reroll —
  // charging it every trial understates the line by the fee × decline rate.
  const rrFee = reroll && CASINO_GAMES[game].reroll ? Math.round(CASINO_GAMES[game].rerollCost * ANTE_X) : 0;

  for (let t = 0; t < TRIALS; t++) {
    const r     = ceilingHand(game, choice, reroll);
    const spend = base + (r.rerolled ? rrFee : 0);
    // Other seats are assumed to play the same line, so the pot cut follows suit.
    const pot   = computeInitialPot(seats, R, C) + seats * potContribution(spend);
    handSum += r.gold;
    netSum  += r.gold + Math.floor(pot / seats) - spend;
    if (r.rerolled) rrCount++;
  }
  return { hand: handSum / TRIALS, net: netSum / TRIALS, rerollRate: rrCount / TRIALS };
}

say(`\n${'═'.repeat(78)}\nCEILING — best 5 cards available, by GAME × DECK (5 seats, no gambit)\n${'═'.repeat(78)}`);
say('  A seat that can play ANY game and always commits its highest cards.');
say('  Deck gpBoost is applied (Purist +10% / Safety −10%); antes differ per game.\n');
say('  deck         ' + DECK_VARIANT_ORDER.map(k =>
  `${DECK_VARIANTS[k].label} ${deckSizeFor(k)}c`.padStart(17)).join(''));
say('  avg card     ' + DECK_VARIANT_ORDER.map(k =>
  `${VARIANT_MEAN[k].toFixed(1)}g`.padStart(17)).join(''));
say('  boost        ' + DECK_VARIANT_ORDER.map(k =>
  `${DECK_VARIANTS[k].gpBoost >= 0 ? '+' : ''}${Math.round(DECK_VARIANTS[k].gpBoost * 100)}%`.padStart(17)).join(''));

for (const table of TABLES) {
  say(`\n  ── ${table.name} ──`);
  say('  ' + 'game'.padEnd(13) + DECK_VARIANT_ORDER.map(k => DECK_VARIANTS[k].label.padStart(17)).join('') + '     (hand / net)');
  for (const game of CASINO_GAME_ORDER) {
    const cells = DECK_VARIANT_ORDER.map(k => {
      const r = ceiling(game, k, table.R, table.C);
      return `${Math.round(r.hand)}g / ${g(r.net).trim()}`.padStart(17);
    });
    say(`  ${CASINO_GAMES[game].label.padEnd(13)}${cells.join('')}`);
  }
  // Five Card Draw is the only game with a reroll; optimal reroll play is a
  // different (and strictly better-informed) line, so it is shown separately.
  const rrRes = DECK_VARIANT_ORDER.map(k => ceiling('five_card_draw', k, table.R, table.C, true));
  say(`  ${'  └ FCD+reroll'.padEnd(13)}${rrRes.map(r => `${Math.round(r.hand)}g / ${g(r.net).trim()}`.padStart(17)).join('')}`);
  say(`  ${'    (taken)'.padEnd(13)}${rrRes.map(r => `${Math.round(r.rerollRate * 100)}% of hands`.padStart(17)).join('')}`);
}

// ── the ranking the matrix is for ──
say(`\n${'═'.repeat(78)}\nCEILING RANKING (average table R55/C40, net/seat)\n${'═'.repeat(78)}`);
const combos: { label: string; hand: number; net: number }[] = [];
for (const game of CASINO_GAME_ORDER)
  for (const k of DECK_VARIANT_ORDER) {
    const r = ceiling(game, k, 55, 40);
    combos.push({ label: `${CASINO_GAMES[game].label} · ${DECK_VARIANTS[k].label}`, ...r });
  }
for (const k of DECK_VARIANT_ORDER) {
  const r = ceiling('five_card_draw', k, 55, 40, true);
  combos.push({ label: `Five Card Draw+reroll · ${DECK_VARIANTS[k].label}`, ...r });
}
combos.sort((a, b) => b.net - a.net);

// ── is a deck variant its CARD POOL, or just its gpBoost? ──
// Strip the boost back out and compare raw best-5 value. If the raw row is flat,
// the variants are a pure +10%/-10% decision for a seat that can play anything,
// and excludeTypes is costing that seat nothing in reachable card value.
say(`
${'═'.repeat(78)}
DECK POOL vs gpBOOST — raw best-5 before the boost (average table)
${'═'.repeat(78)}`);
say('  ' + 'game'.padEnd(18) + DECK_VARIANT_ORDER.map(k => DECK_VARIANTS[k].label.padStart(13)).join('') + '   spread');
for (const game of CASINO_GAME_ORDER) {
  const raws = DECK_VARIANT_ORDER.map(k =>
    ceiling(game, k, 55, 40).hand / (1 + DECK_VARIANTS[k].gpBoost));
  const spread = (Math.max(...raws) - Math.min(...raws)) / Math.max(...raws) * 100;
  say(`  ${CASINO_GAMES[game].label.padEnd(18)}${raws.map(v => `${Math.round(v)}g`.padStart(13)).join('')}   ${spread.toFixed(1)}%`);
}

combos.forEach((c, i) => say(`  ${String(i + 1).padStart(2)}. ${c.label.padEnd(38)} hand ${String(Math.round(c.hand)).padStart(4)}g   net ${g(c.net)}`));

console.log(out.join('\n'));
