import { describe, it, expect } from 'vitest';
import {
  flatMercCuts, casinoMercCuts, mercTotals, normalizeHandle, playersByHandle, mercHireBlockers,
} from '../../src/lib/mercLogic';
import { casinoTableSettlement, casinoTableShares } from '../../src/lib/missionLogic';
import { awardTileRewards } from '../../src/lib/gameLogic';
import type { AdvSlot, GMMission, GMParticipant, Player, Tile } from '../../src/types';
import type { DeckCard } from '../../src/lib/casinoData';

const merc = (playerId: string) => ({ playerId, playerName: playerId.toUpperCase(), since: 0 });
const slot = (p: Partial<AdvSlot> = {}): AdvSlot => ({ name: '', game: '', ...p });
const card = (uid: number, value: number) =>
  ({ uid, copyIndex: 0, name: `c${uid}`, type: 'broad', count: 1, value, copies: 1 }) as DeckCard;
const seat = (p: Partial<GMParticipant>): GMParticipant =>
  ({ playerId: 'p', playerName: 'P', joinedAt: 0, played: true, ...p }) as GMParticipant;

describe('flatMercCuts', () => {
  it('gives the merc half of an even share of the base, plus half the slot bonus', () => {
    const cuts = flatMercCuts(100, 60, [slot({ merc: merc('m'), bonusGold: 10 }), slot()], 'o');
    // xp: (100/2)/2 = 25. gold: (60/2 + 10)/2 = 20.
    expect(cuts.get('m')).toMatchObject({ xp: 25, gold: 20, slots: 1 });
  });

  it('floors each half, leaving the remainder with the owner', () => {
    const cuts = flatMercCuts(50, 50, [slot({ merc: merc('m') }), slot(), slot()], 'o');
    // 50/3 = 16.67 → half = 8.33 → 8.
    expect(cuts.get('m')).toMatchObject({ xp: 8, gold: 8 });
  });

  it('ignores a merc naming the owner', () => {
    expect(flatMercCuts(100, 100, [slot({ merc: merc('o') })], 'o').size).toBe(0);
  });

  it('sums one merc across several slots', () => {
    const cuts = flatMercCuts(100, 100, [slot({ merc: merc('m') }), slot({ merc: merc('m') })], 'o');
    expect(cuts.get('m')).toMatchObject({ xp: 50, gold: 50, slots: 2 });
  });
});

describe('casinoMercCuts', () => {
  it('halves a boosted own card and its 1/lockedCount weight', () => {
    const p = seat({
      deckChoice: 'purist', lockedCount: 3,
      slots:       [slot({ merc: merc('m') }), slot(), slot()],
      lockedCards: [card(0, 45), card(1, 30), card(2, 30)],
    });
    const c = casinoMercCuts(p, 0).get('m')!;
    expect(c.gold).toBe(Math.floor((45 * 1.1) / 2));   // 24
    expect(c.weight).toBeCloseTo(1 / 6);
  });

  it('halves a CLAIMED card flat (no boost) and its carried fraction', () => {
    const p = seat({
      deckChoice: 'purist', lockedCount: 2,
      slots:       [slot(), slot(), slot({ claimed: true, claimedFraction: 0.25, merc: merc('m') })],
      lockedCards: [card(0, 30), card(1, 30), card(7, 40)],
    });
    const c = casinoMercCuts(p, 0).get('m')!;
    expect(c.gold).toBe(20);
    expect(c.weight).toBeCloseTo(0.125);
  });

  it('pairs cards and slots after compacting null holes, as the server does', () => {
    const p = seat({
      lockedCount: 2,
      slots:       [null as unknown as AdvSlot, slot(), slot({ merc: merc('m') })],
      lockedCards: [card(0, 10), card(1, 50)],
    });
    // No deckChoice reads as Purist (+10%), so the 50 card is worth 55.
    expect(casinoMercCuts(p, 0).get('m')!.gold).toBe(27);
  });
});

