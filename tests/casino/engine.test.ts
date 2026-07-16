import { describe, it, expect } from 'vitest';

// Client (canonical) casino modules.
import {
  CASINO_GAMES, CASINO_GAME_ORDER, minCasinoAnte, seatSpend,
  type CasinoGame,
} from '../../src/lib/casinoData';
import {
  evaluatePoker, evaluateBlackjack,
  rollSeatCount, rollReleaseChance, rollCollectChance,
  deriveHintCost, computeInitialPot, potContribution, rollTableSetup,
  drawCommunity, initialDealCount, selectCommitted,
  CASINO_XP_FLOOR, CASINO_POT_CUT_PCT,
  type DeckCard,
} from '../../src/lib/casinoEngine';
import { handStake as clientHandStake } from '../../src/lib/casinoSlots';
import { applyDeckBoost as clientApplyDeckBoost } from '../../src/lib/casinoSlots';
import {
  GAMBIT_DEFS, makeGambitDeck, gambitCasinoGold, CASINO_GAMBIT_XP_TO_GP,
} from '../../src/lib/casinoGambits';
import {
  casinoEntryCosts, pickNextCasinoGame, freshCasinoTable, casinoPotShares,
} from '../../src/lib/missionLogic';
import type { GMMission } from '../../src/types';

// Server mirror — must stay in lockstep with the client copy.
import * as server from '../../functions/src/casinoEngine';

// Deterministic RNG so client and server calls consume identical sequences.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function card(value: number, name = 'X', type = 'broad'): DeckCard {
  return { name, type: type as DeckCard['type'], count: 1, value, copies: 1, uid: value, copyIndex: 0 };
}

// ── Per-variant cost model (FINAL numbers) ───────────────────────────────────
describe('CASINO_GAMES cost model', () => {
  it('locks the four game antes/rerolls/play-on', () => {
    expect(CASINO_GAMES.five_card_draw).toMatchObject({ ante: 60, rerollCost: 30, reroll: true,  playOn: 0,  sittings: 1 });
    expect(CASINO_GAMES.seven_card_stud).toMatchObject({ ante: 75, rerollCost: 0,  reroll: false, playOn: 0,  sittings: 1 });
    expect(CASINO_GAMES.holdem).toMatchObject({          ante: 30, rerollCost: 0,  reroll: false, playOn: 50, sittings: 2 });
    expect(CASINO_GAMES.blackjack).toMatchObject({       ante: 40, rerollCost: 0,  reroll: false, playOn: 0,  sittings: 1 });
  });

  it('never lets a seat commit more than 5 cards', () => {
    for (const g of CASINO_GAME_ORDER) expect(CASINO_GAMES[g].pickMax).toBeLessThanOrEqual(5);
  });

  it('marks subset-selection games (pool larger than pickMax) correctly', () => {
    // Five Card Draw holds exactly its pickMax → no "best possible" question.
    expect(CASINO_GAMES.five_card_draw.subsetSelect).toBe(false);
    // The other three pick ≤5 from a larger pool.
    expect(CASINO_GAMES.seven_card_stud.subsetSelect).toBe(true);
    expect(CASINO_GAMES.holdem.subsetSelect).toBe(true);
    expect(CASINO_GAMES.blackjack.subsetSelect).toBe(true);
  });

  it('minCasinoAnte is the cheapest ante (Hold \'Em, 30g)', () => {
    expect(minCasinoAnte()).toBe(30);
  });

  it('seatSpend sums ante + optional reroll + optional play-on', () => {
    expect(seatSpend('five_card_draw')).toBe(60);
    expect(seatSpend('five_card_draw', { rerolled: true })).toBe(90);
    expect(seatSpend('seven_card_stud', { rerolled: true })).toBe(75); // no reroll → flag ignored
    expect(seatSpend('holdem')).toBe(30);
    expect(seatSpend('holdem', { playedOn: true })).toBe(80);
    expect(seatSpend('blackjack', { rerolled: true, playedOn: true })).toBe(40); // neither applies
  });
});

