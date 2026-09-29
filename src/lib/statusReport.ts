// ── Status Report logic ──────────────────────────────────────────────────────
// Pure computation of the admin Status Report: which in-progress missions and
// challenges have "problem" or "warning" slots, who owns them, and why. Kept free
// of React/Firebase so it can be unit-tested against the live thresholds.
//
// Three timestamps per slot, of unequal weight:
//   lastActivity — STRONG. Server-verified activity from the Archipelago server;
//                  the real "still making progress" signal. Drives the time-based
//                  warnings (no recent activity).
//   lastChecked  — WEAK. A manual self-report by the player (e.g. vouching they're
//                  stuck); may be inaccurate. Only counts toward the "later of the
//                  three" progress check on the problem threshold.
//   lastReported — WEAK. Stamped when the player saves a status note on the slot.
//                  Weighted exactly like lastChecked, so a note CLEARS the
//                  `stalled` problem and therefore costs no statusIncident. That
//                  is deliberate (it is why notes exist), and it is not a new
//                  loophole — lastChecked already does the same from the tracker
//                  side. `noActivity144` deliberately ignores both: a note must
//                  never launder a slot with no server activity.
//
// "Done" here means Goaled/Done only — a `100%` slot has every check but no goal,
// so it still holds its world open and can be flagged as the last player. See
// OWING_STATUSES; do not conflate it with FREE_COMPLETED_STATUSES.

import type {
  GMMission, Tile, Player, AdvSlot, SlotStatus, AdvStatusNote,
  OfficialReport, OfficialProblemWorld, OfficialProblemPlayer, OfficialWarnWorld, OfficialWarnItem,
  RoomProgressSample,
} from '../types';
import { FREE_COMPLETED_STATUSES } from './constants';

const HOUR = 3_600_000;

// Slot-level thresholds (hours). The two 72s are the check-in cadence and move
// together; the warn code `allIdle60` keeps its old name because it is a stored
// wire value (see StatusWarnCode) — its rendered text reads the constant.
export const PROBLEM_STALE_HOURS      = 72;   // In-Progress: no activity AND no self-report in this long → problem
export const WARN_NO_ACTIVITY_HOURS   = 144;  // In-Progress: no server activity in this long → warning
export const WARN_ALL_STALE_HOURS     = 72;   // every In-Progress slot here idle (no activity) this long → warning

// Candidate-level bucket thresholds (hours).
export const TOO_EARLY_HOURS        = 48;  // not yet elapsed this long → "Too Early"
export const RECENTLY_REPORTED_HOURS = 24; // reported within this long → "Recently Reported"

// Landing-page idle badge (the player-facing preview of the above). The alert tier
// deliberately REUSES PROBLEM_STALE_HOURS rather than declaring its own 72, so the
// red badge always means "you are on the host's next report" and the two can never
// drift apart. Only the caution tier is new.
export const SLOT_CAUTION_HOURS = 48;

// ── Room-pace thresholds ─────────────────────────────────────────────────────
// Room health asks a different question from every threshold above it: not "is
// this PLAYER responding" but "is this ROOM going to finish". They are not the
// same world — ten players can each look clean on the slot checks while the room
// as a whole crawls, which is exactly the case nothing else here catches.
//
// The window REUSES PROBLEM_STALE_HOURS rather than declaring its own 72, for
// the same reason the idle badge does: that constant already is the check-in
// cadence, and two copies would drift. The pace is normalised to it, so a report
// run twice in one day and one run three weeks late are judged on the same bar —
// official runs are ad hoc, so a raw "since the last report" delta would mean a
// different thing every time it was read.
export const ROOM_WINDOW_HOURS = PROBLEM_STALE_HOURS;  // 72 — the pace window
export const ROOM_CAUTION_PCT  = 3;    // < this %/window → caution: worth a look
export const ROOM_DANGER_PCT   = 1.5;  // < this %/window → danger: investigate

