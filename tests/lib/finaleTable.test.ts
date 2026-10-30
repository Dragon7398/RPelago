import { describe, it, expect } from 'vitest';
import {
  CASINO_GAMES, CASINO_GAME_ORDER, FINALE_GAME, isFinale, minCasinoAnte,
  FINALE_ROWS, FINALE_ROW_REELS, FINALE_BOARD_CARDS, FINALE_MAX_REROLL_REELS,
  finaleReelIndices, finaleRowIndices, seatSpend,
} from '../../src/lib/casinoData';
import {
  currentMaxSlots, msToNextDecay, seatTally, shouldDeploy, finaleDeadlinePassed,
  casinoEntryCosts, freshFinaleTable, findFinale, cardStatsCorpus, pickNextCasinoGame,
  FINALE_BASE_MAX, type FinaleSetup,
} from '../../src/lib/missionLogic';
import { FINALE_REBUY_GOLD, finaleBoardCost } from '../../src/lib/finaleStars';
import type { GMMission } from '../../src/types';

const HOUR = 3_600_000;

const setup = (over: Partial<FinaleSetup> = {}): FinaleSetup => ({
  closesAt: 5_000_000,
  release:  true,
  collect:  true,
  hint:     7,
  stars:    { Sonic: 5, Zelda: 2, Wild: 1 },
  ...over,
});

const finale = (over: Partial<GMMission> = {}, now = 0): GMMission =>
  ({ ...freshFinaleTable(setup(), now), id: 'fin', ...over } as GMMission);

const seats = (n: number): Record<string, never> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { playerId: `p${i}` }])) as never;

const table = (over: Partial<GMMission> = {}): GMMission =>
  ({
    id: 't', type: 'casino', casinoGame: 'blackjack', series: 1, label: 'Blackjack',
    state: 'forming', baseMax: 6, xp: 50, gp: 0, release: 'special', collect: 'special',
    hint: 7, firstJoinAt: null, createdAt: 0, participants: {}, ...over,
  } as GMMission);

// ── The rotation tripwires ────────────────────────────────────────────────────

describe('the finale stays out of the rotation', () => {
  it('is NOT in CASINO_GAME_ORDER', () => {
    // ⚠️ THE tripwire for this whole feature. That array drives respawn
    // (pickNextCasinoGame), the per-game casinoSeries counters, seedInitialMissions
    // and minCasinoAnte. Adding the finale would put the season closer into the
    // respawn rotation and zero the minimum ante.
    expect(CASINO_GAME_ORDER).not.toContain(FINALE_GAME);
    expect(CASINO_GAME_ORDER).toHaveLength(4);
  });

  it('does not drag the minimum ante to zero', () => {
    // The finale's ante IS 0, so a minCasinoAnte() that iterated CasinoGame rather
    // than the rotation would return 0 and every gold gate keyed off it would open.
    expect(CASINO_GAMES[FINALE_GAME].ante).toBe(0);
    expect(minCasinoAnte()).toBe(CASINO_GAMES.holdem.ante);
    expect(minCasinoAnte()).toBeGreaterThan(0);
  });

  it('is never picked as the next table to open, even while one is forming', () => {
    const missions = { f: finale(), b: table() };
    for (let i = 0; i < 40; i++) {
      expect(pickNextCasinoGame(missions, () => i / 40)).not.toBe(FINALE_GAME);
    }
  });

  it('is not counted as one of the forming tables of its own game', () => {
    // A forming finale must not make some other game look under-represented.
    const withFinale = pickNextCasinoGame({ f: finale() }, () => 0);
    const without    = pickNextCasinoGame({}, () => 0);
    expect(withFinale).toBe(without);
  });

  it('costs nothing to sit down at', () => {
    expect(seatSpend(FINALE_GAME, { rerolled: true, playedOn: true })).toBe(0);
  });
});

describe('isFinale', () => {
  it('keys off casinoGame and nothing else', () => {
    expect(isFinale(finale())).toBe(true);
    expect(isFinale(table())).toBe(false);
    // Not the label, and not the presence of finaleClosesAt — a label is
    // host-editable and a missing timestamp must not demote the finale.
    expect(isFinale(table({ label: 'The Finale' }))).toBe(false);
    expect(isFinale(table({ finaleClosesAt: 1 }))).toBe(false);
    expect(isFinale(finale({ finaleClosesAt: undefined }))).toBe(true);
  });

  it('tolerates null and undefined', () => {
    expect(isFinale(null)).toBe(false);
    expect(isFinale(undefined)).toBe(false);
  });
});

// ── Seats and decay ───────────────────────────────────────────────────────────

