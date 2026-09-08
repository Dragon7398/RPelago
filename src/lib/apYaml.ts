// Archipelago player-YAML parsing — a REUSABLE primitive.
//
// Not casino-specific: the casino Slot Fill manifest uses it now, and S2
// challenges/missions are expected to reuse it heavily. It extracts each world's
// name + resolved game from an Archipelago player YAML (single- or multi-document)
// for a "first look" prefill. It is deliberately tolerant — AP community YAMLs
// are messy — and never throws for a whole file: a bad document is skipped and
// reported, so the rest of the file still parses.
//
// It does NOT judge validity (genre fit, check counts, etc.) — that stays a
// manual step. The machine checks are "looks outright broken" (parse errors /
// missing game), "wrong number of worlds" (checkWorldCount), and the two
// settings screens below: progression_balancing (checkProgressionBalancing,
// which alone can hard-block a submit) and the per-game caps on inventory /
// locations / hints (checkYamlLimits, advisory only).

import { parseAllDocuments } from 'yaml';

// Sentinel game name for a weighted selection we cannot pin to one concrete game.
// Pair it with the `randomized` flag rather than string-matching this value, so a
// game legitimately named "Randomized" is never mistaken for the sentinel.
export const RANDOMIZED_GAME = 'Randomized';

export interface ParsedSlot {
  name:        string;    // player/slot name (templating tokens like "{number}" kept as-is)
  game:        string;    // concrete game name, or RANDOMIZED_GAME when it can't be pinned down
  randomized:  boolean;   // true whenever `game` was a weighted choice not resolvable to exactly one
  candidates?: string[];  // the viable (weight > 0) game names, when weighted — for downstream checks
}

export interface ParseYamlResult {
  slots:  ParsedSlot[];   // one per YAML document, in file order
  errors: string[];       // per-document problems; a bad document is skipped, never fatal to the file
}

interface GameResolution {
  game:        string;
  randomized:  boolean;
  candidates?: string[];
  error?:      string;
}

// Resolve the `game` field to a single name, or RANDOMIZED_GAME when a weighted
// choice can't be pinned down. A weight is "viable" only if it's a number > 0,
// so `{ GameA: 1, GameB: 0 }` still resolves cleanly to GameA.
function resolveGame(raw: unknown): GameResolution {
  if (typeof raw === 'string') {
    const g = raw.trim();
    if (!g) return { game: RANDOMIZED_GAME, randomized: true, candidates: [], error: 'empty "game" value' };
    return { game: g, randomized: false };
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const viable = Object.entries(raw as Record<string, unknown>)
      .filter(([, w]) => typeof w === 'number' && w > 0)
      .map(([g]) => g.trim())
      .filter(Boolean);
    if (viable.length === 1) return { game: viable[0], randomized: false };
    if (viable.length === 0)
      return { game: RANDOMIZED_GAME, randomized: true, candidates: [], error: 'no game option has a positive weight' };
    return { game: RANDOMIZED_GAME, randomized: true, candidates: viable };
  }

  return { game: RANDOMIZED_GAME, randomized: true, candidates: [], error: 'unrecognized "game" format' };
}

export function parseApYaml(text: string): ParseYamlResult {
  const slots:  ParsedSlot[] = [];
  const errors: string[]     = [];

  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    // uniqueKeys:false tolerates the duplicate keys AP YAMLs often carry;
    // parseAllDocuments collects per-document errors instead of throwing.
    docs = parseAllDocuments(text, { uniqueKeys: false, logLevel: 'silent' });
  } catch (e) {
    return { slots, errors: [`Could not read the file: ${(e as Error).message}`] };
  }

  const multi = docs.length > 1;
  docs.forEach((doc, i) => {
    const label = multi ? `World ${i + 1}` : 'File';

    let obj: unknown;
    try { obj = doc.toJS({ maxAliasCount: 100 }); } catch { obj = null; }

    // Empty document (blank file, or a trailing "---") — skip silently.
    if (obj == null) return;
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`${label}: not a player config — skipped.`);
      return;
    }

    const rec = obj as Record<string, unknown>;
    if (!('game' in rec)) {
      errors.push(`${label}: no "game" field — skipped.`);
      return;
    }

    const name =
      typeof rec.name === 'string' ? rec.name :
      rec.name != null             ? String(rec.name) : '';

    const resolved = resolveGame(rec.game);
    if (resolved.error) errors.push(`${label}: ${resolved.error}.`);

    slots.push({
      name,
      game:       resolved.game,
      randomized: resolved.randomized,
      ...(resolved.candidates ? { candidates: resolved.candidates } : {}),
    });
  });

  return { slots, errors };
}

