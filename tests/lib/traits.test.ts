import { describe, it, expect } from 'vitest';
import {
  S2_TRAITS, traitDef, isLeveled, hasMultiTargets, traitLevel,
  resolveTrait, resolveTraits, hordeFloor, effectiveHint, splitAroundValue,
  type TraitEntry,
} from '../../src/lib/traits';
import { TILE_TRAITS } from '../../src/lib/constants';

const lv = (level: number, count?: number): TraitEntry =>
  count == null ? { level } : { level, count };

describe('the roster', () => {
  it('is the same sixteen traits as S1 — a model change, not new content', () => {
    const s2 = S2_TRAITS.map(t => t.id).sort();
    const s1 = TILE_TRAITS.map(t => t.id).sort();
    expect(s2).toEqual(s1);
  });

  it('splits 10 leveled / 6 binary', () => {
    const leveled = S2_TRAITS.filter(isLeveled);
    expect(leveled).toHaveLength(10);
    expect(S2_TRAITS.length - leveled.length).toBe(6);
  });

  it('gives every leveled trait a values array of exactly `max`, or none at all', () => {
    for (const def of S2_TRAITS) {
      if (!def.values) continue;
      expect(def.values.length, def.id).toBe(def.max);
    }
  });

  it('leaves `difficulty` unset everywhere — it is an open design question', () => {
    // Guard against someone inventing weights: generated battle traits and the
    // XP/GP retune both key off these, so a placeholder would silently ship a
    // balance decision nobody made.
    for (const def of S2_TRAITS) expect(def.difficulty, def.id).toBeUndefined();
  });

  it('produces a distinct description at every level of every leveled trait', () => {
    for (const def of S2_TRAITS) {
      if (!isLeveled(def)) continue;
      const texts = Array.from({ length: def.max! }, (_, i) => def.describe(i + 1));
      expect(new Set(texts).size, `${def.id} has duplicate level text`).toBe(def.max);
      texts.forEach(t => expect(t.length).toBeGreaterThan(10));
    }
  });

  it('clamps an out-of-range level instead of crashing a render', () => {
    const aerial = traitDef('aerial')!;
    expect(aerial.describe(0)).toBe(aerial.describe(1));
    expect(aerial.describe(99)).toBe(aerial.describe(5));
  });
});

describe('verbatim copy', () => {
  it('keeps the curly apostrophe in Cursed', () => {
    const t = resolveTrait('cursed', lv(2))!;
    expect(t.text).toContain('the file’s settings');
    expect(t.text).not.toContain("file's settings");   // straight quote = wrong
  });

  it('substitutes the per-level numeric parameter', () => {
    expect(resolveTrait('agile', lv(1))!.text).toContain('250 checks');
    expect(resolveTrait('agile', lv(5))!.text).toContain('100 checks');
    expect(resolveTrait('sturdy', lv(5))!.text).toContain('400 checks');
    expect(resolveTrait('enduring', lv(1))!.text).toContain('90%');
    expect(resolveTrait('camouflage', lv(3))!.text).toContain('+50%');
  });

  it('gets harder as the level rises', () => {
    // Agile caps checks (down = harder); Sturdy floors them (up = harder).
    expect(resolveTrait('agile', lv(1))!.value!).toBeGreaterThan(resolveTrait('agile', lv(5))!.value!);
    expect(resolveTrait('sturdy', lv(1))!.value!).toBeLessThan(resolveTrait('sturdy', lv(5))!.value!);
    expect(resolveTrait('horde', lv(1))!.value!).toBeLessThan(resolveTrait('horde', lv(3))!.value!);
  });

  it('matches S1 defaults at L1 for the three traits that carried over unchanged', () => {
    expect(resolveTrait('agile',  lv(1))!.value).toBe(250);
    expect(resolveTrait('sturdy', lv(1))!.value).toBe(150);
    expect(resolveTrait('horde',  lv(1))!.value).toBe(2);
  });
});

describe('multi-target', () => {
  it('offers a count only at or above the trait’s `from` level', () => {
    expect(resolveTrait('stunning', lv(2))!.count).toBeNull();
    expect(resolveTrait('stunning', lv(3))!.count).toBe(2);   // default
    expect(resolveTrait('thief',    lv(1))!.count).toBeNull();
    expect(resolveTrait('thief',    lv(2))!.count).toBe(2);   // thief starts at L2
  });

  it('clamps a stored count into the trait’s range', () => {
    expect(resolveTrait('taunt', lv(3, 99))!.count).toBe(5);
    expect(resolveTrait('taunt', lv(3, 0))!.count).toBe(1);
    expect(resolveTrait('taunt', lv(3, 4))!.count).toBe(4);
  });

  it('ignores a count stored below the `from` level', () => {
    // An admin could lower the level after setting a count; the stale value must
    // not resurrect multi-target behaviour at a level that does not have it.
    expect(resolveTrait('stunning', lv(1, 5))!.count).toBeNull();
  });

  it('reports multi-target capability per level', () => {
    const stun = traitDef('stunning')!;
    expect(hasMultiTargets(stun, 2)).toBe(false);
    expect(hasMultiTargets(stun, 3)).toBe(true);
    expect(hasMultiTargets(traitDef('bifurcated')!, 5)).toBe(false);
  });
});

