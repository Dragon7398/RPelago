import { describe, it, expect } from 'vitest';
import {
  computeStatusReport, buildOfficialReport, renderProblemsMarkdown, renderWarningsMarkdown,
  excuseKey, hasUnexcusedProblem, lastSignOfLife, slotIdleTier,
  roomHealth, worstRoomTier, roomHealthText,
  PROBLEM_STALE_HOURS, SLOT_CAUTION_HOURS,
  ROOM_WINDOW_HOURS, ROOM_CAUTION_PCT, ROOM_DANGER_PCT, ROOM_SAMPLE_RETENTION_HOURS,
  type ReportCandidate, type RoomHealth,
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

  it('flags In-Progress with 72h+ since last activity/self-report as a problem', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(80) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),  // fresh → suppresses warn-c/a
    } }) });
    const aFindings = r[0].players.find(p => p.handle === '@Zed')!.findings;
    expect(aFindings[0].tier).toBe('problem');
    expect(aFindings[0].reasons[0]).toMatch(/72h/);
    // The fresh player has nothing wrong and must not appear.
    expect(r[0].players.map(p => p.handle)).toEqual(['@Zed']);
  });

  it('leaves a slot idle just under 72h alone (the check-in window moved 60h → 72h)', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(70) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // 70h used to be a problem under the old 60h threshold; it is now within tolerance.
    expect(r).toHaveLength(0);
  });

  it('does NOT flag problem when a WEAK self-report (lastChecked) is recent though activity is old', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // problem-b is "later of the two" — the recent self-report clears the 72h problem.
    // (It won't clear the 144h activity warning, but 80h < 144h so nothing fires.)
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

  it('warns when the last player is at 100% but has not goaled', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: '100%' })]),
      b: part('b', 'B', [slot({ status: 'Goaled' })]),
    } }) });
    // Previously invisible: no flag fired on 100%, so the world dropped off entirely.
    expect(r).toHaveLength(1);
    expect(r[0].players.map(p => p.handle)).toEqual(['@Zed']);
    const f = r[0].players[0].findings[0];
    expect(f.tier).toBe('warning');
    expect(f.codes).toEqual(['lastPlayer']);
    expect(f.reasons[0]).toMatch(/100% but not goaled/);
  });

  it('treats Done the same as Goaled for the last-player check', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: '100%' })]),
      b: part('b', 'B', [slot({ status: 'Done' })]),
    } }) });
    expect(r[0].players[0].findings[0].codes).toEqual(['lastPlayer']);
  });

  it('warns the last player still finding checks when the others sit at 100%', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      b: part('b', 'B', [slot({ status: '100%' })]),
    } }) });
    // b has every check and is likely blocked on an item only a can still send.
    expect(r[0].players.map(p => p.handle)).toEqual(['@Zed']);
    const f = r[0].players[0].findings[0];
    expect(f.tier).toBe('warning');
    expect(f.codes).toEqual(['lastChecker']);
    expect(f.reasons[0]).toMatch(/waiting on an item/);
  });

  it('keeps lastPlayer and lastChecker mutually exclusive', () => {
    // All others goaled → lastPlayer only, never both.
    const goaled = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'Goaled' })]),
    } }) });
    expect(goaled[0].players[0].findings[0].codes).toEqual(['lastPlayer']);

    // A goaled peer AND a 100% peer → still lastChecker, since one is ungoaled.
    const mixed = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      b: part('b', 'B', [slot({ status: '100%' })]),
      c: part('c', 'C', [slot({ status: 'Goaled' })]),
    } }) });
    expect(mixed[0].players[0].findings[0].codes).toEqual(['lastChecker']);
  });

  it('does not call anyone last while another player is still finding checks', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
      c: part('c', 'C', [slot({ status: '100%' })]),
    } }) });
    // Two players are still seeking, so neither is the bottleneck.
    expect(r).toHaveLength(0);
  });

  it('does not fire lastChecker for a 100% player alongside another at 100%', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: '100%' })]),
      b: part('b', 'B', [slot({ status: '100%' })]),
    } }) });
    // Nobody is finding checks, and nobody is last to goal — no one to chase.
    expect(r).toHaveLength(0);
  });

  it('does not flag a lone 100% player with no other participants', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: '100%' })]),
    } }) });
    // No "others" to be last among — the existing otherPlayerSlots guard holds.
    expect(r).toHaveLength(0);
  });

  it('does not let a 100% slot trip the time-based In-Progress flags', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: '100%', lastActivity: ago(300) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(1) })]),
    } }) });
    // a's ancient activity must NOT produce a stalled/144h flag — they have every
    // check, so there is nothing to nag them about; only b (the last one still
    // finding checks, and so possibly holding a's goal item) is surfaced.
    expect(r[0].players.map(p => p.handle)).toEqual(['@Alice']);
    expect(r[0].players[0].findings[0].codes).toEqual(['lastChecker']);
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

  it('warns every slot when all In-Progress slots are idle 72h+ (but self-report recent)', () => {
    const r = run({ m1: mission({ linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
      b: part('b', 'B', [slot({ status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
    } }) });
    expect(r[0].players).toHaveLength(2);
    expect(r[0].players.every(p => p.findings[0].tier === 'warning')).toBe(true);
    expect(r[0].players[0].findings.some(f => /72h/.test(f.reasons.join()))).toBe(true);
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
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(80) }),
                           slot({ name: 'S2', status: 'In-Progress', lastActivity: ago(80) })]),
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
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(80) }),
                           slot({ name: 'S2', status: 'Unstarted' })]),
      } }),
    }), NOW);
    expect(renderProblemsMarkdown(rep)).toContain('@Zed Status on ``S1``? Don\'t forget to start ``S2``.');
  });

  it('renders admin Warnings: last-player and deduped world-general idle', () => {
    const lastPlayer = buildOfficialReport(active({
      m1: mission({ label: 'World4', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(1) })]),
        b: part('b', 'B', [slot({ name: 'S2', status: 'Goaled' })]),
      } }),
    }), NOW);
    expect(renderWarningsMarkdown(lastPlayer)).toBe(
      '## Status Report — Warnings\nWorld4:\n@Zed is the last to finish this world. (Slots: ``S1``)',
    );

    const idle = buildOfficialReport(active({
      m1: mission({ label: 'World5', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
        b: part('b', 'B', [slot({ name: 'S2', status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
      } }),
    }), NOW);
    // allIdle60 is world-general → a single deduped line, not one per player, but it
    // still names every slot that tripped it (across players).
    expect(renderWarningsMarkdown(idle)).toBe(
      '## Status Report — Warnings\nWorld5:\nNo activity by players in last 72 hours. (Slots: ``S1``, ``S2``)',
    );

    // A 100%-but-ungoaled last player rides the same lastPlayer code, so it needs
    // no new markdown branch.
    const ungoaled = buildOfficialReport(active({
      m1: mission({ label: 'World6', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: '100%' })]),
        b: part('b', 'B', [slot({ name: 'S2', status: 'Goaled' })]),
      } }),
    }), NOW);
    expect(renderWarningsMarkdown(ungoaled)).toBe(
      '## Status Report — Warnings\nWorld6:\n@Zed is the last to finish this world. (Slots: ``S1``)',
    );
    expect(ungoaled.problems).toHaveLength(0);

    const lastChecker = buildOfficialReport(active({
      m1: mission({ label: 'World7', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(1) })]),
        b: part('b', 'B', [slot({ name: 'S2', status: '100%' })]),
      } }),
    }), NOW);
    expect(renderWarningsMarkdown(lastChecker)).toBe(
      '## Status Report — Warnings\nWorld7:\n' +
      '@Zed is the last still finding checks — others here are at 100% and may be waiting on an item from them. (Slots: ``S1``)',
    );
  });

  it('names each warning\'s own slots, per player and per code', () => {
    // Zed owns two slots: one merely idle-with-the-world, one 144h dead. The two
    // codes must not pool their slot names into each other.
    const rep = buildOfficialReport(active({
      m1: mission({ label: 'World8', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'Dead', status: 'In-Progress', lastActivity: ago(200), lastChecked: ago(1) }),
                           slot({ name: 'Idle', status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
        b: part('b', 'B', [slot({ name: 'Other', status: 'In-Progress', lastActivity: ago(80), lastChecked: ago(1) })]),
      } }),
    }), NOW);
    const items = rep.warnings[0].items;
    expect(items.find(i => i.code === 'noActivity144')).toMatchObject({ handle: '@Zed', slots: ['Dead'] });
    // Every In-Progress slot here is idle ≥72h, so all three trip the world flag.
    expect(items.find(i => i.code === 'allIdle60')!.slots).toEqual(['Dead', 'Idle', 'Other']);
  });

  it('carries structured problem data (stalled/unstarted split) for persistence', () => {
    const rep = buildOfficialReport(active({
      m1: mission({ id: 'm1', label: 'World1', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(80) }),
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

describe('buildOfficialReport — excuses', () => {
  const active = (missions: Record<string, GMMission>): ReportCandidate[] =>
    run(missions).filter(c => c.bucket === 'active');

  const twoPlayerWorld = () => active({
    m1: mission({ id: 'm1', label: 'World1', linkedAt: ago(100), participants: {
      a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(80) })]),
      b: part('b', 'B', [slot({ name: 'S3', status: 'Unstarted' })]),
    } }),
  });

  it('marks an excused player in the snapshot but drops them from the ping', () => {
    const rep = buildOfficialReport(
      twoPlayerWorld(), NOW, 'admin-uid',
      { [excuseKey('mission', 'm1', 'a')]: 'explained in Discord' },
    );
    // Still in the snapshot — the excuse is an audit trail, not an erasure.
    expect(rep.problems[0].players.map(p => p.handle)).toEqual(['@Alice', '@Zed']);
    expect(rep.problems[0].players.find(p => p.playerId === 'a')).toMatchObject({
      excused: true, excusedReason: 'explained in Discord', excusedAt: NOW, excusedBy: 'admin-uid',
    });
    expect(rep.problems[0].players.find(p => p.playerId === 'b')!.excused).toBeUndefined();
    // …but out of the player-facing block.
    const md = renderProblemsMarkdown(rep);
    expect(md).toContain('@Alice');
    expect(md).not.toContain('@Zed');
  });

  it('treats an empty reason as a valid excuse (the key IS the excuse)', () => {
    const rep = buildOfficialReport(twoPlayerWorld(), NOW, undefined, { [excuseKey('mission', 'm1', 'a')]: '' });
    const zed = rep.problems[0].players.find(p => p.playerId === 'a')!;
    expect(zed.excused).toBe(true);
    expect(zed.excusedReason).toBeUndefined();
  });

  it('renders no Problems block at all when every player is excused', () => {
    const rep = buildOfficialReport(twoPlayerWorld(), NOW, undefined, {
      [excuseKey('mission', 'm1', 'a')]: '', [excuseKey('mission', 'm1', 'b')]: '',
    });
    expect(rep.problems).toHaveLength(1);          // snapshot keeps both
    expect(renderProblemsMarkdown(rep)).toBe('');  // nobody to ping
    expect(hasUnexcusedProblem(rep.problems[0])).toBe(false);
  });

  it('keeps the world heading only while someone there is still pingable', () => {
    const rep = buildOfficialReport(twoPlayerWorld(), NOW, undefined, { [excuseKey('mission', 'm1', 'a')]: '' });
    expect(hasUnexcusedProblem(rep.problems[0])).toBe(true);
    expect(renderProblemsMarkdown(rep)).toBe(
      '## Status Report\n### World1\n@Alice Don\'t forget to start ``S3``.',
    );
  });

  it('excuses are scoped per world — the same player elsewhere is untouched', () => {
    const cands = active({
      m1: mission({ id: 'm1', label: 'Alpha', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'Unstarted' })]),
      } }),
      m2: mission({ id: 'm2', label: 'Beta', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S2', status: 'Unstarted' })]),
      } }),
    });
    const rep = buildOfficialReport(cands, NOW, undefined, { [excuseKey('mission', 'm1', 'a')]: '' });
    const byName = Object.fromEntries(rep.problems.map(w => [w.name, w]));
    expect(byName.Alpha.players[0].excused).toBe(true);
    expect(byName.Beta.players[0].excused).toBeUndefined();
    expect(renderProblemsMarkdown(rep)).toBe(
      '## Status Report\n### Beta\n@Zed Don\'t forget to start ``S2``.',
    );
  });

  it('does not excuse warnings — they never counted against anyone', () => {
    const rep = buildOfficialReport(active({
      m1: mission({ id: 'm1', label: 'World4', linkedAt: ago(100), participants: {
        a: part('a', 'A', [slot({ name: 'S1', status: 'In-Progress', lastActivity: ago(1) })]),
        b: part('b', 'B', [slot({ name: 'S2', status: 'Goaled' })]),
      } }),
    }), NOW, undefined, { [excuseKey('mission', 'm1', 'a')]: 'excused anyway' });
    expect(rep.problems).toHaveLength(0);
    expect(rep.warnings[0].items[0]).toMatchObject({ code: 'lastPlayer', handle: '@Zed' });
  });
});

