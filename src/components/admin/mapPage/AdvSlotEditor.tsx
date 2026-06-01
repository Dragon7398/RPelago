import { useState } from 'react';
import { SLOT_STATUSES } from '../../../lib/constants';
import { useGameState } from '../../../contexts/GameStateContext';
import { setTileSlotLock } from '../../../firebase/db';
import { normalizeSlots } from '../../../lib/slotHelpers';
import type { Tile, AdvSlot, SlotStatus } from '../../../types';

type SlotDraft = { name: string; game: string; details: string; status: SlotStatus; bonusXP: number; bonusGold: number };

interface Props {
  tile: Tile;
  selectedCoord: string;
}

export default function AdvSlotEditor({ tile, selectedCoord }: Props) {
  const { adminSetAdventurerSlots } = useGameState();
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotDraft>>({});
  const locked = tile.slotsLocked ?? false;

  const entries = Object.values(tile.adventurers ?? {});
  if (entries.length === 0) return null;

  return (
    <>
      <div className="admin-detail-row" style={{ marginTop: '0.8rem', marginBottom: '0.4rem', alignItems: 'center' }}>
        <div className="admin-detail-label">SLOTS</div>
        <button className={`admin-slot-lock-btn${locked ? ' locked' : ''}`} onClick={() => setTileSlotLock(selectedCoord, !locked)}>
          {locked ? '🔒 LOCKED' : '🔓 LOCK'}
        </button>
      </div>
      {entries.map(entry => {
        const slots = normalizeSlots(entry.slots as any);
        const draft = slotDrafts[entry.advId] ?? { name: '', game: '', details: '', status: 'Unstarted' as SlotStatus, bonusXP: 0, bonusGold: 0 };
        const save  = (next: AdvSlot[]) => adminSetAdventurerSlots(selectedCoord, entry.advId, next);
        return (
          <div key={entry.advId} className="admin-slot-adv">
            <div className="admin-slot-adv-header">
              <span className="admin-slot-adv-name">{entry.name}</span>
              <span className="admin-slot-adv-owner">{entry.ownerName}</span>
            </div>
            {slots.map((s, i) => (
              <div key={i} className="admin-slot-row">
                <input
                  className="admin-slot-edit-input"
                  key={`name-${entry.advId}-${i}-${s.name}`}
                  defaultValue={s.name}
                  placeholder="Slot name"
                  onBlur={e => {
                    const val = e.target.value.trim();
                    if (val && val !== s.name) save(slots.map((slot, j) => j === i ? { ...slot, name: val } : slot));
                  }}
                />
                <input
                  className="admin-slot-edit-input"
                  key={`game-${entry.advId}-${i}-${s.game}`}
                  defaultValue={s.game}
                  placeholder="Game"
                  onBlur={e => {
                    const val = e.target.value.trim();
                    if (val && val !== s.game) save(slots.map((slot, j) => j === i ? { ...slot, game: val } : slot));
                  }}
                />
                <input
                  className="admin-slot-edit-input"
                  key={`details-${entry.advId}-${i}-${s.details ?? ''}`}
                  defaultValue={s.details ?? ''}
                  placeholder="Details"
                  onBlur={e => {
                    const val = e.target.value.trim();
                    const cur = s.details ?? '';
                    if (val !== cur) {
                      const updated = { ...s };
                      if (val) updated.details = val; else delete updated.details;
                      save(slots.map((slot, j) => j === i ? updated : slot));
                    }
                  }}
                />
                <input
                  type="number" min={0} className="admin-bonus-input" placeholder="+XP"
                  key={`adv-xp-${entry.advId}-${i}-${s.bonusXP ?? 0}`}
                  defaultValue={s.bonusXP ?? 0}
                  onBlur={e => {
                    const val = parseInt(e.target.value) || 0;
                    const updated = { ...s };
                    if (val > 0) updated.bonusXP = val; else delete updated.bonusXP;
                    save(slots.map((slot, j) => j === i ? updated : slot));
                  }}
                />
                <input
                  type="number" min={0} className="admin-bonus-input" placeholder="+Gold"
                  key={`adv-gold-${entry.advId}-${i}-${s.bonusGold ?? 0}`}
                  defaultValue={s.bonusGold ?? 0}
                  onBlur={e => {
                    const val = parseInt(e.target.value) || 0;
                    const updated = { ...s };
                    if (val > 0) updated.bonusGold = val; else delete updated.bonusGold;
                    save(slots.map((slot, j) => j === i ? updated : slot));
                  }}
                />
                <select
                  className="admin-slot-status-select"
                  value={s.status ?? 'Unstarted'}
                  onChange={e => save(slots.map((slot, j) => j === i ? { ...slot, status: e.target.value as SlotStatus } : slot))}
                >
                  {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
                {!locked && <button className="admin-slot-del" onClick={() => save(slots.filter((_, j) => j !== i))} title="Remove slot">✕</button>}
              </div>
            ))}
            {!locked && <div className="admin-slot-add-row">
              <input className="admin-text-input" placeholder="Slot name" value={draft.name}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, name: e.target.value } }))} />
              <input className="admin-text-input" placeholder="Game" value={draft.game}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, game: e.target.value } }))} />
              <input className="admin-text-input" placeholder="Details (optional)" value={draft.details}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, details: e.target.value } }))} />
              <input type="number" min={0} className="admin-bonus-input" placeholder="+XP"
                value={draft.bonusXP || ''}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, bonusXP: parseInt(e.target.value) || 0 } }))} />
              <input type="number" min={0} className="admin-bonus-input" placeholder="+Gold"
                value={draft.bonusGold || ''}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, bonusGold: parseInt(e.target.value) || 0 } }))} />
              <select className="admin-slot-status-select" value={draft.status}
                onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, status: e.target.value as SlotStatus } }))}>
                {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <button
                className="admin-slot-add-btn"
                disabled={!draft.name.trim() || !draft.game.trim()}
                onClick={() => {
                  const newSlot: AdvSlot = { name: draft.name.trim(), game: draft.game.trim(), status: draft.status };
                  if (draft.details.trim()) newSlot.details   = draft.details.trim();
                  if (draft.bonusXP > 0)    newSlot.bonusXP   = draft.bonusXP;
                  if (draft.bonusGold > 0)  newSlot.bonusGold = draft.bonusGold;
                  save([...slots, newSlot]);
                  setSlotDrafts(p => ({ ...p, [entry.advId]: { name: '', game: '', details: '', status: 'Unstarted', bonusXP: 0, bonusGold: 0 } }));
                }}
              >+ Add</button>
            </div>}
          </div>
        );
      })}
    </>
  );
}
