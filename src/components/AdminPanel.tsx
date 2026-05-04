import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { playerReset } from '../firebase/db';
import { TILE_TYPES, ALL_ORBS, COLS, ROWS, COL_CHARS, SHOP_ITEMS, coordFromRC, rcFromCoord } from '../lib/constants';
import { getTypeKey, orbIdForElite, orbIdForEdgeTile } from '../lib/tileGen';
import type { TileState, TriState, OrbConfig, AdvSlot } from '../types';

const SHOP_ORDER = ['centralia', 'frostshear', 'flamefell', 'pinereach'] as const;

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
    adminGrantOrb, adminUpdateOrbConfig, adminResetOrbs,
    adminMapReset, adminConsumeItem, adminUpdateShop, adminSetAdventurerSlots,
  } = useGameState();

  const [selectedCoord, setSelectedCoord] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, string | number>>({});
  const [curseEdits, setCurseEdits] = useState<Record<string, string>>({});
  // slotDrafts: advId → pending new-slot input values
  const [slotDrafts, setSlotDrafts] = useState<Record<string, { name: string; game: string }>>({});

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

  const handleOrbConfigUpdate = async (updates: Partial<OrbConfig>) => {
    await adminUpdateOrbConfig(updates);
  };

  const orbConfig = gameState.orbConfig;
  const players = Object.values(gameState.players ?? {});

  return (
    <>
      <div className={`admin-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`admin-panel ${open ? 'open' : ''}`}>
        <button className="admin-close" onClick={onClose}>✕</button>
        <h2>⚔ ADMIN — MAP CONTROL</h2>
        <div className="admin-subtitle">Click a tile to select it, then adjust its state and settings.</div>

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

              {Object.keys(localEdits).length > 0 && (
                <button className="admin-btn secondary" style={{ marginTop: '0.5rem' }} onClick={handleFieldSave}>
                  Save Changes
                </button>
              )}

              {/* Adventurer slot editor */}
              {Object.values(tile.adventurers ?? {}).length > 0 && (
                <>
                  <div className="admin-detail-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>SLOTS</div>
                  {Object.values(tile.adventurers ?? {}).map(entry => {
                    const slots  = readSlots(entry.slots as AdvSlot[] | Record<string, AdvSlot> | undefined);
                    const draft  = slotDrafts[entry.advId] ?? { name: '', game: '' };
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
                          <button
                            className="admin-slot-add-btn"
                            disabled={!draft.name.trim() || !draft.game.trim()}
                            onClick={() => {
                              save([...slots, { name: draft.name.trim(), game: draft.game.trim() }]);
                              setSlotDrafts(p => ({ ...p, [entry.advId]: { name: '', game: '' } }));
                            }}
                          >+ Add</button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Orb config */}
        <div className="admin-orb-section">
          <div className="admin-orb-title">⚗ ORB CONFIGURATION</div>

          {/* Orb location map */}
          <div className="admin-orb-label" style={{ marginBottom: '0.4rem' }}>Orb locations</div>
          {(() => {
            const assignments: Record<string, string[]> = {};
            ALL_ORBS.forEach(o => { assignments[o.id] = []; });

            for (const coord of Object.keys(gameState.tiles)) {
              const [r, c] = rcFromCoord(coord);
              const typeKey = getTypeKey(r, c);
              if (typeKey === 'elite') {
                const id = orbIdForElite(r, c, orbConfig);
                if (id) assignments[id]?.push(`★ Elite · ${coord}`);
              } else if (typeKey === 'battle' || typeKey === 'puzzle') {
                const id = orbIdForEdgeTile(r, c, orbConfig);
                if (id) assignments[id]?.push(`${typeKey === 'battle' ? '⚔ Battle' : '🧩 Puzzle'} · ${coord}`);
              }
            }
            for (const shop of Object.values(gameState.shops ?? {})) {
              if (shop.orbId) assignments[shop.orbId]?.push(`🛒 ${shop.name}`);
            }

            return ALL_ORBS.map(orb => {
              const locs       = assignments[orb.id] ?? [];
              const isDupe     = locs.length > 1;
              const isUnset    = locs.length === 0;
              return (
                <div key={orb.id} className={`admin-orb-loc${isDupe ? ' dupe' : isUnset ? ' unset' : ''}`}>
                  <span className="admin-orb-loc-icon">{orb.icon}</span>
                  <span className="admin-orb-loc-name">{orb.label}</span>
                  <span className="admin-orb-loc-where">
                    {isUnset ? '— unassigned' : locs.join('  ·  ')}
                  </span>
                  {isDupe && <span className="admin-orb-loc-warn" title="Assigned to multiple slots">⚠</span>}
                </div>
              );
            });
          })()}

          <div className="admin-orb-row" style={{ marginTop: '0.8rem' }}>
            <div className="admin-orb-label">Boss min orbs</div>
            <input
              type="number" className="admin-count-input" min={0} max={9}
              value={orbConfig?.bossMinOrbs ?? 5}
              onChange={e => handleOrbConfigUpdate({ bossMinOrbs: parseInt(e.target.value) || 0 })}
            />
          </div>

          <div className="admin-orb-row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
            <div className="admin-orb-label" style={{ width: '100%' }}>Grant orb (admin override)</div>
            {ALL_ORBS.map(orb => (
              <button
                key={orb.id}
                className={`admin-grant-orb-btn${gameState.orbState?.[orb.id] ? ' granted' : ''}`}
                onClick={() => !gameState.orbState?.[orb.id] && adminGrantOrb(orb.id)}
              >
                {orb.icon} {orb.label}
              </button>
            ))}
          </div>

          <div className="admin-orb-label" style={{ marginTop: '0.8rem', marginBottom: '0.4rem' }}>
            Boss curse text (shown when orb is missing)
          </div>
          {ALL_ORBS.map(orb => {
            const saved   = orbConfig?.bossNegEffects?.[orb.id] ?? '';
            const current = curseEdits[orb.id] ?? saved;
            const dirty   = current !== saved;
            return (
              <div key={orb.id} className="admin-curse-row">
                <span className="admin-curse-orb">{orb.icon} {orb.label}</span>
                <input
                  className="admin-text-input"
                  value={current}
                  onChange={e => setCurseEdits(p => ({ ...p, [orb.id]: e.target.value }))}
                  placeholder={`Curse for missing ${orb.label} Orb…`}
                />
                {dirty && (
                  <button
                    className="admin-curse-save"
                    onClick={() => {
                      handleOrbConfigUpdate({ bossNegEffects: { ...(orbConfig?.bossNegEffects ?? {}), [orb.id]: current } });
                      setCurseEdits(p => { const n = { ...p }; delete n[orb.id]; return n; });
                    }}
                  >
                    ✓
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Shop management */}
        <div className="admin-orb-section">
          <div className="admin-orb-title">🛒 SHOPS</div>
          {SHOP_ORDER.map(shopId => {
            const shop = gameState.shops?.[shopId];
            if (!shop) return null;
            return (
              <div key={shopId} className="admin-shop-row">
                <div className="admin-shop-name">{shop.name}</div>
                <div className="admin-orb-row" style={{ marginTop: '0.3rem' }}>
                  <div className="admin-orb-label">Orb for sale</div>
                  <select
                    className="admin-select"
                    value={shop.orbId ?? ''}
                    onChange={e => adminUpdateShop(shopId, { orbId: e.target.value || null })}
                  >
                    <option value="">— None —</option>
                    {ALL_ORBS.map(orb => (
                      <option key={orb.id} value={orb.id}>{orb.icon} {orb.label}</option>
                    ))}
                  </select>
                </div>
                {shop.itemIds?.length > 0 && (
                  <div className="admin-shop-items">
                    Items: {shop.itemIds.map(id => SHOP_ITEMS.find(i => i.id === id)?.name ?? id).join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Player management */}
        <div className="admin-orb-section">
          <div className="admin-orb-title">👥 PLAYERS</div>
          {players.length === 0 ? (
            <div className="admin-detail-empty">No players have joined yet.</div>
          ) : players.map(player => {
            const ownedItems = SHOP_ITEMS.filter(item => (player.inventory?.[item.id] ?? 0) > 0);
            return (
              <div key={player.id} className="admin-player-card">
                <div className="admin-player-header">
                  <div className="admin-player-name">{player.displayName}</div>
                  <div className="admin-player-stats">
                    ✨ {player.xp.toLocaleString()} XP · 🪙 {player.gold.toLocaleString()} G · {Object.keys(player.adventurers ?? {}).length} adv
                    {(player.xpHistory?.length ?? 0) > 0 && (
                      <span className="admin-player-history"> · prev: {player.xpHistory!.map(x => x.toLocaleString()).join(', ')} XP</span>
                    )}
                  </div>
                </div>
                {ownedItems.length > 0 && (
                  <div className="admin-player-inv">
                    {ownedItems.map(item => (
                      <div key={item.id} className="admin-inv-item">
                        <span className="admin-inv-item-name">{item.name}</span>
                        <span className="admin-inv-item-qty">×{player.inventory![item.id]}</span>
                        <button
                          className="admin-inv-use-btn"
                          onClick={() => adminConsumeItem(player.id, item.id)}
                        >
                          Mark Used
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="admin-player-reset-btn"
                  onClick={() => {
                    if (confirm(`Reset ${player.displayName}'s stats? This archives their XP and cannot be undone.`))
                      playerReset(player.id);
                  }}
                >
                  Player Reset
                </button>
              </div>
            );
          })}
        </div>

        {/* Danger zone */}
        <div className="admin-actions" style={{ marginTop: '1rem' }}>
          <button
            className="admin-btn danger"
            onClick={() => { if (confirm('Reset the map? Player XP, gold, and adventurers are preserved. This cannot be undone.')) adminMapReset(); }}
          >
            Map Reset
          </button>
          <button
            className="admin-btn"
            style={{ borderColor: 'oklch(40% 0.14 290)', color: 'oklch(65% 0.16 290)', background: 'oklch(14% 0.07 290 / 0.4)' }}
            onClick={() => { if (confirm('Reset all orbs?')) adminResetOrbs(); }}
          >
            Reset Orbs
          </button>
          <button className="admin-btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}
