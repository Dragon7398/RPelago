// Drago's APworld list — the sheet that says which APworlds this game runs by
// default. It is republished periodically, and each republication marks some
// games as newly available and others as updated, so the host has to re-check
// every world a config asks for against the current sheet.
//
// A list is therefore an ERA, not a per-download record: every room generated
// between one publication and the next was built from the same sheet. That is the
// whole model here — a registry of eras, each with the moment WE adopted it (not
// the moment the sheet was published; downloads before the switch still came off
// the old sheet). A mission's era is looked up from when its room went up.
//
// Deriving the era from a timestamp rather than stamping an id onto each mission
// is deliberate:
//   • it classifies every historical mission with no migration and no writes, and
//   • missions from before this file existed fall into the `pre` era on their own,
//     which is exactly what they are.
//
// ── RATCHETING FORWARD ────────────────────────────────────────────────────────
// When a new sheet is adopted, APPEND one entry with the date we switched to it.
// Nothing else changes: every game whose most recent download predates that date
// flips from "current" to "downloaded on an older list" on its own, and the admin
// YAML list starts asking for a re-check on exactly those. Never edit or remove a
// past entry — that rewrites the history the badges are read from.

export interface ApList {
  /** Stable key. Never reused, never renamed once shipped. */
  id:    string;
  /** How the sheet is referred to out loud ("Early August"). Shown in the UI. */
  label: string;
  /** Epoch ms WE switched to this sheet. Entries run in ascending order. */
  from:  number;
}

// America/Chicago (CDT in August) — the same wall clock the season's other
// schedule anchors use (see weeklyGoldTopUp).
export const AP_LISTS: readonly ApList[] = [
  {
    id:    'pre',
    label: 'pre-list',
    // Everything sourced before the first tracked sheet. `from: 0` makes this the
    // catch-all era for missions whose timestamps are missing or ancient.
    from:  0,
  },
  {
    id:    'early-aug',
    label: 'Early August',
    // 10:00, not midnight: the rooms generated earlier that morning were still
    // built off the old sheet, and dating the era to the start of the day would
    // wrongly clear their worlds as already checked against this one.
    from:  Date.parse('2026-08-13T10:00:00-05:00'),
  },
];

/** The sheet in force right now — the one new downloads are checked against. */
export function currentApList(): ApList {
  return AP_LISTS[AP_LISTS.length - 1];
}

/**
 * Index into `AP_LISTS` of the sheet in force at `ts` — i.e. the era a room
 * generated then was built from. A missing timestamp resolves to the earliest
 * era: an unknown download date is treated as old, so it gets re-checked rather
 * than silently passing as current.
 */
export function apListIndexAt(ts: number | null | undefined): number {
  if (ts == null) return 0;
  let idx = 0;
  for (let i = 0; i < AP_LISTS.length; i++) {
    if (ts >= AP_LISTS[i].from) idx = i;
  }
  return idx;
}

export function apListAt(ts: number | null | undefined): ApList {
  return AP_LISTS[apListIndexAt(ts)];
}

/** Is this era the one currently in force? */
export function isCurrentApList(index: number): boolean {
  return index === AP_LISTS.length - 1;
}
