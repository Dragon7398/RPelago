import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useGameState } from '../../contexts/GameStateContext';
import { MISSION_DEFS } from '../../lib/constants';
import { deriveAgendaData } from './agendaHelpers';
import AgendaAdvGroup from './AgendaAdvGroup';
import AgendaMissionCard from './AgendaMissionCard';
import type { AgendaSlot } from './agendaHelpers';

const STATUS_CLASS: Record<string, string> = {
  'Unstarted':   'ss-Unstarted',
  'In-Progress': 'ss-InProgress',
  '100%':        'ss-100pct',
  'Goaled':      'ss-Goaled',
  'Done':        'ss-Done',
};

function DrawerSlotRow({ slot }: { slot: AgendaSlot }) {
  return (
    <div className="ag-slot-row">
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
        <span className="ag-slot-game" style={{ color: 'oklch(54% 0.04 75)' }}>Not yet assigned</span>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onTileClick: (coord: string) => void;
}

export default function AgendaDrawer({ open, onClose, onTileClick }: Props) {
  const { user } = useAuth();
  const { gameState } = useGameState();
  const [missionCardOpen, setMissionCardOpen] = useState(false);

  const handleClose = useCallback(() => {
    setMissionCardOpen(false);
    onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  if (!open || !user || !gameState) return null;

  const data = deriveAgendaData(gameState, user.id);
  const { mission, advGroups, activeCount } = data;

  const hasMission = !!mission;
  const hasAdvs = advGroups.length > 0;
  const fullEmpty = !hasMission && !hasAdvs;

  return (
    <div className="ag-scrim" onClick={handleClose}>
      <div className="ag-drawer" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ag-drawer-header">
          <span style={{ fontSize: '1.05rem' }}>📜</span>
          <span className="ag-drawer-title">QUEST LOG</span>
          {activeCount > 0 && (
            <span className="ag-drawer-count">&middot; {activeCount} ACTIVE</span>
          )}
          <button className="ag-drawer-close" onClick={handleClose}>✕</button>
        </div>

        {/* Full empty state */}
        {fullEmpty && (
          <div className="ag-empty-full">
            <div className="ag-empty-full-icon">🗺</div>
            <div className="ag-empty-full-title">No active engagements</div>
            <div className="ag-empty-full-text">
              Your adventurers wait at the guildhall. Enlist in a Guildmaster Mission,
              or send a hero to a tile, and your tasks gather here.
            </div>
            <div className="ag-empty-ctas">
              <button className="ag-cta-deploy" onClick={handleClose}>⚔ DEPLOY HERO</button>
              <button
                className="ag-cta-missions"
                onClick={() => { onTileClick('D3'); handleClose(); }}
              >
                🎰 VIEW MISSIONS
              </button>
            </div>
          </div>
        )}

        {/* Populated state */}
        {!fullEmpty && (
          <div>
            {/* Mission section */}
            {hasMission ? (
              <div className="ag-mission-pinned">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1rem' }}>{MISSION_DEFS[mission!.type]?.icon ?? '🎰'}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                    <span className="ag-mission-kicker">CURRENT MISSION</span>
                    <span className="ag-mission-label">{mission!.label}</span>
                  </div>
                  <span className="ag-mission-badge">{mission!.typeLabel}</span>
                </div>
                <div className="ag-mission-reward">{mission!.reward}</div>
                {mission!.slots.length > 0 && (
                  <div className="ag-slot-list" style={{ marginBottom: '0.5rem' }}>
                    {mission!.slots.map((slot, i) => (
                      <DrawerSlotRow key={i} slot={slot} />
                    ))}
                  </div>
                )}
                <div className="ag-mission-actions">
                  <button className="ag-mission-view-btn" onClick={() => setMissionCardOpen(true)}>
                    [ MISSION ]
                  </button>
                  {mission!.link && (
                    <a href={mission!.link} target="_blank" rel="noreferrer" className="ag-archi-link">
                      ↗ ARCHIPELAGO
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="ag-no-mission-block" style={{ marginBottom: '0.4rem' }}>
                <div className="ag-no-mission-title">NO ACTIVE MISSION</div>
                <div className="ag-no-mission-text">
                  Join a Guildmaster Mission to take on shared objectives with other players.
                </div>
              </div>
            )}

            {/* Adventurers section */}
            <div className="ag-section-divider">
              <span className="ag-section-label">ADVENTURERS</span>
              {hasAdvs && (
                <span className="ag-section-count">&middot; {advGroups.length}</span>
              )}
              <span className="ag-section-rule" />
            </div>

            {hasAdvs ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {advGroups.map(adv => (
                  <AgendaAdvGroup
                    key={adv.id}
                    adv={adv}
                    onTileClick={coord => { onTileClick(coord); handleClose(); }}
                  />
                ))}
              </div>
            ) : (
              <div className="ag-empty-block">
                <div className="ag-empty-block-icon">⚔</div>
                <div className="ag-empty-block-text">
                  No adventurers deployed. Send one to a tile on the map and its slots will appear here.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mission card overlay */}
        {missionCardOpen && mission && (
          <AgendaMissionCard mission={mission} onClose={() => setMissionCardOpen(false)} />
        )}
      </div>
    </div>
  );
}