// ── Shared document walking ─────────────────────────────────────────────────
//
// Every screening pass below agrees on two things: what counts as a "world" (one
// YAML document) and where inside a document an AP option may sit. Keeping them
// here means a new check can't quietly disagree with an older one about which
// half of a config it was meant to read.

// Hand each document's root record to `visit`, labelled the way findings name it
// ("World 2" in a multi-doc file, "File" in a single). Unreadable documents are
// skipped, exactly as parseApYaml skips them.
function forEachWorld(
  text: string,
  visit: (rec: Record<string, unknown>, world: string) => void,
): void {
  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    docs = parseAllDocuments(text, { uniqueKeys: false, logLevel: 'silent' });
  } catch {
    return;
  }

  const multi = docs.length > 1;
  docs.forEach((doc, i) => {
    let obj: unknown;
    try { obj = doc.toJS({ maxAliasCount: 100 }); } catch { obj = null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    visit(obj as Record<string, unknown>, multi ? `World ${i + 1}` : 'File');
  });
}

// The places a per-game AP option can live in one document: the root (where it
// acts as a default for every game in the world) and each nested game section —
// a weighted `game:` can carry several. Each site is judged on its own; callers
// combine them (worst severity for PB, highest count for the caps).
function optionSites(rec: Record<string, unknown>): Record<string, unknown>[] {
  const sites: Record<string, unknown>[] = [rec];
  for (const v of Object.values(rec)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) sites.push(v as Record<string, unknown>);
  }
  return sites;
}

// ── Progression Balancing screening ─────────────────────────────────────────
//
// A machine check on the one AP setting we care to police automatically:
// `progression_balancing` (per-world, range 0–99; named values disabled=0,
// normal=50, extreme=99). Community consensus keeps it ≤50; higher values (or
// "extreme") make a world much easier and are discouraged/disallowed here.
//
//   • REJECT (hard block): a value above 75, "extreme", or a random-range whose
//     top reaches above 75.
//   • WARN  (soft, host-visible): a value in 51–75, "random-high", or a
//     random-range that reaches into 50–75.
//
// The setting is scanned wherever it appears in a document: at the top level and
// under each game section (AP nests it under the resolved game's name; a weighted
// game can carry several sections). A weighted mapping (option → weight) is
// judged across every option with weight > 0, taking the worst outcome.

export type PbSeverity = 'warn' | 'reject';

export interface PbFinding {
  world:    string;      // "World 2" (multi-doc) or "File" (single)
  severity: PbSeverity;
  value:    string;      // the offending option(s), comma-joined
  message:  string;      // human-readable explanation
}

const pbWorse = (a: PbSeverity | null, b: PbSeverity | null): PbSeverity | null =>
  a === 'reject' || b === 'reject' ? 'reject' : a === 'warn' || b === 'warn' ? 'warn' : null;

// Severity of a single progression_balancing option (a number, or a token like
// "extreme" / "random-high" / "random-range-0-99"). Returns null when acceptable.
function pbTokenSeverity(token: string | number): PbSeverity | null {
  const raw = String(token).trim();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 75) return 'reject';
    if (n > 50) return 'warn';
    return null;
  }
  const t = raw.toLowerCase();
  if (t === 'extreme') return 'reject';
  if (t === 'random-high') return 'warn';
  if (t.startsWith('random-range')) {
    const nums = (t.match(/\d+/g) ?? []).map(Number);
    if (nums.length >= 2) {
      const top = Math.max(...nums);
      if (top > 75) return 'reject';   // range can land above 75
      if (top >= 50) return 'warn';    // range reaches into 50–75
    }
    return null;
  }
  // random, random-low, disabled, normal, or anything unrecognized → acceptable.
  return null;
}

// Judge one progression_balancing value: a scalar, or a weighted option→weight
// mapping (only weight > 0 counts). Returns the worst severity and the labels of
// the offending options.
function evalPbValue(val: unknown): { severity: PbSeverity | null; labels: string[] } {
  if (typeof val === 'number' || typeof val === 'string') {
    const sev = pbTokenSeverity(val);
    return { severity: sev, labels: sev ? [String(val).trim()] : [] };
  }
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    let worst: PbSeverity | null = null;
    const labels: string[] = [];
    for (const [opt, weight] of Object.entries(val as Record<string, unknown>)) {
      if (typeof weight !== 'number' || weight <= 0) continue;
      const sev = pbTokenSeverity(opt);
      if (sev) { labels.push(opt); worst = pbWorse(worst, sev); }
    }
    return { severity: worst, labels };
  }
  return { severity: null, labels: [] };
}