// ── lastReported: a slot note counts as a sign of life ───────────────────────
//
// This is the whole of the notes feature's report integration. `lastReported` is
// weighted exactly like `lastChecked`, so a note CLEARS the stalled problem and
// therefore costs the player no statusIncident. Deliberate — see the file header.

describe('lastReported', () => {
  // A second, freshly-active player keeps the world-general allIdle60 warning from
  // firing, so each assertion below is about player a's own codes only.
  const stalledWorld = (s: AdvSlot) => run({
    m1: mission({ id: 'm1', label: 'W', linkedAt: ago(200), participants: {
      a: part('a', 'A', [s]),
      b: part('b', 'B', [slot({ name: 'Other', status: 'In-Progress', lastActivity: ago(1) })]),
    } }),
  });

  // A world with nothing left to flag drops off the candidate list entirely, so an
  // EMPTY report is the strongest possible "cleared" — not a missing case.
  const codesFor = (rep: ReportCandidate[]) =>
    rep[0]?.players.find(p => p.playerId === 'a')?.findings.flatMap(f => f.codes) ?? [];

  it('clears the stalled problem when the note is recent', () => {
    const codes = codesFor(stalledWorld(slot({
      name: 'S', status: 'In-Progress', lastActivity: ago(100), lastReported: ago(2),
    })));
    expect(codes).not.toContain('stalled');
  });

  it('does not clear it when the note is older than the threshold', () => {
    const codes = codesFor(stalledWorld(slot({
      name: 'S', status: 'In-Progress', lastActivity: ago(100), lastReported: ago(PROBLEM_STALE_HOURS + 1),
    })));
    expect(codes).toContain('stalled');
  });

  it('still raises noActivity144 despite a fresh note — a note must not launder a dead slot', () => {
    const codes = codesFor(stalledWorld(slot({
      name: 'S', status: 'In-Progress', lastActivity: ago(200), lastReported: ago(1),
    })));
    expect(codes).toContain('noActivity144');
  });

  it('surfaces the note on the finding so the host can read it before excusing', () => {
    const rep = stalledWorld(slot({
      name: 'S', status: 'In-Progress', lastActivity: ago(100),
      note: { text: 'stuck behind a Varia gate', timestamp: ago(2) },
    }));
    const f = rep[0].players.find(p => p.playerId === 'a')!.findings[0];
    expect(f.note?.text).toBe('stuck behind a Varia gate');
  });

  it('lastSignOfLife takes the newest present stamp, and null when there are none', () => {
    expect(lastSignOfLife(slot({ lastActivity: ago(10), lastChecked: ago(5), lastReported: ago(20) }))).toBe(ago(5));
    expect(lastSignOfLife(slot({ lastActivity: ago(10), lastReported: ago(2) }))).toBe(ago(2));
    expect(lastSignOfLife(slot({}))).toBeNull();
  });
});

