import { useEffect } from 'react';

interface Props {
  open:     boolean;
  title:    string;
  glyph:    string;
  subtitle?: string;
  onClose:  () => void;
  children: React.ReactNode;
}

// The shared shell for the district panels. It reuses the `lightbox-*` classes the
// tile lightboxes use, so every theme — including the four light and four
// colour-blind ones — already styles it correctly; only the width differs, via
// `district-modal`.
export default function DistrictModal({ open, title, glyph, subtitle, onClose, children }: Props) {
  // Escape closes. Bound only while open, so several mounted-but-closed panels
  // can't all race to handle one keypress.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`lightbox-overlay ${open ? 'open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="lightbox district-modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="lb-icon">{glyph}</div>
        <div className="lb-title town">{title}</div>
        {subtitle && <div className="lb-subtitle">{subtitle}</div>}
        <div className="lb-divider" />
        {children}
      </div>
    </div>
  );
}
