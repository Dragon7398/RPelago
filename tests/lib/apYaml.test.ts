import { describe, it, expect } from 'vitest';
import { parseApYaml, checkWorldCount, checkProgressionBalancing, checkYamlLimits, summarizeLimitFindings, RANDOMIZED_GAME, type YamlLimits } from '../../src/lib/apYaml';

describe('parseApYaml — game resolution', () => {
  it('reads a plain string game', () => {
    const r = parseApYaml(`name: Alice\ngame: Super Metroid\n`);
    expect(r.errors).toEqual([]);
    expect(r.slots).toEqual([{ name: 'Alice', game: 'Super Metroid', randomized: false }]);
  });

  it('resolves a weighted map with exactly one viable option', () => {
    const r = parseApYaml(`name: Bob\ngame:\n  A Link to the Past: 3\n`);
    expect(r.slots[0]).toEqual({ name: 'Bob', game: 'A Link to the Past', randomized: false });
  });

  it('treats a weight-0 sibling as non-selectable (still deterministic)', () => {
    const r = parseApYaml(`name: Bob\ngame:\n  Super Metroid: 1\n  A Link to the Past: 0\n`);
    expect(r.slots[0]).toMatchObject({ game: 'Super Metroid', randomized: false });
    expect(r.slots[0].candidates).toBeUndefined();
  });

  it('marks two-or-more weighted options as Randomized with candidates', () => {
    const r = parseApYaml(`name: Cara\ngame:\n  Super Metroid: 1\n  A Link to the Past: 1\n`);
    expect(r.slots[0]).toEqual({
      name: 'Cara',
      game: RANDOMIZED_GAME,
      randomized: true,
      candidates: ['Super Metroid', 'A Link to the Past'],
    });
  });

  it('marks a weighted map with zero viable options as Randomized and reports it', () => {
    const r = parseApYaml(`name: Dan\ngame:\n  Super Metroid: 0\n  A Link to the Past: 0\n`);
    expect(r.slots[0]).toMatchObject({ game: RANDOMIZED_GAME, randomized: true, candidates: [] });
    expect(r.errors.join(' ')).toMatch(/positive weight/);
  });

  it('RANDOMIZED_GAME is the literal "Randomized"', () => {
    expect(RANDOMIZED_GAME).toBe('Randomized');
  });
});

describe('parseApYaml — names & robustness', () => {
  it('keeps templated names verbatim', () => {
    const r = parseApYaml(`name: Player{number}\ngame: Celeste\n`);
    expect(r.slots[0].name).toBe('Player{number}');
  });

  it('produces a slot with an empty name when name is missing', () => {
    const r = parseApYaml(`game: Hollow Knight\n`);
    expect(r.slots[0]).toEqual({ name: '', game: 'Hollow Knight', randomized: false });
  });

  it('tolerates duplicate keys instead of throwing out the document', () => {
    // Strict parsers (js-yaml) reject this outright; we must still recover the world.
    const r = parseApYaml(`name: Eve\ngame: Timespinner\nTimespinner:\n  foo: 1\n  foo: 2\n`);
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0]).toMatchObject({ name: 'Eve', game: 'Timespinner' });
  });

  it('skips a document with no game field and records why', () => {
    const r = parseApYaml(`name: NoGame\ndescription: oops\n`);
    expect(r.slots).toHaveLength(0);
    expect(r.errors.join(' ')).toMatch(/no "game" field/);
  });

  it('returns no slots (not a crash) for empty or blank input', () => {
    expect(parseApYaml('').slots).toEqual([]);
    expect(parseApYaml('\n\n').slots).toEqual([]);
  });
});

describe('parseApYaml — multi-document files', () => {
  it('returns one slot per document, in order, mixing concrete and randomized', () => {
    const text = [
      'name: One\ngame: Super Metroid',
      'name: Two\ngame:\n  Celeste: 1\n  Hollow Knight: 1',
      'name: Three\ngame: Timespinner',
    ].join('\n---\n');
    const r = parseApYaml(text);
    expect(r.slots.map(s => s.name)).toEqual(['One', 'Two', 'Three']);
    expect(r.slots.map(s => s.game)).toEqual(['Super Metroid', RANDOMIZED_GAME, 'Timespinner']);
    expect(r.slots[1].candidates).toEqual(['Celeste', 'Hollow Knight']);
  });

  it('labels errors per world and keeps the good worlds', () => {
    const text = 'name: Good\ngame: Celeste\n---\nname: Bad\ndescription: no game here\n';
    const r = parseApYaml(text);
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0].name).toBe('Good');
    expect(r.errors.join(' ')).toMatch(/World 2/);
  });

  it('skips a trailing empty document from a dangling separator', () => {
    const r = parseApYaml('name: Solo\ngame: Celeste\n---\n');
    expect(r.slots).toHaveLength(1);
  });
});