// ── Hint cost derivation ─────────────────────────────────────────────────────
describe('deriveHintCost', () => {
  it('spans 6.5% (easiest) to 12% (most generous)', () => {
    expect(deriveHintCost(40, 25)).toBe(6.5);
    expect(deriveHintCost(70, 50)).toBe(12);
  });

  it('always yields a multiple of 0.5 across every rollable R/C pair', () => {
    for (let r = 40; r <= 70; r += 5) {
      for (let c = 25; c <= 50; c += 5) {
        const h = deriveHintCost(r, c);
        expect(h * 2).toBe(Math.round(h * 2)); // integer number of halves
        expect(h).toBeGreaterThanOrEqual(6.5);
        expect(h).toBeLessThanOrEqual(12);
      }
    }
  });
});

// ── Dynamic pot ──────────────────────────────────────────────────────────────
describe('computeInitialPot', () => {
  it('floors at base (10 + seats×10) when the bonus rolls 0', () => {
    expect(computeInitialPot(5, 40, 25, () => 0)).toBe(60); // 10 + 50 + 0
    expect(computeInitialPot(8, 70, 50, () => 0)).toBe(90); // 10 + 80 + 0
  });

  it('caps at base + (150 − R − C) when the bonus rolls high', () => {
    // Easiest odds (40+25) → span 85; hardest-to-beat rng ~1 hits the cap.
    expect(computeInitialPot(5, 40, 25, () => 0.999999)).toBe(60 + 85);
    // Most generous odds (70+50) → span 30.
    expect(computeInitialPot(8, 70, 50, () => 0.999999)).toBe(90 + 30);
  });

  it('never produces a negative bonus span', () => {
    // Even at the max R+C the pot is still ≥ base.
    for (let s = 5; s <= 8; s++) {
      expect(computeInitialPot(s, 70, 50, () => 0)).toBe(10 + s * 10);
    }
  });
});

describe('potContribution', () => {
  it('is 40% of a fee, floored', () => {
    expect(CASINO_POT_CUT_PCT).toBe(0.4);
    expect(potContribution(60)).toBe(24);
    expect(potContribution(75)).toBe(30);
    expect(potContribution(30)).toBe(12);
    expect(potContribution(45)).toBe(18);
  });
});

// ── Roll bounds & full coverage ──────────────────────────────────────────────
describe('roll bounds', () => {
  it('rollSeatCount stays within 5–8 and can reach both ends', () => {
    expect(rollSeatCount(() => 0)).toBe(5);
    expect(rollSeatCount(() => 0.999999)).toBe(8);
    const seen = new Set<number>();
    for (let i = 0; i < 4; i++) seen.add(rollSeatCount(() => (i + 0.5) / 4));
    expect([...seen].sort()).toEqual([5, 6, 7, 8]);
  });

  it('rollReleaseChance covers 40..70 in 5% steps', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 7; i++) seen.add(rollReleaseChance(() => (i + 0.5) / 7));
    expect([...seen].sort((a, b) => a - b)).toEqual([40, 45, 50, 55, 60, 65, 70]);
  });

  it('rollCollectChance covers 25..50 in 5% steps', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 6; i++) seen.add(rollCollectChance(() => (i + 0.5) / 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([25, 30, 35, 40, 45, 50]);
  });
});

// ── Scoring: reward = plain Σ of committed card values ────────────────────────
describe('scoring is a plain sum for every variant', () => {
  const hand = [card(15), card(30), card(25), card(40), card(50)];
  const sum  = 160;

  it('evaluatePoker / evaluateBlackjack / handStake all agree on Σ', () => {
    expect(evaluatePoker(hand).total).toBe(sum);
    expect(evaluateBlackjack(hand).total).toBe(sum);
    expect(clientHandStake(hand)).toBe(sum);
  });

  it('rejecting a card only lowers the sum (no combo/bust)', () => {
    expect(evaluatePoker(hand.slice(0, 3)).total).toBe(70);
    expect(evaluatePoker([]).total).toBe(0);
  });
});

