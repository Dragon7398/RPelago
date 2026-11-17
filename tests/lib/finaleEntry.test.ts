import { describe, it, expect } from 'vitest';
import { computeMissionCard, freshFinaleTable, missionDisplayLabel, type FinaleSetup } from '../../src/lib/missionLogic';
import { CASINO_GAMES, CASINO_GAME_ORDER, holdsMissionClaim } from '../../src/lib/casinoData';
import { claimRefusal } from '../../src/lib/slotHelpers';
import type { GMMission } from '../../src/types';

const HOUR = 3_600_000;
const NOW  = 10 * HOUR;

const setup = (over: Partial<FinaleSetup> = {}): FinaleSetup => ({
  closesAt: NOW + 48 * HOUR,
  release:  true,
  collect:  true,
  hint:     7,
  stars:    { Sonic: 5 },
  ...over,
});

const finale = (over: Partial<GMMission> = {}): GMMission =>
  ({ ...freshFinaleTable(setup(), 0), id: 'fin', ...over } as GMMission);

const table = (over: Partial<GMMission> = {}): GMMission =>
  ({
    id: 't', type: 'casino', casinoGame: 'blackjack', series: 2, label: 'Blackjack',
    state: 'forming', baseMax: 6, xp: 50, gp: 0, release: 'special', collect: 'special',
    hint: 7, firstJoinAt: null, createdAt: 0, participants: {}, ...over,
  } as GMMission);

const seats = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) =>
    [`p${i}`, { playerId: `p${i}`, playerName: `P${i}`, joinedAt: 0 }])) as never;

/**
 * A player who holds every claim they have and almost no gold — the state that
 * bars them from every ordinary table, and from which the finale must still be
 * enterable.
 */
const cardFor = (m: GMMission, over: Partial<{
  uid: string | null; held: number; capacity: number; gold: number; restricted: boolean;
}> = {}) => {
  const o = { uid: 'me', held: 1, capacity: 1, gold: 0, restricted: false, ...over };
  return computeMissionCard(m, o.uid, o.held, o.capacity, false, NOW, o.gold, o.restricted);
};

// ── The whole point of WS-C ───────────────────────────────────────────────────

describe('entering the finale', () => {
  it('is takeable by a player with every claim in use', () => {
    // The claim gate sits ABOVE every casino branch in computeMissionCard, so
    // without the hoisted finale branch this player would be told they cannot
    // enter — the exact restriction the finale exists without.
    const card = cardFor(finale(), { held: 1, capacity: 1 });
    expect(card.takeable).toBe(true);
    expect(card.disabledReason).toBeNull();
  });

  it('is takeable by a RESTRICTED player holding a claim', () => {
    // A restricted player's claim is held to world completion, so they sit at
    // capacity almost permanently. The finale is the celebration nobody is
    // excluded from (decision 9).
    const card = cardFor(finale(), { held: 1, capacity: 1, restricted: true });
    expect(card.takeable).toBe(true);
    expect(card.disabledReason).toBeNull();
  });

  it('is takeable with zero gold', () => {
    const card = cardFor(finale(), { gold: 0 });
    expect(card.takeable).toBe(true);
    expect(card.insufficientGold).toBeUndefined();
    // Because every cost on the game def is 0 — not because a gate was skipped.
    expect(CASINO_GAMES.finale.ante).toBe(0);
  });

  it('is takeable however many players have already entered', () => {
    const card = cardFor(finale({ participants: seats(40), firstJoinAt: 0 }));
    expect(card.takeable).toBe(true);
    expect(card.seats.label).toBe('40 seated');
  });

  it('refuses a player who has already played it', () => {
    const m = finale({ finalePlays: { me: { folds: 0, played: true } } });
    const card = cardFor(m);
    expect(card.takeable).toBe(false);
    expect(card.doneLabel).toBe('ALREADY PLAYED');
    expect(card.disabledReason).toMatch(/once each|once, and once/i);
  });

  it('still lets a player in who has folded but not locked in', () => {
    // Folding does not spend the one play — it costs the rebuy instead.
    const m = finale({ finalePlays: { me: { folds: 2 } } });
    expect(cardFor(m).takeable).toBe(true);
  });

  it('does not refuse a DIFFERENT player who has played', () => {
    const m = finale({ finalePlays: { someoneElse: { folds: 0, played: true } } });
    expect(cardFor(m).takeable).toBe(true);
  });

  it('closes entry on the deadline', () => {
    expect(cardFor(finale({ finaleClosesAt: NOW - 1 })).takeable).toBe(false);
    expect(cardFor(finale({ finaleClosesAt: NOW - 1 })).disabledReason).toMatch(/closed/i);
    expect(cardFor(finale({ finaleClosesAt: NOW + 1 })).takeable).toBe(true);
  });

  it('reports a seated player as in, not as blocked', () => {
    const card = cardFor(finale({ participants: { me: { playerId: 'me', playerName: 'Me', joinedAt: 0 } } }));
    expect(card.youIn).toBe(true);
    expect(card.takeable).toBe(false);
    expect(card.doneLabel).toBe('YOU ARE IN');
  });

  it('says the room is being built once it has deployed', () => {
    const card = cardFor(finale({ state: 'inprogress' }));
    expect(card.takeable).toBe(false);
    expect(card.disabledReason).toMatch(/being built/i);
    // And not the ordinary "a fresh cohort is forming below" — there is no next one.
    expect(card.disabledReason).not.toMatch(/fresh cohort/i);
  });
});

