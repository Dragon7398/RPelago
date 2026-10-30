// The Finale's star tiers — see docs/casino-finale-slots-plan.md §3 and
// docs/casino-finale-slots-impl.md WS-A.
//
// A finale card is worth 1–5 stars, set by INVERSE weighted popularity: a card
// scores high when the season picked it LESS often than its share of the pooled
// baseline deck predicts. The whole mechanic exists to reward playing the games the
// season passed over, which is why the scale runs backwards from what a naive
// "most popular card" reading would give.
//
// The measurement itself is `cardStats.ts` (`cardPopularity` / `baselineDeckWeights`,
// pooling one Purist + Unconsoled + Indie deck). This module only RANKS and CUTS
// that report into tiers, and prices them.

import { CARD_DEFS, FINALE_GAME, isFinale, type CardDef, type CardTypeKey } from './casinoData';
import { applyDeckBoost } from './casinoSlots';
import { BASELINE_VARIANTS, cardPopularity, type CardPopularityRow } from './cardStats';
import type { CasinoDeckChoice, FinaleStars, GMMission } from '../types';

export type { FinaleStars };

// `FINALE_GAME` and `isFinale` live in casinoData (beside the game defs and the
// board geometry); re-exported here so a caller working with stars has them to hand.
export { FINALE_GAME, isFinale };

/** Wild is PINNED to the floor, never ranked — see `rankableDefs` below. */
export const WILD_STARS: FinaleStars = 1;

// ── Payout ───────────────────────────────────────────────────────────────────
// gold = (50 + 10 × Σ stars) × deck boost. Range 60–300 before the boost, so
// 330 on Purist and 270 on Safety.
//
// ⚠️ **These two functions and their constants must be MIRRORED in
// `functions/src/casinoEngine.ts`** when WS-E lands, alongside `applyDeckBoost`
// which already is. The server writes `goldSwing` at four separate sites
// (`lockFinaleResult`, `claimMissionSlot`, `resubmitCasinoYaml`,
// `adminRemoveCasinoSlot` — see impl §0.5) and that stored number is what
// settlement pays; it is never re-derived from the slots. So a drift between the
// two copies is not a display bug, it is the wrong amount of gold.

export const FINALE_BASE_GOLD = 50;
export const FINALE_GOLD_PER_STAR = 10;

/**
 * What a fresh board costs after a fold. The first board is free.
 *
 * ⚠️ **This figure is anti-abuse, not revenue.** A hand tops out at 330g, so with a
 * free respin a player would simply fold until a 250g+ board appeared. The 50g is
 * the drag that makes folding a judgement call instead of a loop — which is also
 * why the money goes to the HOUSE and is never routed through `potContribution`
 * (D5). Recycling it back to the players restores the exploit.
 */
export const FINALE_REBUY_GOLD = 50;

/** What this player owes for their next board: free the first time, then the rebuy. */
export function finaleBoardCost(play: { folds?: number } | undefined): number {
  return (play?.folds ?? 0) > 0 ? FINALE_REBUY_GOLD : 0;
}

/**
 * What a seat's OWN hand pays: the sitting-down base plus its stars, then the
 * deck boost. The base is the fee for spinning, rerolling and choosing a row.
 */
export function finaleOwnGold(stars: number, choice: CasinoDeckChoice): number {
  return applyDeckBoost(FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR * stars, choice);
}

/**
 * What a CLAIMED card pays its claimant — stars only (plan §4a).
 *
 * No base: the claimant never sat down, spun or chose a row. No deck boost: the
 * existing rule is that a claimed card pays flat because the claimant never chose
 * the deck. So a 5★ card is worth 50g to whoever finishes it, which is exactly
 * what the player who abandoned it forfeits.
 */
export function finaleClaimedGold(stars: number): number {
  return FINALE_GOLD_PER_STAR * stars;
}

// ── Tier sizes ────────────────────────────────────────────────────────────────

/**
 * Which tier takes each leftover card when the rankable count is not a multiple
 * of five — indices into the 5★→1★ array, so the ENDS fill first.
 *
 * The extremes are what the mechanic is actually about (the 5★ cards nobody
 * played, the 1★ cards everybody did), so they are the generous tiers and the
 * middle stays tight. With the real deck this yields `[8, 7, 7, 7, 7]` over the 36
 * rankable cards, i.e. the plan's **8/7/7/7/8** once Wild joins the 1★ tier.
 */
const REMAINDER_ORDER: readonly number[] = [0, 4, 1, 3, 2];

/** Tier sizes for `n` rankable cards, ordered 5★ → 1★. Sums to `n` exactly. */
export function starTierSizes(n: number): number[] {
  const base  = Math.floor(Math.max(0, n) / 5);
  const sizes = [base, base, base, base, base];
  let rest = Math.max(0, n) - base * 5;
  for (const i of REMAINDER_ORDER) {
    if (rest <= 0) break;
    sizes[i]++;
    rest--;
  }
  return sizes;
}

// ── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Least-picked FIRST, so the head of the sort is the 5★ end.
 *
 * ⚠️ **The tiebreak is load-bearing, not tidiness.** Every card the season never
 * committed scores `index === 0`, so the 5★/4★ boundary lands INSIDE a tie — and
 * which side a card falls on is worth 10g to everyone who keeps it. `cardPopularity`
 * breaks its own ties on `observed` descending, which says nothing at zero.
 *
 * So: ascending `index`, then **`availability` descending** — between two cards
 * nobody picked, the one the deck offered more often was more conspicuously passed
 * over, which is the same judgement the index itself makes — then `name` ascending
 * so the result is reproducible from the data alone.
 */
export function compareForStars(a: CardPopularityRow, b: CardPopularityRow): number {
  // A null index means the baseline holds no copy of this card, so its rate is
  // not computable. It sorts LAST (into the over-picked tier) rather than being
  // handed 5★ for a number nobody can check. Unreachable with the real CARD_DEFS
  // — every card sits in at least one baseline deck — but callers may pass their own.
  if (a.index == null || b.index == null) {
    if (a.index != null) return -1;
    if (b.index != null) return 1;
  } else if (a.index !== b.index) {
    return a.index - b.index;
  }
  if (a.availability !== b.availability) return b.availability - a.availability;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The cards that get ranked: everything except Wild, which is pinned (D7). */
function rankableDefs(defs: readonly CardDef[]): Set<string> {
  return new Set(defs.filter(d => d.type !== 'wild').map(d => d.name));
}

export interface FinaleStarRow {
  name:         string;
  type:         CardTypeKey;
  stars:        FinaleStars;
  /** observedShare / availabilityShare — see `cardStats`. Null when unmeasurable. */
  index:        number | null;
  observed:     number;
  availability: number;
  /** True for Wild: pinned to the floor rather than placed by the ranking. */
  pinned:       boolean;
}

/**
 * Missions the baseline is measured over.
 *
 * ⚠️ **The finale is excluded from its own baseline.** Its hands are casino seats
 * like any other, so counting them would let the finale shift the tiers as it is
 * played — and a player's payout could move between their spin and settlement
 * (plan §3). The tiers are frozen onto the mission at creation and read from there
 * (D6), and excluding the finale here makes this function give the same answer
 * whenever it is called, which is what lets the admin panel keep printing a stable
 * table after the table opens.
 */
export function baselineMissions(missions: readonly GMMission[]): GMMission[] {
  return missions.filter(m => !isFinale(m));
}

/**
 * The full ranked table, 5★ first — the audit trail for "why was Sonic worth five".
 * Wild is appended at the floor.
 */
export function finaleStarRanking(
  missions: readonly GMMission[],
  variants: readonly CasinoDeckChoice[] = BASELINE_VARIANTS,
  defs: readonly CardDef[] = CARD_DEFS,
): FinaleStarRow[] {
  const rep      = cardPopularity(baselineMissions(missions), variants, defs);
  const rankable = rankableDefs(defs);
  const ranked   = rep.rows.filter(r => rankable.has(r.name)).sort(compareForStars);
  const sizes    = starTierSizes(ranked.length);

  const out: FinaleStarRow[] = [];
  let i = 0;
  sizes.forEach((size, tier) => {
    const stars = (5 - tier) as FinaleStars;
    for (let n = 0; n < size; n++, i++) {
      const r = ranked[i];
      out.push({
        name: r.name, type: r.type, stars,
        index: r.index, observed: r.observed, availability: r.availability,
        pinned: false,
      });
    }
  });

  // Wild, pinned. It is a free choice of game, which players spend on whatever they
  // are most comfortable with — most likely something already over-picked — so it
  // directly countermands the scale and pays the floor (D7). Its own pick rate
  // measures a different thing entirely, which is why it is not ranked at all.
  for (const def of defs) {
    if (def.type !== 'wild') continue;
    const r = rep.rows.find(row => row.name === def.name);
    out.push({
      name: def.name, type: def.type, stars: WILD_STARS,
      index: r?.index ?? null, observed: r?.observed ?? 0, availability: r?.availability ?? 0,
      pinned: true,
    });
  }

  return out;
}

/**
 * The snapshot frozen onto `mission.finaleStars` at creation, and the ONLY thing
 * read at settle. Keyed by card NAME, because a star value is a property of the
 * card rather than of the dealt instance — which is what makes a reroll free of
 * any star bookkeeping (plan §11).
 */
export function finaleStarTiers(
  missions: readonly GMMission[],
  variants: readonly CasinoDeckChoice[] = BASELINE_VARIANTS,
  defs: readonly CardDef[] = CARD_DEFS,
): Record<string, FinaleStars> {
  const out: Record<string, FinaleStars> = {};
  for (const row of finaleStarRanking(missions, variants, defs)) out[row.name] = row.stars;
  return out;
}

/** Σ stars over a set of cards, reading the frozen snapshot. Unknown names score 0. */
export function sumStars(
  cards: readonly { name?: string }[] | undefined,
  stars: Record<string, FinaleStars> | undefined,
): number {
  if (!cards || !stars) return 0;
  return cards.reduce((s, c) => s + (c?.name ? stars[c.name] ?? 0 : 0), 0);
}
