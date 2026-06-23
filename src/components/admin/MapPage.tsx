import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import { TILE_TYPES, SHOP_ITEMS, ALL_ORBS } from '../../lib/constants';
import { typeKeyForCoord } from '../../lib/tileGen';
import { hasUnfinishedTileSlots } from '../../lib/missionLogic';
import type { TileState, TriState, SlotStatus } from '../../types';
import { setTileTracker, setTileTracker2, setTileCheese, setTileCheese2, fetchCheesetrackerId, fetchCheeseDetails, adminUpdateAdvSlotStatus, adminUpdatePublicSlotStatus, freeAdventurer } from '../../firebase/db';
import { fetchRoomStatus, extractApSlotName } from '../../lib/archipelagoApi';
import MapGridPanel        from './mapPage/MapGridPanel';
import TraitEditor         from './mapPage/TraitEditor';
import AdvSlotEditor       from './mapPage/AdvSlotEditor';
import PublicSlotEditor    from './mapPage/PublicSlotEditor';
import ClaimableBonusEditor from './mapPage/ClaimableBonusEditor';

const STATE_BUTTONS: { state: TileState; label: string; cls: string }[] = [
  { state: 'hidden',     label: 'Hidden',      cls: 'btn-hidden'     },
  { state: 'available',  label: 'Available',   cls: 'btn-available'  },
  { state: 'inprogress', label: 'In Progress', cls: 'btn-inprogress' },
  { state: 'complete',   label: 'Complete',    cls: 'btn-complete'   },
];