describe('legacy S1 entries', () => {
  it('maps a stored numeric parameter back onto its level', () => {
    expect(traitLevel({ value: 250 }, traitDef('agile')!)).toBe(1);
    expect(traitLevel({ value: 100 }, traitDef('agile')!)).toBe(5);
    expect(traitLevel({ value: 150 }, traitDef('sturdy')!)).toBe(1);
  });

  it('treats an unrecognised legacy value as level 1, not "off"', () => {
    // S1 Enduring defaulted to 95, which is NOT in the S2 ladder [90,92,94,96].
    expect(traitLevel({ value: 95 }, traitDef('enduring')!)).toBe(1);
  });

  it('treats a present binary entry as on', () => {
    expect(traitLevel({ value: 0 }, traitDef('bifurcated')!)).toBe(1);
  });

  it('treats a missing entry as off', () => {
    expect(traitLevel(undefined, traitDef('agile')!)).toBe(0);
    expect(resolveTrait('agile', undefined)).toBeNull();
    expect(resolveTrait('agile', { level: 0 })).toBeNull();
  });

  it('prefers `level` over `value` when both are present', () => {
    expect(traitLevel({ level: 4, value: 250 }, traitDef('agile')!)).toBe(4);
  });
});

describe('resolveTraits', () => {
  it('returns only active traits, in canonical order', () => {
    const out = resolveTraits({ sturdy: lv(2), aerial: lv(1), horde: lv(3) });
    expect(out.map(t => t.def.id)).toEqual(['aerial', 'horde', 'sturdy']);
  });

  it('drops unknown ids rather than throwing', () => {
    expect(resolveTrait('nonsense', lv(1))).toBeNull();
    expect(resolveTraits({ nonsense: lv(1) })).toEqual([]);
  });

  it('handles a tile with no traits', () => {
    expect(resolveTraits(undefined)).toEqual([]);
    expect(resolveTraits({})).toEqual([]);
  });
});

describe('hordeFloor — read by the join callable', () => {
  it('is 1 when Horde is absent', () => {
    expect(hordeFloor(undefined)).toBe(1);
    expect(hordeFloor({ sturdy: lv(3) })).toBe(1);
  });

  it('rises with the Horde level', () => {
    expect(hordeFloor({ horde: lv(1) })).toBe(2);
    expect(hordeFloor({ horde: lv(2) })).toBe(3);
    expect(hordeFloor({ horde: lv(3) })).toBe(4);
  });

  it('never exceeds the 5-slot ceiling a player may declare', () => {
    // A floor above the ceiling would make the tile unjoinable by construction.
    for (let level = 1; level <= 3; level++) {
      expect(hordeFloor({ horde: lv(level) })).toBeLessThanOrEqual(5);
    }
  });
});

describe('effectiveHint — Camouflage is additive (T1)', () => {
  it('adds the level value on top of the stored hint', () => {
    expect(effectiveHint(10, { camouflage: lv(1) }, false)).toBe(20);
    expect(effectiveHint(10, { camouflage: lv(2) }, false)).toBe(35);
    expect(effectiveHint(10, { camouflage: lv(3) }, false)).toBe(60);
  });

  it('reverts to the base cost once a slot has goaled', () => {
    expect(effectiveHint(10, { camouflage: lv(3) }, true)).toBe(10);
  });

  it('never turns hints off — the S1 boolean gate is retired', () => {
    // Whatever the level, the cost stays a finite number the player can pay.
    for (let level = 1; level <= 3; level++) {
      const hint = effectiveHint(10, { camouflage: lv(level) }, false);
      expect(Number.isFinite(hint)).toBe(true);
      expect(hint).toBeGreaterThan(0);
    }
  });

  it('is a no-op without Camouflage', () => {
    expect(effectiveHint(12, { sturdy: lv(1) }, false)).toBe(12);
    expect(effectiveHint(12, undefined, false)).toBe(12);
  });
});

describe('the player seam (T6)', () => {
  it('ignores the player argument today, but accepts it everywhere', () => {
    // Equipment will make trait level PER-PLAYER. Consumers must already be
    // threading the viewer through, so this asserts the signature exists and is
    // currently inert rather than asserting a behaviour.
    const player = { id: 'p1' } as never;
    expect(resolveTrait('agile', lv(3), player)!.level).toBe(3);
    expect(resolveTraits({ agile: lv(3) }, player)).toHaveLength(1);
    expect(hordeFloor({ horde: lv(2) }, player)).toBe(3);
    expect(effectiveHint(10, { camouflage: lv(1) }, false, player)).toBe(20);
  });

  it('reports base and effective level separately', () => {
    const t = resolveTrait('agile', lv(4))!;
    expect(t.base).toBe(4);
    expect(t.level).toBe(4);   // equipment will make these diverge
  });
});

describe('splitAroundValue — the MODIFIED item badge renderer', () => {
  it('splits a resolved description around its numeric parameter', () => {
    const t = resolveTrait('agile', lv(1))!;
    const parts = splitAroundValue(t.text, t.value)!;
    expect(parts[0]).toBe('Your slot may not have more than ');
    expect(parts[1]).toBe(' checks.');
    expect(parts[0] + t.value + parts[1]).toBe(t.text);
  });

  it('returns null for a trait with no numeric parameter', () => {
    const t = resolveTrait('cursed', lv(1))!;
    expect(splitAroundValue(t.text, t.value)).toBeNull();
  });

  it('returns null rather than mangling an ambiguous match', () => {
    // Two occurrences would make the split arbitrary; the caller falls back to
    // rendering plain text.
    expect(splitAroundValue('10 of 10 checks', 10)).toBeNull();
    expect(splitAroundValue('no number here', 42)).toBeNull();
  });

  it('round-trips every leveled trait that carries a value', () => {
    for (const def of S2_TRAITS) {
      if (!def.values) continue;
      for (let level = 1; level <= def.max!; level++) {
        const t = resolveTrait(def.id, lv(level))!;
        const parts = splitAroundValue(t.text, t.value);
        if (parts) expect(parts[0] + t.value + parts[1], `${def.id} L${level}`).toBe(t.text);
      }
    }
  });
});
