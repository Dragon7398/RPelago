import type { Player } from '../types';

// ── S2 leveled enemy traits ───────────────────────────────────────────────────
// Ten traits carry 3–5 levels; six stay binary. The roster is the same sixteen
// as S1 — this is a model change plus a rebalance, not new content.
// Full spec: docs/season-2-traits-plan.md.
//
// A tile stores `{ level, count? }` per trait. Level 0 / absent = off.
// `count` applies only to a `multi` trait at or above its `multi.from` level.

export interface TraitMulti {
  /** First level at which the admin may roll more than one target. */
  from: number;
  min: number;
  max: number;
  def: number;
  noun: 'stunned' | 'taunted' | 'thieves';
}

export interface TraitDef {
  id:    string;
  name:  string;
  /** One-line codex summary. */
  blurb: string;
  /** Level count. Absent ⇒ binary (on/off, no meter). */
  max?:  number;
  /** Per-level numeric parameter; length === max when present. */
  values?: readonly number[];
  /** Player-facing text for a level. Binary traits ignore the argument. */
  describe: (level: number) => string;
  multi?: TraitMulti;
  /**
   * Difficulty weight per level, feeding generated battle traits and the XP/GP
   * retune. OPEN DESIGN QUESTION — see traits plan §10 item 1. Deliberately
   * unset on every def until those numbers exist; nothing may read a missing
   * value as though it meant "no difficulty".
   */
  difficulty?: readonly number[];
}

const CURLY = '’';   // ’ — preserve it; this copy is verbatim from the design.

const cursed = (severity: string) =>
  'After submitting your slot, one or more of your settings will be randomized. ' +
  severity +
  ' (This will not affect logic or ER settings. Please talk with the admin if ' +
  'there is a setting that should not be touched.)';

/** Pick from a per-level list, clamped so an out-of-range level can't crash a render. */
function atLevel<T>(list: readonly T[], level: number): T {
  const i = Math.min(Math.max(level, 1), list.length) - 1;
  return list[i];
}

const AERIAL = [
  'In order to engage this enemy, one of your games must feature the ability to Jump, Fly, or use a short+ range weapon.',
  'In order to engage this enemy, one of your games must feature the ability to Fly or use a short+ range weapon.',
  'In order to engage this enemy, one of your games must feature the ability to Fly or use a medium+ range weapon.',
  'In order to engage this enemy, one of your games must feature the ability to Fly or use a long+ range weapon.',
  'In order to engage this enemy, one of your games must feature the ability to attack with a ranged weapon while flying, or use an extreme range weapon.',
] as const;

const CURSED = [
  cursed('This will have a minor effect on the file' + CURLY + 's settings.'),
  cursed('This will have a moderate effect on the file' + CURLY + 's settings.'),
  cursed('This will have a strong effect on the file' + CURLY + 's settings.'),
] as const;

const STUNNING = [
  'One slot will be chosen at random to be stunned. It will have several of its locations excluded.',
  'One slot will be chosen at random to be stunned. It will have the majority of its locations excluded.',
  'One or more slots will be chosen at random to be stunned. They will have the majority of their locations excluded.',
] as const;

const TAUNT = [
  'One slot will be chosen at random to be taunted. It will have several of its locations prioritized.',
  'One slot will be chosen at random to be taunted. It will have the majority of its locations prioritized.',
  'One or more slots will be chosen at random to be taunted. They will have the majority of their locations prioritized.',
] as const;

const THIEF = [
  'One slot will be chosen at random to be a thief. It will steal one or more important items from the other slots.',
  'One or two slots will be chosen at random to be thieves. They will steal one or more important items from the other non-thief slots.',
  'One or two slots will be chosen at random to be thieves. They will steal several important items from the other non-thief slots.',
] as const;

const AGILE_V      = [250, 220, 180, 140, 100] as const;
const CAMOUFLAGE_V = [10, 25, 50] as const;
const ENDURING_V   = [90, 92, 94, 96] as const;
const HORDE_V      = [2, 3, 4] as const;
const STURDY_V     = [150, 200, 250, 300, 400] as const;

