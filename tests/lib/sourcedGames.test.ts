import { describe, it, expect } from 'vitest';
import { sourcedGameLists, gameNoveltyInYaml, gameTitleKey, sourcedAt } from '../../src/lib/missionLogic';
import { AP_LISTS, apListAt, apListIndexAt, currentApList, isCurrentApList } from '../../src/lib/apLists';
import type { AdvSlot, GMMission, GMParticipant } from '../../src/types';

// Anchored to the registry rather than to fixed dates, so appending a new list
// (the ratchet) leaves these tests meaningful instead of silently re-scoped.
const CURRENT = currentApList();
const PREV    = AP_LISTS[AP_LISTS.length - 2];
const onCurrentList = CURRENT.from + 3_600_000;
const onPrevList    = CURRENT.from - 3_600_000;

const seat = (id: string, games: string[]): GMParticipant => ({
  playerId: id, playerName: id.toUpperCase(), joinedAt: 0,
  slots: games.map<AdvSlot>(g => ({ name: `${id}_slot`, game: g })),
});

// `linkedAt` (when the room went up) is what dates a mission's downloads.
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

const live = (id: string, seats: GMParticipant[], linkedAt: number, extra: Partial<GMMission> = {}) =>
  mission(id, 'inprogress', seats, { link: `https://ap/room/${id}`, linkedAt, ...extra });

describe('AP list registry', () => {
  it('runs in ascending order and starts at the catch-all era', () => {
    expect(AP_LISTS[0].from).toBe(0);
    for (let i = 1; i < AP_LISTS.length; i++) {
      expect(AP_LISTS[i].from).toBeGreaterThan(AP_LISTS[i - 1].from);
    }
  });

  it('resolves a timestamp to the list in force then', () => {
    expect(apListAt(onCurrentList).id).toBe(CURRENT.id);
    expect(apListAt(onPrevList).id).toBe(PREV.id);
    expect(isCurrentApList(apListIndexAt(onCurrentList))).toBe(true);
    expect(isCurrentApList(apListIndexAt(onPrevList))).toBe(false);
  });

  it('treats an unknown download date as the earliest era, never the current one', () => {
    expect(apListIndexAt(null)).toBe(0);
    expect(apListIndexAt(undefined)).toBe(0);
    expect(isCurrentApList(apListIndexAt(null))).toBe(AP_LISTS.length === 1);
  });
});

describe('sourcedAt', () => {
  it('prefers the room link, then deploy, then creation — never firstJoinAt', () => {
    const base = mission('m', 'inprogress', []);
    expect(sourcedAt({ ...base, createdAt: 1, firstJoinAt: 2, deployedAt: 3, linkedAt: 4 })).toBe(4);
    expect(sourcedAt({ ...base, createdAt: 1, firstJoinAt: 2, deployedAt: 3 })).toBe(3);
    expect(sourcedAt({ ...base, createdAt: 1, firstJoinAt: 2 })).toBe(1);
  });
});

describe('sourcedGameLists', () => {
  it('counts complete missions and in-progress ones that have a room', () => {
    const seen = sourcedGameLists([
      mission('done', 'complete',   [seat('a', ['Celeste'])], { linkedAt: onCurrentList }),
      live('live', [seat('b', ['Timespinner'])], onCurrentList),
    ]);
    expect([...seen.keys()].sort()).toEqual(['celeste', 'timespinner']);
  });

  it('ignores forming tables and in-progress ones still awaiting a room', () => {
    const seen = sourcedGameLists([
      mission('form', 'forming', [seat('a', ['Celeste'])], { linkedAt: onCurrentList }),
      mission('noroom', 'inprogress', [seat('b', ['Timespinner'])]),   // no link yet
    ]);
    expect(seen.size).toBe(0);
  });

  it('excludes the mission being verified, so its own games never count as sourced', () => {
    const ms = [live('live', [seat('a', ['Celeste'])], onCurrentList)];
    expect(sourcedGameLists(ms).has('celeste')).toBe(true);
    expect(sourcedGameLists(ms, 'live').size).toBe(0);
  });

  it('includes claimable slots — they were carved off a seat on a room that exists', () => {
    const seen = sourcedGameLists([
      live('live', [seat('a', ['Celeste'])], onCurrentList, {
        claimableSlots: { k1: { slots: [{ name: 'orphan', game: 'Hollow Knight' }] } },
      }),
    ]);
    expect(seen.get('hollow knight')).toBe(apListIndexAt(onCurrentList));
  });

  it('folds case and whitespace, and drops slots with no game chosen yet', () => {
    const seen = sourcedGameLists([
      mission('done', 'complete', [seat('a', ['  A Link  to the   Past ', ''])], { linkedAt: onCurrentList }),
    ]);
    expect([...seen.keys()]).toEqual(['a link to the past']);
    expect(gameTitleKey('  A Link  to the   Past ')).toBe('a link to the past');
  });

  it('keeps the NEWEST list a game was downloaded under, whatever order the missions arrive in', () => {
    const older = live('older', [seat('a', ['Celeste'])], onPrevList);
    const newer = live('newer', [seat('b', ['Celeste'])], onCurrentList);
    for (const ms of [[older, newer], [newer, older]]) {
      expect(sourcedGameLists(ms).get('celeste')).toBe(apListIndexAt(onCurrentList));
    }
  });

  it('dates a room-less completed mission by deploy/creation, landing it on the older list', () => {
    const seen = sourcedGameLists([
      mission('legacy', 'complete', [seat('a', ['Celeste'])], { deployedAt: onPrevList }),
    ]);
    expect(seen.get('celeste')).toBe(apListIndexAt(onPrevList));
  });
});