describe('applyDeckBoost', () => {
  it('adds 10% for Purist, rounded once, and leaves others untouched', () => {
    expect(clientApplyDeckBoost(100, 'purist')).toBe(110);
    expect(clientApplyDeckBoost(105, 'purist')).toBe(116); // round(115.5)
    expect(clientApplyDeckBoost(100, 'unconsoled')).toBe(100);
    expect(clientApplyDeckBoost(100, 'indie')).toBe(100);
  });
});

// ── Gambit deck: composition, values, conversion, shared-deck draw ───────────
describe('gambit deck composition', () => {
  const copies = (pred: (d: typeof GAMBIT_DEFS[number]) => boolean) =>
    GAMBIT_DEFS.filter(pred).reduce((s, d) => s + d.copies, 0);

  it('has 18 distinct defs and 54 cards, split 27 bonus / 27 penalty', () => {
    expect(GAMBIT_DEFS.length).toBe(18);
    expect(copies(() => true)).toBe(54);
    expect(copies(d => d.kind === 'bonus')).toBe(27);
    expect(copies(d => d.kind === 'penalty')).toBe(27);
  });

  it('uses 4 small / 3 medium / 2 large copies per stat×polarity', () => {
    expect(copies(d => d.size === 'small')).toBe(24);  // 4 × 6
    expect(copies(d => d.size === 'medium')).toBe(18); // 3 × 6
    expect(copies(d => d.size === 'large')).toBe(12);  // 2 × 6
  });

  it('carries the locked deltas: R/C 3/5/7, Hint 0.5/1/1.5', () => {
    const deltas = (stat: string, kind: string) =>
      GAMBIT_DEFS.filter(d => d.stat === stat && d.kind === kind)
        .map(d => Math.abs(d.delta)).sort((a, b) => a - b);
    expect(deltas('release', 'bonus')).toEqual([3, 5, 7]);
    expect(deltas('release', 'penalty')).toEqual([3, 5, 7]);
    expect(deltas('collect', 'bonus')).toEqual([3, 5, 7]);
    expect(deltas('hint', 'bonus')).toEqual([0.5, 1, 1.5]);
    expect(deltas('hint', 'penalty')).toEqual([0.5, 1, 1.5]);
  });

  it('bonus goldCost: R/C 0/15/30, Hint 0/10/20 (small/med/large)', () => {
    const bonusCost = (stat: string, size: string) =>
      GAMBIT_DEFS.find(d => d.stat === stat && d.kind === 'bonus' && d.size === size)!.goldCost;
    expect([bonusCost('release', 'small'), bonusCost('release', 'medium'), bonusCost('release', 'large')]).toEqual([0, 15, 30]);
    expect([bonusCost('hint', 'small'), bonusCost('hint', 'medium'), bonusCost('hint', 'large')]).toEqual([0, 10, 20]);
  });

  it('penalty pot 20/30/40 (R/C and Hint); xp R/C 10/15/20, Hint 5/10/15', () => {
    const pen = (stat: string, size: string) =>
      GAMBIT_DEFS.find(d => d.stat === stat && d.kind === 'penalty' && d.size === size)!;
    expect(['small', 'medium', 'large'].map(s => pen('release', s).pot)).toEqual([20, 30, 40]);
    expect(['small', 'medium', 'large'].map(s => pen('hint', s).pot)).toEqual([20, 30, 40]);
    expect(['small', 'medium', 'large'].map(s => pen('release', s).xp)).toEqual([10, 15, 20]);
    expect(['small', 'medium', 'large'].map(s => pen('hint', s).xp)).toEqual([5, 10, 15]);
  });

  it('bonuses never carry pot or xp', () => {
    for (const d of GAMBIT_DEFS.filter(d => d.kind === 'bonus')) {
      expect(d.pot).toBe(0);
      expect(d.xp).toBe(0);
    }
  });
});

