import type { Tile } from '../../types';

interface Props {
  coord: string;
  tile: Tile;
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

/**
 * The S2 start tile. It is auto-complete from generation and never a challenge —
 * no adventurers, no slots, no rewards. Ornamental for now; the Castle's own
 * content is a later design, and the guild facilities it used to imply live in
 * the district ward instead.
 */
export default function CastlePanel({ coord, tile, open, onClose, isAdmin }: Props) {
  return (
    <div className={`lightbox-overlay ${open ? 'open' : ''}`}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lightbox">
        <button className="lightbox-close" onClick={onClose}>✕</button>
        {isAdmin && (
          <a className="lb-admin-link" href={`/?coord=${coord}#admin`} target="_blank" rel="noreferrer" title="Open in Map Editor">🗺</a>
        )}
        <div className="lb-coord">Grid Position: {coord}</div>
        <div className="lb-icon">🏰</div>
        <div className="lb-title castle">{tile.name || 'The Castle'}</div>
        <div className="lb-subtitle">{coord} · Starting Hold</div>
        <div className="lb-divider" />

        <div className="lb-placeholder">
          <div className="lb-placeholder-tag">Ornamental for now</div>
          <p className="lb-placeholder-body">
            The realm&rsquo;s seat and your starting hold — every early claim flows
            outward from here. Its halls expand in a future update.
          </p>
        </div>

        {tile.details && <div className="lb-details">{tile.details}</div>}
      </div>
    </div>
  );
}
