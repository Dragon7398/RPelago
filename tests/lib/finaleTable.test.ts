import { describe, it, expect } from 'vitest';
import {
  CASINO_GAMES, CASINO_GAME_ORDER, FINALE_GAME, isFinale, minCasinoAnte,
  FINALE_ROWS, FINALE_ROW_REELS, FINALE_BOARD_CARDS, FINALE_MAX_REROLL_REELS,
  finaleReelIndices, finaleRowIndices, applyReelRespin, seatSpend,
  COAT_TABLE_TYPES, COAT_TYPES_REQUIRED, deckChoiceOf,
} from '../../src/lib/casinoData';
import {
  currentMaxSlots, msToNextDecay, seatTally, shouldDeploy, finaleEntryClosed, allSeatsPlayed, fmtDur,
  casinoEntryCosts, freshFinaleTable, findFinale, cardStatsCorpus, pickNextCasinoGame,
  FINALE_BASE_MAX, casinoTableSettlement, casinoShareDenominator, type FinaleSetup,
  missionPendingAction, outstandingConfigsBlockRoom, seatOwesConfig, seatsMissingConfig,
  seatsAwaitingConfig,
} from '../../src/lib/missionLogic';
import {
  FINALE_REBUY_GOLD, finaleBoardCost, finaleBoardRefusal, finaleOwnGold, finaleClaimedGold,
  FINALE_BASE_GOLD, FINALE_GOLD_PER_STAR, FINALE_MIN_GOLD, FINALE_MAX_GOLD,
} from '../../src/lib/finaleStars';
import { cardsToSlots, finaleSlotDetails, handStakeFromSlots, repickPool, repickLockedCount } from '../../src/lib/casinoSlots';
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

// ── The Coat of Many Colors ──────────────────────────────────────────────────
//
// The finale adds a FIFTH route to a requirement of four. The whole point of the
// change is that it is strictly more generous, so the regression (an existing
// holder keeps it) matters more than the new path.

describe('the Coat counts the finale as a table type', () => {
  // The grant in `completeMission` is a client write over the player record, so
  // this is the rule it applies, expressed the same way.
  const earns = (...types: string[]) => {
    const completed: Record<string, boolean> = {};
    for (const t of types) completed[t] = true;
    return COAT_TABLE_TYPES.filter(g => completed[g]).length >= COAT_TYPES_REQUIRED;
  };

  it('is five routes against a requirement of four', () => {
    expect(COAT_TABLE_TYPES).toEqual([...CASINO_GAME_ORDER, FINALE_GAME]);
    expect(COAT_TABLE_TYPES).toHaveLength(5);
    expect(COAT_TYPES_REQUIRED).toBe(4);
    // ⚠️ The tripwire that matters: this list may grow the finale, the ROTATION
    // may not. If someone ever 'simplifies' these into one array, the finale
    // enters the respawn rotation and zeroes minCasinoAnte.
    expect(CASINO_GAME_ORDER).not.toContain(FINALE_GAME);
  });

  it('still grants the Coat for all four games — no existing holder can lose it', () => {
    // THE regression. The old rule was `CASINO_GAME_ORDER.every(...)`; everyone
    // who satisfied it has four types and so still clears four of five.
    expect(earns(...CASINO_GAME_ORDER)).toBe(true);
  });

  it('grants it for three games plus the finale — the route this adds', () => {
    expect(earns('five_card_draw', 'seven_card_stud', 'holdem', FINALE_GAME)).toBe(true);
    expect(earns('blackjack', 'holdem', 'seven_card_stud', FINALE_GAME)).toBe(true);
  });

  it('grants it for all five, and does not require them', () => {
    expect(earns(...COAT_TABLE_TYPES)).toBe(true);
  });

  it('still refuses three types, with or without the finale', () => {
    // The finale is one route among five, not a shortcut: it replaces a game, it
    // does not reduce the count.
    expect(earns('five_card_draw', 'seven_card_stud', 'holdem')).toBe(false);
    expect(earns('five_card_draw', 'seven_card_stud', FINALE_GAME)).toBe(false);
    expect(earns(FINALE_GAME)).toBe(false);
    expect(earns()).toBe(false);
  });

  it('counts each type once, however many tables of it a player ran', () => {
    // `casinoGamesCompleted` is a set of booleans, so this is structural — but it
    // is the thing a reader assumes and worth pinning.
    expect(earns('blackjack', 'blackjack', 'blackjack', 'blackjack')).toBe(false);
  });
});