describe('casinoTableSettlement', () => {
  const table = (participants: Record<string, GMParticipant>): GMMission =>
    ({ id: 't', type: 'casino', pot: 300, casinoShareUnits: 2, participants } as unknown as GMMission);

  const a = seat({
    playerId: 'a', lockedCount: 3,
    slots: [slot({ merc: merc('m') }), slot(), slot()],
    lockedCards: [card(0, 30), card(1, 30), card(2, 30)],
  });
  const b = seat({
    playerId: 'b', lockedCount: 2,
    slots: [slot(), slot()], lockedCards: [card(0, 30), card(1, 30)],
  });

  it('moves half a slot of pot weight to the merc without changing the total', () => {
    const { seat: s, merc: m } = casinoTableSettlement(table({ a, b }), () => 0);
    expect(m.get('m')).toBe(Math.floor((300 * (1 / 6)) / 2));   // 25
    expect(s.get('a')).toBe(Math.floor((300 * (5 / 6)) / 2));   // 125
    expect(s.get('b')).toBe(150);
    expect((s.get('a') ?? 0) + (m.get('m') ?? 0)).toBe(150);    // a's seat still worth one unit in total
  });

  it('pays a merc who is also seated both shares', () => {
    const am = { ...a, slots: [slot({ merc: merc('b') }), slot(), slot()] };
    const total = casinoTableShares(table({ a: am, b }), () => 0);
    expect(total.get('b')).toBe(150 + 25);
    expect([...total.values()].reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(300);
  });

  it('agrees with mercTotals for the owner side', () => {
    expect(mercTotals(casinoMercCuts(a, 0)).weight).toBeCloseTo(1 / 6);
  });
});

describe('awardTileRewards with a merc', () => {
  const player = (id: string): Player =>
    ({ id, displayName: id, xp: 0, gold: 0, adventurers: {}, feats: {} }) as unknown as Player;

  it('splits the merced slot’s share of the owner’s reward', () => {
    const tile = {
      xp: 40, gold: 100,
      adventurers: {
        a1: { advId: 'a1', owner: 'o', ownerName: 'o', name: 'A', cls: 'fighter',
              slots: [slot({ merc: merc('m') }), slot()] },
      },
    } as unknown as Tile;
    const out = awardTileRewards(tile, { o: player('o'), m: player('m') }, 'B2');
    expect(out.m).toMatchObject({ xp: 10, gold: 25 });
    expect(out.o).toMatchObject({ xp: 30, gold: 75 });
  });
});

describe('handle matching', () => {
  it('normalises @, case and whitespace', () => {
    expect(normalizeHandle('  @@Tamsin ')).toBe('tamsin');
  });

  it('finds the player and only them', () => {
    const players = {
      x: { id: 'x', discordHandle: 'tamsin' },
      y: { id: 'y', discordHandle: 'tamsin_2' },
      z: { discordHandle: 'tamsin' },   // phantom record with no id — never a match
    };
    expect(playersByHandle(players, '@Tamsin').map(p => p.id)).toEqual(['x']);
    expect(playersByHandle(players, '')).toEqual([]);
  });
});

describe('mercHireBlockers', () => {
  it('a claimed slot can never be merced', () => {
    const t = slot({ claimed: true });
    expect(mercHireBlockers(t, [t, slot(), slot()], false)).toEqual(['claimed']);
  });

  it('a single slot cannot be merced at all', () => {
    const t = slot();
    expect(mercHireBlockers(t, [t], false)).toEqual(['allSlots']);
  });

  it('of three slots, two may be merced but not the third (non-casino)', () => {
    const [a, b, c] = [slot(), slot(), slot()];
    expect(mercHireBlockers(b, [a, b, c], false)).toEqual([]);
    a.merc = merc('m');
    expect(mercHireBlockers(b, [a, b, c], false)).toEqual([]);
    b.merc = merc('n');
    expect(mercHireBlockers(c, [a, b, c], false)).toEqual(['allSlots']);
  });

  it('a casino seat may have only one merced slot', () => {
    const [a, b, c] = [slot({ merc: merc('m') }), slot(), slot()];
    expect(mercHireBlockers(b, [a, b, c], true)).toEqual(['casinoLimit']);
  });

  it('replacing the merc already on a slot does not count that slot against itself', () => {
    const [a, b] = [slot({ merc: merc('m') }), slot()];
    expect(mercHireBlockers(a, [a, b], true)).toEqual([]);
  });

  it('ignores null holes when counting', () => {
    const t = slot();
    expect(mercHireBlockers(t, [null, t, undefined, slot()], false)).toEqual([]);
  });
});
