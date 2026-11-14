import { describe, it, expect } from 'vitest';
import {
  CASINO_GAMES, CASINO_GAME_ORDER, FINALE_GAME, isFinale, minCasinoAnte,
  FINALE_ROWS, FINALE_ROW_REELS, FINALE_BOARD_CARDS, FINALE_MAX_REROLL_REELS,
  finaleReelIndices, finaleRowIndices, applyReelRespin, seatSpend,
} from '../../src/lib/casinoData';
import {
  currentMaxSlots, msToNextDecay, seatTally, shouldDeploy, finaleEntryClosed, allSeatsPlayed,
  casinoEntryCosts, freshFinaleTable, findFinale, cardStatsCorpus, pickNextCasinoGame,
  FINALE_BASE_MAX, casinoTableSettlement, casinoShareDenominator, type FinaleSetup,
  missionPendingAction, outstandingConfigsBlockRoom, seatOwesConfig, seatsMissingConfig,
  seatsAwaitingConfig,
} from '../../src/lib/missionLogic';
import { FINALE_REBUY_GOLD, finaleBoardCost } from '../../src/lib/finaleStars';
import { cardsToSlots, finaleSlotDetails, handStakeFromSlots } from '../../src/lib/casinoSlots';
import type { GMMission } from '../../src/types';

const HOUR = 3_600_000;