// ── Who may still be dealt a board ───────────────────────────────────────────
//
// The rule `dealFinaleBoard` enforces and the arm screen renders, said once. The
// distinction it draws is the one the first implementation got WRONG: the
// deadline closes ENTRY, and enlisting is entry, so a player who was let in may
// still take their first board afterwards. A flat deadline test there left them
// pressing a live button the server rejected until the idle sweep removed them.

describe('finaleBoardRefusal', () => {
  const DAY = 86_400_000;
  const first  = { folds: 0 };
  const rebuy  = { folds: 1 };

  it('allows a FIRST board after entry has closed — the regression', () => {
    expect(finaleBoardRefusal(first, 1_000, 9_999)).toBeNull();
    // …including for a seat with no play record at all, which is the shape a
    // player who enlisted and never spun actually has.
    expect(finaleBoardRefusal(undefined, 1_000, 9_999)).toBeNull();
    expect(finaleBoardRefusal({}, 1_000, 9_999)).toBeNull();
  });

  it('allows a rebuy while entry is still open', () => {
    expect(finaleBoardRefusal(rebuy, 10_000, 9_999)).toBeNull();
    expect(finaleBoardCost(rebuy)).toBe(FINALE_REBUY_GOLD);
  });

  it('refuses a rebuy once entry has closed', () => {
    expect(finaleBoardRefusal(rebuy, 1_000, 9_999)).toBe('rebuy-closed');
    // However many times they have folded.
    expect(finaleBoardRefusal({ folds: 7 }, 1_000, 9_999)).toBe('rebuy-closed');
  });

  it('treats the deadline instant itself as closed, like finaleEntryClosed', () => {
    expect(finaleBoardRefusal(rebuy, 5_000, 4_999)).toBeNull();
    expect(finaleBoardRefusal(rebuy, 5_000, 5_000)).toBe('rebuy-closed');
  });

  it('allows everything when no deadline has been set', () => {
    // A table mid-creation, or one the host has not dated. Never guess a close.
    expect(finaleBoardRefusal(rebuy, null, Date.now() + DAY)).toBeNull();
    expect(finaleBoardRefusal(rebuy, undefined, Date.now() + DAY)).toBeNull();
  });

  it('agrees with finaleBoardCost about which boards are free', () => {
    // The join between the two: a board that costs nothing is never refused, so
    // the free-board case can only ever be gated by the seat itself.
    for (const folds of [0, 1, 2, 5]) {
      const free = finaleBoardCost({ folds }) === 0;
      expect(finaleBoardRefusal({ folds }, 1_000, 9_999) === null).toBe(free);
    }
  });
});

// ── The re-pick pool after a host edit ───────────────────────────────────────
//
// `adminRemoveCasinoSlot` cannot reach the seat's dealt pool, which is what a
// resubmit re-selects from — so a struck card is kept out by uid instead. Applied
// on both sides, or the client offers a card the server refuses to commit.

describe('repickPool', () => {
  const pool = [card('Sonic', 0), card('Zelda', 1), card('Metroid', 2)];

  it('leaves an ordinary seat\u2019s pool untouched — the regression half', () => {
    // Every table, every seat, every day: nothing has been struck, so nothing is
    // filtered. This is the case that must not change.
    expect(repickPool(pool, {})).toEqual(pool);
    expect(repickPool(pool, undefined)).toEqual(pool);
    expect(repickPool(pool, { removedCardUids: [] })).toEqual(pool);
  });

  it('drops a struck card', () => {
    expect(repickPool(pool, { removedCardUids: [1] }).map(c => c.name))
      .toEqual(['Sonic', 'Metroid']);
  });

  it('drops several, and leaves the survivors in order', () => {
    expect(repickPool(pool, { removedCardUids: [2, 0] }).map(c => c.name))
      .toEqual(['Zelda']);
  });

  it('can empty the pool, which the callers must then refuse on', () => {
    // `resubmitCasinoYaml` answers "your dealt hand is no longer available" —
    // better than silently offering a re-pick with nothing in it.
    expect(repickPool(pool, { removedCardUids: [0, 1, 2] })).toEqual([]);
  });

  it('ignores a uid that is not in this pool', () => {
    // A finale seat re-picks from its ROW, not the whole board, so a card struck
    // from elsewhere legitimately will not be found here.
    expect(repickPool(pool, { removedCardUids: [99] })).toEqual(pool);
  });

  it('survives the holes RTDB puts in an array', () => {
    // A sparse array comes back with undefined in the gaps, which is what the
    // typeof guard is for — not defensive noise.
    const holey = [undefined, 1, null] as unknown as number[];
    expect(repickPool(pool, { removedCardUids: holey }).map(c => c.name))
      .toEqual(['Sonic', 'Metroid']);
  });

  it('never aliases the pool it was given', () => {
    const out = repickPool(pool, {});
    expect(out).not.toBe(pool);
    out.pop();
    expect(pool).toHaveLength(3);
  });
});