describe('penalty XP → GP conversion (casino seasons)', () => {
  it('pays xp × 2 gold; bonuses convert to 0', () => {
    expect(CASINO_GAMBIT_XP_TO_GP).toBe(2);
    const relLarge = GAMBIT_DEFS.find(d => d.stat === 'release' && d.delta === -7)!; // xp 20
    const hintSmall = GAMBIT_DEFS.find(d => d.stat === 'hint' && d.delta === 0.5)!;   // xp 5
    expect(gambitCasinoGold(relLarge)).toBe(40);
    expect(gambitCasinoGold(hintSmall)).toBe(10);
    for (const d of GAMBIT_DEFS.filter(d => d.kind === 'bonus')) {
      expect(gambitCasinoGold(d)).toBe(0);
    }
  });
});

describe('shared gambit deck draws 3 unique and depletes', () => {
  it('each offer holds 3 distinct defIds and shrinks the deck by 3', () => {
    const deck = makeGambitDeck();          // one shared, shuffled 54-card deck
    expect(deck.remaining()).toBe(54);
    for (let seat = 1; seat <= 8; seat++) {
      const offer = deck.drawOffer(3);
      expect(offer.length).toBe(3);
      expect(new Set(offer.map(c => c.defId)).size).toBe(3); // unique-within-offer
      expect(deck.remaining()).toBe(54 - seat * 3);          // depletes; never runs dry (8×3 < 54)
    }
  });
});

// ── Single-sitting play helpers ───────────────────────────────────────────────
describe('initialDealCount', () => {
  it('deals the whole pool up front, except Blackjack (2, then hits)', () => {
    expect(initialDealCount('five_card_draw')).toBe(5);
    expect(initialDealCount('seven_card_stud')).toBe(7);
    expect(initialDealCount('blackjack')).toBe(2);
  });
});

describe('selectCommitted', () => {
  const hand = [card(15), card(30), card(25), card(40), card(50), card(20), card(35)]; // 7 cards
  it('commits the whole hand when no subset is given and it fits pickMax', () => {
    const five = hand.slice(0, 5);
    const r = selectCommitted(five, null, 5);
    expect(r.ok && r.committed.length).toBe(5);
  });

  it('rejects a full hand larger than pickMax with no selection (forces a pick)', () => {
    const r = selectCommitted(hand, null, 5); // 7 > 5
    expect(r).toEqual({ ok: false, reason: 'Keep at most 5 cards.' });
  });

  it('keeps exactly the chosen subset', () => {
    const keep = [hand[0].uid, hand[2].uid, hand[4].uid];
    const r = selectCommitted(hand, keep, 5);
    expect(r.ok && r.committed.map(c => c.uid)).toEqual(keep);
  });

  it('rejects a selection referencing a card not in hand, an empty keep, or too many', () => {
    expect(selectCommitted(hand, [9999], 5)).toMatchObject({ ok: false });
    expect(selectCommitted(hand, [], 5)).toMatchObject({ ok: false });
    expect(selectCommitted(hand, hand.map(c => c.uid).slice(0, 6), 5)).toEqual({ ok: false, reason: 'Keep at most 5 cards.' });
  });
});

// ── Hold 'Em community draw ───────────────────────────────────────────────────
describe('drawCommunity', () => {
  it('returns 5 distinct cards: 1 random + one each of the four typed categories', () => {
    for (const seed of [1, 7, 42, 100, 2024]) {
      const c = drawCommunity(mulberry32(seed));
      expect(c.length).toBe(5);
      // all distinct card instances
      expect(new Set(c.map(x => x.uid)).size).toBe(5);
      // positions 1..4 are exactly one each of broad/narrow/franchise/platform
      expect(c.slice(1).map(x => x.type).sort()).toEqual(['broad', 'franchise', 'narrow', 'platform']);
    }
  });

  it('is deterministic and identical on client and server for the same RNG', () => {
    for (const seed of [3, 55, 999]) {
      expect(server.drawCommunity(mulberry32(seed))).toEqual(drawCommunity(mulberry32(seed)));
    }
  });
});