// Sampling policy, mirrored in `tickSlotStatuses` (which is the only writer).
// Retention must comfortably exceed the window, or a room could hold samples yet
// have no baseline old enough to judge against.
export const ROOM_SAMPLE_MIN_HOURS       = 6;    // minimum spacing between samples
export const ROOM_SAMPLE_RETENTION_HOURS = 336;  // 14d of history kept

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
  /** The player's own explanation, when they left one. Surfaced in the admin
   *  Report tab so the host reads the reason before deciding whether to excuse —
   *  it is exactly the evidence the trackers cannot see. */
  note?:    AdvStatusNote;
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
  /** Pace reading per cheese room — one entry, or two for a bifurcated tile.
   *  Rooms with too little history to judge are omitted, so this can be empty.
   *  ⚠️ A candidate may have NO players and still be here on room pace alone —
   *  that is the whole point of the reading (see computeStatusReport). */
  rooms:   RoomHealth[];
}

// One slot in a candidate's scope, tagged with its owner (null = unowned public
// slot). `room` is display-only, for the peek's bifurcated grouping — the scope
// itself deliberately spans both rooms of a tile (see WorldScope).
interface ScopedSlot {
  ownerId: string | null;
  slot:    AdvSlot;
  room?:   1 | 2;
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

/**
 * The newest sign of life on a slot — the later of server activity and either
 * kind of self-report. Only present stamps count; all three missing returns null
 * ("unknown", per `stale()` above).
 */
export function lastSignOfLife(s: AdvSlot): number | null {
  const stamps = [s.lastActivity, s.lastChecked, s.lastReported].filter((v): v is number => v != null);
  return stamps.length ? Math.max(...stamps) : null;
}

export type SlotIdleTier = 'caution' | 'alert';

export interface SlotIdle {
  tier:  SlotIdleTier;
  hours: number;    // whole hours since the last sign of life
  /** True when the clock is running from the room link, not from a timestamp —
   *  the badge's copy says "since the room went up" rather than "since last
   *  activity", which would be a lie on a slot that has never had any. */
  fromRoom: boolean;
}

/**
 * The landing page's idle badge for one slot, or null for no badge.
 *
 * Two departures from the report's own rules, both deliberate:
 *
 *  - Suppressed for every status in FREE_COMPLETED_STATUSES (100% / Goaled /
 *    Done) — the set that already frees a mission claim. `statusReport` keeps
 *    `100%` in scope on purpose (see the header note), so a 100% slot can raise
 *    a `lastPlayer` warning while carrying no badge. That is the intended trade:
 *    this badge nudges the player, it does not mirror the report.
 *
 *  - With no stamps at all the clock falls back to `roomLinkedAt`, so an
 *    Unstarted slot still badges. `stale()`'s unknown-is-never-stale rule holds
 *    for the report and is untouched; the fallback is safe here because the room
 *    link is an event we recorded, not the absence of one. No link, no badge —
 *    there was nothing to start.
 */
export function slotIdleTier(
  s: AdvSlot,
  now: number,
  roomLinkedAt?: number | null,
): SlotIdle | null {
  const status = statusOf(s);
  if (FREE_COMPLETED_STATUSES.has(status)) return null;

  const sign     = lastSignOfLife(s);
  const fromRoom = sign == null;
  const origin   = sign ?? roomLinkedAt ?? null;
  if (origin == null) return null;

  const hours = Math.floor((now - origin) / HOUR);
  if (hours >= PROBLEM_STALE_HOURS) return { tier: 'alert',   hours, fromRoom };
  if (hours >= SLOT_CAUTION_HOURS)  return { tier: 'caution', hours, fromRoom };
  return null;
}

export function fmtDuration(h: number): string {
  if (!isFinite(h)) return 'never';
  const totalH = Math.floor(h);
  const d = Math.floor(totalH / 24);
  const rem = totalH % 24;
  return d > 0 ? `${d}d ${rem}h` : `${totalH}h`;
}

export type RoomHealthTier = 'caution' | 'danger';

export interface RoomHealth {
  /** null = the room is keeping pace (or has nothing left to find). */
  tier:         RoomHealthTier | null;
  room:         1 | 2;     // which cheese room of the world this reading is for
  done:         number;    // checks found across the whole room, now
  total:        number;    // checks the room holds, now
  pct:          number;    // done/total as a percentage
  remaining:    number;    // total − done
  gained:       number;    // checks found since the baseline sample (may be < 0)
  deltaPct:     number;    // `gained` as a % of the CURRENT total
  ratePct:      number;    // deltaPct normalised to ROOM_WINDOW_HOURS — the judged number
  hours:        number;    // real hours between baseline and latest sample
  totalChanged: boolean;   // the room's size moved inside the window
}

/**
 * How fast one room is actually clearing, from its `roomProgress` samples.
 *
 * Returns null for "unknown" — no samples, no baseline a full window old, or a
 * room with nothing tracked yet. That follows `stale()`'s rule: an absence of
 * data is never evidence of a problem, and a young room must not read as 0%
 * progress simply because it has no history to compare against.
 *
 * Two deliberate choices in the arithmetic:
 *
 *  - The delta is measured against the CURRENT total, not the baseline's. The
 *    denominator moves — a slot connecting for the first time adds its whole
 *    location count — and dividing by the old total would report a window in
 *    which real progress was made as the room going backwards.
 *
 *  - A finished room (every check found) is never flagged. It has no progress
 *    left to make, so the pace question does not apply to it; without this the
 *    last window of every successful room would read as danger.
 */
export function roomHealth(
  samples: Record<string, RoomProgressSample> | undefined | null,
  now: number,
  room: 1 | 2 = 1,
): RoomHealth | null {
  const rows = Object.entries(samples ?? {})
    .map(([ts, v]) => ({ ts: Number(ts), done: v?.done ?? 0, total: v?.total ?? 0 }))
    .filter(r => Number.isFinite(r.ts) && r.ts <= now)
    .sort((a, b) => a.ts - b.ts);

  const latest = rows[rows.length - 1];
  if (!latest || !(latest.total > 0)) return null;

  // Baseline: the NEWEST sample at least a full window old, so the measured span
  // is the window plus at most one sampling interval. `base === latest` means
  // sampling stopped a window ago (the room went all-Done, or its fetches are
  // failing) — unknown, not stalled.
  const cutoff = now - ROOM_WINDOW_HOURS * HOUR;
  let base: typeof latest | undefined;
  for (const r of rows) { if (r.ts > cutoff) break; base = r; }
  if (!base || base.ts >= latest.ts) return null;

  const hours     = (latest.ts - base.ts) / HOUR;
  const gained    = latest.done - base.done;
  const deltaPct  = (gained / latest.total) * 100;
  const ratePct   = deltaPct * (ROOM_WINDOW_HOURS / hours);
  const remaining = latest.total - latest.done;

  const tier: RoomHealthTier | null =
    remaining <= 0            ? null
    : ratePct < ROOM_DANGER_PCT  ? 'danger'
    : ratePct < ROOM_CAUTION_PCT ? 'caution'
    : null;

  return {
    tier, room,
    done: latest.done, total: latest.total,
    pct: (latest.done / latest.total) * 100,
    remaining, gained, deltaPct, ratePct, hours,
    totalChanged: latest.total !== base.total,
  };
}

/** The worse of a world's rooms — a bifurcated tile has two, and one sick room
 *  is enough to make the world worth opening. */
export const worstRoomTier = (rooms: RoomHealth[]): RoomHealthTier | null =>
  rooms.some(r => r.tier === 'danger')  ? 'danger'
  : rooms.some(r => r.tier === 'caution') ? 'caution'
  : null;

const pct1   = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
const signed = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString()}`;

/**
 * One room's pace in words. Used for the admin card AND stored as the warn
 * item's `detail`, so a report stays readable after its samples are pruned.
 *
 * It leads with the absolute counts on purpose. A room funnelled down to a
 * handful of checks ping-ponging between two players will flag forever and the
 * flag is correct — but `+11 of 46 remaining` triages in one glance, where a
 * bare `0.9%` would send the host into the room to find out it was fine.
 */
export function roomHealthText(h: RoomHealth, showRoom = false): string {
  const head = showRoom ? `Room ${h.room}: ` : '';
  const grew = h.totalChanged ? ' Room size changed this window.' : '';
  // The normalised rate is only worth printing when the span is NOT the window —
  // on an ordinary read the two numbers are the same and repeating it reads as a
  // mistake. When a sampling gap stretched the span, it is the whole story.
  const rate = Math.abs(h.hours - ROOM_WINDOW_HOURS) >= 1
    ? ` = ${pct1(h.ratePct)} per ${ROOM_WINDOW_HOURS}h.` : '.';
  return `${head}${signed(h.gained)} checks (${pct1(h.deltaPct)}) in ${fmtDuration(h.hours)}${rate}`
    + ` ${h.done.toLocaleString()} of ${h.total.toLocaleString()} found;`
    + ` ${h.remaining.toLocaleString()} remain (${pct1(h.pct)} clear).${grew}`;
}

// ── Daily series (the peek's bar charts) ─────────────────────────────────────
// Samples are 6-hourly, so "what happened on Tuesday" is the difference between
// the last sample of Monday and the last sample of Tuesday. Both ends must exist:
// a day we cannot bracket is a GAP, never a zero — drawing a missing sample as
// "no progress" is the same lie `stale()` refuses to tell about a missing stamp.

export interface DayBucket {
  dayStart: number;        // local midnight
  label:    string;        // short weekday
  gained:   number | null; // checks found that day; null = no data to bracket it
  pct:      number | null; // `gained` as a share of the room/slot's CURRENT total
}

/** Per-slot samples: `{ts: {slotKey: {d, t}}}` — the `roomTelemetry` tree. */
export type SlotProgressSamples = Record<string, Record<string, { d?: number; t?: number }>>;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Local midnight `back` days ago. Uses setDate rather than subtracting 24h so a
// DST change shifts the boundary instead of smearing it across two days.
function startOfDay(now: number, back: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
}

function bucketize(
  points: { ts: number; v: number }[],
  total: number,
  now: number,
  days: number,
): DayBucket[] {
  const pts = points.filter(p => Number.isFinite(p.ts) && p.ts <= now).sort((a, b) => a.ts - b.ts);
  // Newest value at or before `t`, or null when nothing was sampled that early.
  const before = (t: number): number | null => {
    let found: number | null = null;
    for (const p of pts) { if (p.ts > t) break; found = p.v; }
    return found;
  };
  // Newest value sampled INSIDE the day. A day needs one: carrying the last known
  // value across an unsampled day would draw a stopped tick — or a room that went
  // all-Done and is no longer polled — as a run of confident zeroes, which is the
  // one thing these bars must never say. Today counts as unsampled until its first
  // tick lands, so the newest bar can legitimately be a gap.
  const within = (from: number, to: number): number | null => {
    let found: number | null = null;
    for (const p of pts) { if (p.ts > to) break; if (p.ts > from) found = p.v; }
    return found;
  };

  const out: DayBucket[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const dayStart = startOfDay(now, back);
    const dayEnd   = Math.min(now, startOfDay(now, back - 1));
    const a = before(dayStart);
    const b = within(dayStart, dayEnd);
    const gained = a == null || b == null ? null : b - a;
    out.push({
      dayStart,
      label: DAY_LABELS[new Date(dayStart).getDay()],
      gained,
      pct: gained == null || total <= 0 ? null : (gained / total) * 100,
    });
  }
  return out;
}

/** Share of the whole room found on each of the last `days` days. */
export function roomDailySeries(
  samples: Record<string, RoomProgressSample> | undefined | null,
  now: number,
  days = 14,
): DayBucket[] {
  const rows = Object.entries(samples ?? {})
    .map(([ts, v]) => ({ ts: Number(ts), done: v?.done ?? 0, total: v?.total ?? 0 }))
    .filter(r => Number.isFinite(r.ts) && r.ts <= now)
    .sort((a, b) => a.ts - b.ts);
  const total = rows.length ? rows[rows.length - 1].total : 0;
  return bucketize(rows.map(r => ({ ts: r.ts, v: r.done })), total, now, days);
}

export interface SlotSeries {
  days:  DayBucket[];
  done:  number;
  total: number;
  /** Checks found across the whole window — the row's headline delta. */
  gained: number | null;
}

/**
 * One slot's recent movement, or null when the tree holds nothing under this key.
 * Null is the honest answer for a slot whose `{NUMBER}` never resolved: its stored
 * name is not the one the room generated, so it matches no series and must show
 * "no match" rather than somebody else's numbers.
 */
export function slotDailySeries(
  samples: SlotProgressSamples | undefined | null,
  slotKey: string,
  now: number,
  days = 7,
): SlotSeries | null {
  const rows = Object.entries(samples ?? {})
    .map(([ts, bySlot]) => ({ ts: Number(ts), cell: bySlot?.[slotKey] }))
    .filter(r => Number.isFinite(r.ts) && r.ts <= now && r.cell != null)
    .map(r => ({ ts: r.ts, d: r.cell!.d ?? 0, t: r.cell!.t ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
  if (rows.length === 0) return null;

  const latest  = rows[rows.length - 1];
  const buckets = bucketize(rows.map(r => ({ ts: r.ts, v: r.d })), latest.t, now, days);
  const known   = buckets.filter(b => b.gained != null);
  return {
    days: buckets,
    done: latest.d,
    total: latest.t,
    gained: known.length ? known.reduce((n, b) => n + b.gained!, 0) : null,
  };
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
    // "Later of activity / self-report": strong server activity OR either kind of
    // (weaker) manual self-report counts as a sign of life. Only present timestamps
    // count — a slot with none recorded is unknown, not stalled.
    const lastSign = lastSignOfLife(s);

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
    ({ slotName, game, tier, reasons: list.map(x => x.reason), codes: list.map(x => x.code),
       ...(s.note ? { note: s.note } : {}) });
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

// ── World scope ──────────────────────────────────────────────────────────────
// The slot set a world is judged over, built ONCE here and shared by the report
// and the admin peek. Both must see the same slots: `allIdle60` and the two
// last-player warnings compare a slot against every other slot in this list, so a
// second construction that differed even slightly would silently change verdicts.
//
// Note a bifurcated tile is deliberately ONE scope spanning both rooms, which is
// the long-standing behaviour — `room` is carried for display only.

interface WorldScope {
  scope:   ScopedSlot[];
  nameFor: (ownerId: string) => string;
}

export function missionScope(m: GMMission): WorldScope {
  const parts = Object.values(m.participants ?? {});
  return {
    scope: parts.flatMap(p => (p.slots ?? []).map(slot => ({ ownerId: p.playerId, slot }))),
    nameFor: (ownerId) => parts.find(p => p.playerId === ownerId)?.playerName ?? ownerId,
  };
}

export function tileScope(t: Tile): WorldScope {
  const advs = Object.values(t.adventurers ?? {});
  return {
    scope: [
      ...advs.flatMap(a => (a.slots ?? []).map(slot => ({ ownerId: a.owner, slot, room: a.room ?? slot.room ?? 1 }))),
      ...(t.publicSlots ?? []).map(slot => ({ ownerId: null, slot, room: slot.room ?? 1 })),
    ],
    nameFor: (ownerId) => advs.find(a => a.owner === ownerId)?.ownerName ?? ownerId,
  };
}

/** Sort rank for the peek: what needs attention first, finished last. */
export type SlotRank = 0 | 1 | 2 | 3;

export interface WorldSlot {
  slot:      AdvSlot;
  ownerId:   string | null;   // null = a public slot, owned by nobody
  handle:    string | null;   // "@handle"; null for public slots
  room:      1 | 2;
  finding:   ReportSlotFinding | null;
  rank:      SlotRank;        // 0 problem · 1 warning · 2 still going · 3 finished
}

/**
 * EVERY slot in a world, each with the finding it would raise (or null).
 *
 * This is the peek's view, and it differs from the report's on purpose:
 * `playersFrom` drops clean slots and public slots because nobody can be pinged
 * about them, but the host looking into a room needs to see the whole table —
 * a finished slot is context, and a public slot is still part of the world.
 *
 * It also keeps ALL of a slot's findings, where the report keeps one tier: a
 * problem outranks a warning in `classifySlot`, so `lastChecker` (the others are
 * at 100% and waiting on this player) never survives into a ping. It is often the
 * most useful thing on the row, so the peek shows it.
 */
export function worldSlotReport(
  ws: WorldScope,
  players: Record<string, Player>,
  now: number,
): WorldSlot[] {
  const rows = ws.scope.map(({ ownerId, slot, room }) => {
    const finding = ownerId == null ? null : classifySlot(slot, ownerId, ws.scope, now);
    const rank: SlotRank =
      finding?.tier === 'problem' ? 0
      : finding?.tier === 'warning' ? 1
      : ungoaled(slot) ? 2
      : 3;
    return {
      slot, ownerId, room: (room ?? 1) as 1 | 2, finding, rank,
      handle: ownerId == null ? null : handleFor(ownerId, ws.nameFor(ownerId), players),
    };
  });

  return rows.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank
    : (a.slot.name || '').localeCompare(b.slot.name || '', undefined, { sensitivity: 'base' }));
}

// Elapsed clock origin, mirroring the mission card: room link up is when play can
// start. Missions fall back through deploy → first join → creation; tiles have only
// linkedAt. Null → elapsed unknown (treated as NOT too-early, so it stays visible).
function bucketFor(elapsedOrigin: number | null, lastReportAt: number | null, now: number): ReportBucket {
  if (elapsedOrigin != null && (now - elapsedOrigin) / HOUR < TOO_EARLY_HOURS) return 'tooEarly';
  if (lastReportAt != null && (now - lastReportAt) / HOUR < RECENTLY_REPORTED_HOURS) return 'recentlyReported';
  return 'active';
}

const roomsOf = (list: (RoomHealth | null)[]): RoomHealth[] =>
  list.filter((r): r is RoomHealth => r != null);

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
    const { scope, nameFor } = missionScope(m);
    const playersList = playersFrom(scope, nameFor, players, now);
    // A world with no player findings still earns a card when its ROOM is off the
    // pace — that combination (everybody individually responsive, the room barely
    // moving) is precisely what the slot checks cannot see, and dropping it here
    // is what would make the reading useless.
    const rooms = roomsOf([roomHealth(m.roomProgress, now, 1)]);
    if (playersList.length === 0 && !worstRoomTier(rooms)) continue;

    const origin = m.linkedAt ?? m.deployedAt ?? m.firstJoinAt ?? m.createdAt ?? null;
    out.push({
      kind: 'mission', id, name: missionLabel(m),
      bucket: bucketFor(origin, m.lastReportAt ?? null, now),
      players: playersList,
      rooms,
    });
  }

  // ── Tiles / challenges ───────────────────────────────────────────────────────
  for (const [coord, t] of Object.entries(tiles ?? {})) {
    if (t.state !== 'inprogress') continue;
    const { scope, nameFor } = tileScope(t);
    const playersList = playersFrom(scope, nameFor, players, now);
    // Bifurcated tiles are two Archipelago rooms and therefore two readings; a
    // tile that never split simply has no second sample tree.
    const rooms = roomsOf([
      roomHealth(t.roomProgress,  now, 1),
      roomHealth(t.roomProgress2, now, 2),
    ]);
    if (playersList.length === 0 && !worstRoomTier(rooms)) continue;

    out.push({
      kind: 'tile', id: coord, name: t.name || coord,
      bucket: bucketFor(t.linkedAt ?? null, t.lastReportAt ?? null, now),
      players: playersList,
      rooms,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ── Official report ──────────────────────────────────────────────────────────
// Snapshot the given candidates (the live "Active" section) into the persisted
// shape. Problems drive the player-facing pings; warnings are admin-facing.

// RTDB drops empty arrays to null and hands dense arrays back as-is; normalize any
// array-ish value (including objects with numeric keys) to a plain array.
const asArr = <T,>(v: T[] | Record<string, T> | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : Object.values(v);

// Key identifying one player's problems on one world — the unit an excuse acts on.
// Shared so the pre-run UI and buildOfficialReport agree on the shape.
export const excuseKey = (kind: 'mission' | 'tile', id: string, playerId: string): string =>
  `${kind}:${id}:${playerId}`;

// Pre-run excuses: excuseKey → optional reason ('' when none was typed).
export type ExcuseMap = Record<string, string>;

export function buildOfficialReport(
  active: ReportCandidate[], ts: number, runBy?: string, excuses: ExcuseMap = {},
): OfficialReport {
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
      if (!stalled.length && !unstarted.length) continue;

      // An excused player still goes into the snapshot (audit trail) but carries
      // the flag that keeps them out of the ping and off the incident count.
      const key    = excuseKey(c.kind, c.id, p.playerId);
      const reason = Object.prototype.hasOwnProperty.call(excuses, key) ? excuses[key] : null;
      const row: OfficialProblemPlayer = { playerId: p.playerId, handle: p.handle, stalled, unstarted };
      if (reason != null) {
        row.excused   = true;
        row.excusedAt = ts;
        if (runBy) row.excusedBy = runBy;
        if (reason.trim()) row.excusedReason = reason.trim();
      }
      players.push(row);
    }
    if (players.length) problems.push({ kind: c.kind, id: c.id, name: c.name, players });

    // Warnings → deduped items, each carrying the slot names that tripped it.
    // Player-specific codes carry the handle; allIdle60 is world-general (a
    // single item, whose slots span every player idle here).
    const items = new Map<string, OfficialWarnItem>();
    const allIdleSlots: string[] = [];

    // Room pace leads the list: it is the only world-level judgement here, and a
    // world can be on the report for this and nothing else. It carries no slots
    // and no playerId — the room's pace is nobody's individual fault, which is
    // also why these codes never reach the player-facing Problems block and
    // never charge a statusIncident. `detail` is rendered NOW because the
    // samples behind it are pruned at 14 days while reports are kept for 10.
    for (const h of c.rooms) {
      if (!h.tier) continue;
      items.set(`room${h.room}`, {
        code:   h.tier === 'danger' ? 'roomDanger' : 'roomCaution',
        detail: roomHealthText(h, c.rooms.length > 1),
      });
    }
    const add = (code: OfficialWarnItem['code'], slot: string, p?: ReportCandidate['players'][number]) => {
      const key = `${code}|${p?.playerId ?? ''}`;
      const cur = items.get(key);
      if (cur) { cur.slots!.push(slot); return; }
      items.set(key, p ? { code, playerId: p.playerId, handle: p.handle, slots: [slot] } : { code, slots: [slot] });
    };
    for (const p of c.players) {
      for (const f of p.findings) {
        if (f.tier !== 'warning') continue;
        if (f.codes.includes('lastPlayer'))    add('lastPlayer', f.slotName, p);
        if (f.codes.includes('lastChecker'))   add('lastChecker', f.slotName, p);
        if (f.codes.includes('noActivity144')) add('noActivity144', f.slotName, p);
        if (f.codes.includes('allIdle60'))     allIdleSlots.push(f.slotName);
      }
    }
    // Appended last so allIdle60 keeps its trailing position in the item list.
    for (const s of allIdleSlots) add('allIdle60', s);

    const list = [...items.values()];
    // Two players can own same-named slots; dedupe so the line reads once each.
    // Skip the slotless items (room pace) — `new Set(undefined)` would stamp them
    // with an empty array that RTDB then stores as null.
    for (const it of list) {
      if (!it.slots) continue;
      it.slots = [...new Set(it.slots)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    if (list.length) warnings.push({ kind: c.kind, id: c.id, name: c.name, handled: false, items: list });
  }

  return { ts, runBy, problems, warnings };
}

// Did this world actually ping anyone? A world whose every problem player was
// excused was reported on paper only, so it must not reset its own report timer.
export const hasUnexcusedProblem = (w: OfficialProblemWorld): boolean =>
  asArr(w.players).some(p => !p.excused);

const codeSpan = (s: string) => '``' + s + '``';

// Player-facing Problems block (the primary copy-paste, to ping players).
// Excused players are omitted entirely — the whole point of an excuse is that
// they don't get pinged — and a world left with nobody to ping drops its heading.
export function renderProblemsMarkdown(r: OfficialReport): string {
  const worlds = asArr(r.problems);
  if (!worlds.length) return '';
  const lines: string[] = [];
  for (const w of worlds) {
    const pingable = asArr(w.players).filter(p => !p.excused);
    if (!pingable.length) continue;
    lines.push(`### ${w.name}`);
    for (const p of pingable) {
      const stalled = asArr(p.stalled);
      const unstarted = asArr(p.unstarted);
      const clauses: string[] = [];
      if (stalled.length)   clauses.push(`Status on ${stalled.map(codeSpan).join(', ')}?`);
      if (unstarted.length) clauses.push(`Don't forget to start ${unstarted.map(codeSpan).join(', ')}.`);
      lines.push(`${p.handle} ${clauses.join(' ')}`);
    }
  }
  return lines.length ? ['## Status Report', ...lines].join('\n') : '';
}

