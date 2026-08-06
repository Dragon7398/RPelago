// ── Status Report logic ──────────────────────────────────────────────────────
// Pure computation of the admin Status Report: which in-progress missions and
// challenges have "problem" or "warning" slots, who owns them, and why. Kept free
// of React/Firebase so it can be unit-tested against the live thresholds.
//
// Two timestamps per slot, of unequal weight:
//   lastActivity — STRONG. Server-verified activity from the Archipelago server;
//                  the real "still making progress" signal. Drives the time-based
//                  warnings (no recent activity).
//   lastChecked  — WEAK. A manual self-report by the player (e.g. vouching they're
//                  stuck); may be inaccurate. Only counts toward the "later of the
//                  two" progress check on the problem threshold.
//
// "Done" here means Goaled/Done only — a `100%` slot has every check but no goal,
// so it still holds its world open and can be flagged as the last player. See
// OWING_STATUSES; do not conflate it with FREE_COMPLETED_STATUSES.

import type {
  GMMission, Tile, Player, AdvSlot, SlotStatus,
  OfficialReport, OfficialProblemWorld, OfficialProblemPlayer, OfficialWarnWorld, OfficialWarnItem,
} from '../types';

const HOUR = 3_600_000;

// Slot-level thresholds (hours).
export const PROBLEM_STALE_HOURS      = 60;   // In-Progress: no activity AND no self-report in this long → problem
export const WARN_NO_ACTIVITY_HOURS   = 144;  // In-Progress: no server activity in this long → warning
export const WARN_ALL_STALE_HOURS     = 60;   // every In-Progress slot here idle (no activity) this long → warning

// Candidate-level bucket thresholds (hours).
export const TOO_EARLY_HOURS        = 48;  // not yet elapsed this long → "Too Early"
export const RECENTLY_REPORTED_HOURS = 24; // reported within this long → "Recently Reported"

export type ReportTier   = 'problem' | 'warning';
export type ReportBucket = 'active' | 'tooEarly' | 'recentlyReported';

export interface ReportSlotFinding {
  slotName: string;
  game:     string;
  tier:     ReportTier;
  reasons:  string[];  // human-readable, for the live report UI
  codes:    string[];  // machine-readable, for the official report builder
                       // problems: 'unstarted' | 'stalled'
                       // warnings: 'lastPlayer' | 'lastChecker' | 'noActivity144' | 'allIdle60'
}

export interface ReportPlayerFinding {
  playerId: string;
  handle:   string;               // "@discordHandle" (falls back to name / id)
  findings: ReportSlotFinding[];  // problems first, then warnings
}

export interface ReportCandidate {
  kind:    'mission' | 'tile';
  id:      string;                // missionId or tile coord
  name:    string;
  bucket:  ReportBucket;
  players: ReportPlayerFinding[]; // alphabetical by handle; only those with findings
}

// One slot in a candidate's scope, tagged with its owner (null = unowned public slot).
interface ScopedSlot {
  ownerId: string | null;
  slot:    AdvSlot;
}

const statusOf = (s: AdvSlot): SlotStatus => s.status ?? 'Unstarted';

// `100%` sits between "playing" and "finished", and the two last-player warnings
// need it on OPPOSITE sides — hence two predicates, not one:
//
//   seeking  — still finding checks (Unstarted | In-Progress). A 100% player is
//              NOT seeking; they have every check.
//   ungoaled — has not goaled (Unstarted | In-Progress | 100%). A 100% player IS
//              ungoaled; the world cannot close on them.
//
// ⚠️ Neither is `FREE_COMPLETED_STATUSES`, and neither may be unified with it.
// That set counts `100%` as complete because it releases the player's *claim*
// (they may take another world) — a different question from either of these.
const SEEKING_STATUSES:  readonly SlotStatus[] = ['Unstarted', 'In-Progress'];
const UNGOALED_STATUSES: readonly SlotStatus[] = ['Unstarted', 'In-Progress', '100%'];

const seeking  = (s: AdvSlot): boolean => SEEKING_STATUSES.includes(statusOf(s));
const ungoaled = (s: AdvSlot): boolean => UNGOALED_STATUSES.includes(statusOf(s));

// True when `ts` is present AND at least `hours` old. A MISSING timestamp is
// "unknown", never "stale" — a slot we have no check/activity data for must not
// trip a time-based flag (that produced false "No check in never" warnings for
// slots synced before the timestamp fields existed).
function stale(ts: number | null | undefined, hours: number, now: number): boolean {
  return ts != null && (now - ts) / HOUR >= hours;
}

