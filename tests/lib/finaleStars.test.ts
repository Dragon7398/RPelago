import { describe, it, expect } from 'vitest';
import {
  FINALE_GAME, WILD_STARS, FINALE_BASE_GOLD, FINALE_GOLD_PER_STAR,
  starTierSizes, compareForStars, baselineMissions,
  finaleStarRanking, finaleStarTiers, finaleOwnGold, finaleClaimedGold, sumStars,
  type FinaleStars,
} from '../../src/lib/finaleStars';
import { baselineDeckWeights } from '../../src/lib/cardStats';
import { CARD_DEFS, type CardDef } from '../../src/lib/casinoData';
import type { GMMission } from '../../src/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Ten rankable cards of ONE type with one copy each, so availability is identical
// across them and the ranking turns purely on pick counts. Ten rankable cards cut
// into five tiers of two, which makes every tier boundary assertable by hand.
const EVEN: CardDef[] = [
  { name: 'Wildish', type: 'wild', count: null, value: 10, copies: 5 },
  ...Array.from({ length: 10 }, (_, i): CardDef => ({
    name: `C${i}`, type: 'broad', count: 20, value: 30, copies: 1,
  })),
];

const seat = (names: string[], opts: { claimedAt?: number[] } = {}) => ({
  playerId: 'p', playerName: 'P', joinedAt: 0,
  lockedCards: names.map((name, i) => ({
    name, type: 'broad', count: 1, value: 1, copies: 1, uid: i, copyIndex: 0,
  })),
  slots: names.map((_, i) => ({
    name: `s${i}`, game: 'g',
    ...(opts.claimedAt?.includes(i) ? { claimed: true } : {}),
  })),
});

const mission = (
  participants: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): GMMission =>
  ({ id: 'm', type: 'casino', state: 'complete', participants, ...extra } as unknown as GMMission);

/** One mission whose seats commit `name` exactly `n` times, for each entry. */
const picks = (counts: Record<string, number>): GMMission[] => {
  const names: string[] = [];
  for (const [name, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) names.push(name);
  }
  // Split across seats of ≤5 so no seat holds an implausible hand; the tally is
  // per card either way.
  const seats: Record<string, unknown> = {};
  for (let i = 0; i < names.length; i += 5) {
    seats[`p${i}`] = seat(names.slice(i, i + 5));
  }
  return [mission(seats)];
};

/**
 * A season in which every card was committed exactly as often as the baseline deck
 * offers it, so every index lands on 1.00 and nothing is over- or under-picked.
 * `overrides` multiplies individual cards, which is how a test isolates ONE
 * comparison instead of having 35 never-picked cards crowd the top tiers.
 */
const proportionalPicks = (overrides: Record<string, number> = {}): GMMission[] => {
  const weights = baselineDeckWeights();
  const counts: Record<string, number> = {};
  for (const def of CARD_DEFS) {
    counts[def.name] = Math.round((weights.get(def.name) ?? 0) * (overrides[def.name] ?? 1));
  }
  return picks(counts);
};

const starOf = (rows: ReturnType<typeof finaleStarRanking>, name: string) =>
  rows.find(r => r.name === name)?.stars;

const rankOf = (rows: ReturnType<typeof finaleStarRanking>, name: string) =>
  rows.findIndex(r => r.name === name);

// ── Tier sizes ────────────────────────────────────────────────────────────────