// Screen every world in a config for an out-of-policy progression_balancing.
// One finding per world (the worst it carries); acceptable worlds produce none.
export function checkProgressionBalancing(text: string): PbFinding[] {
  const findings: PbFinding[] = [];

  forEachWorld(text, (rec, world) => {
    // Gather progression_balancing wherever it lives: at the root, and under any
    // nested game section.
    const pbVals = optionSites(rec)
      .filter(site => 'progression_balancing' in site)
      .map(site => site.progression_balancing);

    let worst: PbSeverity | null = null;
    const labels = new Set<string>();
    for (const pv of pbVals) {
      const { severity, labels: ls } = evalPbValue(pv);
      if (severity) { ls.forEach(l => labels.add(l)); worst = pbWorse(worst, severity); }
    }
    if (!worst) return;

    const value = [...labels].join(', ');
    findings.push({
      world,
      severity: worst,
      value,
      message: worst === 'reject'
        ? `Progression Balancing (${value}) is too high — values above 75 and "extreme" are not allowed. Set it to 75 or lower.`
        : `Progression Balancing (${value}) is above 50 — this is discouraged and will be flagged for your host.`,
    });
  });

  return findings;
}

// ── YAML settings caps ──────────────────────────────────────────────────────
//
// The five per-game settings the rules put a number on: starting inventory
// items, priority locations, excluded locations, starting hints, and starting
// hint locations.
//
// Unlike progression_balancing there is deliberately NO hard cap here and no
// 'reject' severity — the host grants exceptions routinely, so a config over a
// cap must always still be submittable. Every finding is advisory: it warns the
// player at attach time and flags the seat for the host on download.
//
// Caps are passed in rather than baked in, because a player's feats raise their
// personal limits (see yamlLimitsForFeats in gameLogic.ts) — the same file is
// over for one player and fine for another.

export type YamlLimitKey =
  | 'startInventory' | 'priorityLocations' | 'excludeLocations'
  | 'startHints'     | 'startLocationHints';

export type YamlLimits = Record<YamlLimitKey, number>;

export interface LimitFinding {
  world:   string;        // "World 2" (multi-doc) or "File" (single)
  key:     YamlLimitKey;
  label:   string;        // "Excluded locations" — prose
  short:   string;        // "Excluded" — badge text
  count:   number;        // what the config actually asks for
  cap:     number;        // this player's limit
  message: string;        // human-readable explanation
}

interface LimitOption {
  key:      YamlLimitKey;
  label:    string;
  short:    string;
  /** AP option names feeding this cap; a site's counts are summed across them. */
  yamlKeys: string[];
  /** 'items' sums the counts in an item→count mapping; 'entries' counts members. */
  mode:     'items' | 'entries';
}

const LIMIT_OPTIONS: readonly LimitOption[] = [
  // start_inventory_from_pool grants a starting item too — it just takes it out
  // of the pool — so both feed the one cap the rules state.
  { key: 'startInventory',     label: 'Starting inventory items', short: 'Start items',
    yamlKeys: ['start_inventory', 'start_inventory_from_pool'], mode: 'items' },
  { key: 'priorityLocations',  label: 'Priority locations',        short: 'Priority',
    yamlKeys: ['priority_locations'],   mode: 'entries' },
  { key: 'excludeLocations',   label: 'Excluded locations',        short: 'Excluded',
    yamlKeys: ['exclude_locations'],    mode: 'entries' },
  { key: 'startHints',         label: 'Starting hints',            short: 'Hints',
    yamlKeys: ['start_hints'],          mode: 'entries' },
  { key: 'startLocationHints', label: 'Starting hint locations',   short: 'Hint locs',
    yamlKeys: ['start_location_hints'], mode: 'entries' },
];