// ── Casino multi-table model ──────────────────────────────────────────────────
const formingTable = (game: CasinoGame): GMMission =>
  ({ type: 'casino', state: 'forming', casinoGame: game } as GMMission);

describe('casinoEntryCosts', () => {
  it('derives the house-cut note from each game\'s cost model', () => {
    expect(casinoEntryCosts('five_card_draw')).toEqual([{ label: 'Ante', gold: 60 }, { label: 'Reroll', gold: 30 }]);
    expect(casinoEntryCosts('seven_card_stud')).toEqual([{ label: 'Ante', gold: 75 }]);
    expect(casinoEntryCosts('holdem')).toEqual([{ label: 'Ante', gold: 30 }, { label: 'Play-on', gold: 50 }]);
    expect(casinoEntryCosts('blackjack')).toEqual([{ label: 'Ante', gold: 40 }]);
  });
});

describe('pickNextCasinoGame', () => {
  it('returns a game with the fewest forming tables (guaranteed when one is at zero)', () => {
    // three games represented, blackjack absent → blackjack is the sole minimum.
    const missions: Record<string, GMMission> = {
      a: formingTable('five_card_draw'), b: formingTable('five_card_draw'),
      c: formingTable('seven_card_stud'), d: formingTable('holdem'),
    };
    for (let i = 0; i < 20; i++) expect(pickNextCasinoGame(missions)).toBe('blackjack');
  });

  it('only counts FORMING casino tables', () => {
    const missions: Record<string, GMMission> = {
      a: { type: 'casino', state: 'inprogress', casinoGame: 'blackjack' } as GMMission,
      b: { type: 'casino', state: 'complete',   casinoGame: 'holdem'    } as GMMission,
    };
    // both non-forming → all counts 0 → any of the four is valid
    for (let i = 0; i < 20; i++) expect(['five_card_draw', 'seven_card_stud', 'holdem', 'blackjack']).toContain(pickNextCasinoGame(missions));
  });

  it('seeding 6 tables yields a 2/2/1/1 spread regardless of tiebreak', () => {
    const working: Record<string, GMMission> = {};
    for (let i = 0; i < 6; i++) {
      const g = pickNextCasinoGame(working);
      working[`t${i}`] = formingTable(g);
    }
    const counts: Record<string, number> = {};
    for (const m of Object.values(working)) counts[m.casinoGame!] = (counts[m.casinoGame!] ?? 0) + 1;
    expect(Object.values(counts).sort()).toEqual([1, 1, 2, 2]);
  });
});

describe('casinoPotShares', () => {
  it('splits evenly and pays out the whole pot (remainder to one seat)', () => {
    const shares = casinoPotShares(100, ['a', 'b', 'c'], () => 0); // base 33, rem 1
    const vals = ['a', 'b', 'c'].map(id => shares.get(id)!);
    expect(vals.reduce((s, v) => s + v, 0)).toBe(100);      // nothing leaks
    expect(vals.filter(v => v === 33).length).toBe(2);
    expect(vals.filter(v => v === 34).length).toBe(1);
  });

  it('divides evenly when there is no remainder', () => {
    const shares = casinoPotShares(90, ['a', 'b', 'c']);
    expect([...shares.values()]).toEqual([30, 30, 30]);
  });

  it('handles empty winners and a zero pot without leaking', () => {
    expect(casinoPotShares(50, []).size).toBe(0);
    expect([...casinoPotShares(0, ['a', 'b']).values()]).toEqual([0, 0]);
  });
});

describe('freshCasinoTable', () => {
  it('builds a forming casino table pinned to the game, with rolled seats/odds/pot', () => {
    const t = freshCasinoTable('holdem', 3, 1000, mulberry32(42));
    expect(t.type).toBe('casino');
    expect(t.casinoGame).toBe('holdem');
    expect(t.series).toBe(3);
    expect(t.label).toBe("Texas Hold 'Em");
    expect(t.state).toBe('forming');
    expect(t.release).toBe('special');
    expect(t.collect).toBe('special');
    expect(t.baseMax).toBeGreaterThanOrEqual(5);
    expect(t.baseMax).toBeLessThanOrEqual(8);
    expect(t.entryCosts).toEqual([{ label: 'Ante', gold: 30 }, { label: 'Play-on', gold: 50 }]);
    expect(t.pot).toBeGreaterThanOrEqual(10 + t.baseMax * 10);
    expect(t.casinoStats!.xp).toBe(50);
    expect(t.hint).toBe(t.casinoStats!.hint);
  });
});

