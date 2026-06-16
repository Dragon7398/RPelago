import type { AgendaAdv, AgendaTile, AgendaSlot } from './agendaHelpers';
import type { TileTypeKey } from '../../types';
import { ADV_ICONS } from '../../lib/constants';

const TILE_TYPE_META: Record<TileTypeKey, { icon: string; label: string; cssKey: string }> = {
  town_center: { icon: '🏰', label: 'TOWN',   cssKey: 'town'   },
  town:        { icon: '🏰', label: 'TOWN',   cssKey: 'town'   },
  battle:      { icon: '⚔️',  label: 'BATTLE', cssKey: 'battle' },
  puzzle:      { icon: '🧩', label: 'PUZZLE', cssKey: 'puzzle' },
  elite:       { icon: '💀', label: 'ELITE',  cssKey: 'elite'  },
  boss:        { icon: '🐉', label: 'BOSS',   cssKey: 'boss'   },
};

// Maps SlotStatus strings to CSS class suffixes matching the existing ss-* palette
const STATUS_CLASS: Record<string, string> = {
  'Unstarted':   'ss-Unstarted',
  'In-Progress': 'ss-InProgress',
  '100%':        'ss-100pct',
  'Goaled':      'ss-Goaled',
  'Done':        'ss-Done',
};

function SlotRow({ slot }: { slot: AgendaSlot }) {
  if (!slot.hasGame) {
    return (
      <div className="ag-slot-no-game">
        <span className="ag-slot-name">{slot.name}</span>
        <span className="ag-slot-sep">&mdash;</span>
        <a
          href="https://archipelago.gg/games"
          target="_blank"
          rel="noreferrer"
          className="ag-slot-yaml-link"
        >
          Create a YAML to begin
        </a>
      </div>
    );
  }
  return (
    <div className="ag-slot-row">
      <span className="ag-slot-name">{slot.name}</span>
      <span className="ag-slot-sep">&mdash;</span>
      <span className="ag-slot-game" title={slot.game}>{slot.game}</span>
      <span className={`ag-slot-status ${STATUS_CLASS[slot.status] ?? 'ss-Unstarted'}`}>
        {slot.status}
      </span>
    </div>
  );
}

function TileRow({ tile, onTileClick }: { tile: AgendaTile; onTileClick: (coord: string) => void }) {
  const meta = TILE_TYPE_META[tile.typeKey] ?? TILE_TYPE_META.battle;

  return (
    <div className="ag-tile-row">
      <div className="ag-tile-header">
        <span className="ag-tile-type-icon">{meta.icon}</span>
        <span className={`ag-tile-name ag-tile-name-${meta.cssKey}`}>{tile.name}</span>
        <span className={`ag-tile-badge ag-tile-badge-${meta.cssKey}`}>
          {meta.label}
        </span>
        {tile.roomLabel && (
          <span className="ag-tile-room-badge">{tile.roomLabel}</span>
        )}
        <button className="ag-coord-chip" onClick={() => onTileClick(tile.coord)}>
          [{tile.coord}]
        </button>
      </div>

      {tile.freedEarly && (
        <div className="ag-freed-note">
          <span>⚠</span>
          <span>Freed early &mdash; obligations remain</span>
        </div>
      )}

      {tile.traits.length > 0 && (
        <div className="ag-trait-list">
          {tile.traits.map(t => (
            <span key={t} className="ag-trait-chip">{t}</span>
          ))}
        </div>
      )}

      {tile.slots.length > 0 && (
        <div className="ag-slot-list">
          {tile.slots.map((slot, i) => <SlotRow key={i} slot={slot} />)}
        </div>
      )}

      {tile.link && (
        <a href={tile.link} target="_blank" rel="noreferrer" className="ag-archi-link">
          ↗ ARCHIPELAGO
        </a>
      )}
    </div>
  );
}

interface Props {
  adv: AgendaAdv;
  onTileClick: (coord: string) => void;
}

export default function AgendaAdvGroup({ adv, onTileClick }: Props) {
  const icon = ADV_ICONS[adv.cls];
  const tileCountLabel = adv.tiles.length === 1 ? '1 TILE' : `${adv.tiles.length} TILES`;

  return (
    <div className="ag-adv-group">
      <div className="ag-adv-header">
        <div className="ag-adv-icon">{icon}</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.18 }}>
          <span className="ag-adv-name">{adv.name}</span>
          <span className="ag-adv-cls">{adv.cls}</span>
        </div>
        <span className="ag-adv-tile-count">{tileCountLabel}</span>
      </div>
      {adv.tiles.map(tile => (
        <TileRow key={tile.coord} tile={tile} onTileClick={onTileClick} />
      ))}
    </div>
  );
}
