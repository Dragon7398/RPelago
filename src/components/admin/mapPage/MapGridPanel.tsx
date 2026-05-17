import { TILE_TYPES, COLS, ROWS, COL_CHARS, coordFromRC, TILE_TRAITS } from '../../../lib/constants';
import { getTypeKey, typeKeyForCoord } from '../../../lib/tileGen';
import type { GameState } from '../../../types';

interface Props {
  gameState: GameState;
  selectedCoord: string | null;
  onSelectCoord: (coord: string) => void;
}

// Column-major order: A1–A5, B1–B5, …
const allCoords: string[] = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    allCoords.push(coordFromRC(r, c));
  }
}

function tileComplete(coord: string, gs: GameState): boolean {
  const t = gs.tiles[coord];
  if (!t) return false;
  const typeKey = typeKeyForCoord(coord);
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
      return Object.keys(t.traits ?? {}).length > 0 && (!!t.rules?.trim() || Object.keys(t.traits ?? {}).length > 2);
    case 'boss':
      return !!t.details?.trim() && !!t.rules?.trim();
    default:
      return false;
  }
}

export default function MapGridPanel({ gameState, selectedCoord, onSelectCoord }: Props) {
  const traitCoverage = TILE_TRAITS.map(def => {
    let battle = 0, puzzle = 0, elite = 0;
    for (const coord of allCoords) {
      if (!gameState.tiles[coord]?.traits?.[def.id]) continue;
      const typeKey = typeKeyForCoord(coord);
      if (typeKey === 'battle') battle++;
      else if (typeKey === 'puzzle') puzzle++;
      else if (typeKey === 'elite') elite++;
    }
    return { def, battle, puzzle, elite };
  });

  return (
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
              const coord      = coordFromRC(r, c);
              const t          = gameState.tiles[coord];
              const typeKey    = getTypeKey(r, c);
              const info       = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
              const state      = t?.state ?? 'hidden';
              const isSelected = coord === selectedCoord;
              return (
                <div
                  key={coord}
                  className={`admin-tile s-${state}${isSelected ? ' selected' : ''}`}
                  style={isSelected ? { outline: '2px solid var(--gold)' } : {}}
                  onClick={() => onSelectCoord(coord)}
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

      <div className="map-checklist">
        <div className="map-checklist-title">TILE CHECKLIST</div>
        {allCoords.map(coord => {
          const typeKey = typeKeyForCoord(coord);
          const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
          const t       = gameState.tiles[coord];
          const done    = tileComplete(coord, gameState);
          return (
            <div
              key={coord}
              className={`map-checklist-row${done ? ' done' : ''}${coord === selectedCoord ? ' selected' : ''}`}
              onClick={() => onSelectCoord(coord)}
            >
              <span className="map-checklist-coord">{coord}</span>
              <span className="map-checklist-icon">{info.icon}</span>
              <span className="map-checklist-name">{t?.name || <em className="map-checklist-unnamed">unnamed</em>}</span>
              {done && <span className="map-checklist-check">✓</span>}
            </div>
          );
        })}
      </div>

      <div className="map-checklist">
        <div className="map-checklist-title">TRAIT COVERAGE</div>
        {traitCoverage.map(({ def, battle, puzzle, elite }) => (
          <div key={def.id} className={`map-checklist-row trait-coverage-row${battle + puzzle + elite === 0 ? '' : ' done'}`}>
            <span className="map-checklist-name trait-coverage-name">{def.name}</span>
            <span className="trait-coverage-counts">
              <span className="trait-coverage-count">{TILE_TYPES.battle.icon} {battle}</span>
              <span className="trait-coverage-count">{TILE_TYPES.puzzle.icon} {puzzle}</span>
              <span className="trait-coverage-count">{TILE_TYPES.elite.icon} {elite}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
