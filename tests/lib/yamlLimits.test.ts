import { describe, it, expect } from 'vitest';
import { yamlLimitsForFeats, yamlLimitsForPlayer } from '../../src/lib/gameLogic';
import { BASE_YAML_LIMITS } from '../../src/lib/constants';
import { checkYamlLimits } from '../../src/lib/apYaml';
import type { Player } from '../../src/types';

// The feat→cap mapping is the join between two vocabularies (FeatDef.yamlEffect
// names vs the AP option names apYaml screens), so it is the piece most likely to
// be wired up crossways — e.g. "hintedLocations" is start_location_hints, NOT
// start_hints. These pin each one to the number the rules text promises.

describe('yamlLimitsForFeats', () => {
  it('returns the base caps for a player with no feats', () => {
    expect(yamlLimitsForFeats([])).toEqual(BASE_YAML_LIMITS);
  });

  it('ignores feats with no YAML effect', () => {
    expect(yamlLimitsForFeats(['mentor', 'treasurer', 'seeker'])).toEqual(BASE_YAML_LIMITS);
  });

  it('Knowledgeable: +1 starting hint and +2 hint LOCATIONS', () => {
    const l = yamlLimitsForFeats(['knowledgeable']);
    expect(l.startHints).toBe(BASE_YAML_LIMITS.startHints + 1);
    expect(l.startLocationHints).toBe(BASE_YAML_LIMITS.startLocationHints + 2);
  });

  it('Picky: 6 excluded locations', () => {
    expect(yamlLimitsForFeats(['picky']).excludeLocations).toBe(6);
  });

  it('Helpful: 4 priority locations', () => {
    expect(yamlLimitsForFeats(['helpful']).priorityLocations).toBe(4);
  });

  it('Prepared: 1 starting inventory item', () => {
    expect(yamlLimitsForFeats(['prepared']).startInventory).toBe(1);
  });

  it('stacks the three slots a player can actually hold at once', () => {
    const l = yamlLimitsForFeats(['picky', 'mentor', 'prepared']);
    expect(l.excludeLocations).toBe(6);
    expect(l.startInventory).toBe(1);
    expect(l.priorityLocations).toBe(BASE_YAML_LIMITS.priorityLocations);
  });

  it('reads a player record, and treats a feat-less one as base', () => {
    const player = { feats: { level3: 'picky', level5: '', level7: '' } } as unknown as Player;
    expect(yamlLimitsForPlayer(player).excludeLocations).toBe(6);
    expect(yamlLimitsForPlayer(null)).toEqual(BASE_YAML_LIMITS);
    expect(yamlLimitsForPlayer(undefined)).toEqual(BASE_YAML_LIMITS);
  });
});

describe('caps end to end', () => {
  // The point of threading limits through instead of baking them in: the same
  // file is a warning for one player and silent for another.
  const text =
    'name: P\ngame: Celeste\nCeleste:\n  exclude_locations:\n' +
    ['A', 'B', 'C', 'D', 'E'].map(x => `    - ${x}`).join('\n') + '\n';

  it('warns a player on the base caps', () => {
    const f = checkYamlLimits(text, yamlLimitsForFeats([]));
    expect(f).toHaveLength(1);
    expect(f[0].key).toBe('excludeLocations');
  });

  it('says nothing to a Picky player, whose six are allowed', () => {
    expect(checkYamlLimits(text, yamlLimitsForFeats(['picky']))).toEqual([]);
  });
});
