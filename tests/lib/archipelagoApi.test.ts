import { describe, it, expect } from 'vitest';
import { hasNumberToken, resolveNumberedSlotName, extractApSlotName, deriveSlotStatus } from '../../src/lib/archipelagoApi';

describe('hasNumberToken', () => {
  it('only matches the token at the end of the name', () => {
    expect(hasNumberToken('jam_minit{NUMBER}')).toBe(true);
    expect(hasNumberToken('jam_minit{number}')).toBe(true);   // AP accepts either case
    expect(hasNumberToken('jam_minit')).toBe(false);
    expect(hasNumberToken('{NUMBER}_jam')).toBe(false);
  });
});

describe('resolveNumberedSlotName', () => {
  it('resolves a lone slot to the bare name AP generated', () => {
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', ['jam_minit', 'other'])).toBe('jam_minit');
  });

  it('leaves a genuinely ambiguous token alone — the admin maps those by hand', () => {
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', ['jam_minit', 'jam_minit2'])).toBeNull();
  });

  it('resolves when AP numbered the only candidate ({number} expands even at 1)', () => {
    expect(resolveNumberedSlotName('jam_minit{number}', ['jam_minit1', 'other'])).toBe('jam_minit1');
  });

  it('returns null when the room has no candidate at all', () => {
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', ['somethingelse'])).toBeNull();
  });

  it('returns null for a name without the token — nothing to resolve', () => {
    expect(resolveNumberedSlotName('jam_minit', ['jam_minit'])).toBeNull();
    expect(resolveNumberedSlotName('{NUMBER}', ['2'])).toBeNull();
  });

  it('does not treat a longer neighbouring name as a candidate', () => {
    // "jam_minit_alt" is a different slot, not an AP-numbered variant of the base.
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', ['jam_minit_alt'])).toBeNull();
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', ['jam_minit', 'jam_minit_alt'])).toBe('jam_minit');
  });

  it('treats regex metacharacters in the base as literals', () => {
    expect(resolveNumberedSlotName('a.b{NUMBER}', ['axb'])).toBeNull();
    expect(resolveNumberedSlotName('a.b{NUMBER}', ['a.b'])).toBe('a.b');
  });

  it('composes with the alias form cheese reports', () => {
    const games = ['my alias (jam_minit)', 'someone (else)'];
    const apNames = games.map(extractApSlotName);
    expect(resolveNumberedSlotName('jam_minit{NUMBER}', apNames)).toBe('jam_minit');
  });

  it('the resolved name is what carries a status through sync', () => {
    const games = [
      { name: 'jam_minit', tracker_status: 'goal_completed', checks_done: 5, checks_total: 5 },
    ];
    const statusMap = new Map(games.map(g => [extractApSlotName(g.name), deriveSlotStatus(g)]));
    const real = resolveNumberedSlotName('jam_minit{NUMBER}', statusMap.keys());
    expect(real).toBe('jam_minit');
    expect(statusMap.get(real!)).toBe('Done');
  });
});