// ── The pot denominator after a host edit ────────────────────────────────────
//
// `repickPool` keeps a struck CARD out of the re-pick; this keeps its SHARE out.
// Both halves are needed: without the second, a denied player re-picks their
// remaining cards and the seat silently recovers the pot weight a void already
// released to the table (or a kick reserved for a claimant), so the table pays out
// more than it holds.

describe('repickLockedCount', () => {
  it('is the committed count on a FORMING table, struck cards or not', () => {
    // Nothing is banked pre-deploy: casinoShareUnits is counted at deploy and a
    // forming void skips the voidedShare increment, so the seat is one whole unit
    // however often its hand is rebuilt. Carrying strikes here would underpay it.
    expect(repickLockedCount('forming', 3, {})).toBe(3);
    expect(repickLockedCount('forming', 3, { removedCardUids: [7] })).toBe(3);
    expect(repickLockedCount('forming', 5, { removedCardUids: [1, 2] })).toBe(5);
  });

  it('leaves an ordinary live seat at its committed count — the regression half', () => {
    // The common case by far: a host deny on a table nobody has had cards struck
    // from. One seat, one unit. This is what must not change.
    expect(repickLockedCount('inprogress', 4, {})).toBe(4);
    expect(repickLockedCount('inprogress', 4, undefined)).toBe(4);
    expect(repickLockedCount('inprogress', 4, { removedCardUids: [] })).toBe(4);
  });

  it('holds a struck card in the denominator on a LIVE table', () => {
    // Dealt 5, host voids one (0.2 released), player re-picks the other 4.
    // Restamping to 4 would return the seat to weight 1.0 against a denominator
    // that has already shrunk by 0.2 — the over-pay.
    expect(repickLockedCount('inprogress', 4, { removedCardUids: [2] })).toBe(5);
    expect(repickLockedCount('inprogress', 3, { removedCardUids: [2, 4] })).toBe(5);
  });

  it('never lets a re-picked live seat exceed the share its strikes left it', () => {
    // The invariant the whole rule exists for, stated as arithmetic: seat weight
    // plus every carved fraction can never exceed the one unit it started as.
    const dealt = 5;
    for (const struckCount of [0, 1, 2, 3]) {
      const struck = Array.from({ length: struckCount }, (_, i) => i);
      const carved = struckCount / dealt;              // released or reserved elsewhere
      for (let committed = 1; committed <= dealt - struckCount; committed++) {
        const denom  = repickLockedCount('inprogress', committed, { removedCardUids: struck });
        const weight = committed / denom;
        expect(weight + carved).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('survives the holes RTDB puts in an array', () => {
    const holey = [undefined, 3, null] as unknown as number[];
    expect(repickLockedCount('inprogress', 4, { removedCardUids: holey })).toBe(5);
  });
});

// ── Which deck a seat is priced off ─────────────────────────────────────────
//
// `setCasinoDeckChoice` refuses to move once a finale board exists, but it reads
// the board and writes the choice in two steps — so a client firing both calls at
// once can still slip a change in behind the deal, and lock the same cards in at
// the other variant's boost. The deal therefore STAMPS the deck it used, and this
// accessor prefers the stamp, which makes the race unwinnable rather than unlikely.

describe('deckChoiceOf', () => {
  it('prefers the deck the board was dealt from', () => {
    expect(deckChoiceOf({ deckChoice: 'purist', finaleDeck: 'safety' })).toBe('safety');
    expect(deckChoiceOf({ deckChoice: 'safety', finaleDeck: 'purist' })).toBe('purist');
  });

  it('falls back to the standing pick when nothing is stamped', () => {
    // Every ordinary table, always: `finaleDeck` is never written there, so this
    // is exactly the old behaviour and no other game changes.
    expect(deckChoiceOf({ deckChoice: 'safety' })).toBe('safety');
    expect(deckChoiceOf({ deckChoice: 'indie' })).toBe('indie');
  });

  it('defaults to purist with neither', () => {
    expect(deckChoiceOf({})).toBe('purist');
  });

  it('prices a stamped board off the stamp, which is the gold difference', () => {
    // The exploit in one assertion: spin on Safety, switch to Purist behind the
    // deal, lock the same stars in. The stamp is what stops the +10%.
    const stars = 12;
    const seat  = { deckChoice: 'purist' as const, finaleDeck: 'safety' as const };
    expect(finaleOwnGold(stars, deckChoiceOf(seat)))
      .toBe(finaleOwnGold(stars, 'safety'));
    expect(finaleOwnGold(stars, deckChoiceOf(seat)))
      .toBeLessThan(finaleOwnGold(stars, 'purist'));
  });
});
// ── What the player is told a board is worth ─────────────────────────────────
//
// Three surfaces advertise this range — the landing card, the Games modal and the
// help section — and each reads the constants rather than printing 60–300, so what
// a player is PROMISED and what `finaleOwnGold` PAYS cannot drift. These tests are
// the join between the two.

describe('the advertised payout range', () => {
  it('matches the formula at both ends, before any deck boost', () => {
    // Floor: the hand floor is one card (FinaleBoard refuses to drop the last),
    // and the cheapest card is 1★. Ceiling: a full row of five 5★ cards.
    expect(FINALE_MIN_GOLD).toBe(finaleOwnGold(1, 'unconsoled'));
    expect(FINALE_MAX_GOLD).toBe(finaleOwnGold(FINALE_ROW_REELS * 5, 'unconsoled'));
    expect([FINALE_MIN_GOLD, FINALE_MAX_GOLD]).toEqual([60, 300]);
  });

  it('is derived, so it tracks the base and per-star constants', () => {
    expect(FINALE_MIN_GOLD).toBe(FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR);
    expect(FINALE_MAX_GOLD).toBe(FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR * FINALE_ROW_REELS * 5);
  });

  it('tops out at 330 on Purist and 270 on Safety', () => {
    // The two figures the impl doc names. Deck boost is applied to the whole
    // reward, base included — which is why these are not 300 ± 25.
    expect(finaleOwnGold(FINALE_ROW_REELS * 5, 'purist')).toBe(330);
    expect(finaleOwnGold(FINALE_ROW_REELS * 5, 'safety')).toBe(270);
  });

  it('pays a claimed card stars only — no base, no boost', () => {
    // ⚠️ The +50 is the fee for sitting down and spinning, so a claimant never
    // collects it. The range above is therefore an OWN-hand range and the
    // surfaces that print it are all offering a seat, not a claim.
    expect(finaleClaimedGold(5)).toBe(FINALE_GOLD_PER_STAR * 5);
    expect(finaleClaimedGold(5)).toBeLessThan(FINALE_MIN_GOLD + FINALE_GOLD_PER_STAR * 4);
  });
});

// ── fmtDur ───────────────────────────────────────────────────────────────────
//
// Moved out of CasinoShell into missionLogic so the landing card and the phase
// panel can read one copy (the panel is imported BY the landing, so exporting it
// from there would be a cycle). Pinned because the move must not change it: it is
// what the finale's entry countdown is rendered with.

describe('fmtDur', () => {
  it('renders a forward duration at the coarsest useful unit', () => {
    expect(fmtDur(40 * 60_000)).toBe('40m');
    expect(fmtDur(5 * HOUR + 20 * 60_000)).toBe('5h 20m');
    expect(fmtDur(28 * HOUR)).toBe('1d 4h');
  });

  it('never renders a negative duration', () => {
    // A deadline a second in the past must not read as '-1m'. The callers test
    // `finaleEntryClosed` first, so this is belt-and-braces.
    expect(fmtDur(-1)).toBe('0m');
    expect(fmtDur(-5 * HOUR)).toBe('0m');
  });
});