// ── slotIdleTier: the landing page's badge ───────────────────────────────────

describe('slotIdleTier', () => {
  const inprog = (h: number) => slot({ status: 'In-Progress', lastActivity: ago(h) });

  it('is quiet below the caution threshold', () => {
    expect(slotIdleTier(inprog(SLOT_CAUTION_HOURS - 1), NOW)).toBeNull();
  });

  it('cautions from 48h and alerts from 72h', () => {
    expect(slotIdleTier(inprog(SLOT_CAUTION_HOURS), NOW)).toMatchObject({ tier: 'caution', hours: SLOT_CAUTION_HOURS });
    expect(slotIdleTier(inprog(PROBLEM_STALE_HOURS - 1), NOW)).toMatchObject({ tier: 'caution' });
    expect(slotIdleTier(inprog(PROBLEM_STALE_HOURS), NOW)).toMatchObject({ tier: 'alert', hours: PROBLEM_STALE_HOURS });
  });

  it('is suppressed for every status that already frees a mission claim', () => {
    for (const status of ['100%', 'Goaled', 'Done'] as const) {
      expect(slotIdleTier(slot({ status, lastActivity: ago(500) }), NOW)).toBeNull();
    }
  });

  it('a note resets the clock like any other sign of life', () => {
    const s = slot({ status: 'In-Progress', lastActivity: ago(100), lastReported: ago(1) });
    expect(slotIdleTier(s, NOW)).toBeNull();
  });

  it('falls back to the room link for an Unstarted slot, and flags it', () => {
    const s = slot({ status: 'Unstarted' });
    expect(slotIdleTier(s, NOW, ago(80))).toMatchObject({ tier: 'alert', hours: 80, fromRoom: true });
    expect(slotIdleTier(s, NOW, ago(50))).toMatchObject({ tier: 'caution', fromRoom: true });
  });

  it('shows nothing when there is no room link yet — there was nothing to start', () => {
    expect(slotIdleTier(slot({ status: 'Unstarted' }), NOW)).toBeNull();
    expect(slotIdleTier(slot({ status: 'Unstarted' }), NOW, null)).toBeNull();
  });

  it('prefers a real stamp over the room link', () => {
    const s = slot({ status: 'In-Progress', lastActivity: ago(1) });
    expect(slotIdleTier(s, NOW, ago(500))).toBeNull();
  });
});

