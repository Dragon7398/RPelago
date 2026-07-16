import { describe, it, expect } from 'vitest';
import { parseApYaml, checkWorldCount, RANDOMIZED_GAME } from '../../src/lib/apYaml';

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