describe('seats and decay', () => {
  it('has no cap, however long it has been open', () => {
    const m = finale({ firstJoinAt: 0, participants: seats(30) });
    expect(currentMaxSlots(m, 400 * HOUR)).toBe(Infinity);
    // Which is what makes every `filled >= max` gate false by construction.
    expect(30 >= currentMaxSlots(m, 400 * HOUR)).toBe(false);
  });

  it('never decays', () => {
    const m = finale({ firstJoinAt: 0, participants: seats(3) });
    // Must be checked explicitly: Infinity passes msToNextDecay's `<= 1` test and
    // would otherwise render a countdown to a seat that cannot close.
    expect(msToNextDecay(m, 100 * HOUR)).toBeNull();
    // An ordinary table of the same age does decay, so the guard is doing work.
    expect(msToNextDecay(table({ firstJoinAt: 0, participants: seats(3) }), 10 * HOUR)).not.toBeNull();
  });

  it('shows a seated count rather than an x-of-y tally', () => {
    const t = seatTally(finale({ participants: seats(12) }), HOUR);
    expect(t.filled).toBe(12);
    expect(t.max).toBe(12);        // Infinity does not render; the tally answers instead
    expect(t.over).toBe(false);
    expect(t.label).toBe('12 seated');
    expect(t.title).toMatch(/no seat limit/i);
  });

  it('keeps baseMax at 0, which is what the un-forked pip loops need', () => {
    // ⚠️ Several places read m.baseMax DIRECTLY — SeatPips, the map card's Pips,
    // and the table's empty-seat filler — all as `for (i = 0; i < baseMax; i++)`.
    // Zero makes each of them draw nothing, i.e. "only the seats that exist",
    // which IS the finale's display rule. A large sentinel would render a wall of
    // fake empty seats in all three.
    expect(FINALE_BASE_MAX).toBe(0);
    expect(finale().baseMax).toBe(0);
    // And the two "N decayed" readouts subtract from it, so they must not go positive.
    expect(finale({ participants: seats(9) }).baseMax - seatTally(finale({ participants: seats(9) }), 0).max)
      .toBeLessThanOrEqual(0);
  });
});

// ── Deploy ────────────────────────────────────────────────────────────────────

describe('deploy', () => {
  it('is never deployed by shouldDeploy', () => {
    // It wants a full table with every seat locked in. The finale has no cap, so
    // it is never full, and it deliberately tolerates seats that never lock in.
    const m = finale({ firstJoinAt: 0, participants: seats(8) });
    expect(shouldDeploy(m, 500 * HOUR)).toBe(false);
  });

  it('deploys on the deadline instead', () => {
    const m = finale({ finaleClosesAt: 1_000 });
    expect(finaleDeadlinePassed(m, 999)).toBe(false);
    expect(finaleDeadlinePassed(m, 1_000)).toBe(true);
    expect(finaleDeadlinePassed(m, 5_000)).toBe(true);
  });

  it('stalls rather than closing itself when the deadline is missing', () => {
    // A half-written mission should be visibly stuck, not deploy immediately.
    expect(finaleDeadlinePassed(finale({ finaleClosesAt: undefined }), 9e12)).toBe(false);
  });

  it('does not fire again once deployed', () => {
    expect(finaleDeadlinePassed(finale({ finaleClosesAt: 1, state: 'inprogress' }), 9e12)).toBe(false);
  });

  it('never claims an ordinary table has passed a finale deadline', () => {
    expect(finaleDeadlinePassed(table({ finaleClosesAt: 1 }), 9e12)).toBe(false);
  });
});

// ── The board ─────────────────────────────────────────────────────────────────

describe('the board', () => {
  it('is 3 rows × 5 reels, fifteen cards', () => {
    expect([FINALE_ROWS, FINALE_ROW_REELS, FINALE_BOARD_CARDS]).toEqual([3, 5, 15]);
    expect(FINALE_MAX_REROLL_REELS).toBe(3);
    expect(CASINO_GAMES[FINALE_GAME].hole).toBe(FINALE_BOARD_CARDS);
    // Keep at most one row's worth — the player takes a single row.
    expect(CASINO_GAMES[FINALE_GAME].pickMax).toBe(FINALE_ROW_REELS);
  });

  it('maps a reel to a COLUMN, not a row', () => {
    // A reroll respins all three cards of one column. Getting this wrong would
    // respin a row and silently break the one mechanic the reroll exists for.
    expect(finaleReelIndices(0)).toEqual([0, 5, 10]);
    expect(finaleReelIndices(4)).toEqual([4, 9, 14]);
  });

  it('maps a 1-based row to its five indices', () => {
    expect(finaleRowIndices(1)).toEqual([0, 1, 2, 3, 4]);
    expect(finaleRowIndices(3)).toEqual([10, 11, 12, 13, 14]);
  });

  it('partitions the board exactly, by rows and by reels alike', () => {
    const byRow  = [1, 2, 3].flatMap(finaleRowIndices).sort((a, b) => a - b);
    const byReel = [0, 1, 2, 3, 4].flatMap(finaleReelIndices).sort((a, b) => a - b);
    const all    = Array.from({ length: FINALE_BOARD_CARDS }, (_, i) => i);
    expect(byRow).toEqual(all);
    expect(byReel).toEqual(all);
  });

  it('leaves the deck big enough for a full reroll', () => {
    // Worst case: 15 dealt plus 3 reels × 3 cards respun = 24, against the
    // smallest deck variant (Safety).
    expect(FINALE_BOARD_CARDS + FINALE_MAX_REROLL_REELS * FINALE_ROWS).toBeLessThan(44);
  });
});

