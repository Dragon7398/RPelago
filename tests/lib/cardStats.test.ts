import { describe, it, expect } from 'vitest';
import {
  BASELINE_VARIANTS, baselineDeckWeights, tallyCommittedCards, cardPopularity,
} from '../../src/lib/cardStats';
import { CARD_DEFS, DECK_VARIANTS, type CardDef } from '../../src/lib/casinoData';
import type { GMMission } from '../../src/types';

// A tiny synthetic deck, so the weighting assertions state an exact expected number
// instead of restating whatever CARD_DEFS happens to hold.
const DEFS: CardDef[] = [
  { name: 'Wildish',   type: 'wild',      count: null, value: 10, copies: 2 },
  { name: 'Broadish',  type: 'broad',     count: 50,   value: 20, copies: 3 },
  { name: 'Console',   type: 'platform',  count: 30,   value: 30, copies: 2 },
  { name: 'Zeldaish',  type: 'franchise', count: 10,   value: 40, copies: 1 },
  { name: 'Narrowish', type: 'narrow',    count: 3,    value: 50, copies: 1 },
];

const seat = (cards: { name: string }[], opts: {
  deckChoice?: 'purist' | 'unconsoled' | 'indie' | 'safety';
  claimedAt?: number[];
} = {}) => ({
  lockedCards: cards.map((c, i) => ({ ...c, type: 'broad', count: 1, value: 1, copies: 1, uid: i, copyIndex: 0 })),
  slots: cards.map((_, i) => ({
    name: `s${i}`, game: 'g',
    ...(opts.claimedAt?.includes(i) ? { claimed: true } : {}),
  })),
  ...(opts.deckChoice ? { deckChoice: opts.deckChoice } : {}),
});

const mission = (participants: Record<string, unknown>, type = 'casino'): GMMission =>
  ({ id: 'm1', type, state: 'complete', participants } as unknown as GMMission);

describe('baselineDeckWeights', () => {
  it('pools Purist + Unconsoled + Indie — Safety is excluded', () => {
    expect(BASELINE_VARIANTS).toEqual(['purist', 'unconsoled', 'indie']);
    // Safety would weight BOTH exclusions a second time, which is the mistake the
    // chosen baseline exists to avoid.
    expect(DECK_VARIANTS.safety.excludeTypes).toEqual(['platform', 'franchise']);
  });

  it('counts a card once per baseline deck that holds it, times its copies', () => {
    const w = baselineDeckWeights(BASELINE_VARIANTS, DEFS);
    // In all three decks: copies × 3.
    expect(w.get('Wildish')).toBe(6);
    expect(w.get('Broadish')).toBe(9);
    expect(w.get('Narrowish')).toBe(3);
    // Platform is dropped by Unconsoled → present in Purist + Indie only.
    expect(w.get('Console')).toBe(4);
    // Franchise is dropped by Indie → present in Purist + Unconsoled only.
    expect(w.get('Zeldaish')).toBe(2);
  });

  it('gives every real card a non-zero weight (nothing is unmeasurable)', () => {
    const w = baselineDeckWeights(BASELINE_VARIANTS, CARD_DEFS);
    for (const def of CARD_DEFS) expect(w.get(def.name)).toBeGreaterThan(0);
  });
});