// ── Room pace ────────────────────────────────────────────────────────────────

// A sample tree: `hoursAgo -> [done, total]`, keyed the way the tick writes it.
const samples = (rows: [number, number, number][]) =>
  Object.fromEntries(rows.map(([h, done, total]) => [String(ago(h)), { done, total }]));

// A window's worth of history whose latest sample gains `pct`% of `total`.
const paced = (pct: number, total = 1000, done = 500) =>
  samples([[ROOM_WINDOW_HOURS + 1, done, total], [0, done + Math.round(total * pct / 100), total]]);

describe('roomHealth', () => {
  it('returns null when there is nothing to judge', () => {
    expect(roomHealth(undefined, NOW)).toBeNull();
    expect(roomHealth({}, NOW)).toBeNull();
    // Nothing tracked yet: every slot reports 0 locations.
    expect(roomHealth(samples([[80, 0, 0], [0, 0, 0]]), NOW)).toBeNull();
  });

  it('returns null with no baseline a full window old — young is not stalled', () => {
    // Plenty of samples, but all inside the window: unknown, never 0% progress.
    expect(roomHealth(samples([[40, 500, 1000], [20, 500, 1000], [0, 500, 1000]]), NOW)).toBeNull();
    // Exactly at the window boundary the baseline exists.
    expect(roomHealth(samples([[ROOM_WINDOW_HOURS, 500, 1000], [0, 505, 1000]]), NOW)).not.toBeNull();
  });

  it('returns null when sampling stopped a window ago', () => {
    // Every sample is older than the cutoff, so the newest IS the baseline and
    // there is no span to measure (room went all-Done, or its fetches are failing).
    expect(roomHealth(samples([[200, 400, 1000], [100, 500, 1000]]), NOW)).toBeNull();
  });

  it('ignores samples stamped in the future', () => {
    const tree = { ...paced(5), [String(NOW + 10 * H)]: { done: 9999, total: 1000 } };
    expect(roomHealth(tree, NOW)!.done).toBe(550);
  });

  it('tiers on the normalised rate', () => {
    expect(roomHealth(paced(10), NOW)!.tier).toBeNull();
    expect(roomHealth(paced(ROOM_CAUTION_PCT + 0.5), NOW)!.tier).toBeNull();
    expect(roomHealth(paced(ROOM_CAUTION_PCT - 0.5), NOW)!.tier).toBe('caution');
    expect(roomHealth(paced(ROOM_DANGER_PCT - 0.5), NOW)!.tier).toBe('danger');
    expect(roomHealth(paced(0), NOW)!.tier).toBe('danger');
  });

  it('refuses to judge a span shorter than the window', () => {
    // Half a window of history is not a cheap 1.5% verdict — it is not a verdict.
    // Normalising UP from a short span would let one quiet weekend (or one collect
    // dump) decide the tier, which is the noise the window exists to average out.
    expect(roomHealth(samples([[ROOM_WINDOW_HOURS / 2, 500, 1000], [0, 510, 1000]]), NOW)).toBeNull();
  });

  it('normalises a LONGER span down, so a sampling gap cannot flatter a room', () => {
    // 2% gained, but over two windows — a 1% pace. The raw delta reads as caution;
    // the normalised rate is the truth, and it is danger.
    const gap = samples([[ROOM_WINDOW_HOURS * 2, 500, 1000], [0, 520, 1000]]);
    const h = roomHealth(gap, NOW)!;
    expect(h.hours).toBeCloseTo(ROOM_WINDOW_HOURS * 2, 5);
    expect(h.deltaPct).toBeCloseTo(2, 5);
    expect(h.ratePct).toBeCloseTo(1, 5);
    expect(h.tier).toBe('danger');
  });

  it('measures the delta against the CURRENT total, so a late-connecting slot is not a regress', () => {
    // 400/800 → a new slot connects (+200 locations) and 40 checks are found.
    const h = roomHealth(samples([[ROOM_WINDOW_HOURS + 1, 400, 800], [0, 440, 1000]]), NOW)!;
    expect(h.gained).toBe(40);
    expect(h.deltaPct).toBeCloseTo(4, 5);   // 40/1000, not 40/800
    expect(h.totalChanged).toBe(true);
    expect(h.tier).toBeNull();              // real progress, not a regression
  });

  it('never flags a room with every check found', () => {
    const h = roomHealth(samples([[ROOM_WINDOW_HOURS + 1, 1000, 1000], [0, 1000, 1000]]), NOW)!;
    expect(h.remaining).toBe(0);
    expect(h.ratePct).toBe(0);
    expect(h.tier).toBeNull();
  });

  it('reports a shrinking room honestly rather than clamping', () => {
    const h = roomHealth(samples([[ROOM_WINDOW_HOURS + 1, 500, 1000], [0, 480, 1000]]), NOW)!;
    expect(h.gained).toBe(-20);
    expect(h.tier).toBe('danger');
    expect(roomHealthText(h)).toContain('−20 checks');
  });

  it('carries the absolutes, so an end-game room triages without opening it', () => {
    const h = roomHealth(samples([[ROOM_WINDOW_HOURS, 5074, 5120], [0, 5085, 5120]]), NOW)!;
    expect(h.tier).toBe('danger');
    const text = roomHealthText(h);
    expect(text).toContain('+11 checks');
    expect(text).toContain('35 remain');
    expect(text).not.toContain('Room 1');       // single-room worlds say nothing
    expect(roomHealthText(h, true)).toMatch(/^Room 1: /);
  });

  it('prints the normalised rate only when the span is not the window', () => {
    // Ordinary read: delta and rate are the same number, so it is said once.
    const plain = roomHealthText(roomHealth(samples([[ROOM_WINDOW_HOURS, 500, 1000], [0, 520, 1000]]), NOW)!);
    expect(plain).toContain('+20 checks (2.0%)');
    expect(plain).not.toContain('per ' + ROOM_WINDOW_HOURS + 'h');
    // Sampling gap: the normalised rate is the whole story, so it is spelled out.
    const gap = roomHealthText(roomHealth(samples([[ROOM_WINDOW_HOURS * 2, 500, 1000], [0, 520, 1000]]), NOW)!);
    expect(gap).toContain('= 1.0% per ' + ROOM_WINDOW_HOURS + 'h');
  });

  it('prefers the newest baseline at least a window old', () => {
    const tree = samples([
      [ROOM_SAMPLE_RETENTION_HOURS - 1, 100, 1000],   // ancient — must not be used
      [ROOM_WINDOW_HOURS + 2, 500, 1000],             // the baseline
      [0, 505, 1000],
    ]);
    const h = roomHealth(tree, NOW)!;
    expect(h.gained).toBe(5);
    expect(h.hours).toBeCloseTo(ROOM_WINDOW_HOURS + 2, 5);
  });
});

