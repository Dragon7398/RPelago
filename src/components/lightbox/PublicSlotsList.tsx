import type { AdvSlot } from '../../types';

export default function PublicSlotsList({ slots }: { slots: AdvSlot[] }) {
  if (slots.length === 0) return null;
  return (
    <div className="lb-public-slots">
      <div className="lb-public-slots-header">PUBLIC SLOTS</div>
      {slots.map((s, i) => (
        <div key={i} className="lb-slot-row">
          <span className="lb-slot-name">{s.name}</span>
          <span className="lb-slot-sep">—</span>
          <span className="lb-slot-game">{s.game}</span>
          {s.details && <span className="lb-slot-details">{s.details}</span>}
          {s.status && <span className={`lb-slot-status ss-${s.status.replace('%', 'pct').replace('-', '')}`}>{s.status}</span>}
        </div>
      ))}
    </div>
  );
}