export const S2_TRAITS: readonly TraitDef[] = [
  { id: 'aerial', name: 'Aerial', max: 5,
    blurb: 'Engagement requirement — mobility / range',
    describe: lv => atLevel(AERIAL, lv) },

  { id: 'agile', name: 'Agile', max: 5, values: AGILE_V,
    blurb: 'Caps total checks',
    describe: lv => 'Your slot may not have more than ' + atLevel(AGILE_V, lv) + ' checks.' },

  { id: 'camouflage', name: 'Camouflage', max: 3, values: CAMOUFLAGE_V,
    blurb: 'Raises hint cost until first goal',
    describe: lv => 'Hints are at +' + atLevel(CAMOUFLAGE_V, lv) + '% until at least one slot has goaled.' },

  { id: 'cursed', name: 'Cursed', max: 3,
    blurb: 'Randomizes some YAML settings on submit',
    describe: lv => atLevel(CURSED, lv) },

  { id: 'enduring', name: 'Enduring', max: 4, values: ENDURING_V,
    blurb: 'Requires a % of all checks sent',
    describe: lv => 'Goaling all slots does not complete this challenge. In order to complete the challenge, '
      + atLevel(ENDURING_V, lv) + '% of all checks must be sent.' },

  { id: 'horde', name: 'Horde', max: 3, values: HORDE_V,
    blurb: 'Minimum number of games per slot',
    describe: lv => 'Your slot must have at least ' + atLevel(HORDE_V, lv) + ' games.' },

  { id: 'sturdy', name: 'Sturdy', max: 5, values: STURDY_V,
    blurb: 'Minimum number of checks per slot',
    describe: lv => 'Your slot must have at least ' + atLevel(STURDY_V, lv) + ' checks.' },

  { id: 'stunning', name: 'Stunning', max: 3,
    blurb: 'Excludes a random slot' + CURLY + 's locations',
    multi: { from: 3, min: 1, max: 5, def: 2, noun: 'stunned' },
    describe: lv => atLevel(STUNNING, lv) },

  { id: 'taunt', name: 'Taunt', max: 3,
    blurb: 'Prioritizes a random slot' + CURLY + 's locations',
    multi: { from: 3, min: 1, max: 5, def: 2, noun: 'taunted' },
    describe: lv => atLevel(TAUNT, lv) },

  { id: 'thief', name: 'Thief', max: 3,
    blurb: 'Random slots steal items from others',
    multi: { from: 2, min: 1, max: 5, def: 2, noun: 'thieves' },
    describe: lv => atLevel(THIEF, lv) },

  // ── Binary (no level, no meter) ─────────────────────────────────────────────
  { id: 'bifurcated', name: 'Bifurcated', blurb: 'Splits the challenge into two worlds',
    describe: () => 'This challenge will be split into two worlds that must both goal to complete this challenge.' },
  { id: 'confounding', name: 'Confounding', blurb: 'Adds a public Simon Tatham slot',
    describe: () => 'An additional Simon Tatham’s Portable Puzzle Collection slot will be added to this challenge as a Public slot.' },
  { id: 'magicresist', name: 'Magic Resist', blurb: 'Engagement requirement — no magic',
    describe: () => 'In order to engage this enemy, your slot must not involve magic. (Subject to discussion with admins.)' },
  { id: 'physresist', name: 'Physical Resist', blurb: 'Engagement requirement — magic only',
    describe: () => 'In order to engage this enemy, your slot must involve magic. (Subject to discussion with admins.)' },
  { id: 'puzzling', name: 'Puzzling', blurb: 'Adds a public Jigsaw slot',
    describe: () => 'An additional Jigsaw will be added to this challenge as a Public slot.' },
  { id: 'unbalanced', name: 'Unbalanced', blurb: 'Progression balancing set to 0',
    describe: () => 'Progression balancing will be set to 0 for this challenge.' },
];

const BY_ID = new Map(S2_TRAITS.map(t => [t.id, t]));
export function traitDef(id: string): TraitDef | undefined { return BY_ID.get(id); }

export function isLeveled(def: TraitDef): boolean { return (def.max ?? 1) > 1; }

/** True when this trait at this level lets the admin choose a target count. */
export function hasMultiTargets(def: TraitDef, level: number): boolean {
  return def.multi != null && level >= def.multi.from;
}

// ── Stored shape ──────────────────────────────────────────────────────────────

/** What a tile stores per trait. `value` is the legacy S1 field. */
export interface TraitEntry {
  level?: number;
  count?: number;
  /** S1 only. Never written by S2; read by the legacy path in traitLevel. */
  value?: number;
}

/**
 * The stored level for an entry, tolerating S1 records.
 *
 * No S2 tile ever carries an S1-shaped entry — every S2 tile is authored fresh —
 * so the legacy branch exists purely to keep the ARCHIVED S1 season rendering,
 * and can be deleted when that archive stops being served.
 */