describe('checkWorldCount', () => {
  it('flags an exact-count mismatch (casino: must equal locked cards)', () => {
    expect(checkWorldCount(3, { count: 4 })).toMatch(/3 games.*4 are expected/);
    expect(checkWorldCount(1, { count: 2 })).toMatch(/1 game,/);
    expect(checkWorldCount(4, { count: 4 })).toBeNull();
  });

  it('flags a range violation (non-casino: 1–5)', () => {
    expect(checkWorldCount(0, { min: 1, max: 5 })).toMatch(/at least 1/);
    expect(checkWorldCount(6, { min: 1, max: 5 })).toMatch(/at most 5/);
    expect(checkWorldCount(3, { min: 1, max: 5 })).toBeNull();
  });
});

// Progression Balancing is nested under the resolved game's section in an AP YAML.
const pbYaml = (pb: string) => `name: P\ngame: Super Metroid\nSuper Metroid:\n  progression_balancing: ${pb}\n`;

describe('checkProgressionBalancing', () => {
  it('passes acceptable scalar values (≤50, disabled, normal, random-low)', () => {
    for (const v of ['0', '50', 'disabled', 'normal', 'random', 'random-low']) {
      expect(checkProgressionBalancing(pbYaml(v))).toEqual([]);
    }
  });

  it('warns on a scalar in 51–75', () => {
    const f = checkProgressionBalancing(pbYaml('60'));
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warn');
    expect(f[0].value).toBe('60');
  });

  it('rejects a scalar above 75', () => {
    const f = checkProgressionBalancing(pbYaml('80'));
    expect(f[0].severity).toBe('reject');
  });

  it('rejects "extreme"', () => {
    expect(checkProgressionBalancing(pbYaml('extreme'))[0].severity).toBe('reject');
  });

  it('warns on "random-high"', () => {
    expect(checkProgressionBalancing(pbYaml('random-high'))[0].severity).toBe('warn');
  });

  it('warns on a random-range that reaches into 50–75', () => {
    expect(checkProgressionBalancing(pbYaml('random-range-40-60'))[0].severity).toBe('warn');
  });

  it('rejects a random-range whose top exceeds 75', () => {
    expect(checkProgressionBalancing(pbYaml('random-range-0-99'))[0].severity).toBe('reject');
  });

  it('ignores a random-range that stays at or below 50', () => {
    expect(checkProgressionBalancing(pbYaml('random-range-0-40'))).toEqual([]);
  });

  it('judges a weighted mapping across only weight>0 options, worst wins', () => {
    // extreme has weight 0 (ignored); a viable 60 warns, viable 80 rejects.
    const map = `name: P\ngame: Celeste\nCeleste:\n  progression_balancing:\n    normal: 1\n    extreme: 0\n    60: 1\n    80: 1\n`;
    const f = checkProgressionBalancing(map);
    expect(f[0].severity).toBe('reject');
  });

  it('ignores an out-of-policy option that has weight 0', () => {
    const map = `name: P\ngame: Celeste\nCeleste:\n  progression_balancing:\n    normal: 1\n    extreme: 0\n    random-range-0-99: 0\n`;
    expect(checkProgressionBalancing(map)).toEqual([]);
  });

  it('labels each world in a multi-document file', () => {
    const text = `${pbYaml('80')}---\n${pbYaml('30')}`;
    const f = checkProgressionBalancing(text);
    expect(f).toHaveLength(1);
    expect(f[0].world).toBe('World 1');
  });

  it('returns nothing for a config with no progression_balancing', () => {
    expect(checkProgressionBalancing('name: P\ngame: Celeste\n')).toEqual([]);
  });
});

// ── YAML settings caps ────────────────────────────────────────────────────────

// The base allowance a player with no feats gets (mirrors BASE_YAML_LIMITS).
const CAPS: YamlLimits = {
  startInventory: 0, priorityLocations: 2, excludeLocations: 2,
  startHints: 1, startLocationHints: 1,
};

// AP nests these under the resolved game's section, same as progression_balancing.
const capYaml = (body: string) =>
  `name: P\ngame: Celeste\nCeleste:\n${body.split('\n').map(l => (l ? `  ${l}` : l)).join('\n')}\n`;

