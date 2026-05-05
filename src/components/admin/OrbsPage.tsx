import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { ALL_ORBS, rcFromCoord } from '../../lib/constants';
import { getTypeKey, orbIdForElite, orbIdForEdgeTile } from '../../lib/tileGen';
import type { OrbConfig } from '../../types';

const ORB_EFFECTS: Record<string, string> = {
  wood:  'Enables Boss Release (required to release completed slots)',
  soul:  'Enables Boss Collect (required to collect completed slots)',
  light: 'Reduces Boss Hint cost by 10',
  dark:  'Reduces Boss Hint cost by 10',
};

export default function OrbsPage() {
  const { gameState, adminGrantOrb, adminUpdateOrbConfig, adminResetOrbs } = useGameState();
  const [curseEdits, setCurseEdits] = useState<Record<string, string>>({});

  if (!gameState) return null;

  const orbConfig = gameState.orbConfig;

  function handleOrbConfigUpdate(updates: Partial<OrbConfig>) {
    adminUpdateOrbConfig(updates);
  }

  // Build assignment map
  const assignments: Record<string, string[]> = {};
  ALL_ORBS.forEach(o => { assignments[o.id] = []; });
  for (const coord of Object.keys(gameState.tiles)) {
    const [r, c]  = rcFromCoord(coord);
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

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">⚗ Orbs</h2>

      {/* Orb Locations */}
      <section className="dash-section">
        <h3 className="dash-section-title">Orb Locations</h3>
        {ALL_ORBS.map(orb => {
          const locs   = assignments[orb.id] ?? [];
          const isDupe = locs.length > 1;
          const isUnset = locs.length === 0;
          const effect  = ORB_EFFECTS[orb.id];
          return (
            <div key={orb.id} className={`dash-orb-loc${isDupe ? ' dupe' : isUnset ? ' unset' : ''}`}>
              <span className="dash-orb-loc-icon">{orb.icon}</span>
              <div className="dash-orb-loc-body">
                <div className="dash-orb-loc-top">
                  <span className="dash-orb-loc-name">{orb.label}</span>
                  <span className="dash-orb-loc-where">
                    {isUnset ? '— unassigned' : locs.join('  ·  ')}
                  </span>
                  {isDupe && (
                    <span className="dash-orb-loc-warn" title="Assigned to multiple slots">⚠</span>
                  )}
                  {gameState.orbState?.[orb.id] && (
                    <span className="dash-orb-collected" title="Collected">✓</span>
                  )}
                </div>
                {effect && <div className="dash-orb-effect">{effect}</div>}
              </div>
            </div>
          );
        })}
      </section>

      {/* Grant Orb */}
      <section className="dash-section">
        <h3 className="dash-section-title">Grant Orb (Admin Override)</h3>
        <div className="dash-grant-orbs">
          {ALL_ORBS.map(orb => (
            <button
              key={orb.id}
              className={`dash-grant-btn${gameState.orbState?.[orb.id] ? ' granted' : ''}`}
              onClick={() => !gameState.orbState?.[orb.id] && adminGrantOrb(orb.id)}
            >
              {orb.icon} {orb.label}
            </button>
          ))}
        </div>
      </section>

      {/* Boss Config */}
      <section className="dash-section">
        <h3 className="dash-section-title">Boss Configuration</h3>
        <div className="dash-boss-row">
          <label className="dash-boss-label">Minimum orbs required to face boss</label>
          <input
            type="number" className="dash-number-input" min={0} max={9}
            value={orbConfig?.bossMinOrbs ?? 5}
            onChange={e => handleOrbConfigUpdate({ bossMinOrbs: parseInt(e.target.value) || 0 })}
          />
        </div>
      </section>

      {/* Curse Text */}
      <section className="dash-section">
        <h3 className="dash-section-title">Boss Curse Text (shown when orb is missing)</h3>
        {ALL_ORBS.map(orb => {
          const saved   = orbConfig?.bossNegEffects?.[orb.id] ?? '';
          const current = curseEdits[orb.id] ?? saved;
          const dirty   = current !== saved;
          return (
            <div key={orb.id} className="dash-curse-row">
              <span className="dash-curse-orb">{orb.icon} {orb.label}</span>
              <input
                className="dash-curse-input"
                value={current}
                onChange={e => setCurseEdits(p => ({ ...p, [orb.id]: e.target.value }))}
                placeholder={`Curse for missing ${orb.label} Orb…`}
              />
              {dirty && (
                <button
                  className="dash-curse-save"
                  onClick={() => {
                    handleOrbConfigUpdate({
                      bossNegEffects: { ...(orbConfig?.bossNegEffects ?? {}), [orb.id]: current },
                    });
                    setCurseEdits(p => { const n = { ...p }; delete n[orb.id]; return n; });
                  }}
                >
                  ✓
                </button>
              )}
            </div>
          );
        })}
      </section>

      <div className="dash-danger">
        <button
          className="dash-danger-btn"
          onClick={() => {
            if (confirm('Reset all orbs? This cannot be undone.'))
              adminResetOrbs();
          }}
        >
          Reset Orbs
        </button>
      </div>
    </div>
  );
}
