import { describe, it, expect } from 'vitest';
import { sourcedGameTitles, newGamesInYaml, gameTitleKey } from '../../src/lib/missionLogic';
import type { AdvSlot, GMMission, GMParticipant } from '../../src/types';

const seat = (id: string, games: string[]): GMParticipant => ({
  playerId: id, playerName: id.toUpperCase(), joinedAt: 0,
  slots: games.map<AdvSlot>(g => ({ name: `${id}_slot`, game: g })),
});

const mission = (
  id: string,
  state: GMMission['state'],
  seats: GMParticipant[],
  extra: Partial<GMMission> = {},
): GMMission => ({
  id, type: 'casino', series: 1, label: id, state,
  baseMax: 4, xp: 50, gp: 0, release: 'on', collect: 'off', hint: 10,
  firstJoinAt: 0, createdAt: 0,
  participants: Object.fromEntries(seats.map(s => [s.playerId, s])),
  ...extra,
});

describe('sourcedGameTitles', () => {
  it('counts complete missions and in-progress ones that have a room', () => {
    const seen = sourcedGameTitles([
      mission('done', 'complete',   [seat('a', ['Celeste'])]),
      mission('live', 'inprogress', [seat('b', ['Timespinner'])], { link: 'https://ap/room/1' }),
    ]);
    expect([...seen].sort()).toEqual(['celeste', 'timespinner']);
  });

  it('ignores forming tables and in-progress ones still awaiting a room', () => {
    const seen = sourcedGameTitles([
      mission('form', 'forming',    [seat('a', ['Celeste'])]),
      mission('noroom', 'inprogress', [seat('b', ['Timespinner'])]),  // no link yet
    ]);
    expect(seen.size).toBe(0);
  });

  it('excludes the mission being verified, so its own games never count as sourced', () => {
    const ms = [mission('live', 'inprogress', [seat('a', ['Celeste'])], { link: 'https://ap/room/1' })];
    expect(sourcedGameTitles(ms).has('celeste')).toBe(true);
    expect(sourcedGameTitles(ms, 'live').size).toBe(0);
  });

  it('includes claimable slots — they were carved off a seat on a room that exists', () => {
    const seen = sourcedGameTitles([
      mission('live', 'inprogress', [seat('a', ['Celeste'])], {
        link: 'https://ap/room/1',
        claimableSlots: { k1: { slots: [{ name: 'orphan', game: 'Hollow Knight' }] } },
      }),
    ]);
    expect(seen.has('hollow knight')).toBe(true);
  });

  it('folds case and whitespace, and drops slots with no game chosen yet', () => {
    const seen = sourcedGameTitles([
      mission('done', 'complete', [seat('a', ['  A Link  to the   Past ', ''])]),
    ]);
    expect([...seen]).toEqual(['a link to the past']);
    expect(gameTitleKey('  A Link  to the   Past ')).toBe('a link to the past');
  });
});

describe('newGamesInYaml', () => {
  const sourced = new Set(['celeste']);

  it('flags only the games missing from the sourced set', () => {
    const text = 'name: P1\ngame: Celeste\n---\nname: P2\ngame: Timespinner\n';
    expect(newGamesInYaml(text, sourced)).toEqual(['Timespinner']);
  });

  it('returns nothing when every world is already sourced', () => {
    expect(newGamesInYaml('name: P1\ngame: celeste\n', sourced)).toEqual([]);
  });

  it('dedupes a title repeated across worlds', () => {
    const text = 'name: P1\ngame: Hollow Knight\n---\nname: P2\ngame: hollow  knight\n';
    expect(newGamesInYaml(text, sourced)).toEqual(['Hollow Knight']);
  });

  it('marks the viable candidates of a weighted game as maybes', () => {
    const text = 'name: P1\ngame:\n  Celeste: 1\n  Timespinner: 1\n  Undertale: 0\n';
    expect(newGamesInYaml(text, sourced)).toEqual(['Timespinner (?)']);
  });

  it('ignores an unparseable or gameless file rather than flagging it', () => {
    expect(newGamesInYaml('name: P1\ndescription: no game here\n', sourced)).toEqual([]);
    expect(newGamesInYaml('', sourced)).toEqual([]);
  });
});
