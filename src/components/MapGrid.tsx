import Tile from './Tile';
import { COLS, ROWS, COL_CHARS, coordFromRC } from '../lib/constants';

interface Props {
  onTileClick: (coord: string) => void;
}

export default function MapGrid({ onTileClick }: Props) {
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