export function fmtDuration(h: number): string {
  if (!isFinite(h)) return 'never';
  const totalH = Math.floor(h);
  const d = Math.floor(totalH / 24);
  const rem = totalH % 24;
  return d > 0 ? `${d}d ${rem}h` : `${totalH}h`;
}

const handleFor = (playerId: string, fallbackName: string, players: Record<string, Player>): string => {
  const p = players[playerId];
  return '@' + (p?.discordHandle ?? p?.displayName ?? fallbackName ?? playerId);
};

// Classify one owned slot against the full slot scope of its candidate. Returns
// null when the slot is fine. Problem tier wins over warning when both apply.
function classifySlot(s: AdvSlot, ownerId: string, all: ScopedSlot[], now: number): ReportSlotFinding | null {
  const status = statusOf(s);
  const problems: { code: string; reason: string }[] = [];
  const warnings: { code: string; reason: string }[] = [];

  // Problem (a): never started — needs to begin their game.
  if (status === 'Unstarted') {
    problems.push({ code: 'unstarted', reason: 'Unstarted — needs to begin their game' });
  }

  // Warnings (a) and (a2): the two ways of being "the last one". Both compare
  // against OTHER players only, and they are mutually exclusive by construction —
  // (a) requires no other player ungoaled, (a2) requires at least one.
  // (Unstarted slots are excluded from both only because the `unstarted` problem
  // outranks any warning anyway — see the problems-win return below.)
  const others = all.filter(x => x.ownerId != null && x.ownerId !== ownerId);
  const otherSeeking  = others.some(x => seeking(x.slot));
  const otherUngoaled = others.some(x => ungoaled(x.slot));

  if (others.length > 0 && (status === 'In-Progress' || status === '100%')) {
    // (a) Last to GOAL — every other player has goaled. Covers `100%` as well as
    // `In-Progress`: a player with every check but no goal still holds the world
    // open, and no other flag fires on `100%`, so a lone 100% player used to drop
    // the whole world off the candidate list.
    if (!otherUngoaled) {
      warnings.push({
        code: 'lastPlayer',
        reason: status === '100%'
          ? 'Last player still to goal — at 100% but not goaled; others here are done'
          : 'Last player still progressing — others here are done',
      });
    }

    // (a2) Last still FINDING CHECKS — no other player is seeking, but at least
    // one is ungoaled, which (given the above) means they are sitting at 100%.
    // That is usually not idleness: a 100% player has exhausted their own world
    // and is most likely blocked on an item only this player can still send. So
    // the seeker is the bottleneck for everyone here, not merely for themselves.
    if (status === 'In-Progress' && !otherSeeking && otherUngoaled) {
      warnings.push({
        code: 'lastChecker',
        reason: 'Last player still finding checks — others here are at 100% and may be waiting on an item from them',
      });
    }
  }

  if (status === 'In-Progress') {
    // "Later of activity / self-report": strong server activity OR a (weaker) manual
    // self-report both count as a sign of life. Only present timestamps count — a
    // slot with neither recorded is unknown, not stalled.
    const stamps = [s.lastActivity, s.lastChecked].filter((v): v is number => v != null);
    const lastSign = stamps.length ? Math.max(...stamps) : null;

    // Problem (b): stalled — no server activity AND no self-report in 60h+.
    if (stale(lastSign, PROBLEM_STALE_HOURS, now)) {
      problems.push({ code: 'stalled', reason: `No activity or self-report in ${fmtDuration((now - lastSign!) / HOUR)} (≥${PROBLEM_STALE_HOURS}h)` });
    }

    // Warning (b): no SERVER ACTIVITY in 144h+, even if they self-reported recently
    // (the self-report is the weak signal, so a recent one doesn't clear this).
    if (stale(s.lastActivity, WARN_NO_ACTIVITY_HOURS, now)) {
      warnings.push({ code: 'noActivity144', reason: `No activity in ${fmtDuration((now - s.lastActivity!) / HOUR)} (≥${WARN_NO_ACTIVITY_HOURS}h)` });
    }

    // Warning (c): EVERY In-Progress slot here (all players + public) has had no
    // server activity in 60h+. A slot with no recorded activity can't be confirmed
    // idle, so its presence keeps this from firing (unknown ≠ idle).
    const inProgHere = all.filter(x => statusOf(x.slot) === 'In-Progress');
    if (inProgHere.length > 0 && inProgHere.every(x => stale(x.slot.lastActivity, WARN_ALL_STALE_HOURS, now))) {
      warnings.push({ code: 'allIdle60', reason: `All in-progress slots here idle ≥${WARN_ALL_STALE_HOURS}h (no activity)` });
    }
  }

  const slotName = s.name?.trim() || '(unnamed slot)';
  const game     = s.game?.trim() || '—';
  const pack = (list: { code: string; reason: string }[], tier: ReportTier): ReportSlotFinding =>
    ({ slotName, game, tier, reasons: list.map(x => x.reason), codes: list.map(x => x.code) });
  if (problems.length > 0) return pack(problems, 'problem');
  if (warnings.length > 0) return pack(warnings, 'warning');
  return null;
}

