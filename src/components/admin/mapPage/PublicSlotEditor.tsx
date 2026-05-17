import { useState } from 'react';
import { SLOT_STATUSES } from '../../../lib/constants';
import { useGameState } from '../../../contexts/GameStateContext';
import { normalizeSlots } from '../../../lib/slotHelpers';
import type { Tile, AdvSlot, SlotStatus } from '../../../types';

type PublicDraft = { name: string; game: string; details: string; status: SlotStatus; room: 1 | 2 | undefined };

function RoomSelect({ value, onChange }: { value: 1 | 2 | undefined; onChange: (v: 1 | 2 | undefined) => void }) {
  return (
    <select
      className="admin-slot-status-select"
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value;
        onChange(v === '1' ? 1 : v === '2' ? 2 : undefined);
      }}
    >
      <option value="">— Room —</option>
      <option value="1">Room 1</option>
      <option value="2">Room 2</option>
    </select>
  );
}

interface Props {
  tile: Tile;
  selectedCoord: string;
}

export default function PublicSlotEditor({ tile, selectedCoord }: Props) {
  const { adminSetPublicSlots } = useGameState();
  const [draft, setDraft] = useState<PublicDraft>({ name: '', game: '', details: '', status: 'Unstarted', room: undefined });

  const pubSlots    = normalizeSlots(tile.publicSlots as AdvSlot[] | Record<string, AdvSlot> | undefined);
  const isBifurcated = tile.traits?.['bifurcated'] !== undefined;
  const save        = (next: AdvSlot[]) => adminSetPublicSlots(selectedCoord, next);

  return (
    <>
      <div className="admin-detail-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>PUBLIC SLOTS</div>
      <div className="admin-slot-adv">
        {pubSlots.map((s, i) => (
          <div key={i} className="admin-slot-row">
            <span className="admin-slot-val">{s.name}</span>
            <span className="admin-slot-sep">—</span>
            <span className="admin-slot-val">{s.game}</span>
            {s.details && <span className="admin-slot-val admin-slot-details">{s.details}</span>}
            <select
              className="admin-slot-status-select"
              value={s.status ?? 'Unstarted'}
              onChange={e => save(pubSlots.map((slot, j) => j === i ? { ...slot, status: e.target.value as SlotStatus } : slot))}
            >
              {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            {isBifurcated && (
              <RoomSelect
                value={s.room}
                onChange={room => save(pubSlots.map((slot, j) => j === i ? { ...slot, room } : slot))}
              />
            )}
            <button className="admin-slot-del" onClick={() => save(pubSlots.filter((_, j) => j !== i))} title="Remove slot">✕</button>
          </div>
        ))}
        <div className="admin-slot-add-row">
          <input className="admin-text-input" placeholder="Slot name" value={draft.name}
            onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} />
          <input className="admin-text-input" placeholder="Game" value={draft.game}
            onChange={e => setDraft(p => ({ ...p, game: e.target.value }))} />
          <input className="admin-text-input" placeholder="Details (optional)" value={draft.details}
            onChange={e => setDraft(p => ({ ...p, details: e.target.value }))} />
          <select className="admin-slot-status-select" value={draft.status}
            onChange={e => setDraft(p => ({ ...p, status: e.target.value as SlotStatus }))}>
            {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
          {isBifurcated && (
            <RoomSelect value={draft.room} onChange={room => setDraft(p => ({ ...p, room }))} />
          )}
          <button
            className="admin-slot-add-btn"
            disabled={!draft.name.trim() || !draft.game.trim()}
            onClick={() => {
              const newSlot: AdvSlot = { name: draft.name.trim(), game: draft.game.trim(), status: draft.status };
              if (draft.details.trim()) newSlot.details = draft.details.trim();
              if (draft.room)           newSlot.room    = draft.room;
              save([...pubSlots, newSlot]);
              setDraft({ name: '', game: '', details: '', status: 'Unstarted', room: undefined });
            }}
          >+ Add</button>
        </div>
      </div>
    </>
  );
}
