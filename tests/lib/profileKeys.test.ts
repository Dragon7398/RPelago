import { describe, it, expect } from 'vitest';
import { gameKey, normalizeGameName, handleKey, apSlotKey } from '../../functions/src/profileKeys';
import { apSlotKey as clientApSlotKey } from '../../src/lib/slotHelpers';

// RTDB rejects these in a key, and because the profile `games` map is written as
// merge paths of one multi-path update(), a single bad key throws before ANY of
// the batch lands — which is how one dotted game name lost a whole table's worth
// of profile counters.
const illegalIn = (key: string): string | null => {
  for (const ch of key) {
    const code = ch.codePointAt(0)!;
    if ('.#$[]/'.includes(ch) || code <= 0x1f || code === 0x7f) return ch;
  }
  return null;
};

describe('gameKey', () => {
  it('produces a key RTDB accepts for the name that broke it', () => {
    const key = gameKey('Plants vs. Zombies');
    expect(illegalIn(key)).toBeNull();
    expect(decodeURIComponent(key)).toBe('Plants vs. Zombies');
  });

  it('never emits an illegal character, whatever is thrown at it', () => {
    const names = [
      'Plants vs. Zombies', 'S.T.A.L.K.E.R.', 'Dr. Langeskov', 'Mr. Run and Jump',
      'Yu-Gi-Oh! 2006', 'Sonic & Knuckles', 'Pokemon Emerald v1.2',
      'a/b', 'a#b', 'a$b', 'a[b]', "Luigi's Mansion", 'Ori~and', '100% Orange Juice',
      '  spaced   out  ',
      // Built, not written as an escape: a raw control character in a source
      // literal is exactly the thing tooling likes to silently launder.
      `Mega${String.fromCharCode(0)}Man`,
      `tab${String.fromCharCode(9)}bed`,
    ];
    for (const n of names) {
      const key = gameKey(n);
      expect(illegalIn(key), n).toBeNull();
      expect(decodeURIComponent(key), n).toBe(normalizeGameName(n));
    }
  });

  it('leaves dot-free names byte-identical to the old encoding, so no key splits in two', () => {
    for (const n of ['Super Mario World', "Luigi's Mansion", 'Celeste 64', 'A Link to the Past']) {
      expect(gameKey(n)).toBe(encodeURIComponent(normalizeGameName(n)));
    }
  });

  it('normalizes whitespace before encoding', () => {
    expect(gameKey('  Super   Metroid ')).toBe(gameKey('Super Metroid'));
  });
});

describe('handleKey', () => {
  it('strips the dots Discord handles carry', () => {
    expect(handleKey('some.player')).toBe('some_player');
    expect(handleKey('someplayer')).toBe('someplayer');
  });
});

// Slot names come straight off the tracker, so they are exactly as arbitrary as
// game names — and they key the `roomTelemetry` samples, written as merge paths of
// the tick's one multi-path update(). A single bad key would throw the whole tick.
describe('apSlotKey', () => {
  const names = [
    'Dr. Mario', 'mossTUNIC', "Luigi's Mansion run", 'a/b', 'a#b', 'a$b', 'a[b]',
    'slot.with.dots', 'Yu-Gi-Oh! 2006', '100% Orange Juice', 'jam_minit2',
    'spaced  out', 'ünïcodé', `bad${String.fromCharCode(0)}char`,
  ];

  it('never emits a character RTDB rejects', () => {
    for (const n of names) {
      expect({ name: n, bad: illegalIn(apSlotKey(n)) }).toEqual({ name: n, bad: null });
    }
  });

  it('is identical on both sides of the wire', () => {
    // The server writes the key and the client re-derives it to read the series
    // back. If these two ever drift, every slot silently loses its history.
    for (const n of names) expect(clientApSlotKey(n)).toBe(apSlotKey(n));
  });

  it('does NOT normalize whitespace, unlike gameKey', () => {
    // The client looks a slot up by the name it holds, character for character —
    // collapsing spaces here would make a doubled-space name unfindable.
    expect(apSlotKey('a  b')).not.toBe(apSlotKey('a b'));
  });

  it('keeps distinct names distinct', () => {
    expect(new Set(names.map(apSlotKey)).size).toBe(names.length);
  });
});