describe('tallyCommittedCards', () => {
  it('counts committed cards per name across seats and missions', () => {
    const t = tallyCommittedCards([
      mission({ a: seat([{ name: 'Broadish' }, { name: 'Console' }], { deckChoice: 'purist' }) }),
      mission({ b: seat([{ name: 'Broadish' }], { deckChoice: 'indie' }) }),
    ]);
    expect(t.counts.get('Broadish')).toBe(2);
    expect(t.counts.get('Console')).toBe(1);
    expect(t.seats).toBe(2);
    expect(t.cards).toBe(3);
    expect(t.deckMix).toEqual({ purist: 1, indie: 1 });
  });

  // THE SUBTLE ONE. A claimed card came off another player's deck and was inherited
  // with the slot — the claimant never saw it in a hand. Counting it records a pick
  // nobody made, and inflates whatever card happened to be abandoned.
  it('EXCLUDES claimed cards, which were inherited rather than chosen', () => {
    const t = tallyCommittedCards([
      mission({ a: seat([{ name: 'Broadish' }, { name: 'Zeldaish' }], { claimedAt: [1] }) }),
    ]);
    expect(t.counts.get('Broadish')).toBe(1);
    expect(t.counts.has('Zeldaish')).toBe(false);
    expect(t.claimedSkipped).toBe(1);
    expect(t.cards).toBe(1);
  });

  it('ignores non-casino missions and seats that never locked', () => {
    const t = tallyCommittedCards([
      mission({ a: seat([{ name: 'Broadish' }]) }, 'patrol'),
      mission({ b: { slots: [{ name: 's', game: 'g' }] } }),   // never played
    ]);
    expect(t.seats).toBe(0);
    expect(t.cards).toBe(0);
  });

  it('records seats whose deckChoice predates the field', () => {
    const t = tallyCommittedCards([mission({ a: seat([{ name: 'Broadish' }]) })]);
    expect(t.deckUnknown).toBe(1);
    expect(t.deckMix).toEqual({});
  });
});

describe('cardPopularity', () => {
  it('indexes 1 when a card is picked exactly as often as the deck offers it', () => {
    // Baseline shares: Wildish 6/24, Broadish 9/24, Console 4/24, Zeldaish 2/24,
    // Narrowish 3/24. Commit in exactly those proportions (24 cards) → every index 1.
    const cards = [
      ...Array(6).fill({ name: 'Wildish' }),
      ...Array(9).fill({ name: 'Broadish' }),
      ...Array(4).fill({ name: 'Console' }),
      ...Array(2).fill({ name: 'Zeldaish' }),
      ...Array(3).fill({ name: 'Narrowish' }),
    ];
    const rep = cardPopularity([mission({ a: seat(cards) })], BASELINE_VARIANTS, DEFS);
    for (const r of rep.rows) expect(r.index).toBeCloseTo(1, 10);
  });

  it('puts an over-picked card above an under-picked one regardless of raw count', () => {
    // Broadish is offered 9/24 and Zeldaish 2/24, so one Zeldaish pick out of two
    // cards beats three Broadish out of four on RATE — which is the whole point of
    // weighting, and what a raw tally would get backwards.
    const rep = cardPopularity([
      mission({ a: seat([{ name: 'Zeldaish' }, { name: 'Broadish' }]) }),
    ], BASELINE_VARIANTS, DEFS);
    const names = rep.rows.map(r => r.name);
    expect(names.indexOf('Zeldaish')).toBeLessThan(names.indexOf('Broadish'));
  });

  it('keeps never-committed cards, at index 0', () => {
    const rep = cardPopularity([mission({ a: seat([{ name: 'Broadish' }]) })], BASELINE_VARIANTS, DEFS);
    const narrow = rep.rows.find(r => r.name === 'Narrowish')!;
    expect(narrow.observed).toBe(0);
    expect(narrow.index).toBe(0);
    // ...and sorted to the bottom, which is where "never picked" belongs.
    expect(rep.rows[rep.rows.length - 1].observed).toBe(0);
  });

  it('is safe on an empty season rather than dividing by zero', () => {
    const rep = cardPopularity([], BASELINE_VARIANTS, DEFS);
    expect(rep.seats).toBe(0);
    expect(rep.cards).toBe(0);
    for (const r of rep.rows) expect(r.index).toBe(0);
  });

  it('reports every real card when run against the live deck', () => {
    const rep = cardPopularity([], BASELINE_VARIANTS, CARD_DEFS);
    expect(rep.rows).toHaveLength(CARD_DEFS.length);
  });
});
