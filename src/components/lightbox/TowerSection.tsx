import { TOWER_FLOOR_ORBS, towerFloorsUnlocked, orbsToNextTowerFloor } from '../../lib/constants';

interface Props {
  orbCount: number;
}

const FLOOR_NAMES = ['Foundation', 'Reliquary', 'Sanctum'] as const;

/**
 * The Tower's SURFACE tile — the S2 replacement for BossSection.
 *
 * Unlike S1's boss, the Tower is not one fight: it is three floors, each gated
 * on a different orb count (3 / 5 / 7), with the Sorcerer waiting on the third.
 * Read-only progress at launch; Phase 3 adds the per-floor Enter buttons.
 */
export default function TowerSection({ orbCount }: Props) {
  const unlocked = towerFloorsUnlocked(orbCount);
  const toNext   = orbsToNextTowerFloor(orbCount);

  return (
    <div className="lb-sealed lb-sealed-tower">
      <div className="lb-sealed-title">🏯 The Skybound Tower</div>
      <p className="lb-sealed-body">
        The Tower pierces the clouds. The season&rsquo;s boss lies hidden within,
        unsealed only as the orbs are gathered.
      </p>

      <div className="lb-tower-floors">
        {TOWER_FLOOR_ORBS.map((need, i) => {
          const isOpen = orbCount >= need;
          return (
            <div key={i} className={`lb-tower-floor${isOpen ? ' open' : ''}`}>
              <span className="lb-tower-floor-n">{i + 1}</span>
              <span className="lb-tower-floor-name">{FLOOR_NAMES[i]}</span>
              <span className="lb-tower-floor-req">
                {isOpen ? 'Unsealed' : `${need} orbs`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="lb-tower-status">
        {toNext == null
          ? <span className="lb-tower-status-open">Every floor stands open — the Sorcerer awaits.</span>
          : <>Gather <strong>{toNext}</strong> more orb{toNext !== 1 ? 's' : ''} to unseal floor {unlocked + 1}.</>}
      </div>
    </div>
  );
}
