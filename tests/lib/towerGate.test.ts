import { describe, it, expect } from 'vitest';
import {
  TOWER_FLOOR_ORBS, TOWER_FLOORS, towerFloorsUnlocked, orbsToNextTowerFloor,
} from '../../src/lib/constants';
import { ALL_ORBS } from '../../src/lib/constants';

describe('Tower floor gate', () => {
  it('gates the three floors at 3 / 5 / 7 orbs', () => {
    expect([...TOWER_FLOOR_ORBS]).toEqual([3, 5, 7]);
    expect(TOWER_FLOORS).toBe(3);
  });

  it('never requires a full set — the Sorcerer opens at 7 of 9', () => {
    // A player must not be able to lock themselves out of the win condition by
    // missing an orb that is stuck behind an unreachable elite.
    expect(TOWER_FLOOR_ORBS[TOWER_FLOOR_ORBS.length - 1]).toBeLessThan(ALL_ORBS.length);
  });

  it('unlocks floors monotonically as orbs accumulate', () => {
    const expected = [0, 0, 0, 1, 1, 2, 2, 3, 3, 3];   // index = orb count 0..9
    expected.forEach((floors, orbs) => {
      expect(towerFloorsUnlocked(orbs), `at ${orbs} orbs`).toBe(floors);
    });
  });

  it('counts down to the next floor, then reports null once all are open', () => {
    expect(orbsToNextTowerFloor(0)).toBe(3);
    expect(orbsToNextTowerFloor(2)).toBe(1);   // one more opens floor 1
    expect(orbsToNextTowerFloor(3)).toBe(2);   // floor 1 open, 2 more for floor 2
    expect(orbsToNextTowerFloor(5)).toBe(2);
    expect(orbsToNextTowerFloor(6)).toBe(1);
    expect(orbsToNextTowerFloor(7)).toBeNull();
    expect(orbsToNextTowerFloor(9)).toBeNull();
  });

  it('agrees with towerFloorsUnlocked at every orb count', () => {
    // The tile face reads orbsToNextTowerFloor and the panel reads both, so a
    // disagreement would show "2 orbs" next to a floor that is already open.
    for (let orbs = 0; orbs <= ALL_ORBS.length; orbs++) {
      const unlocked = towerFloorsUnlocked(orbs);
      const toNext   = orbsToNextTowerFloor(orbs);
      if (unlocked === TOWER_FLOORS) expect(toNext).toBeNull();
      else expect(orbs + toNext!).toBe(TOWER_FLOOR_ORBS[unlocked]);
    }
  });
});
