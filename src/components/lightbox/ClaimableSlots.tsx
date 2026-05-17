import { ADV_ICONS } from '../../lib/constants';
import { normalizeSlots } from '../../lib/slotHelpers';
import { SlotBonusPills } from './AdvRow';
import type { AdvSlot, Adventurer, AuthUser } from '../../types';

interface Props {
  entries: [string, AdvSlot[] | Record<string, AdvSlot>][];
  user: AuthUser | null;
  alreadySent: boolean;
  freeAdvs: Adventurer[];
  claimingSlotKey: string | null;
  setClaimingSlotKey: (key: string | null) => void;
  onClaimSlot: (slotKey: string, slots: AdvSlot[], advId: string) => Promise<void>;
}

export default function ClaimableSlots({
  entries, user, alreadySent, freeAdvs, claimingSlotKey, setClaimingSlotKey, onClaimSlot,
}: Props) {
  if (entries.length === 0) return null;
  const canClaim = !!user && !alreadySent && freeAdvs.length > 0;
  return (
    <div className="lb-claimable-slots">
      <div className="lb-claimable-header">CLAIMABLE SLOTS</div>
      <div className="lb-claimable-note">A player has vacated this challenge. You can take over their game slot.</div>
      {entries.map(([slotKey, rawVal]) => {
        const slotArr   = normalizeSlots(rawVal as AdvSlot[] | Record<string, AdvSlot>);
        const isClaiming = claimingSlotKey === slotKey;
        const hasContent = slotArr.some(s => s.name || s.game);
        const bonusXP    = slotArr.reduce((n, s) => n + (s.bonusXP   ?? 0), 0);
        const bonusGold  = slotArr.reduce((n, s) => n + (s.bonusGold ?? 0), 0);
        return (
          <div key={slotKey} className="lb-claimable-slot">
            {hasContent && (
              <div className="lb-claimable-slot-games">
                {slotArr.map((s, i) => (
                  <div key={i} className="lb-slot-row">
                    {s.name && <span className="lb-slot-name">{s.name}</span>}
                    {s.name && s.game && <span className="lb-slot-sep">—</span>}
                    {s.game && <span className="lb-slot-game">{s.game}</span>}
                    {s.details && <span className="lb-slot-details">{s.details}</span>}
                  </div>
                ))}
              </div>
            )}
            <SlotBonusPills bonusXP={bonusXP || undefined} bonusGold={bonusGold || undefined} />
            {!user && <div className="lb-claimable-login">Log in to claim this slot.</div>}
            {canClaim && !isClaiming && (
              <button className="lb-claim-btn" onClick={() => setClaimingSlotKey(slotKey)}>CLAIM</button>
            )}
            {canClaim && isClaiming && (
              <div className="lb-claim-picker">
                <div className="lb-send-label">SEND AN ADVENTURER</div>
                <div className="lb-adv-picker">
                  {freeAdvs.map(adv => (
                    <button key={adv.id} className="lb-adv-pick-btn" onClick={() => onClaimSlot(slotKey, slotArr, adv.id)}>
                      <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
                      <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
                      <span className="btn-adv-class">{adv.cls}</span>
                    </button>
                  ))}
                </div>
                <button className="lb-cancel-claim-btn" onClick={() => setClaimingSlotKey(null)}>Cancel</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
