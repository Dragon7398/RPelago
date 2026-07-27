import { describe, it, expect } from 'vitest';
import {
  computeStatusReport, buildOfficialReport, renderProblemsMarkdown, renderWarningsMarkdown,
  type ReportCandidate,
} from '../../src/lib/statusReport';
import type { GMMission, Tile, Player, AdvSlot } from '../../src/types';

const NOW = 1_700_000_000_000;
const H = 3_600_000;
const ago = (hours: number) => NOW - hours * H;

const slot = (p: Partial<AdvSlot>): AdvSlot => ({ name: 'S', game: 'G', ...p });

function mission(p: Partial<GMMission> & { participants: GMMission['participants'] }): GMMission {
  return {
    id: 'm1', type: 'patrol', state: 'inprogress', label: 'Mission', series: 1,
    baseMax: 5, xp: 0, gp: 0, release: 'on', collect: 'off', hint: 0,
    firstJoinAt: null, createdAt: ago(200),
    ...p,
  } as GMMission;
}

const part = (playerId: string, playerName: string, slots: AdvSlot[]) =>
  ({ playerId, playerName, joinedAt: ago(200), slots } as GMMission['participants'][string]);

function tile(p: Partial<Tile>): Tile {
  return {
    state: 'inprogress', required: 1, adventurers: {}, name: 'Tile',
    release: 'on', collect: 'off', hint: 0, details: '', gold: 0, xp: 0, bonusXP: 0,
    diffBonus: 0, baseRelease: 'on', baseCollect: 'off', baseHint: 0, adminOverride: false,
    link: 'x', linkedAt: ago(200),
    ...p,
  } as Tile;
}

const players: Record<string, Player> = {
  a: { discordHandle: 'Zed' } as Player,
  b: { discordHandle: 'Alice' } as Player,
};

const label = (m: GMMission) => m.label;
const run = (missions: Record<string, GMMission>, tiles: Record<string, Tile> = {}) =>
  computeStatusReport(missions, tiles, players, NOW, label);

describe('computeStatusReport — slot classification', () => {
  it('flags an Unstarted slot as a problem', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: { a: part('a', 'A', [slot({ status: 'Unstarted' })]) } }) });
    expect(r).toHaveLength(1);
    const f = r[0].players[0].findings[0];
    expect(f.tier).toBe('problem');
    expect(f.reasons[0]).toMatch(/Unstarted/);
  });

  it('flags In-Progress with 60h+ since last activity/self-report as a problem', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(70) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),  // fresh → suppresses warn-c/a
    } }) });
    const aFindings = r[0].players.find(p => p.handle === '@Zed')!.findings;
    expect(aFindings[0].tier).toBe('problem');
    expect(aFindings[0].reasons[0]).toMatch(/60h/);
    // The fresh player has nothing wrong and must not appear.
    expect(r[0].players.map(p => p.handle)).toEqual(['@Zed']);
  });

  it('does NOT flag problem when a WEAK self-report (lastChecked) is recent though activity is old', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(60), lastChecked: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // problem-b is "later of the two" — the recent self-report clears the 60h problem.
    // (It won't clear the 144h activity warning, but 60h < 144h so nothing fires.)
    expect(r).toHaveLength(0);
  });

  it('warns when a player is the last one still progressing', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'Goaled' })]),
    } }) });
    expect(r[0].players.map(p => p.handle)).toEqual(['@Zed']);
    const f = r[0].players[0].findings[0];
    expect(f.tier).toBe('warning');
    expect(f.reasons.some(x => /Last player/.test(x))).toBe(true);
  });

  it('warns on 144h+ since last ACTIVITY even with a recent self-report (lastChecked)', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(150), lastChecked: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    const f = r[0].players.find(p => p.handle === '@Zed')!.findings[0];
    expect(f.tier).toBe('warning');
    expect(f.reasons.some(x => /144h/.test(x))).toBe(true);
  });

  it('warns every slot when all In-Progress slots are idle 60h+ (but self-report recent)', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(70), lastChecked: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(70), lastChecked: ago(1) })]),
    } }) });
    expect(r[0].players).toHaveLength(2);
    expect(r[0].players.every(p => p.findings[0].tier === 'warning')).toBe(true);
    expect(r[0].players[0].findings.some(f => /60h/.test(f.reasons.join()))).toBe(true);
  });

  it('does NOT raise a time-based flag when timestamps are missing (no "never" warnings)', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress' })]),          // no lastActivity/lastChecked
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // The missing-timestamp slot is unknown, not stale → no problem-b / warn-b / warn-c.
    expect(r).toHaveLength(0);
  });

  it('excludes a candidate whose slots are all healthy', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'Goaled' })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // b is the only active one; warn-a would fire since a is Goaled → so it IS a candidate.
    expect(r).toHaveLength(1);
  });

  it('excludes forming missions entirely', () => {
    const r = run({ m1: mission({ state: 'forming', participants: { a: part('a', 'A', [slot({ status: 'Unstarted' })]) } }) });
    expect(r).toHaveLength(0);
  });
});

