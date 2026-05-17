import { useState } from 'react';
import { TILE_TRAITS } from '../../../lib/constants';
import type { TraitDef } from '../../../lib/constants';
import { useGameState } from '../../../contexts/GameStateContext';
import { useToast } from '../../../contexts/ToastContext';
import type { Tile } from '../../../types';

interface Props {
  tile: Tile;
  selectedCoord: string;
}

export default function TraitEditor({ tile, selectedCoord }: Props) {
  const { adminUpdateTile } = useGameState();
  const { addToast } = useToast();
  const [collapsed, setCollapsed] = useState(
    () => tile.state === 'inprogress' || tile.state === 'complete',
  );

  const handleToggle = async (def: TraitDef, enabled: boolean) => {
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

  const handleValue = async (traitId: string, value: number) => {
    const next = { ...(tile.traits ?? {}), [traitId]: { value } };
    try {
      await adminUpdateTile(selectedCoord, { traits: next });
    } catch {
      addToast('Failed to update trait value. Please try again.', 'error');
    }
  };

  return (
    <div style={{ marginTop: '0.6rem' }}>
      <div className="admin-traits-header" onClick={() => setCollapsed(c => !c)}>
        <span className="admin-detail-label" style={{ cursor: 'pointer' }}>TRAITS</span>
        <span className="admin-traits-chevron">{collapsed ? '▶' : '▼'}</span>
      </div>
      {collapsed ? (
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
                    onChange={e => handleToggle(def, e.target.checked)}
                  />
                  <span className="admin-trait-name">{def.name}</span>
                  {def.hasValue && isEnabled && (
                    <input
                      type="number"
                      className="admin-trait-value-input"
                      key={`${selectedCoord}-${def.id}-val`}
                      defaultValue={currentVal}
                      min={0}
                      onBlur={e => handleValue(def.id, parseInt(e.target.value) || def.defaultValue)}
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
  );
}