// ── Client / server engine parity (the sync guard) ───────────────────────────
describe('client and server casino engines stay in sync', () => {
  it('CASINO_GAMES is identical on both sides', () => {
    expect(server.CASINO_GAMES).toEqual(CASINO_GAMES);
    expect(server.CASINO_GAME_ORDER).toEqual(CASINO_GAME_ORDER);
    expect(server.minCasinoAnte()).toBe(minCasinoAnte());
    expect(server.CASINO_XP_FLOOR).toBe(CASINO_XP_FLOOR);
    expect(server.CASINO_POT_CUT_PCT).toBe(CASINO_POT_CUT_PCT);
  });

  it('seatSpend matches for every game and flag combination', () => {
    const flags = [{}, { rerolled: true }, { playedOn: true }, { rerolled: true, playedOn: true }];
    for (const g of CASINO_GAME_ORDER as CasinoGame[]) {
      for (const f of flags) {
        expect(server.seatSpend(g, f)).toBe(seatSpend(g, f));
      }
    }
  });

  it('initialDealCount / selectCommitted match on both sides', () => {
    for (const g of CASINO_GAME_ORDER as CasinoGame[]) {
      expect(server.initialDealCount(g)).toBe(initialDealCount(g));
    }
    const h = [card(15), card(30), card(25), card(40), card(50), card(20)];
    expect(server.selectCommitted(h, null, 5)).toEqual(selectCommitted(h, null, 5));
    expect(server.selectCommitted(h, [h[0].uid, h[1].uid], 5)).toEqual(selectCommitted(h, [h[0].uid, h[1].uid], 5));
  });

  it('deriveHintCost / potContribution match across the whole domain', () => {
    for (let r = 40; r <= 70; r += 5) {
      for (let c = 25; c <= 50; c += 5) {
        expect(server.deriveHintCost(r, c)).toBe(deriveHintCost(r, c));
      }
    }
    for (const fee of [30, 40, 45, 60, 75, 80, 90]) {
      expect(server.potContribution(fee)).toBe(potContribution(fee));
    }
  });

  it('GAMBIT_DEFS and the XP→GP conversion are identical on both sides', () => {
    expect(server.GAMBIT_DEFS).toEqual(GAMBIT_DEFS);
    expect(server.CASINO_GAMBIT_XP_TO_GP).toBe(CASINO_GAMBIT_XP_TO_GP);
    for (const d of GAMBIT_DEFS) {
      expect(server.gambitCasinoGold(d)).toBe(gambitCasinoGold(d));
    }
  });

  it('rollTableSetup yields identical results for the same RNG sequence', () => {
    for (const seed of [1, 42, 1337, 999999]) {
      const a = rollTableSetup(mulberry32(seed));
      const b = server.rollTableSetup(mulberry32(seed));
      expect(b).toEqual(a);
      // sanity: the rolled setup obeys the documented bounds
      expect(a.seats).toBeGreaterThanOrEqual(5);
      expect(a.seats).toBeLessThanOrEqual(8);
      expect(a.stats.release).toBeGreaterThanOrEqual(40);
      expect(a.stats.release).toBeLessThanOrEqual(70);
      expect(a.stats.collect).toBeGreaterThanOrEqual(25);
      expect(a.stats.collect).toBeLessThanOrEqual(50);
      expect(a.stats.xp).toBe(CASINO_XP_FLOOR);
      expect(a.pot).toBeGreaterThanOrEqual(10 + a.seats * 10);
    }
  });
});
