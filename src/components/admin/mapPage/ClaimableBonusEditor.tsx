import { useState } from 'react';
import { useGameState } from '../../../contexts/GameStateContext';
import { normalizeSlots } from '../../../lib/slotHelpers';
import type { Tile, AdvSlot } from '../../../types';

interface Props {
  tile: Tile;
  selectedCoord: string;
}

export default function ClaimableBonusEditor({ tile, selectedCoord }: Props) {
  const { adminSetClaimableSlotBonus } = useGameState();

  const claimable = tile.claimableSlots ?? {};
  const entries   = Object.entries(claimable);

  const [bonusDrafts, setBonusDrafts] = useState<Record<string, { bonusXP: number; bonusGold: number }>>(() => {
    const drafts: Record<string, { bonusXP: number; bonusGold: number }> = {};
    for (const [key, rawVal] of entries) {
      const arr = normalizeSlots(rawVal as AdvSlot[] | Record<string, AdvSlot>);
      drafts[key] = { bonusXP: arr[0]?.bonusXP ?? 0, bonusGold: arr[0]?.bonusGold ?? 0 };
    }
    return drafts;
  });

  if (entries.length === 0) return null;

  return (
    <>
      <div className="admin-detail-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>CLAIMABLE SLOT BONUSES</div>
      <div className="admin-slot-adv">
        {entries.map(([slotKey, rawVal]) => {
          const slotArr = normalizeSlots(rawVal as AdvSlot[] | Record<string, AdvSlot>);
          const draft   = bonusDrafts[slotKey] ?? { bonusXP: 0, bonusGold: 0 };
          return (
            <div key={slotKey} className="admin-claimable-bonus-row">
              <div className="admin-claimable-bonus-games">
                {slotArr.map((s, i) => (
                  <span key={i} className="admin-claimable-bonus-game">
                    {s.name ? `${s.name} — ${s.game}` : s.game}
                  </span>
                ))}
              </div>
              <div className="admin-claimable-bonus-inputs">
                <span className="admin-bonus-label">+XP</span>
                <input
                  type="number" min={0} className="admin-bonus-input"
                  value={draft.bonusXP || ''} placeholder="0"
                  onChange={e => setBonusDrafts(p => ({ ...p, [slotKey]: { ...draft, bonusXP: parseInt(e.target.value) || 0 } }))}
                />
                <span className="admin-bonus-label">+Gold</span>
                <input
                  type="number" min={0} className="admin-bonus-input"
                  value={draft.bonusGold || ''} placeholder="0"
                  onChange={e => setBonusDrafts(p => ({ ...p, [slotKey]: { ...draft, bonusGold: parseInt(e.target.value) || 0 } }))}
                />
                <button
                  className="admin-slot-add-btn"
                  onClick={async () => {
                    const updated = slotArr.map((s, i) => {
                      if (i !== 0) return s;
                      const out = { ...s };
                      if (draft.bonusXP > 0)   out.bonusXP   = draft.bonusXP;   else delete out.bonusXP;
                      if (draft.bonusGold > 0) out.bonusGold = draft.bonusGold; else delete out.bonusGold;
                      return out;
                    });
                    await adminSetClaimableSlotBonus(selectedCoord, slotKey, updated);
                  }}
                >Save</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
