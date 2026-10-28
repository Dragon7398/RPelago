import { CARD_DEFS, DECK_VARIANTS, type CardDef, type CardTypeKey, type DeckCard } from './casinoData';
import { normalizeSlots } from './slotHelpers';
import type { CasinoDeckChoice, GMMission } from '../types';

// ── Card popularity ──────────────────────────────────────────────────────────
//
// Which cards players actually commit, measured against how often the deck OFFERS
// them. A raw count answers the wrong question: a Broad card has more copies than a
// Narrow one, so it will top any unweighted tally purely by being dealt more.
//
// The baseline is a **theoretical deck pooling one Purist, one Unconsoled and one
// Indie deck** (`BASELINE_VARIANTS`). Purist holds everything; Unconsoled drops
// Platform; Indie drops Franchise. So across the three, a Platform card is present
// in 2, a Franchise card in 2, and everything else in all 3 — times its `copies`.
// Safety is deliberately absent: it is Unconsoled and Indie combined, so including
// it would weight both exclusions twice.

/** The three decks the baseline pools. Safety is excluded — see the header. */
export const BASELINE_VARIANTS: readonly CasinoDeckChoice[] = ['purist', 'unconsoled', 'indie'];

export interface CardPopularityRow {
  name:         string;
  type:         CardTypeKey;
  value:        number;
  /** Times this card was committed off a seat's own hand. */
  observed:     number;
  /** Copies of it in the pooled baseline deck. */
  availability: number;
  observedShare:     number;
  availabilityShare: number;
  /**
   * observedShare / availabilityShare. 1 = picked exactly as often as the deck
   * offers it; >1 over-picked, <1 under-picked. Null when the baseline holds none
   * of this card (nothing to compare against).
   */
  index:        number | null;
}

export interface CardPopularityReport {
  rows:   CardPopularityRow[];
  /** Seats whose committed cards were counted. */
  seats:  number;
  /** Own-hand cards counted (claimed cards are excluded — see below). */
  cards:  number;
  /** Seats per deck variant, so the baseline's confound is visible. */
  deckMix: Record<string, number>;
  /** Seats whose `deckChoice` was never recorded (pre-dates the field). */
  deckUnknown: number;
  /** Claimed cards skipped, for the same reason. */
  claimedSkipped: number;
}

/** Copies of each card in the pooled baseline deck, keyed by card name. */
export function baselineDeckWeights(
  variants: readonly CasinoDeckChoice[] = BASELINE_VARIANTS,
  defs: readonly CardDef[] = CARD_DEFS,
): Map<string, number> {
  const excluded = variants.map(v => new Set<CardTypeKey>(DECK_VARIANTS[v].excludeTypes));
  const out = new Map<string, number>();
  for (const def of defs) {
    const decks = excluded.filter(ex => !ex.has(def.type)).length;
    out.set(def.name, def.copies * decks);
  }
  return out;
}

/**
 * Committed cards across every seat, counted by card name.
 *
 * **Claimed cards are excluded, deliberately.** A claimed card came off a DIFFERENT
 * player's deck and was inherited with the slot — the claimant never saw it in a
 * hand and never chose it. Counting it would record a pick nobody made. They are
 * told apart by their index-aligned slot's `claimed` flag, never by uid, which can
 * coincide across two seats' decks.
 */
export function tallyCommittedCards(missions: readonly GMMission[]): {
  counts: Map<string, number>;
  seats: number;
  cards: number;
  deckMix: Record<string, number>;
  deckUnknown: number;
  claimedSkipped: number;
} {
  const counts = new Map<string, number>();
  const deckMix: Record<string, number> = {};
  let seats = 0, cards = 0, deckUnknown = 0, claimedSkipped = 0;

  for (const m of missions) {
    if (m.type !== 'casino') continue;
    for (const p of Object.values(m.participants ?? {})) {
      const locked = p.lockedCards;
      if (!Array.isArray(locked) || locked.length === 0) continue;
      seats++;
      if (p.deckChoice) deckMix[p.deckChoice] = (deckMix[p.deckChoice] ?? 0) + 1;
      else deckUnknown++;

      const slots = normalizeSlots(p.slots);
      locked.forEach((card: DeckCard, i) => {
        if (!card?.name) return;
        if (slots[i]?.claimed === true) { claimedSkipped++; return; }
        counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
        cards++;
      });
    }
  }

  return { counts, seats, cards, deckMix, deckUnknown, claimedSkipped };
}

/**
 * The full report, sorted most over-picked first. Cards never committed are kept
 * with `observed: 0` — "never chosen once in the whole season" is the most
 * interesting answer the least-popular end can give, and dropping them would hide
 * it.
 */
export function cardPopularity(
  missions: readonly GMMission[],
  variants: readonly CasinoDeckChoice[] = BASELINE_VARIANTS,
  defs: readonly CardDef[] = CARD_DEFS,
): CardPopularityReport {
  const { counts, seats, cards, deckMix, deckUnknown, claimedSkipped } = tallyCommittedCards(missions);
  const weights = baselineDeckWeights(variants, defs);
  const totalWeight = [...weights.values()].reduce((s, n) => s + n, 0);

  const rows: CardPopularityRow[] = defs.map(def => {
    const observed     = counts.get(def.name) ?? 0;
    const availability = weights.get(def.name) ?? 0;
    const observedShare     = cards       > 0 ? observed / cards : 0;
    const availabilityShare = totalWeight > 0 ? availability / totalWeight : 0;
    return {
      name: def.name, type: def.type, value: def.value,
      observed, availability, observedShare, availabilityShare,
      index: availabilityShare > 0 ? observedShare / availabilityShare : null,
    };
  });

  // Unknown index sorts last either way; ties break on the raw count so the more
  // evidenced of two equal indices leads.
  rows.sort((a, b) => {
    if (a.index == null) return 1;
    if (b.index == null) return -1;
    if (b.index !== a.index) return b.index - a.index;
    return b.observed - a.observed;
  });

  return { rows, seats, cards, deckMix, deckUnknown, claimedSkipped };
}