// ── Money ─────────────────────────────────────────────────────────────────────

describe('entry cost', () => {
  it('reads as entry and rebuy, not ante and reroll', () => {
    // All three of ante/reroll/play-on are 0, so the generic builder would emit
    // "Ante 0g · Reroll 0g" — true and useless.
    expect(casinoEntryCosts(FINALE_GAME)).toEqual([
      { label: 'Entry',            gold: 0 },
      { label: 'Rebuy after fold', gold: FINALE_REBUY_GOLD },
    ]);
  });

  it('is free the first time and charges the rebuy after a fold', () => {
    expect(finaleBoardCost(undefined)).toBe(0);
    expect(finaleBoardCost({ folds: 0 })).toBe(0);
    expect(finaleBoardCost({ folds: 1 })).toBe(FINALE_REBUY_GOLD);
    expect(finaleBoardCost({ folds: 4 })).toBe(FINALE_REBUY_GOLD);
  });
});

// ── The table as created ──────────────────────────────────────────────────────

describe('freshFinaleTable', () => {
  it('opens with no pot, and an opening pot of zero to audit against', () => {
    // ⚠️ A zero pot keeps the whole weighted-pot pipeline dormant at settle, which
    // is what lets the finale reuse completeMission unforked. Anything that grows
    // it switches that machinery back on.
    const m = finale();
    expect(m.pot).toBe(0);
    expect(m.casinoOpenPot).toBe(0);
  });

  it('stores the host’s odds as FINAL values, not as "special"', () => {
    const on  = finale();
    expect([on.release, on.collect]).toEqual(['on', 'on']);
    const off = { ...freshFinaleTable(setup({ release: false, collect: false }), 0) } as GMMission;
    expect([off.release, off.collect]).toEqual(['off', 'off']);
  });

  it('pins the odds CHANCES to 100/0 so a roll cannot overturn the host', () => {
    // rollCasinoOdds is `Math.random() * 100 < chance`, so 100 is always on and 0
    // is never on. That makes deploy-time rolling deterministic and equal to the
    // host's pick — the skip in deployMission is tidiness, not the guarantee.
    const mixed = { ...freshFinaleTable(setup({ release: true, collect: false }), 0) } as GMMission;
    expect(mixed.casinoStats?.release).toBe(100);
    expect(mixed.casinoStats?.collect).toBe(0);
    expect(mixed.casinoOpenStats).toEqual(mixed.casinoStats);
  });

  it('freezes the star snapshot it was given, verbatim', () => {
    const stars = { Sonic: 5, Zelda: 2 } as const;
    const m = { ...freshFinaleTable(setup({ stars: { ...stars } }), 0) } as GMMission;
    expect(m.finaleStars).toEqual(stars);
  });

  it('carries the deadline, an empty play log, and no cohort number', () => {
    const m = finale({}, 1234);
    expect(m.finaleClosesAt).toBe(5_000_000);
    expect(m.finalePlays).toEqual({});
    expect(m.series).toBe(1);        // it runs once; there is no Cohort II
    expect(m.state).toBe('forming');
    expect(m.participants).toEqual({});
  });
});

// ── Finding it ────────────────────────────────────────────────────────────────

describe('findFinale', () => {
  it('finds it among live missions', () => {
    expect(findFinale({ a: table(), f: finale() })?.casinoGame).toBe(FINALE_GAME);
  });

  it('finds a SETTLED one in history, so a second cannot be opened', () => {
    // It runs once. A finale that has already been played and archived must still
    // block the host from opening another.
    expect(findFinale({ a: table() }, { f: finale({ state: 'complete' }) })).not.toBeNull();
  });

  it('is null when the host has not opened one', () => {
    expect(findFinale({ a: table() }, {})).toBeNull();
    expect(findFinale(undefined, undefined)).toBeNull();
  });
});

// ── The shared stats corpus ───────────────────────────────────────────────────

describe('cardStatsCorpus', () => {
  it('excludes forming tables — a table that has not run is hypothetical', () => {
    const corpus = cardStatsCorpus({ f: table({ id: 'f', state: 'forming' }) }, {});
    expect(corpus).toHaveLength(0);
  });

  it('includes in-progress and complete tables', () => {
    const corpus = cardStatsCorpus(
      { a: table({ id: 'a', state: 'inprogress' }) },
      { b: table({ id: 'b', state: 'complete' }) },
    );
    expect(corpus.map(m => m.id).sort()).toEqual(['a', 'b']);
  });

  it('counts a complete mission once, from either node', () => {
    // An admin can park a mission at `complete` without archiving it, so the same
    // id can appear in both. Counting it twice would double every card on it.
    const done = table({ id: 'x', state: 'complete' });
    const corpus = cardStatsCorpus({ x: done }, { x: done });
    expect(corpus.filter(m => m.id === 'x')).toHaveLength(1);
  });
});