describe('starTierSizes', () => {
  it('always sums to the input', () => {
    for (let n = 0; n <= 60; n++) {
      expect(starTierSizes(n).reduce((s, x) => s + x, 0)).toBe(n);
    }
  });

  it('gives the real deck 8/7/7/7/7 over its 36 rankable cards', () => {
    // Which is the plan's 8/7/7/7/8 once Wild joins the 1★ tier.
    expect(starTierSizes(36)).toEqual([8, 7, 7, 7, 7]);
  });

  it('fills the extremes first, so the middle tier stays tightest', () => {
    expect(starTierSizes(35)).toEqual([7, 7, 7, 7, 7]);
    expect(starTierSizes(36)).toEqual([8, 7, 7, 7, 7]);   // → 5★
    expect(starTierSizes(37)).toEqual([8, 7, 7, 7, 8]);   // → 5★, 1★
    expect(starTierSizes(38)).toEqual([8, 8, 7, 7, 8]);   // → 4★
    expect(starTierSizes(39)).toEqual([8, 8, 7, 8, 8]);   // → 2★
    expect(starTierSizes(40)).toEqual([8, 8, 8, 8, 8]);
  });

  it('never returns a negative or fractional size', () => {
    for (const n of [0, 1, 4, 5, 6, -3]) {
      for (const size of starTierSizes(n)) {
        expect(Number.isInteger(size)).toBe(true);
        expect(size).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ── The real deck: the partition the plan pins ────────────────────────────────

describe('the real deck partitions exactly', () => {
  it('holds 37 cards — 36 categories plus Wild', () => {
    // A TRIPWIRE. The 8/7/7/7/8 cut is stated as a fixed table in the plan, and
    // adding or removing a card silently re-cuts every tier. If this fails, the
    // tier table in docs/casino-finale-slots-plan.md §3 needs re-deciding, not
    // this number needs updating.
    expect(CARD_DEFS.length).toBe(37);
    expect(CARD_DEFS.filter(d => d.type === 'wild')).toHaveLength(1);
  });

  it('puts every card in exactly one tier, 8/7/7/7/8 from 1★ up', () => {
    const rows = finaleStarRanking([]);
    expect(rows).toHaveLength(CARD_DEFS.length);
    expect(new Set(rows.map(r => r.name)).size).toBe(CARD_DEFS.length);

    const per = (s: FinaleStars) => rows.filter(r => r.stars === s).length;
    expect([per(1), per(2), per(3), per(4), per(5)]).toEqual([8, 7, 7, 7, 8]);
  });

  it('covers every CARD_DEFS name in the frozen snapshot', () => {
    const tiers = finaleStarTiers([]);
    expect(Object.keys(tiers)).toHaveLength(CARD_DEFS.length);
    for (const def of CARD_DEFS) {
      expect(tiers[def.name], def.name).toBeGreaterThanOrEqual(1);
      expect(tiers[def.name], def.name).toBeLessThanOrEqual(5);
    }
  });
});

// ── Wild is pinned ────────────────────────────────────────────────────────────

describe('Wild', () => {
  it('is pinned to the floor regardless of how often it was picked', () => {
    // Nobody picks Wild: on a pure ranking that is the most passed-over card on the
    // board and it would score 5★ — the exact inversion D7 exists to prevent.
    const never = finaleStarRanking(picks({ 'Game Boy': 20 }));
    expect(starOf(never, 'Wild')).toBe(WILD_STARS);
    expect(WILD_STARS).toBe(1);

    // And picked constantly, it still sits at the floor rather than moving.
    const always = finaleStarRanking(picks({ Wild: 40 }));
    expect(starOf(always, 'Wild')).toBe(1);
  });

  it('is marked pinned, and nothing else is', () => {
    const rows = finaleStarRanking([]);
    expect(rows.filter(r => r.pinned).map(r => r.name)).toEqual(['Wild']);
  });

  it('is excluded from the ranked cut, so it never displaces a real card', () => {
    // 36 ranked cards + Wild appended. If Wild were ranked, one category card
    // would be pushed out of the partition entirely.
    const rows = finaleStarRanking([]);
    expect(rows.filter(r => !r.pinned)).toHaveLength(36);
  });
});

// ── Direction: stars run INVERSE to popularity ────────────────────────────────

describe('stars run inverse to popularity', () => {
  it('gives the least-picked card 5★ and the most-picked 1★', () => {
    // C0 picked 0 times … C9 picked 9. Equal availability, so the ranking is the
    // pick order and the tiers are two cards each.
    const counts = Object.fromEntries(EVEN
      .filter(d => d.type !== 'wild')
      .map((d, i) => [d.name, i]));
    const rows = finaleStarRanking(picks(counts), undefined, EVEN);

    expect(starOf(rows, 'C0')).toBe(5);
    expect(starOf(rows, 'C1')).toBe(5);
    expect(starOf(rows, 'C2')).toBe(4);
    expect(starOf(rows, 'C3')).toBe(4);
    expect(starOf(rows, 'C4')).toBe(3);
    expect(starOf(rows, 'C5')).toBe(3);
    expect(starOf(rows, 'C6')).toBe(2);
    expect(starOf(rows, 'C7')).toBe(2);
    expect(starOf(rows, 'C8')).toBe(1);
    expect(starOf(rows, 'C9')).toBe(1);
  });

  it('is monotonic — more picks never earns more stars', () => {
    const counts = Object.fromEntries(EVEN
      .filter(d => d.type !== 'wild')
      .map((d, i) => [d.name, i * 3]));
    const rows = finaleStarRanking(picks(counts), undefined, EVEN);
    const ranked = rows.filter(r => !r.pinned);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].stars).toBeLessThanOrEqual(ranked[i - 1].stars);
      expect(ranked[i].observed).toBeGreaterThanOrEqual(ranked[i - 1].observed);
    }
  });

  it('scores the plan’s worked example: equal presence, half the picks, more stars', () => {
    // Zelda and Sonic are both Franchise with one copy, so the baseline offers
    // them equally often — exactly the comparison the design cites. Against a
    // season that is otherwise perfectly proportional, Zelda is picked twice as
    // often as its share predicts and Sonic half as often.
    const rows  = finaleStarRanking(proportionalPicks({ Zelda: 2, Sonic: 0.5 }));
    const zelda = rows.find(r => r.name === 'Zelda')!;
    const sonic = rows.find(r => r.name === 'Sonic')!;

    expect(sonic.availability).toBe(zelda.availability);
    expect(sonic.index!).toBeLessThan(zelda.index!);
    expect(rankOf(rows, 'Sonic')).toBeLessThan(rankOf(rows, 'Zelda'));
    expect(sonic.stars).toBeGreaterThan(zelda.stars);

    // The two extremes of a deck that is otherwise flat. The plan quotes Zelda at
    // 2★ from real season data; what is pinned here is the DIRECTION and the gap,
    // since the exact tier depends on how the rest of the season actually went.
    expect(sonic.stars).toBe(5);
    expect(zelda.stars).toBe(1);
  });
});

// ── The tiebreak ──────────────────────────────────────────────────────────────

describe('the tiebreak', () => {
  const row = (name: string, index: number | null, availability: number) =>
    ({ name, type: 'broad', value: 0, observed: 0, availability,
       observedShare: 0, availabilityShare: 0, index }) as never;

  it('ranks the more-offered card first when neither was picked', () => {
    // Both at index 0. The deck offered A nine times and B three; A is the more
    // conspicuously avoided, so it takes the higher tier.
    expect(compareForStars(row('A', 0, 9), row('B', 0, 3))).toBeLessThan(0);
    expect(compareForStars(row('B', 0, 3), row('A', 0, 9))).toBeGreaterThan(0);
  });

  it('falls back to the name, so the result is reproducible', () => {
    expect(compareForStars(row('Apple', 0, 5), row('Pear', 0, 5))).toBeLessThan(0);
    expect(compareForStars(row('Pear', 0, 5), row('Apple', 0, 5))).toBeGreaterThan(0);
    expect(compareForStars(row('Same', 0, 5), row('Same', 0, 5))).toBe(0);
  });

  it('sorts an unmeasurable card last rather than rewarding it', () => {
    // A null index means the baseline holds no copy, so its rate is not
    // computable. 5★ is a reward; it must be earned against a number.
    expect(compareForStars(row('Null', null, 9), row('Real', 0.5, 1))).toBeGreaterThan(0);
    expect(compareForStars(row('Real', 0.5, 1), row('Null', null, 9))).toBeLessThan(0);
    expect(compareForStars(row('N1', null, 9), row('N2', null, 3))).toBeLessThan(0);
  });

  it('makes the whole ranking stable under input reordering', () => {
    const data = picks({ Zelda: 6, Sonic: 3, 'Game Boy': 9, Puzzle: 2, Mario: 5 });
    const forward = finaleStarTiers(data);

    // Same seats, reversed card order inside each hand, and reversed defs.
    const flipped = data.map(m => mission(Object.fromEntries(
      Object.entries(m.participants ?? {}).map(([id, p]) => {
        const q = p as { lockedCards: { name: string }[] };
        return [id, seat(q.lockedCards.map(c => c.name).reverse())];
      }),
    )));
    const backward = finaleStarTiers(flipped, undefined, [...CARD_DEFS].reverse());

    expect(backward).toEqual(forward);
  });
});

// ── The finale is not in its own baseline ─────────────────────────────────────

describe('baselineMissions', () => {
  it('drops the finale, so it cannot shift its own tiers as it is played', () => {
    const ordinary = mission({ a: seat(['Zelda']) }, { casinoGame: 'holdem' });
    const finale   = mission({ b: seat(['Sonic']) }, { casinoGame: FINALE_GAME });

    expect(baselineMissions([ordinary, finale])).toEqual([ordinary]);
  });

  it('gives the same tiers before and after the finale has seats', () => {
    const season = [mission({ a: seat(['Zelda', 'Zelda', 'Mario']) }, { casinoGame: 'blackjack' })];
    const before = finaleStarTiers(season);

    // The finale opens and several players commit cards at it.
    const after = finaleStarTiers([
      ...season,
      mission({ b: seat(['Sonic', 'Metroid']), c: seat(['Sonic']) }, { casinoGame: FINALE_GAME }),
    ]);

    expect(after).toEqual(before);
  });
});

// ── Payout ────────────────────────────────────────────────────────────────────

describe('payout', () => {
  it('runs 60–300 before the deck boost', () => {
    expect(FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR * 1).toBe(60);    // one 1★ card
    expect(FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR * 25).toBe(300);  // five 5★ cards
  });

  it('tops out at 330 on Purist and 270 on Safety', () => {
    expect(finaleOwnGold(25, 'purist')).toBe(330);
    expect(finaleOwnGold(25, 'safety')).toBe(270);
    expect(finaleOwnGold(25, 'unconsoled')).toBe(300);
    expect(finaleOwnGold(25, 'indie')).toBe(300);
  });

  it('floors at 60 on a flat deck and never pays less than the base', () => {
    expect(finaleOwnGold(1, 'unconsoled')).toBe(60);
    expect(finaleOwnGold(0, 'unconsoled')).toBe(FINALE_BASE_GOLD);
  });

  it('pays a claimed card its stars alone — no base, no boost', () => {
    // A 5★ card is worth 50g to whoever finishes it, which is exactly what the
    // player who abandoned it forfeits. That symmetry is the point (plan §4a).
    expect(finaleClaimedGold(5)).toBe(50);
    expect(finaleClaimedGold(1)).toBe(10);
    expect(finaleClaimedGold(0)).toBe(0);
  });

  it('matches the design’s worked hand: 5★+5★+2★ on Purist pays 187', () => {
    expect(finaleOwnGold(5 + 5 + 2, 'purist')).toBe(187);
  });
});

describe('sumStars', () => {
  const stars: Record<string, FinaleStars> = { Sonic: 5, Zelda: 2, Wild: 1 };

  it('sums the frozen values by card name', () => {
    expect(sumStars([{ name: 'Sonic' }, { name: 'Zelda' }], stars)).toBe(7);
  });

  it('counts a duplicate card twice — two kept Sonics is two Sonic games (D8)', () => {
    expect(sumStars([{ name: 'Sonic' }, { name: 'Sonic' }], stars)).toBe(10);
  });

  it('scores an unknown name 0 rather than throwing', () => {
    expect(sumStars([{ name: 'Nonesuch' }, { name: 'Sonic' }], stars)).toBe(5);
    expect(sumStars([{}], stars)).toBe(0);
  });

  it('is 0 when either side is missing', () => {
    expect(sumStars(undefined, stars)).toBe(0);
    expect(sumStars([{ name: 'Sonic' }], undefined)).toBe(0);
  });
});
