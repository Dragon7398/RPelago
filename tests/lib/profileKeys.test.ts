import { describe, it, expect } from 'vitest';
import { gameKey, normalizeGameName, handleKey } from '../../functions/src/profileKeys';

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