// Build the player-findings list for a candidate from its scoped slots. Only owned
// slots produce player rows; public slots still count toward the shared scope.
function playersFrom(
  scope: ScopedSlot[],
  nameFor: (ownerId: string) => string,
  players: Record<string, Player>,
  now: number,
): ReportPlayerFinding[] {
  const byPlayer = new Map<string, ReportSlotFinding[]>();
  for (const { ownerId, slot } of scope) {
    if (ownerId == null) continue; // public slots have no player to report
    const finding = classifySlot(slot, ownerId, scope, now);
    if (!finding) continue;
    const list = byPlayer.get(ownerId) ?? [];
    list.push(finding);
    byPlayer.set(ownerId, list);
  }

  return [...byPlayer.entries()]
    .map(([playerId, findings]) => ({
      playerId,
      handle: handleFor(playerId, nameFor(playerId), players),
      // Problems before warnings, then alphabetical by slot name.
      findings: findings.sort((a, b) =>
        a.tier !== b.tier ? (a.tier === 'problem' ? -1 : 1)
        : a.slotName.localeCompare(b.slotName, undefined, { sensitivity: 'base' })),
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' }));
}

// Elapsed clock origin, mirroring the mission card: room link up is when play can
// start. Missions fall back through deploy → first join → creation; tiles have only
// linkedAt. Null → elapsed unknown (treated as NOT too-early, so it stays visible).
function bucketFor(elapsedOrigin: number | null, lastReportAt: number | null, now: number): ReportBucket {
  if (elapsedOrigin != null && (now - elapsedOrigin) / HOUR < TOO_EARLY_HOURS) return 'tooEarly';
  if (lastReportAt != null && (now - lastReportAt) / HOUR < RECENTLY_REPORTED_HOURS) return 'recentlyReported';
  return 'active';
}

export function computeStatusReport(
  missions: Record<string, GMMission>,
  tiles: Record<string, Tile>,
  players: Record<string, Player>,
  now: number,
  missionLabel: (m: GMMission) => string,
): ReportCandidate[] {
  const out: ReportCandidate[] = [];

  // ── Missions ───────────────────────────────────────────────────────────────
  for (const [id, m] of Object.entries(missions ?? {})) {
    if (m.state !== 'inprogress') continue;
    const scope: ScopedSlot[] = Object.values(m.participants ?? {})
      .flatMap(p => (p.slots ?? []).map(slot => ({ ownerId: p.playerId, slot })));
    const nameFor = (ownerId: string) =>
      Object.values(m.participants ?? {}).find(p => p.playerId === ownerId)?.playerName ?? ownerId;
    const playersList = playersFrom(scope, nameFor, players, now);
    if (playersList.length === 0) continue;

    const origin = m.linkedAt ?? m.deployedAt ?? m.firstJoinAt ?? m.createdAt ?? null;
    out.push({
      kind: 'mission', id, name: missionLabel(m),
      bucket: bucketFor(origin, m.lastReportAt ?? null, now),
      players: playersList,
    });
  }

  // ── Tiles / challenges ───────────────────────────────────────────────────────
  for (const [coord, t] of Object.entries(tiles ?? {})) {
    if (t.state !== 'inprogress') continue;
    const scope: ScopedSlot[] = [
      ...Object.values(t.adventurers ?? {}).flatMap(a =>
        (a.slots ?? []).map(slot => ({ ownerId: a.owner, slot }))),
      ...(t.publicSlots ?? []).map(slot => ({ ownerId: null, slot })),
    ];
    const nameFor = (ownerId: string) =>
      Object.values(t.adventurers ?? {}).find(a => a.owner === ownerId)?.ownerName ?? ownerId;
    const playersList = playersFrom(scope, nameFor, players, now);
    if (playersList.length === 0) continue;

    out.push({
      kind: 'tile', id: coord, name: t.name || coord,
      bucket: bucketFor(t.linkedAt ?? null, t.lastReportAt ?? null, now),
      players: playersList,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ── Official report ──────────────────────────────────────────────────────────
// Snapshot the given candidates (the live "Active" section) into the persisted
// shape. Problems drive the player-facing pings; warnings are admin-facing.

export function buildOfficialReport(active: ReportCandidate[], ts: number, runBy?: string): OfficialReport {
  const problems: OfficialProblemWorld[] = [];
  const warnings: OfficialWarnWorld[]    = [];

  for (const c of active) {
    // Problems → per player, split into stalled ("Status on …?") and unstarted.
    const players: OfficialProblemPlayer[] = [];
    for (const p of c.players) {
      const stalled: string[]   = [];
      const unstarted: string[] = [];
      for (const f of p.findings) {
        if (f.tier !== 'problem') continue;
        if (f.codes.includes('unstarted')) unstarted.push(f.slotName);
        if (f.codes.includes('stalled'))   stalled.push(f.slotName);
      }
      if (stalled.length || unstarted.length) {
        players.push({ playerId: p.playerId, handle: p.handle, stalled, unstarted });
      }
    }
    if (players.length) problems.push({ kind: c.kind, id: c.id, name: c.name, players });

    // Warnings → deduped items. Player-specific codes carry the handle; allIdle60
    // is world-general (collapsed to a single item).
    const items: OfficialWarnItem[] = [];
    const seen = new Set<string>();
    let allIdle = false;
    const add = (code: OfficialWarnItem['code'], p?: ReportCandidate['players'][number]) => {
      const key = `${code}|${p?.playerId ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(p ? { code, playerId: p.playerId, handle: p.handle } : { code });
    };
    for (const p of c.players) {
      for (const f of p.findings) {
        if (f.tier !== 'warning') continue;
        if (f.codes.includes('lastPlayer'))    add('lastPlayer', p);
        if (f.codes.includes('lastChecker'))   add('lastChecker', p);
        if (f.codes.includes('noActivity144')) add('noActivity144', p);
        if (f.codes.includes('allIdle60'))     allIdle = true;
      }
    }
    if (allIdle) add('allIdle60');
    if (items.length) warnings.push({ kind: c.kind, id: c.id, name: c.name, handled: false, items });
  }

  return { ts, runBy, problems, warnings };
}

const codeSpan = (s: string) => '``' + s + '``';

// RTDB drops empty arrays to null and hands dense arrays back as-is; normalize any
// array-ish value (including objects with numeric keys) to a plain array.
const asArr = <T,>(v: T[] | Record<string, T> | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : Object.values(v);

// Player-facing Problems block (the primary copy-paste, to ping players).
export function renderProblemsMarkdown(r: OfficialReport): string {
  const worlds = asArr(r.problems);
  if (!worlds.length) return '';
  const lines: string[] = ['## Status Report'];
  for (const w of worlds) {
    lines.push(`### ${w.name}`);
    for (const p of asArr(w.players)) {
      const stalled = asArr(p.stalled);
      const unstarted = asArr(p.unstarted);
      const clauses: string[] = [];
      if (stalled.length)   clauses.push(`Status on ${stalled.map(codeSpan).join(', ')}?`);
      if (unstarted.length) clauses.push(`Don't forget to start ${unstarted.map(codeSpan).join(', ')}.`);
      lines.push(`${p.handle} ${clauses.join(' ')}`);
    }
  }
  return lines.join('\n');
}

export function warnItemText(it: OfficialWarnItem): string {
  switch (it.code) {
    case 'lastPlayer':    return `${it.handle} is the last to finish this world.`;
    case 'lastChecker':   return `${it.handle} is the last still finding checks — others here are at 100% and may be waiting on an item from them.`;
    case 'noActivity144': return `${it.handle} — no activity in over ${WARN_NO_ACTIVITY_HOURS} hours.`;
    case 'allIdle60':     return `No activity by players in last ${WARN_ALL_STALE_HOURS} hours.`;
  }
}

// Admin-facing Warnings block (handled manually).
export function renderWarningsMarkdown(r: OfficialReport): string {
  const worlds = asArr(r.warnings);
  if (!worlds.length) return '';
  const lines: string[] = ['## Status Report — Warnings'];
  for (const w of worlds) {
    lines.push(`${w.name}:`);
    for (const it of asArr(w.items)) lines.push(warnItemText(it));
  }
  return lines.join('\n');
}