export default function MapPage({ initialCoord }: { initialCoord?: string }) {
  const {
    gameState,
    adminSetTileState, adminUpdateTile, adminCompleteTile, adminRegenTileStats,
  } = useGameState();
  const { addToast } = useToast();
  const [selectedCoord, setSelectedCoord] = useState<string | null>(initialCoord ?? null);
  const [localEdits, setLocalEdits] = useState<Record<string, string | number>>({});
  const [unfinishedSlotWarn, setUnfinishedSlotWarn] = useState<number | null>(null);
  const [syncing1, setSyncing1] = useState(false);
  const [syncing2, setSyncing2] = useState(false);
  const [unassigned1, setUnassigned1] = useState<{ name: string; game: string }[]>([]);
  const [unassigned2, setUnassigned2] = useState<{ name: string; game: string }[]>([]);

  if (!gameState) return null;
  const gs = gameState;

  const tile = selectedCoord ? gs.tiles[selectedCoord] : null;

  const selectCoord = (coord: string) => { setSelectedCoord(coord); setLocalEdits({}); setUnassigned1([]); setUnassigned2([]); };

  const doCompleteTile = async () => {
    if (!selectedCoord || !tile) return;
    try {
      await adminCompleteTile(selectedCoord);
      setUnfinishedSlotWarn(null);
    } catch {
      addToast('Failed to complete tile. Please try again.', 'error');
    }
  };

  const handleStateBtn = async (state: TileState) => {
    if (!selectedCoord || !tile) return;
    if (state === 'complete') {
      if (tile.state === 'complete') return;
      // Gating: soft warn if any adventurer has unfinished slots
      const advList = Object.values(tile.adventurers ?? {});
      const unfinished = hasUnfinishedTileSlots(advList);
      if (unfinished > 0) {
        setUnfinishedSlotWarn(unfinished);
        return;
      }
      await doCompleteTile();
    } else {
      try {
        await adminSetTileState(selectedCoord, state);
      } catch {
        addToast('Failed to update tile state. Please try again.', 'error');
      }
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

  const handleSync = async (room: 1 | 2) => {
    if (!selectedCoord || !tile) return;
    const isBifurcated = tile.traits?.['bifurcated'] !== undefined;
    const roomLink = room === 1 ? tile.link : tile.link2;
    if (!roomLink) return;
    const setSyncing = room === 1 ? setSyncing1 : setSyncing2;
    const roomAdvs = isBifurcated
      ? Object.values(tile.adventurers ?? {}).filter(a => (a.room ?? 1) === room)
      : Object.values(tile.adventurers ?? {});
    setSyncing(true);
    try {
      const status = await fetchRoomStatus(roomLink);
      if (status.tracker) {
        await (room === 1 ? setTileTracker(selectedCoord, status.tracker) : setTileTracker2(selectedCoord, status.tracker));
        try {
          const cheeseId = await fetchCheesetrackerId(status.tracker);
          await (room === 1 ? setTileCheese(selectedCoord, cheeseId) : setTileCheese2(selectedCoord, cheeseId));
          try {
            const games = await fetchCheeseDetails(cheeseId);
            const statusMap = new Map<string, SlotStatus>();
            for (const g of games) {
              const isGoal = g.tracker_status === 'goal_completed';
              const is100  = g.checks_total > 0 && g.checks_done === g.checks_total;
              const isInProgress = !isGoal && g.checks_done > 0 && g.checks_done < g.checks_total;
              const s = isGoal && is100 ? 'Done' as const : isGoal ? 'Goaled' as const : is100 ? '100%' as const : isInProgress ? 'In-Progress' as const : null;
              if (s) statusMap.set(extractApSlotName(g.name), s);
            }
            for (const adv of roomAdvs) {
              const slots = adv.slots ?? [];
              for (let i = 0; i < slots.length; i++) {
                const newStatus = statusMap.get(slots[i].name);
                if (newStatus) await adminUpdateAdvSlotStatus(selectedCoord, adv.advId, i, newStatus);
              }
              if (
                slots.length > 0 &&
                slots.every(s => {
                  const resolved = statusMap.get(s.name) ?? s.status;
                  return resolved === 'Done' || resolved === '100%' || resolved === 'Goaled';
                }) &&
                gs.players[adv.owner]?.adventurers?.[adv.advId]?.busyTile === selectedCoord
              ) await freeAdventurer(adv.owner, adv.advId);
            }
            const allPubSlots = tile.publicSlots ?? [];
            for (let i = 0; i < allPubSlots.length; i++) {
              const ps = allPubSlots[i];
              if (isBifurcated && ps.room && ps.room !== room) continue;
              const newStatus = statusMap.get(ps.name);
              if (newStatus) await adminUpdatePublicSlotStatus(selectedCoord, i, newStatus);
            }
            const assignedNames = new Set(roomAdvs.flatMap(a => (a.slots ?? []).map(s => s.name)));
            const unassigned = games
              .filter(g => !assignedNames.has(extractApSlotName(g.name)))
              .map(g => ({ name: extractApSlotName(g.name), game: g.game }));
            if (room === 1) setUnassigned1(unassigned);
            else setUnassigned2(unassigned);
          } catch { /* cheese details best-effort */ }
        } catch { /* cheese id best-effort */ }
      }
    } catch (err) {
      console.error('AP sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">Map Control</h2>
      <div className="map-page-layout">

        <MapGridPanel
          gameState={gs}
          selectedCoord={selectedCoord}
          onSelectCoord={selectCoord}
        />

        <div className="admin-detail map-page-detail">
          {!selectedCoord || !tile ? (
            <div className="admin-detail-empty">Select a tile to edit it.</div>
          ) : (() => {
            const typeKey  = typeKeyForCoord(selectedCoord);
            const isTown   = typeKey === 'town' || typeKey === 'town_center';
            const shop     = isTown && tile.shopId ? (gs.shops?.[tile.shopId] ?? null) : null;
            const orbDef   = shop?.orbId ? ALL_ORBS.find(o => o.id === shop.orbId) : null;

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
                  {unfinishedSlotWarn !== null && (
                    <div className="admin-complete-warn">
                      <span>{unfinishedSlotWarn} adventurer(s) have unfinished slots. Complete anyway?</span>
                      <button className="dash-action-btn danger" onClick={doCompleteTile}>Yes, Complete</button>
                      <button className="dash-action-btn" onClick={() => setUnfinishedSlotWarn(null)}>Cancel</button>
                    </div>
                  )}
                  { /*
                  {tile.state === 'complete' && Object.keys(tile.adventurers ?? {}).length > 0 && (
                    <button
                      className="dash-action-btn"
                      style={{ marginTop: '0.3rem', fontSize: '0.6rem' }}
                      onClick={handleBackfill}
                      disabled={backfilling}
                      title="Write CompletedChallenge history entries for this tile's players (use for tiles that completed before history tracking was added)"
                    >
                      {backfilling ? '…' : '↺ Backfill History'}
                    </button>
                  )} */}
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
                  <div className="admin-detail-row admin-town-shop-info">
                    <div className="admin-detail-label">SHOP</div>
                    {shop ? (
                      <div className="admin-town-shop">
                        <div className="admin-town-shop-name">🛒 {shop.name}</div>
                        {orbDef && <div className="admin-town-shop-orb">{orbDef.icon} {orbDef.label} Orb</div>}
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
                      {tile.state === 'inprogress' && tile.link && (
                        <button className="dash-copy-room-btn ap-sync-btn" onClick={() => handleSync(1)} disabled={syncing1}>
                          {syncing1 ? '…' : 'Sync'}
                        </button>
                      )}
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
                        {tile.state === 'inprogress' && tile.link2 && (
                          <button className="dash-copy-room-btn ap-sync-btn" onClick={() => handleSync(2)} disabled={syncing2}>
                            {syncing2 ? '…' : 'Sync'}
                          </button>
                        )}
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

                {!isTown && <TraitEditor key={selectedCoord} tile={tile} selectedCoord={selectedCoord} />}

                <AdvSlotEditor
                  key={`adv-${selectedCoord}`}
                  tile={tile}
                  selectedCoord={selectedCoord}
                  unassigned1={unassigned1}
                  unassigned2={unassigned2}
                  onConsumeUnassigned={(room, name) => {
                    const setter = room === 1 ? setUnassigned1 : setUnassigned2;
                    setter(prev => prev.filter(s => s.name !== name));
                  }}
                />
                <PublicSlotEditor    key={`pub-${selectedCoord}`}      tile={tile} selectedCoord={selectedCoord} />
                <ClaimableBonusEditor key={`claim-${selectedCoord}`}   tile={tile} selectedCoord={selectedCoord} />
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
