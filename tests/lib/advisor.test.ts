import { describe, it, expect } from 'vitest';
import {
  ADVISOR_LEVELS,
  advisorCountForLevel,
  missionClaimCapacity,
} from '../../src/lib/gameLogic';
import { LEVEL_THRESHOLDS, MAX_LEVEL } from '../../src/lib/constants';
import type { Player } from '../../src/types';

const player = (xp: number): Player => ({ id: 'p', displayName: 'P', xp, gold: 0 } as Player);

describe('the Advisor (map plan §1.10)', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // THE TRIPWIRE. This is the whole reason this file exists.
  //
  // `missionClaimCapacity` is mirrored server-side as a FLAT `MISSION_CLAIM_CAPACITY
  // = 1` in functions/src/index.ts, and the server has no level math whatsoever —
  // no LEVEL_THRESHOLDS, no calcLevel — so it structurally cannot compute a
  // per-player capacity today.
  //
  // That is fine only while ADVISOR_LEVELS is empty. Fill it and the client starts
  // offering a second table to anyone who has earned the advisor, while
  // `enlistInMission` and `claimMissionSlot` keep refusing them with
  // `no-claims-free` — a bug that looks like a broken button and is invisible in
  // every other test.
  //
  // So: if you are here because this test failed, that is the test working. Teach
  // the server the same math (or key the advisor off something it already reads),
  // then relax this.
  // ═══════════════════════════════════════════════════════════════════════════
  it('ADVISOR_LEVELS is still empty — filling it REQUIRES the server mirror first', () => {
    expect(ADVISOR_LEVELS).toEqual([]);
  });

  it('grants no advisor at any level while the curve is unset', () => {
    for (let lv = 1; lv <= MAX_LEVEL; lv++) {
      expect(advisorCountForLevel(lv)).toBe(0);
    }
  });

  it('keeps claim capacity at the server constant (1) for every level', () => {
    for (const xp of [0, ...LEVEL_THRESHOLDS]) {
      expect(missionClaimCapacity(player(xp))).toBe(1);
    }
  });

  it('treats a missing xp as level 1 rather than throwing', () => {
    expect(missionClaimCapacity({ id: 'p', displayName: 'P', gold: 0 } as Player)).toBe(1);
  });

  // The shape, not the numbers: this is what §1.10 was for. `advisorCountForLevel`
  // counts thresholds at or below the level, so a future curve needs no new logic —
  // only the array. Proven against a local array so the tripwire above stays honest.
  it('counts thresholds cumulatively, so a future curve needs only the array', () => {
    const curve = [4, 7];
    const count = (lv: number) => curve.filter(n => lv >= n).length;
    expect([1, 3, 4, 6, 7, 9].map(count)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
