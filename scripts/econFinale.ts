/**
 * The finale's money-in, modelled off the live engine.
 *
 * `npm run econ` deliberately cannot cover this. That script iterates
 * CASINO_GAME_ORDER — the ROTATION, which the finale is kept out of — and its
 * whole model is ante-in / pot-out. The finale antes nothing, has no pot, and
 * pays a closed form off stars, so it is outside that model in every term. What
 * it injects is therefore **pure money-in with nothing against it**, and the
 * figure the season needs is simply `seats × expected payout`.
 *
 * Run: npx vite-node scripts/econFinale.ts
 *
 * The strategy modelled is a player acting in their own interest under the ONE
 * constraint that makes this game different: every card you keep is a game you
 * have to play. So the model reports a row per keep-count rather than a single
 * number — the host's exposure is bounded by how much Archipelago the floor is
 * willing to sign up for, not by anything in the code.
 */
import {
  DECK_VARIANTS, DECK_VARIANT_ORDER, buildDeck, shuffle,
  applyReelRespin, finaleRowIndices,
  FINALE_BOARD_CARDS, FINALE_ROWS, FINALE_ROW_REELS, FINALE_MAX_REROLL_REELS,
  type DeckCard, type CasinoDeckChoice,
} from '../src/lib/casinoData';
import { makeDrawableDeck } from '../src/lib/casinoEngine';
import {
  finaleStarTiers, finaleOwnGold, FINALE_REBUY_GOLD,
  FINALE_MIN_GOLD, FINALE_MAX_GOLD,
} from '../src/lib/finaleStars';

const TRIALS = 40_000;

// The star snapshot the host would freeze. With no mission corpus every card is
// ranked on presence alone — which is exactly the shape of a real snapshot, and
// the tier SIZES (8/7/7/7/8) are fixed regardless of how the season actually
// went, so the distribution of stars across the deck does not depend on it.
const stars = finaleStarTiers([]);
const starOf = (c: DeckCard) => stars[c.name] ?? 0;

/** The best `keep` cards of a row, by stars — what a player maximising gold takes. */
function bestOfRow(board: DeckCard[], row: 1 | 2 | 3, keep: number): number {
  return finaleRowIndices(row)
    .map(i => starOf(board[i]))
    .sort((a, b) => b - a)
    .slice(0, keep)
    .reduce((a, b) => a + b, 0);
}

/**
 * One sitting. The player respins the three weakest REELS (a reel is a column,
 * so each respin moves all three rows), then takes the row with the most stars
 * among the cards they intend to keep.
 */
function playOne(choice: CasinoDeckChoice, keep: number): number {
  const drawable = makeDrawableDeck(shuffle(buildDeck(DECK_VARIANTS[choice].excludeTypes)));
  let board = drawable.draw(FINALE_BOARD_CARDS);

  // Reel strength = the stars standing in that column across all three rows.
  const reelStars = (b: DeckCard[], reel: number) =>
    Array.from({ length: FINALE_ROWS }, (_, r) => starOf(b[r * FINALE_ROW_REELS + reel]))
      .reduce((a, x) => a + x, 0);
  const worst = Array.from({ length: FINALE_ROW_REELS }, (_, i) => i)
    .sort((a, b) => reelStars(board, a) - reelStars(board, b))
    .slice(0, FINALE_MAX_REROLL_REELS)
    .sort((a, b) => a - b);
  board = applyReelRespin(board, worst, drawable.draw(worst.length * FINALE_ROWS));

  const best = Math.max(...([1, 2, 3] as const).map(r => bestOfRow(board, r, keep)));
  return finaleOwnGold(best, choice);
}

function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('THE FINALE — expected payout per seat   (no ante, no pot: all money-in)');
console.log(`  ${TRIALS.toLocaleString()} sittings per cell · best of 3 rows · 3 weakest reels respun`);
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');
console.log('  cards kept' + DECK_VARIANT_ORDER.map(v => v.padStart(13)).join(''));

const table: Record<number, Record<string, number>> = {};
for (let keep = 1; keep <= FINALE_ROW_REELS; keep++) {
  table[keep] = {};
  const cells = DECK_VARIANT_ORDER.map(v => {
    const avg = mean(Array.from({ length: TRIALS }, () => playOne(v, keep)));
    table[keep][v] = avg;
    return `${Math.round(avg)}g`.padStart(13);
  });
  console.log(`  ${String(keep).padStart(10)}${cells.join('')}`);
}

console.log('');
console.log(`  (the advertised range is ${FINALE_MIN_GOLD}–${FINALE_MAX_GOLD}g before the deck boost)`);
console.log('');

// ── What the season is actually exposed to ───────────────────────────────────
//
// Entry is free and universal, so "seats" is however many players turn up — not
// a rolled seat count. The three figures below bracket it.
const best  = (keep: number) => Math.max(...DECK_VARIANT_ORDER.map(v => table[keep][v]));
const avgAll = (keep: number) => mean(DECK_VARIANT_ORDER.map(v => table[keep][v]));

console.log('══════════════════════════════════════════════════════════════════════');
console.log('SEASON MONEY-IN  =  seats × expected payout');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');
console.log('  seats     conservative      likely         ceiling');
console.log('            (keep 1, avg)   (keep 3, avg)  (keep 5, best deck)');
for (const seats of [10, 15, 20, 25, 30]) {
  const lo = Math.round(seats * avgAll(1));
  const mid = Math.round(seats * avgAll(3));
  const hi = Math.round(seats * best(5));
  console.log(`  ${String(seats).padStart(5)}  ${(lo + 'g').padStart(14)}  ${(mid + 'g').padStart(14)}  ${(hi + 'g').padStart(14)}`);
}
console.log('');
console.log(`  Rebuys claw back ${FINALE_REBUY_GOLD}g a fold and are the ONLY money-out. They are`);
console.log('  deliberately not modelled: a fold is a judgement call, not a rate, and');
console.log('  assuming any fold rate would understate the exposure above.');
console.log('');