/** A minimal DeckCard, enough for the board-index assertions. */
const card = (name: string, uid: number) =>
  ({ name, type: 'broad', count: 1, value: 30, copies: 1, uid, copyIndex: 0 }) as never;

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
  it('has no cap, however long entry stays open', () => {
    // ⚠️ The cap is uncapped only WHILE ENTRY IS OPEN — the deadline closes it to
    // the seated count (see `entry closing`). So this pins the no-decay half: a
    // table open for weeks still has no cap, which is what keeps every
    // `filled >= max` gate false by construction for as long as players may enter.
    const m = finale({ firstJoinAt: 0, finaleClosesAt: 9e12, participants: seats(30) });
    expect(currentMaxSlots(m, 400 * HOUR)).toBe(Infinity);
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

// ── Entry closing, and the closing phase it opens ────────────────────────────
//
// THE THREE PHASES. The deadline does NOT deploy the table — it closes the seat
// cap, and the ordinary `shouldDeploy` rule then deploys once every seat has
// locked in. So:
//
//   1. entry open    — cap Infinity, anyone may enter, nothing deploys
//   2. entry closed  — cap = seated count, table reads FULL, the seats that spun
//                      finish their row + config; a straggler holds it here
//   3. all locked in — shouldDeploy fires, the room is generable
//
// Deploying AT the deadline (the first shape of this) stranded every player still
// mid-manifest, because locking in requires a `forming` table.

describe('entry closing', () => {
  const closing = { finaleClosesAt: 1_000 } as Partial<GMMission>;

  it('is the deadline, and nothing else', () => {
    const m = finale(closing);
    expect(finaleEntryClosed(m, 999)).toBe(false);
    expect(finaleEntryClosed(m, 1_000)).toBe(true);
    expect(finaleEntryClosed(m, 5_000)).toBe(true);
  });

  it('stays open forever when the deadline is missing', () => {
    // A half-written mission should stall visibly, not shut its own doors.
    expect(finaleEntryClosed(finale({ finaleClosesAt: undefined }), 9e12)).toBe(false);
  });

  it('does not test state — a closed finale is closed whatever it is doing', () => {
    // ⚠️ Deliberate, and the reverse of the old predicate. A finale stays `forming`
    // through its whole closing phase, so a `state === 'forming'` term here would
    // have been invisible; but it also must keep answering once deployed, since
    // the admin panel words itself from this.
    expect(finaleEntryClosed(finale({ ...closing, state: 'inprogress' }), 9e12)).toBe(true);
  });

  it('never claims an ordinary table has closed', () => {
    expect(finaleEntryClosed(table({ finaleClosesAt: 1 }), 9e12)).toBe(false);
  });

  it('closes the seat cap, which is what makes the table read as full', () => {
    // THE load-bearing line of the whole closing phase. One change to the cap is
    // what reaches enlist's `filled >= max` gate, shouldDeploy, the config roster's
    // severity and the admin board's triage — none of which needed a finale branch.
    const m = finale({ ...closing, participants: seats(4) });
    expect(currentMaxSlots(m, 999)).toBe(Infinity);
    expect(currentMaxSlots(m, 1_000)).toBe(4);
  });

  it('closes an EMPTY finale to a cap of 0 without deploying or complaining', () => {
    // 0 >= 0 refuses a late entrant, while the `filled === 0` guards keep it from
    // deploying an empty table or reporting work to the host.
    const m = finale({ ...closing, participants: {} });
    expect(currentMaxSlots(m, 9e12)).toBe(0);
    expect(shouldDeploy(m, 9e12)).toBe(false);
  });
});

describe('the three phases', () => {
  // A seat that spun and locked in, and one that spun and did not.
  const done    = { playerId: 'd', playerName: 'D', joinedAt: 0, played: true } as never;
  const pending = { playerId: 'p', playerName: 'P', joinedAt: 0 } as never;
  const at = (over: Partial<GMMission>) => finale({ finaleClosesAt: 1_000, ...over });

  it('1 — never deploys while entry is open, however full or finished it looks', () => {
    // The cap is Infinity, so `filled >= max` is false by construction. Even a
    // table where every seat has already locked in keeps taking players.
    const m = at({ firstJoinAt: 0, participants: { d: done } });
    expect(allSeatsPlayed(m)).toBe(true);
    expect(shouldDeploy(m, 999)).toBe(false);
  });

  it('2 — holds a closed table open for a seat that never locked in', () => {
    // ⚠️ THE decision this phase exists for: a straggler holds the table here
    // indefinitely rather than being stranded by a timer. Locking in or a host ⊘
    // void is what clears it.
    const m = at({ participants: { d: done, p: pending } });
    expect(currentMaxSlots(m, 9e12)).toBe(2);   // reads as full
    expect(allSeatsPlayed(m)).toBe(false);      // but not finished
    expect(shouldDeploy(m, 9e12)).toBe(false);
    expect(shouldDeploy(m, 9e12 + 500 * HOUR)).toBe(false);  // and no timer saves it
  });

  it('3 — deploys the moment the last seat locks in', () => {
    expect(shouldDeploy(at({ participants: { d: done, p: { ...pending, played: true } as never } }), 9e12))
      .toBe(true);
  });

  it('3 — or the moment the host voids the last straggler', () => {
    // Voiding deletes the seat, so the same predicate fires without the player.
    expect(shouldDeploy(at({ participants: { d: done } }), 9e12)).toBe(true);
  });

  it('does not deploy twice', () => {
    expect(shouldDeploy(at({ state: 'inprogress', participants: { d: done } }), 9e12)).toBe(false);
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

  it('respins a COLUMN, leaving every other card where it was', () => {
    // The off-by-one that matters: a row-major board makes "replace a reel" a
    // strided write, and the wrong stride respins a ROW — which would destroy the
    // one mechanic the reroll exists for while still looking plausible on screen.
    const board = Array.from({ length: FINALE_BOARD_CARDS }, (_, i) => card(`old${i}`, i));
    const fresh = [card('newA', 90), card('newB', 91), card('newC', 92)];
    const next  = applyReelRespin(board, [1], fresh);

    expect(next.map(c => c.name).filter(n => n.startsWith('new'))).toEqual(['newA', 'newB', 'newC']);
    // Column 1 is indices 1, 6, 11 — one per row, never 1, 2, 3.
    expect([next[1].name, next[6].name, next[11].name]).toEqual(['newA', 'newB', 'newC']);
    expect([next[2].name, next[3].name]).toEqual(['old2', 'old3']);
    // Everything outside the reel is untouched, and the board keeps its length.
    expect(next).toHaveLength(FINALE_BOARD_CARDS);
    for (const i of [0, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14]) {
      expect(next[i].name, `index ${i}`).toBe(`old${i}`);
    }
  });

  it('fills several reels in REEL order, not tap order', () => {
    // Both client and server must map `fresh` into the board the same way, however
    // the player happened to tap the reels.
    const board = Array.from({ length: FINALE_BOARD_CARDS }, (_, i) => card(`old${i}`, i));
    const fresh = Array.from({ length: 6 }, (_, i) => card(`n${i}`, 50 + i));
    const tapped  = applyReelRespin(board, [4, 0], fresh);
    const ordered = applyReelRespin(board, [0, 4], fresh);
    expect(tapped).toEqual(ordered);
    // Reel 0 takes the first three, reel 4 the next three.
    expect([tapped[0].name, tapped[5].name, tapped[10].name]).toEqual(['n0', 'n1', 'n2']);
    expect([tapped[4].name, tapped[9].name, tapped[14].name]).toEqual(['n3', 'n4', 'n5']);
  });

  it('never grows the board when handed too few replacements', () => {
    const board = Array.from({ length: FINALE_BOARD_CARDS }, (_, i) => card(`old${i}`, i));
    const next  = applyReelRespin(board, [0], []);
    expect(next).toHaveLength(FINALE_BOARD_CARDS);
    expect(next.map(c => c.name)).toEqual(board.map(c => c.name));
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

// ── Settlement needs no fork ──────────────────────────────────────────────────

describe('settlement', () => {
  const seat = (over: Record<string, unknown> = {}) => ({
    playerId: 'p', playerName: 'P', joinedAt: 0, played: true,
    lockedCards: [card('Sonic', 0), card('Zelda', 1)],
    slots: [{ name: 's0', game: 'g0' }, { name: 's1', game: 'g1' }],
    lockedCount: 2, goldSwing: 187,
    ...over,
  });

  it('pays nothing from the pot, because the finale has none', () => {
    // ⚠️ This is why completeMission needs NO finale branch: casinoPotShares
    // short-circuits on `pot <= 0`, so the whole weighted-split pipeline runs and
    // pays zero. The seat's stored goldSwing is the entire payout.
    const m = finale({ participants: { p: seat() } as never, state: 'complete' });
    const { seat: shares, merc } = casinoTableSettlement(m, () => 0);
    expect(shares.get('p')).toBe(0);
    expect([...merc.values()]).toEqual([]);
  });

  it('pays nothing even with seats banked and weight on the table', () => {
    // The denominator IS banked at deploy for a finale, like any casino table —
    // it is the zero pot alone that keeps the split inert. So this is the
    // assertion that matters: banking does no harm.
    const m = finale({
      participants: { p: seat(), q: { ...seat(), playerId: 'q' } } as never,
      casinoShareUnits: 2, casinoVoidedShare: 0, state: 'complete',
    });
    expect(casinoShareDenominator(m)).toBe(2);
    for (const g of casinoTableSettlement(m, () => 0).seat.values()) expect(g).toBe(0);
  });

  it('would pay out if the pot ever became non-zero — so it must stay 0', () => {
    // The inverse, stated so the risk is legible: nothing about a finale makes the
    // split refuse. Routing the 50g rebuy through potContribution would really
    // divide it among the seats.
    const m = finale({
      participants: { p: seat() } as never,
      pot: 200, casinoShareUnits: 1, casinoVoidedShare: 0, state: 'complete',
    });
    expect(casinoTableSettlement(m, () => 0).seat.get('p')).toBe(200);
  });
});

// ── The slot details line ─────────────────────────────────────────────────────

describe('slot details', () => {
  it('reads in stars, not gold', () => {
    expect(finaleSlotDetails({ name: 'Sonic', value: 68 }, 5)).toBe('Sonic · 5★');
  });

  it('is what cardsToSlots stamps when the formatter is passed', () => {
    const slots = cardsToSlots(
      [card('Sonic', 0), card('Zelda', 1)],
      (c, i) => finaleSlotDetails(c, i === 0 ? 5 : 2),
    );
    expect(slots.map(s => s.details)).toEqual(['Sonic · 5★', 'Zelda · 2★']);
    expect(slots.every(s => s.game === '' && s.status === 'Unstarted')).toBe(true);
  });

  it('leaves the ordinary gold line untouched by default', () => {
    // The regression half: every other table still stamps "Name · Ng".
    expect(cardsToSlots([card('Sonic', 0)])[0].details).toBe('Sonic · 30g');
  });

  it('reads back as 0 gold, which is why goldSwing must be stored', () => {
    // handStakeFromSlots parses "· Ng" out of the details line and finds nothing
    // here. That is safe ONLY because it is always a fallback behind
    // `p.goldSwing ?? …` — a finale seat that somehow lost its goldSwing would
    // display as 0 rather than guess.
    const slots = cardsToSlots([card('Sonic', 0)], c => finaleSlotDetails(c, 5));
    expect(handStakeFromSlots(slots)).toBe(0);
    expect(handStakeFromSlots(cardsToSlots([card('Sonic', 0)]))).toBe(30);
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

// ── The deadline close, and the stragglers it leaves ─────────────────────────
//
// The finale is the FIRST table that can reach `inprogress` holding a seat that
// never locked in: gmShouldDeploy demands allSeatsPlayed, so an ordinary cohort
// cannot (only a force-deploy can). Everything below is the host's view of that
// population — the machinery WS-F verified rather than built, pinned so a later
// change to the triage helpers cannot quietly drop the finale out of them.

describe('stragglers at the close', () => {
  // A player who spun and walked away: no `played`, no `yamlAt`, no slots.
  const straggler = { playerId: 's', playerName: 'S', joinedAt: 0, finaleRow: 1 } as never;
  // A seat that finished properly.
  const lockedIn  = { playerId: 'd', playerName: 'D', joinedAt: 0, played: true,
                      slots: [{ name: 'n', game: 'g', status: 'In-Progress' }] } as never;
  // A pure claimant, who never owed a config at all.
  const claimant  = { playerId: 'c', playerName: 'C', joinedAt: 0,
                      slots: [{ name: 'n', game: 'g', claimed: true }] } as never;

  it('counts the spun-and-vanished seat, and only that one', () => {
    expect(seatOwesConfig(straggler)).toBe(true);
    expect(seatOwesConfig(lockedIn)).toBe(false);
    // ⚠️ A claimant's `played` stays unset forever — testing it alone would
    // accuse every player who took over a voided card.
    expect(seatOwesConfig(claimant)).toBe(false);
    const m = finale({ participants: { s: straggler, d: lockedIn, c: claimant } });
    expect(seatsMissingConfig(m)).toBe(1);
  });

  it('is only a heads-up while entry is still open', () => {
    // The room could not be generated today regardless, so a config that is merely
    // late costs the host nothing yet — the table is still taking players.
    const m = finale({ finaleClosesAt: 1_000, participants: { s: straggler, d: lockedIn } });
    expect(outstandingConfigsBlockRoom(m, 0)).toBe(false);
  });

  it('turns red the moment ENTRY CLOSES, not when the table deploys', () => {
    // This is the whole reason the cap closes. These rows are now the only thing
    // between the host and a room, and the table cannot deploy until they clear —
    // so red is the honest colour, and it has to arrive while the table is still
    // `forming`. Under the old deadline-deploys design it stayed amber right up to
    // the moment the table went live, with the note telling the host there was
    // nothing to chase.
    const m = finale({ finaleClosesAt: 1_000, participants: { s: straggler, d: lockedIn } });
    expect(outstandingConfigsBlockRoom(m, 9e12)).toBe(true);
  });

  it('names the straggler for the host to chase, while still forming', () => {
    const m = finale({ finaleClosesAt: 1_000, participants: { s: straggler, d: lockedIn } });
    // The roster the admin card renders — one row per seat, by Discord handle.
    expect(seatsAwaitingConfig(m).map(r => r.playerId)).toEqual(['s']);
    expect(seatsAwaitingConfig(m)[0].reason).toBe('unsubmitted');
    // And the board tells them it is configs they are waiting on, not a room.
    const act = missionPendingAction(m, 9e12);
    expect(act?.code).toBe('configs');
    expect(act?.label).toBe('1 config');
  });

  it('still catches a straggler on a table that was force-deployed', () => {
    // adminForceDeploy is the one way a seat owing a config reaches `inprogress`.
    const m = finale({ state: 'inprogress', participants: { s: straggler, d: lockedIn } });
    expect(outstandingConfigsBlockRoom(m, 0)).toBe(true);
    expect(missionPendingAction(m, 0)?.code).toBe('configs');
  });

  it('goes quiet once every straggler has been voided (force-deployed table)', () => {
    // Voiding is a whole-seat removal in the forming shape — no claimable slot,
    // since minting one with no config behind it blocks the room with something
    // nobody can play. With the seat gone the host can generate.
    const m = finale({ state: 'inprogress', participants: { d: lockedIn } });
    expect(seatsMissingConfig(m)).toBe(0);
    expect(outstandingConfigsBlockRoom(m, 0)).toBe(false);
    expect(missionPendingAction(m, 0)?.code).toBe('generate');
  });

  it('says nothing while entry is open — there is nothing to do yet', () => {
    // An OPEN finale is never 'full', so it never reaches the forming triage arms.
    // That is correct: the host's job starts when entry closes.
    const m = finale({ finaleClosesAt: 9e12, participants: { s: straggler, d: lockedIn } });
    expect(missionPendingAction(m, 0)).toBeNull();
  });

  it('reports ready-to-deploy once the last config lands', () => {
    const m = finale({ finaleClosesAt: 1_000, participants: { d: lockedIn } });
    expect(missionPendingAction(m, 9e12)?.code).toBe('deploy');
  });
});