export function traitLevel(entry: TraitEntry | undefined, def: TraitDef): number {
  if (!entry) return 0;
  if (entry.level != null) return entry.level;
  // Legacy: map the stored numeric parameter back onto its level where we can.
  if (def.values && entry.value != null) {
    const i = def.values.indexOf(entry.value);
    return i >= 0 ? i + 1 : 1;
  }
  return 1;   // a present S1 entry means "on"
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface ResolvedTrait {
  def:   TraitDef;
  /** Effective level for this viewer. Equals `base` until equipment ships. */
  level: number;
  /** The level the TILE was authored with, before any player modifier. */
  base:  number;
  /** values[level-1], or null for traits with no numeric parameter. */
  value: number | null;
  /** Multi-target count, or null when the trait/level has no target choice. */
  count: number | null;
  /** Fully substituted player-facing description. */
  text:  string;
}

/**
 * Resolve one stored trait entry for display or validation.
 *
 * `player` is accepted and DELIBERATELY IGNORED at launch. It is the seam the
 * replacement equipment system plugs into (traits plan T6): equipment can lower
 * a trait's level FOR ONE PLAYER while leaving it intact for everyone else, so
 * "the level of this trait" stops being a single value. Every consumer must go
 * through here with the viewing player rather than reading `entry.level`
 * directly — doing so now costs nothing and avoids a sweep later.
 */
export function resolveTrait(
  traitId: string,
  entry: TraitEntry | undefined,
  // The `_` prefix satisfies tsc's noUnusedParameters (used by `tsc -b` in the
  // Netlify build); the eslint-disable covers ESLint, which doesn't honor it.
  // Same pattern as missionClaimCapacity in gameLogic.ts.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _player?: Player | null,
): ResolvedTrait | null {
  const def = traitDef(traitId);
  if (!def) return null;

  const base = traitLevel(entry, def);
  if (base <= 0) return null;

  // Equipment will narrow this; until then effective === authored.
  const level = Math.min(base, def.max ?? 1);

  const value = def.values ? atLevel(def.values, level) : null;
  const count = hasMultiTargets(def, level) && def.multi
    ? Math.min(Math.max(entry?.count ?? def.multi.def, def.multi.min), def.multi.max)
    : null;

  return { def, level, base, value, count, text: def.describe(level) };
}

/** Every active trait on a tile, in the canonical S2_TRAITS order. */
export function resolveTraits(
  traits: Record<string, TraitEntry> | undefined,
  player?: Player | null,
): ResolvedTrait[] {
  if (!traits) return [];
  return S2_TRAITS
    .map(def => resolveTrait(def.id, traits[def.id], player))
    .filter((t): t is ResolvedTrait => t !== null);
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Split a resolved description around its numeric parameter, for renderers that
 * strike the original and show a replacement beside it (the item MODIFIED
 * badge). Returns null unless the value appears exactly once, so an ambiguous
 * match falls back to plain text rather than mangling the sentence.
 *
 * S2 descriptions arrive already substituted — there is no `{value}` token to
 * split on any more — and reintroducing one would mean every def carrying both
 * a template and a renderer.
 */
export function splitAroundValue(text: string, value: number | null): [string, string] | null {
  if (value == null) return null;
  const needle = String(value);
  const first = text.indexOf(needle);
  if (first < 0 || text.indexOf(needle, first + needle.length) >= 0) return null;
  return [text.slice(0, first), text.slice(first + needle.length)];
}

/**
 * Minimum games a slot must carry on this tile — the Horde floor, 1 when Horde
 * is absent. Read by the join callable (map plan §0.5.1), which is why it lives
 * in shared code rather than in the join form.
 */
export function hordeFloor(
  traits: Record<string, TraitEntry> | undefined,
  player?: Player | null,
): number {
  return resolveTrait('horde', traits?.['horde'], player)?.value ?? 1;
}

/**
 * The tile's effective hint cost. Camouflage is ADDITIVE on top of the stored
 * value (decision T1) and applies only until a slot has goaled — the S1 boolean
 * "hints off" gate is retired.
 */
export function effectiveHint(
  baseHint: number,
  traits: Record<string, TraitEntry> | undefined,
  anySlotGoaled: boolean,
  player?: Player | null,
): number {
  if (anySlotGoaled) return baseHint;
  const camo = resolveTrait('camouflage', traits?.['camouflage'], player);
  return baseHint + (camo?.value ?? 0);
}
