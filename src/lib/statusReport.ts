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

import type { GMMission, Tile, Player, AdvSlot, SlotStatus } from '../types';

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
  reasons:  string[];
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
  const problems: string[] = [];
  const warnings: string[] = [];

  // Problem (a): never started — needs to begin their game.
  if (status === 'Unstarted') {
    problems.push('Unstarted — needs to begin their game');
  }

  if (status === 'In-Progress') {
    // "Later of activity / self-report": strong server activity OR a (weaker) manual
    // self-report both count as a sign of life. Only present timestamps count — a
    // slot with neither recorded is unknown, not stalled.
    const stamps = [s.lastActivity, s.lastChecked].filter((v): v is number => v != null);
    const lastSign = stamps.length ? Math.max(...stamps) : null;

    // Problem (b): stalled — no server activity AND no self-report in 60h+.
    if (stale(lastSign, PROBLEM_STALE_HOURS, now)) {
      problems.push(`No activity or self-report in ${fmtDuration((now - lastSign!) / HOUR)} (≥${PROBLEM_STALE_HOURS}h)`);
    }

    // Warning (a): this is the last player still progressing — every OTHER player
    // here is done (no other player holds an Unstarted or In-Progress slot).
    const otherPlayerSlots = all.filter(x => x.ownerId != null && x.ownerId !== ownerId);
    const anyOtherActive = otherPlayerSlots.some(x => {
      const st = statusOf(x.slot);
      return st === 'Unstarted' || st === 'In-Progress';
    });
    if (otherPlayerSlots.length > 0 && !anyOtherActive) {
      warnings.push('Last player still progressing — others here are done');
    }

    // Warning (b): no SERVER ACTIVITY in 144h+, even if they self-reported recently
    // (the self-report is the weak signal, so a recent one doesn't clear this).
    if (stale(s.lastActivity, WARN_NO_ACTIVITY_HOURS, now)) {
      warnings.push(`No activity in ${fmtDuration((now - s.lastActivity!) / HOUR)} (≥${WARN_NO_ACTIVITY_HOURS}h)`);
    }

    // Warning (c): EVERY In-Progress slot here (all players + public) has had no
    // server activity in 60h+. A slot with no recorded activity can't be confirmed
    // idle, so its presence keeps this from firing (unknown ≠ idle).
    const inProgHere = all.filter(x => statusOf(x.slot) === 'In-Progress');
    if (inProgHere.length > 0 && inProgHere.every(x => stale(x.slot.lastActivity, WARN_ALL_STALE_HOURS, now))) {
      warnings.push(`All in-progress slots here idle ≥${WARN_ALL_STALE_HOURS}h (no activity)`);
    }
  }

  const slotName = s.name?.trim() || '(unnamed slot)';
  const game     = s.game?.trim() || '—';
  if (problems.length > 0) return { slotName, game, tier: 'problem', reasons: problems };
  if (warnings.length > 0) return { slotName, game, tier: 'warning', reasons: warnings };
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
