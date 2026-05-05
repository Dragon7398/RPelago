import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { TILE_TYPES, COLS, ROWS, COL_CHARS, coordFromRC, rcFromCoord, SLOT_STATUSES, TILE_TRAITS } from '../lib/constants';
import type { TraitDef } from '../lib/constants';
import { getTypeKey } from '../lib/tileGen';
import type { TileState, TriState, AdvSlot, SlotStatus } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATE_BUTTONS: { state: TileState; label: string; cls: string }[] = [
  { state: 'hidden',     label: 'Hidden',      cls: 'btn-hidden'     },
  { state: 'available',  label: 'Available',   cls: 'btn-available'  },
  { state: 'inprogress', label: 'In Progress', cls: 'btn-inprogress' },
  { state: 'complete',   label: 'Complete',    cls: 'btn-complete'   },
];

export default function AdminPanel({ open, onClose }: Props) {
  const {
    gameState,
    adminSetTileState, adminUpdateTile, adminCompleteTile,
    adminSetAdventurerSlots, adminSetPublicSlots,
  } = useGameState();

  const [selectedCoord, setSelectedCoord] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, string | number>>({});
  // slotDrafts: advId → pending new-slot input values
  const [slotDrafts, setSlotDrafts] = useState<Record<string, { name: string; game: string; details: string; status: SlotStatus }>>({});
  const [publicDraft, setPublicDraft] = useState<{ name: string; game: string; details: string; status: SlotStatus }>({ name: '', game: '', details: '', status: 'Unstarted' });

  function readSlots(raw: AdvSlot[] | Record<string, AdvSlot> | undefined): AdvSlot[] {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : Object.values(raw);
  }

  if (!gameState) return null;

  const tile = selectedCoord ? gameState.tiles[selectedCoord] : null;

  const handleStateBtn = async (state: TileState) => {
    if (!selectedCoord || !tile) return;
    if (state === 'complete') {
      if (tile.state === 'complete') return;
      await adminCompleteTile(selectedCoord);
    } else {
      await adminSetTileState(selectedCoord, state);
    }
  };

  const handleFieldSave = async () => {
    if (!selectedCoord || Object.keys(localEdits).length === 0) return;
    await adminUpdateTile(selectedCoord, localEdits as any);
    setLocalEdits({});
  };

  const handleTriState = async (field: 'release' | 'collect', value: TriState) => {
    if (!selectedCoord) return;
    await adminUpdateTile(selectedCoord, { [field]: value });
  };

  const handleTraitToggle = async (def: TraitDef, enabled: boolean) => {
    if (!selectedCoord || !tile) return;
    const next = { ...(tile.traits ?? {}) };
    if (enabled) {
      next[def.id] = { value: def.hasValue ? def.defaultValue : 0 };
    } else {
      delete next[def.id];
    }
    await adminUpdateTile(selectedCoord, { traits: (Object.keys(next).length > 0 ? next : null) as any });
  };

  const handleTraitValue = async (traitId: string, value: number) => {
    if (!selectedCoord || !tile) return;
    const next = { ...(tile.traits ?? {}), [traitId]: { value } };
    await adminUpdateTile(selectedCoord, { traits: next });
  };

  return (
    <>
      <div className={`admin-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`admin-panel ${open ? 'open' : ''}`}>
        <button className="admin-close" onClick={onClose}>✕</button>
        <h2>⚔ ADMIN — MAP CONTROL</h2>
        <div className="admin-subtitle">Click a tile to select it, then adjust its state and settings.</div>

        <button
          className="admin-dashboard-link"
          onClick={() => window.open('/#admin', '_blank')}
        >
          ⧉ Admin Dashboard
        </button>

        {/* Mini map */}
        <div className="admin-col-labels">
          {Array.from({ length: COLS }, (_, c) => (
            <div key={c} className="admin-col-lbl">{COL_CHARS[c]}</div>
          ))}
        </div>
        <div className="admin-grid">
          {Array.from({ length: ROWS }, (_, r) => (
            <div key={r} className="admin-grid-row">
              <div className="admin-row-lbl">{r + 1}</div>
              {Array.from({ length: COLS }, (_, c) => {
                const coord   = coordFromRC(r, c);
                const t       = gameState.tiles[coord];
                const typeKey = getTypeKey(r, c);
                const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
                const state   = t?.state ?? 'hidden';
                const isSelected = coord === selectedCoord;
                return (
                  <div
                    key={coord}
                    className={`admin-tile s-${state}${isSelected ? ' selected' : ''}`}
                    style={isSelected ? { outline: '2px solid var(--gold)' } : {}}
                    onClick={() => { setSelectedCoord(coord); setLocalEdits({}); }}
                    title={coord}
                  >
                    <span className="a-icon">{info.icon}</span>
                    <span className="a-lbl">{coord}</span>
                    <span className="state-dot" />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Tile detail */}
        <div className="admin-detail">
          {!selectedCoord || !tile ? (
            <div className="admin-detail-empty">Select a tile to edit it.</div>
          ) : (
            <>
              <div className="admin-detail-title">
                {TILE_TYPES[getTypeKey(...rcFromCoord(selectedCoord))]?.icon} {selectedCoord}
                {tile.name ? ` — ${tile.name}` : ''}
              </div>

              {/* State buttons */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">STATE</div>
                <div className="admin-state-btns">
                  {STATE_BUTTONS.map(({ state, label, cls }) => (
                    <button
                      key={state}
                      className={`admin-state-btn ${cls}${tile.state === state ? ' active' : ''}`}
                      onClick={() => handleStateBtn(state)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">NAME</div>
                <input
                  className="admin-text-input"
                  value={localEdits.name !== undefined ? String(localEdits.name) : (tile.name ?? '')}
                  onChange={e => setLocalEdits(p => ({ ...p, name: e.target.value }))}
                />
              </div>

              {/* Required adventurers */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">REQUIRED</div>
                <input
                  type="number" className="admin-count-input" min={0} max={40}
                  value={localEdits.required !== undefined ? Number(localEdits.required) : (tile.required ?? 0)}
                  onChange={e => setLocalEdits(p => ({ ...p, required: parseInt(e.target.value) || 0 }))}
                />
              </div>

              {/* Gold / XP */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">GOLD / XP</div>
                <input
                  type="number" className="admin-count-input" min={0}
                  value={localEdits.gold !== undefined ? Number(localEdits.gold) : (tile.gold ?? 0)}
                  onChange={e => setLocalEdits(p => ({ ...p, gold: parseInt(e.target.value) || 0 }))}
                  placeholder="Gold"
                />
                <input
                  type="number" className="admin-count-input" min={0}
                  value={localEdits.xp !== undefined ? Number(localEdits.xp) : (tile.xp ?? 0)}
                  onChange={e => setLocalEdits(p => ({ ...p, xp: parseInt(e.target.value) || 0 }))}
                  placeholder="XP"
                />
              </div>

              {/* Release / Collect */}
              {(['release', 'collect'] as const).map(field => (
                <div className="admin-detail-row" key={field}>
                  <div className="admin-detail-label">{field.toUpperCase()}</div>
                  <div className="admin-tristate">
                    {(['on', 'off', 'special'] as TriState[]).map(v => (
                      <button
                        key={v}
                        className={`admin-tri-btn${tile[field] === v ? ` active-${v}` : ''}`}
                        onClick={() => handleTriState(field, v)}
                      >
                        {v.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Hint % */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">HINT %</div>
                <div className="admin-hint-wrap">
                  <input
                    type="number" className="admin-count-input" min={0} max={100}
                    value={localEdits.hint !== undefined ? Number(localEdits.hint) : (tile.hint ?? 0)}
                    onChange={e => setLocalEdits(p => ({ ...p, hint: parseInt(e.target.value) || 0 }))}
                  />
                  <span>%</span>
                </div>
              </div>

              {/* Archipelago link */}
              <div className="admin-detail-row">
                <div className="admin-detail-label">ARCH. LINK</div>
                <input
                  className="admin-text-input"
                  value={localEdits.link !== undefined ? String(localEdits.link) : (tile.link ?? '')}
                  onChange={e => setLocalEdits(p => ({ ...p, link: e.target.value }))}
                  placeholder="https://…"
                />
              </div>

              {/* Details */}
              <div className="admin-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
                <div className="admin-detail-label">DETAILS</div>
                <textarea
                  className="admin-textarea"
                  value={localEdits.details !== undefined ? String(localEdits.details) : (tile.details ?? '')}
                  onChange={e => setLocalEdits(p => ({ ...p, details: e.target.value }))}
                />
              </div>

              {/* Rules */}
              <div className="admin-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
                <div className="admin-detail-label">RULES</div>
                <textarea
                  className="admin-textarea"
                  value={localEdits.rules !== undefined ? String(localEdits.rules) : (tile.rules ?? '')}
                  onChange={e => setLocalEdits(p => ({ ...p, rules: e.target.value }))}
                />
              </div>

              {Object.keys(localEdits).length > 0 && (
                <button className="admin-btn secondary" style={{ marginTop: '0.5rem' }} onClick={handleFieldSave}>
                  Save Changes
                </button>
              )}

              {/* Traits */}
              <div className="admin-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.6rem' }}>
                <div className="admin-detail-label">TRAITS</div>
                <div className="admin-traits-list">
                  {TILE_TRAITS.map(def => {
                    const active    = tile.traits?.[def.id];
                    const isEnabled = active !== undefined;
                    const currentVal = active?.value ?? def.defaultValue;
                    const desc = def.description.replace('{value}', String(currentVal));
                    return (
                      <div key={def.id} className="admin-trait-row">
                        <div className="admin-trait-top">
                          <input
                            type="checkbox"
                            className="admin-trait-check"
                            checked={isEnabled}
                            onChange={e => handleTraitToggle(def, e.target.checked)}
                          />
                          <span className="admin-trait-name">{def.name}</span>
                          {def.hasValue && isEnabled && (
                            <input
                              type="number"
                              className="admin-trait-value-input"
                              key={`${selectedCoord}-${def.id}-val`}
                              defaultValue={currentVal}
                              min={0}
                              onBlur={e => handleTraitValue(def.id, parseInt(e.target.value) || def.defaultValue)}
                            />
                          )}
                        </div>
                        <div className="admin-trait-desc">{desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Adventurer slot editor */}
              {Object.values(tile.adventurers ?? {}).length > 0 && (
                <>
                  <div className="admin-detail-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>SLOTS</div>
                  {Object.values(tile.adventurers ?? {}).map(entry => {
                    const slots  = readSlots(entry.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
                    const draft  = slotDrafts[entry.advId] ?? { name: '', game: '', details: '', status: 'Unstarted' as SlotStatus };
                    const save   = (next: AdvSlot[]) => adminSetAdventurerSlots(selectedCoord!, entry.advId, next);
                    return (
                      <div key={entry.advId} className="admin-slot-adv">
                        <div className="admin-slot-adv-header">
                          <span className="admin-slot-adv-name">{entry.name}</span>
                          <span className="admin-slot-adv-owner">{entry.ownerName}</span>
                        </div>
                        {slots.map((s, i) => (
                          <div key={i} className="admin-slot-row">
                            <span className="admin-slot-val">{s.name}</span>
                            <span className="admin-slot-sep">—</span>
                            <span className="admin-slot-val">{s.game}</span>
                            {s.details && <span className="admin-slot-val admin-slot-details">{s.details}</span>}
                            <select
                              className="admin-slot-status-select"
                              value={s.status ?? 'Unstarted'}
                              onChange={e => save(slots.map((slot, j) => j === i ? { ...slot, status: e.target.value as SlotStatus } : slot))}
                            >
                              {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                            </select>
                            <button
                              className="admin-slot-del"
                              onClick={() => save(slots.filter((_, j) => j !== i))}
                              title="Remove slot"
                            >✕</button>
                          </div>
                        ))}
                        <div className="admin-slot-add-row">
                          <input
                            className="admin-text-input"
                            placeholder="Slot name"
                            value={draft.name}
                            onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, name: e.target.value } }))}
                          />
                          <input
                            className="admin-text-input"
                            placeholder="Game"
                            value={draft.game}
                            onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, game: e.target.value } }))}
                          />
                          <input
                            className="admin-text-input"
                            placeholder="Details (optional)"
                            value={draft.details}
                            onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, details: e.target.value } }))}
                          />
                          <select
                            className="admin-slot-status-select"
                            value={draft.status}
                            onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, status: e.target.value as SlotStatus } }))}
                          >
                            {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                          </select>
                          <button
                            className="admin-slot-add-btn"
                            disabled={!draft.name.trim() || !draft.game.trim()}
                            onClick={() => {
                              const newSlot: AdvSlot = { name: draft.name.trim(), game: draft.game.trim(), status: draft.status };
                              if (draft.details.trim()) newSlot.details = draft.details.trim();
                              save([...slots, newSlot]);
                              setSlotDrafts(p => ({ ...p, [entry.advId]: { name: '', game: '', details: '', status: 'Unstarted' } }));
                            }}
                          >+ Add</button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Public slots */}
              {(() => {
                const pubSlots = readSlots(tile.publicSlots as any);
                const savePub  = (next: AdvSlot[]) => adminSetPublicSlots(selectedCoord!, next);
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
                            onChange={e => savePub(pubSlots.map((slot, j) => j === i ? { ...slot, status: e.target.value as SlotStatus } : slot))}
                          >
                            {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                          </select>
                          <button
                            className="admin-slot-del"
                            onClick={() => savePub(pubSlots.filter((_, j) => j !== i))}
                            title="Remove slot"
                          >✕</button>
                        </div>
                      ))}
                      <div className="admin-slot-add-row">
                        <input
                          className="admin-text-input"
                          placeholder="Slot name"
                          value={publicDraft.name}
                          onChange={e => setPublicDraft(p => ({ ...p, name: e.target.value }))}
                        />
                        <input
                          className="admin-text-input"
                          placeholder="Game"
                          value={publicDraft.game}
                          onChange={e => setPublicDraft(p => ({ ...p, game: e.target.value }))}
                        />
                        <input
                          className="admin-text-input"
                          placeholder="Details (optional)"
                          value={publicDraft.details}
                          onChange={e => setPublicDraft(p => ({ ...p, details: e.target.value }))}
                        />
                        <select
                          className="admin-slot-status-select"
                          value={publicDraft.status}
                          onChange={e => setPublicDraft(p => ({ ...p, status: e.target.value as SlotStatus }))}
                        >
                          {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                        </select>
                        <button
                          className="admin-slot-add-btn"
                          disabled={!publicDraft.name.trim() || !publicDraft.game.trim()}
                          onClick={() => {
                            const newSlot: AdvSlot = { name: publicDraft.name.trim(), game: publicDraft.game.trim(), status: publicDraft.status };
                            if (publicDraft.details.trim()) newSlot.details = publicDraft.details.trim();
                            savePub([...pubSlots, newSlot]);
                            setPublicDraft({ name: '', game: '', details: '', status: 'Unstarted' });
                          }}
                        >+ Add</button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </div>

        <div className="admin-actions" style={{ marginTop: '1rem' }}>
          <button className="admin-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}