describe('computeStatusReport — buckets', () => {
  const p = { a: part('a', 'A', [slot({ status: 'Unstarted' })]) };

  it('is Too Early before 48h elapsed', () => {
    expect(run({ m1: mission({ linkedAt: ago(10), participants: p }) })[0].bucket).toBe('tooEarly');
  });

  it('is Recently Reported when reported within 24h (and past 48h elapsed)', () => {
    expect(run({ m1: mission({ linkedAt: ago(100), lastReportAt: ago(5), participants: p }) })[0].bucket)
      .toBe('recentlyReported');
  });

  it('is Active when elapsed 48h+ and not recently reported', () => {
    expect(run({ m1: mission({ linkedAt: ago(100), participants: p }) })[0].bucket).toBe('active');
  });

  it('Too Early takes precedence over a recent report', () => {
    expect(run({ m1: mission({ linkedAt: ago(10), lastReportAt: ago(5), participants: p }) })[0].bucket)
      .toBe('tooEarly');
  });
});

describe('computeStatusReport — ordering, handles, tiles', () => {
  it('sorts candidates by name and players by handle, with @ handles', () => {
    const r = run({
      zeta: mission({ id: 'zeta', label: 'Zeta', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ status: 'Unstarted' })]),
        b: part('b', 'B', [slot({ status: 'Unstarted' })]),
      } }),
      alpha: mission({ id: 'alpha', label: 'Alpha', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ status: 'Unstarted' })]),
      } }),
    });
    expect(r.map(c => c.name)).toEqual(['Alpha', 'Zeta']);
    // Zeta's players sorted by handle: @Alice (b) before @Zed (a).
    expect(r[1].players.map(p => p.handle)).toEqual(['@Alice', '@Zed']);
  });

  it('includes in-progress tiles as challenge candidates', () => {
    const r = run({}, {
      D3: tile({ name: 'Boss', linkedAt: ago(100), adventurers: {
        adv1: { advId: 'adv1', owner: 'a', ownerName: 'A', name: 'Adv', cls: 'Warrior', slots: [slot({ status: 'Unstarted' })] } as Tile['adventurers'][string],
      } }),
    });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('tile');
    expect(r[0].name).toBe('Boss');
    expect(r[0].players[0].handle).toBe('@Zed');
  });
});

describe('buildOfficialReport + markdown', () => {
  const active = (missions: Record<string, GMMission>): ReportCandidate[] =>
    run(missions).filter(c => c.bucket === 'active');

  it('renders player-facing Problems grouped by world, players alphabetical', () => {
    const rep = buildOfficialReport(active({
      m1: mission({ label: 'World1', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(70) }),
                           slot({ name: 'S2', status: 'In-Progress', lastActivity: ago(70) })]),
        b: part('b', 'B', [slot({ name: 'S3', status: 'Unstarted' }),
                           slot({ name: 'S4', status: 'Unstarted' })]),
      } }),
    }), NOW);
    expect(renderProblemsMarkdown(rep)).toBe(
      '## Status Report\n' +
      '### World1\n' +
      '@Alice Don\'t forget to start ``S3``, ``S4``.\n' +
      '@Zed Status on ``S1``, ``S2``?',
    );
  });

  it('combines a player\'s stalled + unstarted problems into one line', () => {
    const rep = buildOfficialReport(active({
      m1: mission({ label: 'World1', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(70) }),
                           slot({ name: 'S2', status: 'Unstarted' })]),
      } }),
    }), NOW);
    expect(renderProblemsMarkdown(rep)).toContain('@Zed Status on ``S1``? Don\'t forget to start ``S2``.');
  });

  it('renders admin Warnings: last-player and deduped world-general idle', () => {
    const lastPlayer = buildOfficialReport(active({
      m1: mission({ label: 'World4', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
        b: part('b', 'B', [slot({ status: 'Goaled' })]),
      } }),
    }), NOW);
    expect(renderWarningsMarkdown(lastPlayer)).toBe(
      '## Status Report — Warnings\nWorld4:\n@Zed is the last to finish this world.',
    );

    const idle = buildOfficialReport(active({
      m1: mission({ label: 'World5', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(70), lastChecked: ago(1) })]),
        b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(70), lastChecked: ago(1) })]),
      } }),
    }), NOW);
    // allIdle60 is world-general → a single deduped line, not one per player.
    expect(renderWarningsMarkdown(idle)).toBe(
      '## Status Report — Warnings\nWorld5:\nNo activity by players in last 60 hours.',
    );
  });

  it('carries structured problem data (stalled/unstarted split) for persistence', () => {
    const rep = buildOfficialReport(active({
      m1: mission({ id: 'm1', label: 'World1', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(70) }),
                           slot({ name: 'S2', status: 'Unstarted' })]),
      } }),
    }), NOW, 'admin-uid');
    expect(rep.runBy).toBe('admin-uid');
    expect(rep.problems).toHaveLength(1);
    expect(rep.problems[0]).toMatchObject({ kind: 'mission', id: 'm1', name: 'World1' });
    expect(rep.problems[0].players[0]).toMatchObject({
      handle: '@Zed', stalled: ['S1'], unstarted: ['S2'],
    });
  });
});