// `wrap` decorates the slot names: identity for the on-screen list, codeSpan for
// the copy-paste markdown (where backticks are wanted, not shown literally).
export function warnItemText(it: OfficialWarnItem, wrap: (s: string) => string = s => s): string {
  const slots = asArr(it.slots);
  const tail  = slots.length ? ` (Slots: ${slots.map(wrap).join(', ')})` : '';
  switch (it.code) {
    case 'lastPlayer':    return `${it.handle} is the last to finish this world.${tail}`;
    case 'lastChecker':   return `${it.handle} is the last still finding checks — others here are at 100% and may be waiting on an item from them.${tail}`;
    case 'noActivity144': return `${it.handle} — no activity in over ${WARN_NO_ACTIVITY_HOURS} hours.${tail}`;
    case 'allIdle60':     return `No activity by players in last ${WARN_ALL_STALE_HOURS} hours.${tail}`;
    // Room pace. The thresholds are read from the constants (as `allIdle60`'s
    // text is) so the wording can never drift from what actually fired.
    case 'roomCaution':   return `Room pace under ${ROOM_CAUTION_PCT}% per ${ROOM_WINDOW_HOURS}h — worth a look. ${it.detail ?? ''}`.trim();
    case 'roomDanger':    return `Room pace under ${ROOM_DANGER_PCT}% per ${ROOM_WINDOW_HOURS}h — needs investigation. ${it.detail ?? ''}`.trim();
  }
}

// Admin-facing Warnings block (handled manually).
export function renderWarningsMarkdown(r: OfficialReport): string {
  const worlds = asArr(r.warnings);
  if (!worlds.length) return '';
  const lines: string[] = ['## Status Report — Warnings'];
  for (const w of worlds) {
    lines.push(`${w.name}:`);
    for (const it of asArr(w.items)) lines.push(warnItemText(it, codeSpan));
  }
  return lines.join('\n');
}