describe('worstRoomTier', () => {
  const r = (tier: RoomHealth['tier']) => ({ tier } as RoomHealth);
  it('takes the worse of a bifurcated tile: two rooms, one verdict', () => {
    expect(worstRoomTier([])).toBeNull();
    expect(worstRoomTier([r(null), r(null)])).toBeNull();
    expect(worstRoomTier([r(null), r('caution')])).toBe('caution');
    expect(worstRoomTier([r('caution'), r('danger')])).toBe('danger');
  });
});

describe('room pace in the report', () => {
  const healthy = [slot({ name: 'ok', status: 'In-Progress', lastActivity: ago(1) })];

  it('puts a clean world on the report when only its ROOM is off the pace', () => {
    const m = mission({ participants: { a: part('a', 'A', healthy) }, roomProgress: paced(0.5) });
    const [c] = run({ m1: m });
    expect(c.players).toHaveLength(0);          // nobody is individually at fault
    expect(c.rooms.map(r => r.tier)).toEqual(['danger']);
  });

  it('leaves a clean world with a healthy room off entirely', () => {
    const m = mission({ participants: { a: part('a', 'A', healthy) }, roomProgress: paced(8) });
    expect(run({ m1: m })).toHaveLength(0);
  });

  it('reads a bifurcated tile as two rooms', () => {
    const t = tile({
      adventurers: { adv1: { advId: 'adv1', owner: 'a', ownerName: 'A', slots: healthy } } as Tile['adventurers'],
      roomProgress:  paced(9),
      roomProgress2: paced(0.2),
    });
    const [c] = run({}, { D4: t });
    expect(c.rooms.map(r => [r.room, r.tier])).toEqual([[1, null], [2, 'danger']]);
  });

  it('writes a world-general warn item with pre-rendered detail, and pings nobody', () => {
    const m = mission({ participants: { a: part('a', 'A', healthy) }, roomProgress: paced(2) });
    const rep = buildOfficialReport(run({ m1: m }), NOW);

    expect(rep.problems).toHaveLength(0);                  // room pace never pings a player
    const [item] = rep.warnings[0].items;
    expect(item.code).toBe('roomCaution');
    expect(item.playerId).toBeUndefined();
    expect(item.slots).toBeUndefined();                    // no empty array for RTDB to eat
    expect(item.detail).toContain('remain');

    const md = renderWarningsMarkdown(rep);
    expect(md).toContain('Room pace under ' + ROOM_CAUTION_PCT + '% per ' + ROOM_WINDOW_HOURS + 'h');
    expect(md).toContain(item.detail!);
    expect(renderProblemsMarkdown(rep)).toBe('');
  });

  it('leads the item list, ahead of the slot warnings', () => {
    const stalledSlot = [slot({
      name: 'zzz', status: 'In-Progress',
      lastActivity: ago(200),   // trips noActivity144 …
      lastReported: ago(1),     // … while the self-report clears the `stalled` problem
    })];
    const m = mission({ participants: { a: part('a', 'A', stalledSlot) }, roomProgress: paced(1) });
    const rep = buildOfficialReport(run({ m1: m }), NOW);
    expect(rep.warnings[0].items[0].code).toBe('roomDanger');
    expect(rep.warnings[0].items.map(i => i.code)).toContain('noActivity144');
  });
});