describe('checkYamlLimits', () => {
  it('passes a config sitting exactly on every cap', () => {
    const text = capYaml(
      'priority_locations:\n  - A\n  - B\n' +
      'exclude_locations:\n  - C\n  - D\n' +
      'start_hints:\n  - Dash\n' +
      'start_location_hints:\n  - Somewhere\n',
    );
    expect(checkYamlLimits(text, CAPS)).toEqual([]);
  });

  it('passes a config with none of the options at all', () => {
    expect(checkYamlLimits('name: P\ngame: Celeste\n', CAPS)).toEqual([]);
  });

  it('flags an over-cap list by count', () => {
    const f = checkYamlLimits(capYaml('exclude_locations:\n  - A\n  - B\n  - C\n'), CAPS);
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe('excludeLocations');
    expect(f[0].count).toBe(3);
    expect(f[0].cap).toBe(2);
    expect(f[0].world).toBe('File');
  });

  it('counts start_inventory by ITEM COUNT, not by entry', () => {
    // One entry, three items — the cap is on items.
    const f = checkYamlLimits(capYaml('start_inventory:\n  Bomb: 3\n'), CAPS);
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe('startInventory');
    expect(f[0].count).toBe(3);
  });

  it('ignores a start_inventory entry with a count of 0', () => {
    expect(checkYamlLimits(capYaml('start_inventory:\n  Bomb: 0\n'), CAPS)).toEqual([]);
  });

  it('adds start_inventory_from_pool to the same cap', () => {
    const f = checkYamlLimits(
      capYaml('start_inventory:\n  Bomb: 1\nstart_inventory_from_pool:\n  Key: 1\n'), CAPS);
    expect(f[0].key).toBe('startInventory');
    expect(f[0].count).toBe(2);
  });

  it('honours a raised cap (a feat) instead of the base one', () => {
    const text = capYaml('exclude_locations:\n  - A\n  - B\n  - C\n  - D\n  - E\n  - F\n');
    expect(checkYamlLimits(text, CAPS)).toHaveLength(1);            // base 2 — over
    expect(checkYamlLimits(text, { ...CAPS, excludeLocations: 6 })).toEqual([]); // Picky — fine
  });

  it('takes the worst SITE, never the sum, so a weighted game is not double-counted', () => {
    // Two game sections, only one of which can be rolled: 3, not 6.
    const text =
      'name: P\ngame:\n  Celeste: 1\n  Hollow Knight: 1\n' +
      'Celeste:\n  exclude_locations:\n    - A\n    - B\n    - C\n' +
      'Hollow Knight:\n  exclude_locations:\n    - D\n    - E\n    - F\n';
    const f = checkYamlLimits(text, CAPS);
    expect(f).toHaveLength(1);
    expect(f[0].count).toBe(3);
  });

  it('reads an option written at the document root', () => {
    const f = checkYamlLimits('name: P\ngame: Celeste\nstart_hints:\n  - A\n  - B\n', CAPS);
    expect(f[0].key).toBe('startHints');
    expect(f[0].count).toBe(2);
  });

  it('counts a mapping-shaped OptionSet by its members', () => {
    const f = checkYamlLimits(capYaml('priority_locations:\n  A: 1\n  B: 1\n  C: 1\n'), CAPS);
    expect(f[0].count).toBe(3);
  });

  it('labels each world in a multi-document file', () => {
    const over = capYaml('start_hints:\n  - A\n  - B\n');
    const fine = capYaml('start_hints:\n  - A\n');
    const f = checkYamlLimits(`${over}---\n${fine}`, CAPS);
    expect(f).toHaveLength(1);
    expect(f[0].world).toBe('World 1');
  });

  it('never produces a blocking severity — findings are advisory only', () => {
    const f = checkYamlLimits(capYaml('start_inventory:\n  Bomb: 9\n'), CAPS);
    expect(f).toHaveLength(1);
    expect(f[0]).not.toHaveProperty('severity');
    expect(f[0].message).toMatch(/still submit/i);
  });
});

describe('summarizeLimitFindings', () => {
  it('collapses one setting across several worlds into a single row', () => {
    const w = (n: number) => capYaml(`exclude_locations:\n${'  - X\n'.repeat(n)}`);
    const f = checkYamlLimits(`${w(3)}---\n${w(5)}`, CAPS);
    expect(f).toHaveLength(2);

    const [row] = summarizeLimitFindings(f);
    expect(row.key).toBe('excludeLocations');
    expect(row.worlds).toEqual(['World 1', 'World 2']);
    expect(row.count).toBe(5);                       // the worst overage
    expect(row.message).toMatch(/World 1 and World 2 ask for up to 5/);
  });

  it('names a single-document file "This config" rather than "File"', () => {
    const f = checkYamlLimits(capYaml('exclude_locations:\n  - A\n  - B\n  - C\n'), CAPS);
    expect(summarizeLimitFindings(f)[0].message).toMatch(/^Excluded locations: This config asks for 3/);
  });

  it('returns one row per setting, in the order the rules list them', () => {
    const f = checkYamlLimits(capYaml(
      'start_hints:\n  - A\n  - B\n' +
      'start_inventory:\n  Bomb: 1\n' +
      'exclude_locations:\n  - A\n  - B\n  - C\n',
    ), CAPS);
    expect(summarizeLimitFindings(f).map(r => r.key))
      .toEqual(['startInventory', 'excludeLocations', 'startHints']);
  });

  it('returns nothing for a clean config', () => {
    expect(summarizeLimitFindings([])).toEqual([]);
  });
});
