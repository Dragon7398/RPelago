import Tile from './Tile';
import { activeBoard, coordFromRC } from '../lib/board';

interface Props {
  onTileClick: (coord: string) => void;
}

export default function MapGrid({ onTileClick }: Props) {
  // Read at render time, never at module scope — the board changes when the
  // season resolves, and this component is in the main bundle.
  const { rows: ROWS, cols: COLS, colChars: COL_CHARS } = activeBoard();
  return (
    <div className="map-frame">
      <div className="col-labels">
        {Array.from({ length: COLS }, (_, c) => (
          <div key={c} className="col-label">{COL_CHARS[c]}</div>
        ))}
      </div>
      <div className="grid-wrapper">
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="grid-row">
            <div className="row-label">{r + 1}</div>
            {Array.from({ length: COLS }, (_, c) => {
              const coord = coordFromRC(r, c);
              return (
                <Tile
                  key={coord}
                  coord={coord}
                  rowIndex={r}
                  colIndex={c}
                  onClick={onTileClick}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