// Count one option's value. An OptionSet is normally a list, but AP tolerates a
// mapping and players write both, so either shape is counted by its members. For
// start_inventory the value is item→count and the COUNTS are what the rule caps:
// `{ Bomb: 3 }` is three starting items, and an explicit 0 grants nothing.
function countOptionValue(val: unknown, mode: 'items' | 'entries'): number {
  if (val == null) return 0;
  if (Array.isArray(val)) {
    // A list under start_inventory carries no counts — one entry, one item.
    return val.filter(v => v != null && String(v).trim() !== '').length;
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (mode !== 'items') return entries.length;
    let n = 0;
    for (const [, v] of entries) {
      if (typeof v === 'number') { if (v > 0) n += v; continue; }
      n += 1;                                    // unreadable count — assume one
    }
    return n;
  }
  // A bare scalar ("exclude_locations: Some Chest") is a single member.
  return String(val).trim() === '' ? 0 : 1;
}

// Screen every world in a config against a player's caps. One finding per
// over-cap option per world; a world inside its limits produces none.
export function checkYamlLimits(text: string, limits: YamlLimits): LimitFinding[] {
  const findings: LimitFinding[] = [];

  forEachWorld(text, (rec, world) => {
    const sites = optionSites(rec);

    for (const opt of LIMIT_OPTIONS) {
      // A root default and a game section are ALTERNATIVES, not additions (the
      // section wins where both exist), so take the worst single site. Summing
      // would also double-count a weighted game's several sections, only one of
      // which can end up rolled.
      let count = 0;
      for (const site of sites) {
        let siteCount = 0;
        for (const yk of opt.yamlKeys) {
          if (yk in site) siteCount += countOptionValue(site[yk], opt.mode);
        }
        count = Math.max(count, siteCount);
      }

      const cap = limits[opt.key];
      if (count <= cap) continue;

      findings.push({
        world, key: opt.key, label: opt.label, short: opt.short, count, cap,
        message:
          `${opt.label}: this world asks for ${count}, but you are allowed ${cap}. ` +
          `You can still submit — your host is shown the overage and may ask you to change it.`,
      });
    }
  });

  return findings;
}

export interface LimitSummary {
  key:     YamlLimitKey;
  label:   string;
  short:   string;
  cap:     number;
  count:   number;     // the worst overage among the worlds listed
  worlds:  string[];
  message: string;     // one sentence covering every world that broke this cap
}

// Collapse findings to one row per option. A five-world file over on two settings
// otherwise reads as ten near-identical lines; the player wants "you're over on
// exclusions, in these worlds" and the host wants one badge per setting.
// Rows come back in LIMIT_OPTIONS order, so the list matches the rules text.
export function summarizeLimitFindings(findings: LimitFinding[]): LimitSummary[] {
  return LIMIT_OPTIONS.flatMap(opt => {
    const hits = findings.filter(f => f.key === opt.key);
    if (hits.length === 0) return [];
    const count  = Math.max(...hits.map(f => f.count));
    const cap    = hits[0].cap;
    const worlds = hits.map(f => f.world);
    // "File" is the whole config (single-document), so it never reads as a list.
    const where = worlds.length === 1 && worlds[0] === 'File' ? 'This config'
                : worlds.length === 1                        ? worlds[0]
                : `${worlds.slice(0, -1).join(', ')} and ${worlds[worlds.length - 1]}`;
    const verb = worlds.length === 1 ? 'asks' : 'ask';
    const asks = worlds.length === 1 ? String(count) : `up to ${count}`;
    return [{
      key: opt.key, label: opt.label, short: opt.short, cap, count, worlds,
      message:
        `${opt.label}: ${where} ${verb} for ${asks}, but you are allowed ${cap}. ` +
        `You can still submit — your host is shown the overage and may ask you to change it.`,
    }];
  });
}

// Warn (non-blocking) when the number of parsed worlds doesn't match what's
// expected: the casino passes an exact `count` (the seat's locked cards); other
// contexts pass a `min`/`max` range (e.g. 1–5 for a typical challenge/mission).
// Returns a human-readable message, or null when the count is acceptable.
export function checkWorldCount(
  count: number,
  expect: { count?: number; min?: number; max?: number },
): string | null {
  const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;
  if (expect.count != null && count !== expect.count)
    return `This file has ${games(count)}, but ${expect.count} ${expect.count === 1 ? 'is' : 'are'} expected.`;
  if (expect.min != null && count < expect.min)
    return `This file has ${games(count)}; at least ${expect.min} expected.`;
  if (expect.max != null && count > expect.max)
    return `This file has ${games(count)}; at most ${expect.max} expected.`;
  return null;
}