describe('gameNoveltyInYaml', () => {
  const sourced = sourcedGameLists([
    live('cur',  [seat('a', ['Celeste'])],     onCurrentList),
    live('prev', [seat('b', ['Timespinner'])], onPrevList),
  ]);

  it('says nothing about a game already downloaded under the current list', () => {
    const r = gameNoveltyInYaml('name: P1\ngame: celeste\n', sourced);
    expect(r.brandNew).toEqual([]);
    expect(r.outdated).toEqual([]);
  });

  it('flags a never-downloaded game as NEW', () => {
    const r = gameNoveltyInYaml('name: P1\ngame: Hollow Knight\n', sourced);
    expect(r.brandNew).toEqual([{ title: 'Hollow Knight', seenOn: null }]);
    expect(r.outdated).toEqual([]);
  });

  it('flags a game last downloaded on an earlier list as OLD, naming that list', () => {
    const r = gameNoveltyInYaml('name: P1\ngame: Timespinner\n', sourced);
    expect(r.brandNew).toEqual([]);
    expect(r.outdated).toEqual([{ title: 'Timespinner', seenOn: PREV }]);
  });

  it('sorts a mixed file into both buckets', () => {
    const text = [
      'name: P1\ngame: Celeste',       // current list  → silent
      'name: P2\ngame: Timespinner',   // earlier list  → OLD
      'name: P3\ngame: Hollow Knight', // never         → NEW
    ].join('\n---\n');
    const r = gameNoveltyInYaml(text, sourced);
    expect(r.brandNew.map(g => g.title)).toEqual(['Hollow Knight']);
    expect(r.outdated.map(g => g.title)).toEqual(['Timespinner']);
  });

  it('dedupes a title repeated across worlds', () => {
    const text = 'name: P1\ngame: Hollow Knight\n---\nname: P2\ngame: hollow  knight\n';
    expect(gameNoveltyInYaml(text, sourced).brandNew.map(g => g.title)).toEqual(['Hollow Knight']);
  });

  it('marks the viable candidates of a weighted game as maybes', () => {
    const text = 'name: P1\ngame:\n  Celeste: 1\n  Timespinner: 1\n  Hollow Knight: 1\n  Undertale: 0\n';
    const r = gameNoveltyInYaml(text, sourced);
    expect(r.brandNew.map(g => g.title)).toEqual(['Hollow Knight (?)']);
    expect(r.outdated.map(g => g.title)).toEqual(['Timespinner (?)']);
  });

  it('ignores an unparseable or gameless file rather than flagging it', () => {
    for (const text of ['name: P1\ndescription: no game here\n', '']) {
      const r = gameNoveltyInYaml(text, sourced);
      expect(r.brandNew).toEqual([]);
      expect(r.outdated).toEqual([]);
    }
  });

  it('treats everything as needing attention when nothing has been sourced yet', () => {
    const r = gameNoveltyInYaml('name: P1\ngame: Celeste\n', new Map());
    expect(r.brandNew).toEqual([{ title: 'Celeste', seenOn: null }]);
  });
});
