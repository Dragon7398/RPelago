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
// manual step. The only machine checks are "looks outright broken" (parse
// errors / missing game) and "wrong number of worlds" (see checkWorldCount).

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
