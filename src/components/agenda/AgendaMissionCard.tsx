import { MISSION_DEFS } from '../../lib/constants';
import type { AgendaMissionData, AgendaSlot } from './agendaHelpers';

const STATUS_CLASS: Record<string, string> = {
  'Unstarted':   'ss-Unstarted',
  'In-Progress': 'ss-InProgress',
  '100%':        'ss-100pct',
  'Goaled':      'ss-Goaled',
  'Done':        'ss-Done',
};

function MissionSlotRow({ slot }: { slot: AgendaSlot }) {
  return (
    <div className="ag-mc-slot-row">
      <span className="ag-slot-name">{slot.name}</span>
      <span className="ag-slot-sep">&mdash;</span>
      {slot.hasGame ? (
        <>
          <span className="ag-slot-game" title={slot.game}>{slot.game}</span>
          <span className={`ag-slot-status ${STATUS_CLASS[slot.status] ?? 'ss-Unstarted'}`}>
            {slot.status}
          </span>
        </>
      ) : (
        <span className="ag-slot-game" style={{ color: 'oklch(54% 0.04 75)' }}>
          Not yet assigned
        </span>
      )}
    </div>
  );
}

interface Props {
  mission: AgendaMissionData;
  onClose: () => void;
}

export default function AgendaMissionCard({ mission, onClose }: Props) {
  const potLabel = mission.variableReward
    ? '? pot'
    : mission.pot !== null
      ? `${mission.pot.toLocaleString()} pot`
      : null;

  return (
    <div className="ag-mc-overlay" onClick={onClose}>
      <div className="ag-mc-card" onClick={e => e.stopPropagation()}>
        <button className="ag-mc-close" onClick={onClose}>✕</button>

        <div className="ag-mc-kicker">GUILDMASTER MISSION</div>
        <div className="ag-mc-emoji">{MISSION_DEFS[mission.type]?.icon ?? '🎰'}</div>
        <div style={{ marginBottom: '0.5rem' }}>
          <span className="ag-mission-badge">{mission.typeLabel}</span>
        </div>
        <div className="ag-mc-title">{mission.label}</div>
        <div className="ag-mc-roster">{mission.roster}</div>

        <div className="ag-mc-rule" />

        {mission.slots.length > 0 ? (
          <>
            <div className="ag-mc-slots-label">YOUR SLOTS</div>
            <div style={{ marginBottom: '0.8rem' }}>
              {mission.slots.map((slot, i) => (
                <MissionSlotRow key={i} slot={slot} />
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: '0.78rem', color: 'oklch(62% 0.06 75)', marginBottom: '0.8rem', textAlign: 'left' }}>
            Slots not yet assigned.
          </div>
        )}

        {mission.link && (
          <a href={mission.link} target="_blank" rel="noreferrer" className="ag-archi-link" style={{ justifyContent: 'center' }}>
            ↗ OPEN ARCHIPELAGO
          </a>
        )}

        <div className="ag-mc-footer">
          <span style={{ color: 'oklch(78% 0.14 75)' }}>
            ⭐ {mission.variableReward ? '50+' : mission.xp} XP
          </span>
          <span style={{ color: 'oklch(74% 0.16 60)' }}>
            🪙 {mission.variableReward ? '?' : mission.gp.toLocaleString()} GP
          </span>
          {potLabel && (
            <span style={{ color: 'oklch(72% 0.14 285)' }}>
              🎲 {potLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
