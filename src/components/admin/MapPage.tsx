import { useState, useEffect } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import { TILE_TYPES, COLS, ROWS, COL_CHARS, coordFromRC, rcFromCoord, SLOT_STATUSES, TILE_TRAITS, SHOP_ITEMS, ALL_ORBS } from '../../lib/constants';
import type { TraitDef } from '../../lib/constants';
import { getTypeKey } from '../../lib/tileGen';
import type { TileState, TriState, AdvSlot, SlotStatus } from '../../types';

const STATE_BUTTONS: { state: TileState; label: string; cls: string }[] = [
  { state: 'hidden',     label: 'Hidden',      cls: 'btn-hidden'     },
  { state: 'available',  label: 'Available',   cls: 'btn-available'  },
  { state: 'inprogress', label: 'In Progress', cls: 'btn-inprogress' },
  { state: 'complete',   label: 'Complete',    cls: 'btn-complete'   },
];

function readSlots(raw: AdvSlot[] | Record<string, AdvSlot> | undefined): AdvSlot[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

export default function MapPage() {
  const {
    gameState,
    adminSetTileState, adminUpdateTile, adminCompleteTile, adminRegenTileStats,
    adminSetAdventurerSlots, adminSetPublicSlots,
  } = useGameState();

  const { addToast } = useToast();
  const [selectedCoord, setSelectedCoord] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, string | number>>({});
  const [slotDrafts, setSlotDrafts] = useState<Record<string, { name: string; game: string; details: string; status: SlotStatus }>>({});
  const [publicDraft, setPublicDraft] = useState<{ name: string; game: string; details: string; status: SlotStatus; room: 1 | 2 | undefined }>({ name: '', game: '', details: '', status: 'Unstarted', room: undefined });
  const [traitsCollapsed, setTraitsCollapsed] = useState(false);

  useEffect(() => {
    if (!selectedCoord || !gameState) return;
    const t = gameState.tiles[selectedCoord];
    setTraitsCollapsed(t?.state === 'inprogress' || t?.state === 'complete');
  }, [selectedCoord]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!gameState) return null;
  const gs = gameState; // narrowed alias so closures don't see GameState | null

  const tile = selectedCoord ? gs.tiles[selectedCoord] : null;

  const handleStateBtn = async (state: TileState) => {
    if (!selectedCoord || !tile) return;
    try {
      if (state === 'complete') {
        if (tile.state === 'complete') return;
        await adminCompleteTile(selectedCoord);
      } else {
        await adminSetTileState(selectedCoord, state);
      }
    } catch {
      addToast('Failed to update tile state. Please try again.', 'error');
    }
  };

  const handleFieldSave = async () => {
    if (!selectedCoord || Object.keys(localEdits).length === 0) return;
    try {
      await adminUpdateTile(selectedCoord, localEdits as any);
      setLocalEdits({});
    } catch {
      addToast('Failed to save tile changes. Please try again.', 'error');
    }
  };

  const handleTriState = async (field: 'release' | 'collect', value: TriState) => {
    if (!selectedCoord) return;
    try {
      await adminUpdateTile(selectedCoord, { [field]: value });
    } catch {
      addToast('Failed to update tile. Please try again.', 'error');
    }
  };

  const handleTraitToggle = async (def: TraitDef, enabled: boolean) => {
    if (!selectedCoord || !tile) return;
    const next = { ...(tile.traits ?? {}) };
    if (enabled) {
      next[def.id] = { value: def.hasValue ? def.defaultValue : 0 };
    } else {
      delete next[def.id];
    }
    try {
      await adminUpdateTile(selectedCoord, { traits: (Object.keys(next).length > 0 ? next : null) as any });
    } catch {
      addToast('Failed to update trait. Please try again.', 'error');
    }
  };

  const handleTraitValue = async (traitId: string, value: number) => {
    if (!selectedCoord || !tile) return;
    const next = { ...(tile.traits ?? {}), [traitId]: { value } };
    try {
      await adminUpdateTile(selectedCoord, { traits: next });
    } catch {
      addToast('Failed to update trait value. Please try again.', 'error');
    }
  };

  const handleRegenStats = async () => {
    if (!selectedCoord) return;
    try {
      await adminRegenTileStats(selectedCoord);
      setLocalEdits({});
      addToast('Tile stats regenerated from seed.', 'info');
    } catch {
      addToast('Failed to regenerate stats. Please try again.', 'error');
    }
  };

  // ── Checklist helpers ───────────────────────────────────────────────────────
  function tileComplete(coord: string): boolean {
    const t = gs.tiles[coord];
    if (!t) return false;
    const [r, c] = rcFromCoord(coord);
    const typeKey = getTypeKey(r, c);
    switch (typeKey) {
      case 'battle':
        return Object.keys(t.traits ?? {}).length > 0;
      case 'puzzle':
        return !!t.rules?.trim();
      case 'town':
      case 'town_center': {
        const shop = t.shopId ? gs.shops?.[t.shopId] : null;
        return !!(shop && (shop.itemIds.length > 0 || shop.orbId));
      }
      case 'elite':
        return Object.keys(t.traits ?? {}).length > 0 && !!t.rules?.trim();
      case 'boss':
        return !!t.details?.trim() && !!t.rules?.trim();
      default:
        return false;
    }
  }

  // List tiles in column-major order: A1–A5, B1–B5, …
  const allCoords: string[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      allCoords.push(coordFromRC(r, c));
    }
  }

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">Map Control</h2>
      <div className="map-page-layout">

        {/* Mini-map */}
        <div className="map-page-grid-wrap">
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

          {/* Tile checklist */}
          <div className="map-checklist">
            <div className="map-checklist-title">TILE CHECKLIST</div>
            {allCoords.map(coord => {
              const [r, c] = rcFromCoord(coord);
              const typeKey = getTypeKey(r, c);
              const info = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
              const t = gameState.tiles[coord];
              const done = tileComplete(coord);
              return (
                <div
                  key={coord}
                  className={`map-checklist-row${done ? ' done' : ''}${coord === selectedCoord ? ' selected' : ''}`}
                  onClick={() => { setSelectedCoord(coord); setLocalEdits({}); }}
                >
                  <span className="map-checklist-coord">{coord}</span>
                  <span className="map-checklist-icon">{info.icon}</span>
                  <span className="map-checklist-name">{t?.name || <em className="map-checklist-unnamed">unnamed</em>}</span>
                  {done && <span className="map-checklist-check">✓</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tile detail */}
        <div className="admin-detail map-page-detail">
          {!selectedCoord || !tile ? (
            <div className="admin-detail-empty">Select a tile to edit it.</div>
          ) : (() => {
            const [selR, selC] = rcFromCoord(selectedCoord);
            const typeKey = getTypeKey(selR, selC);
            const isTown = typeKey === 'town' || typeKey === 'town_center';
            const shop = isTown && tile.shopId ? (gameState.shops?.[tile.shopId] ?? null) : null;
            const orbDef = shop?.orbId ? ALL_ORBS.find(o => o.id === shop.orbId) : null;

            return (
              <>
                <div className="admin-detail-title">
                  {TILE_TYPES[typeKey]?.icon} {selectedCoord}
                  {tile.name ? ` — ${tile.name}` : ''}
                </div>

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

                <div className="admin-detail-row">
                  <div className="admin-detail-label">NAME</div>
                  <input
                    className="admin-text-input"
                    value={localEdits.name !== undefined ? String(localEdits.name) : (tile.name ?? '')}
                    onChange={e => setLocalEdits(p => ({ ...p, name: e.target.value }))}
                  />
                </div>

                {isTown ? (
                  /* ── Town: shop info ── */
                  <div className="admin-detail-row admin-town-shop-info">
                    <div className="admin-detail-label">SHOP</div>
                    {shop ? (
                      <div className="admin-town-shop">
                        <div className="admin-town-shop-name">🛒 {shop.name}</div>
                        {orbDef && (
                          <div className="admin-town-shop-orb">{orbDef.icon} {orbDef.label} Orb</div>
                        )}
                        {shop.itemIds.length > 0 ? (
                          <ul className="admin-town-shop-items">
                            {shop.itemIds.map(id => {
                              const item = SHOP_ITEMS.find(i => i.id === id);
                              return <li key={id}>{item?.name ?? id}</li>;
                            })}
                          </ul>
                        ) : (
                          <div className="admin-town-shop-empty">No items stocked.</div>
                        )}
                      </div>
                    ) : (
                      <div className="admin-town-shop-empty">No shop assigned.</div>
                    )}
                  </div>
                ) : (
                  /* ── Non-town: Archipelago fields ── */
                  <>
                    <div className="admin-detail-row">
                      <div className="admin-detail-label">REQUIRED</div>
                      <input
                        type="number" className="admin-count-input" min={0} max={40}
                        value={localEdits.required !== undefined ? Number(localEdits.required) : (tile.required ?? 0)}
                        onChange={e => setLocalEdits(p => ({ ...p, required: parseInt(e.target.value) || 0 }))}
                      />
                    </div>

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

                    <div className="admin-detail-row">
                      <div className="admin-detail-label">{tile.traits?.['bifurcated'] !== undefined ? 'ARCH. LINK 1' : 'ARCH. LINK'}</div>
                      <input
                        className="admin-text-input"
                        value={localEdits.link !== undefined ? String(localEdits.link) : (tile.link ?? '')}
                        onChange={e => setLocalEdits(p => ({ ...p, link: e.target.value }))}
                        placeholder="https://…"
                      />
                    </div>

                    {tile.traits?.['bifurcated'] !== undefined && (
                      <div className="admin-detail-row">
                        <div className="admin-detail-label">ARCH. LINK 2</div>
                        <input
                          className="admin-text-input"
                          value={localEdits.link2 !== undefined ? String(localEdits.link2) : (tile.link2 ?? '')}
                          onChange={e => setLocalEdits(p => ({ ...p, link2: e.target.value }))}
                          placeholder="https://…"
                        />
                      </div>
                    )}

                    {typeKey !== 'boss' && (
                      <div className="admin-detail-row" style={{ justifyContent: 'flex-end', gap: '0.5rem', alignItems: 'center' }}>
                        {tile.adminOverride && (
                          <span style={{ fontFamily: "'Cinzel', serif", fontSize: '0.5rem', color: 'oklch(65% 0.14 25)', letterSpacing: '0.08em' }}>
                            ⚠ STATS OVERRIDDEN
                          </span>
                        )}
                        <button
                          className="admin-btn secondary"
                          style={{ fontSize: '0.52rem', padding: '0.18rem 0.6rem' }}
                          onClick={handleRegenStats}
                          title="Reset stats to seeded defaults, clearing any manual overrides"
                        >
                          ↺ Regen Stats
                        </button>
                      </div>
                    )}
                  </>
                )}

                <div className="admin-detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem' }}>
                  <div className="admin-detail-label">DETAILS</div>
                  <textarea
                    className="admin-textarea"
                    value={localEdits.details !== undefined ? String(localEdits.details) : (tile.details ?? '')}
                    onChange={e => setLocalEdits(p => ({ ...p, details: e.target.value }))}
                  />
                </div>

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

                {!isTown && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <div
                      className="admin-traits-header"
                      onClick={() => setTraitsCollapsed(c => !c)}
                    >
                      <span className="admin-detail-label" style={{ cursor: 'pointer' }}>TRAITS</span>
                      <span className="admin-traits-chevron">{traitsCollapsed ? '▶' : '▼'}</span>
                    </div>
                    {traitsCollapsed ? (
                      <div className="admin-traits-summary">
                        {Object.keys(tile.traits ?? {}).length === 0
                          ? <span className="admin-traits-summary-empty">None</span>
                          : TILE_TRAITS
                              .filter(def => tile.traits?.[def.id] !== undefined)
                              .map(def => <span key={def.id} className="admin-traits-summary-tag">{def.name}</span>)
                        }
                      </div>
                    ) : (
                      <div className="admin-traits-list">
                        {TILE_TRAITS.map(def => {
                          const active     = tile.traits?.[def.id];
                          const isEnabled  = active !== undefined;
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
                    )}
                  </div>
                )}

                {/* Adventurer slots */}
                {Object.values(tile.adventurers ?? {}).length > 0 && (
                  <>
                    <div className="admin-detail-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>SLOTS</div>
                    {Object.values(tile.adventurers ?? {}).map(entry => {
                      const slots = readSlots(entry.slots as any);
                      const draft = slotDrafts[entry.advId] ?? { name: '', game: '', details: '', status: 'Unstarted' as SlotStatus };
                      const save  = (next: AdvSlot[]) => adminSetAdventurerSlots(selectedCoord!, entry.advId, next);
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
                              <button className="admin-slot-del" onClick={() => save(slots.filter((_, j) => j !== i))} title="Remove slot">✕</button>
                            </div>
                          ))}
                          <div className="admin-slot-add-row">
                            <input className="admin-text-input" placeholder="Slot name" value={draft.name}
                              onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, name: e.target.value } }))} />
                            <input className="admin-text-input" placeholder="Game" value={draft.game}
                              onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, game: e.target.value } }))} />
                            <input className="admin-text-input" placeholder="Details (optional)" value={draft.details}
                              onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, details: e.target.value } }))} />
                            <select className="admin-slot-status-select" value={draft.status}
                              onChange={e => setSlotDrafts(p => ({ ...p, [entry.advId]: { ...draft, status: e.target.value as SlotStatus } }))}>
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
                  const pubSlots    = readSlots(tile.publicSlots as any);
                  const isBifurcated = tile.traits?.['bifurcated'] !== undefined;
                  const savePub     = (next: AdvSlot[]) => adminSetPublicSlots(selectedCoord!, next);
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
                            {isBifurcated && (
                              <select
                                className="admin-slot-status-select"
                                value={s.room ?? ''}
                                onChange={e => {
                                  const val = e.target.value;
                                  savePub(pubSlots.map((slot, j) => j === i
                                    ? { ...slot, room: val === '1' ? 1 : val === '2' ? 2 : undefined }
                                    : slot));
                                }}
                              >
                                <option value="">— Room —</option>
                                <option value="1">Room 1</option>
                                <option value="2">Room 2</option>
                              </select>
                            )}
                            <button className="admin-slot-del" onClick={() => savePub(pubSlots.filter((_, j) => j !== i))} title="Remove slot">✕</button>
                          </div>
                        ))}
                        <div className="admin-slot-add-row">
                          <input className="admin-text-input" placeholder="Slot name" value={publicDraft.name}
                            onChange={e => setPublicDraft(p => ({ ...p, name: e.target.value }))} />
                          <input className="admin-text-input" placeholder="Game" value={publicDraft.game}
                            onChange={e => setPublicDraft(p => ({ ...p, game: e.target.value }))} />
                          <input className="admin-text-input" placeholder="Details (optional)" value={publicDraft.details}
                            onChange={e => setPublicDraft(p => ({ ...p, details: e.target.value }))} />
                          <select className="admin-slot-status-select" value={publicDraft.status}
                            onChange={e => setPublicDraft(p => ({ ...p, status: e.target.value as SlotStatus }))}>
                            {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                          </select>
                          {isBifurcated && (
                            <select
                              className="admin-slot-status-select"
                              value={publicDraft.room ?? ''}
                              onChange={e => {
                                const val = e.target.value;
                                setPublicDraft(p => ({ ...p, room: val === '1' ? 1 : val === '2' ? 2 : undefined }));
                              }}
                            >
                              <option value="">— Room —</option>
                              <option value="1">Room 1</option>
                              <option value="2">Room 2</option>
                            </select>
                          )}
                          <button
                            className="admin-slot-add-btn"
                            disabled={!publicDraft.name.trim() || !publicDraft.game.trim()}
                            onClick={() => {
                              const newSlot: AdvSlot = { name: publicDraft.name.trim(), game: publicDraft.game.trim(), status: publicDraft.status };
                              if (publicDraft.details.trim()) newSlot.details = publicDraft.details.trim();
                              if (publicDraft.room)           newSlot.room    = publicDraft.room;
                              savePub([...pubSlots, newSlot]);
                              setPublicDraft({ name: '', game: '', details: '', status: 'Unstarted', room: undefined });
                            }}
                          >+ Add</button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