// ── The countdown ─────────────────────────────────────────────────────────────

describe('the card countdown', () => {
  it('counts down to entry closing, with a label that says so', () => {
    const card = cardFor(finale({ finaleClosesAt: NOW + 2 * HOUR, firstJoinAt: 0, participants: seats(1) }));
    expect(card.countdownLabel).toBe('ENTRY CLOSES IN');
    expect(card.liveSec).toBeCloseTo(2 * 3600, 0);
  });

  it('never reports a negative countdown once the deadline is past', () => {
    expect(cardFor(finale({ finaleClosesAt: NOW - 5 * HOUR })).liveSec).toBe(0);
  });

  it('reports no decay steps, however long it has been open', () => {
    const card = cardFor(finale({ firstJoinAt: 0, participants: seats(3) }));
    expect(card.decaySteps).toBe(0);
  });

  it('keeps the decay label and decay clock for an ordinary cohort', () => {
    // The regression half: the chip is no longer hardcoded, so this is what stops
    // every other table losing its wording.
    const card = cardFor(table({ firstJoinAt: 0, participants: seats(2) }), { held: 0 });
    expect(card.countdownLabel).toBe('SLOT DECAYS IN');
    expect(card.liveSec).toBeGreaterThan(0);
  });
});

// ── Labels ────────────────────────────────────────────────────────────────────

describe('missionDisplayLabel', () => {
  it('gives the finale no cohort number', () => {
    // "The Finale · Cohort I" reads as a promise of a second one.
    expect(missionDisplayLabel(finale())).toBe('The Finale');
  });

  it('still numbers an ordinary cohort', () => {
    expect(missionDisplayLabel(table({ series: 2 }))).toBe('Blackjack · Cohort II');
  });
});

// ── The reverse direction: the finale must not block the final tables ─────────

describe('a finale seat does not bar the tables still gathering players', () => {
  it('holds no mission claim, where every other table does', () => {
    // THE rule. `enlistInMission` keys its `activeMissions` write off this, so a
    // finale seat is invisible to every claim count in the app — which is what
    // both mission-card callers derive theirs from (`player.activeMissions`).
    expect(holdsMissionClaim(finale())).toBe(false);
    for (const g of CASINO_GAME_ORDER) {
      expect(holdsMissionClaim(table({ casinoGame: g })), g).toBe(true);
    }
    expect(holdsMissionClaim(table({ type: 'patrol', casinoGame: undefined }))).toBe(true);
  });

  it('leaves an ordinary table takeable for a player whose only seat is the finale', () => {
    // Their held count is 0 BECAUSE the finale wrote no activeMissions entry.
    // The plan is to open the finale at the same moment new tables stop spawning,
    // so a player entering it must still be able to fill the last few seats.
    expect(cardFor(table(), { held: 0, gold: 9999 }).takeable).toBe(true);
  });

  it('is symmetric: holding ordinary tables does not bar the finale either', () => {
    expect(cardFor(finale(), { held: 1, capacity: 1 }).takeable).toBe(true);
    expect(cardFor(table(), { held: 1, capacity: 1, gold: 9999 }).takeable).toBe(false);
  });

  it('does not make a claim on a final table refusable', () => {
    // A casino claim consumes no claim and is rationed per-table only, so nothing
    // about holding a finale seat can refuse one. `claimRefusal` has no notion of
    // capacity at all — only kicked and restricted, neither of which the finale sets.
    expect(claimRefusal(table(), { id: 'me' })).toBeNull();
    expect(claimRefusal(table(), { id: 'me', restricted: false })).toBeNull();
  });
});

// ── Regression: the live tables must still refuse ─────────────────────────────

describe('ordinary tables are unchanged', () => {
  it('still refuse a player with no free claim', () => {
    const card = cardFor(table(), { held: 1, capacity: 1, gold: 9999 });
    expect(card.takeable).toBe(false);
    expect(card.disabledReason).toMatch(/already undertaking/i);
  });

  it('still give a restricted player the held-claim wording', () => {
    const card = cardFor(table(), { held: 1, capacity: 1, gold: 9999, restricted: true });
    expect(card.takeable).toBe(false);
    expect(card.disabledReason).toMatch(/restricted/i);
  });

  it('still refuse a player who cannot cover the full finish cost', () => {
    const card = cardFor(table(), { held: 0, gold: 10 });
    expect(card.takeable).toBe(false);
    expect(card.insufficientGold).toBe(true);
  });

  it('still refuse when every seat is taken', () => {
    const card = cardFor(table({ participants: seats(6), firstJoinAt: 0 }), { held: 0, gold: 9999 });
    expect(card.takeable).toBe(false);
    expect(card.disabledReason).toMatch(/seats are taken|already deployed/i);
  });

  it('still admit a player who has a free claim and the gold', () => {
    expect(cardFor(table(), { held: 0, gold: 9999 }).takeable).toBe(true);
  });
});
