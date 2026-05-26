import { useState, useEffect, useRef } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { ALL_ORBS } from '../lib/constants';
import type { OrbAcquisition } from '../types';

function acquisitionLabel(acq: OrbAcquisition): string {
  if (acq.method === 'shop') {
    const place = acq.tileName || acq.tileCoord;
    return acq.buyerName ? `${place} · ${acq.buyerName}` : place;
  }
  if (acq.method === 'admin') return 'Admin grant';
  return acq.tileName || acq.tileCoord;
}

function acquisitionTitle(acq: OrbAcquisition): string {
  if (acq.method === 'shop') {
    const place = acq.tileName || acq.tileCoord;
    return acq.buyerName
      ? `Purchased at ${place} by ${acq.buyerName}`
      : `Purchased at ${place}`;
  }
  if (acq.method === 'admin') return 'Granted by admin';
  const place = acq.tileName || acq.tileCoord;
  const verb  = acq.method === 'elite' ? 'Defeated' : 'Completed';
  return `${verb} at ${place}`;
}

export default function OrbBar() {
  const { gameState, loading } = useGameState();
  const orbState  = gameState?.orbState  ?? {};
  const orbConfig = gameState?.orbConfig;
  const count     = Object.keys(orbState).length;
  const minOrbs   = orbConfig?.bossMinOrbs ?? 5;

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('realm_orb_collapsed') === 'true'
  );
  const toggleCollapsed = () => {
    setCollapsed(c => {
      localStorage.setItem('realm_orb_collapsed', String(!c));
      return !c;
    });
  };

  // Flash animation: fire only for orbs newly collected during this session
  const initializedRef  = useRef(false);
  const prevOrbStateRef = useRef<Record<string, OrbAcquisition>>({});
  const [flashingOrbs, setFlashingOrbs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (loading) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevOrbStateRef.current = { ...orbState };
      return;
    }
    const newlyCollected = ALL_ORBS
      .filter(o => !prevOrbStateRef.current[o.id] && !!orbState[o.id])
      .map(o => o.id);
    prevOrbStateRef.current = { ...orbState };
    if (newlyCollected.length > 0) {
      setFlashingOrbs(new Set(newlyCollected));
      const t = setTimeout(() => setFlashingOrbs(new Set()), 600);
      return () => clearTimeout(t);
    }
  }, [orbState, loading]);

  return (
    <div className={`orb-bar${collapsed ? ' orb-bar-collapsed' : ''}`}>
      <div className="orb-bar-title" onClick={toggleCollapsed}>
        <span>SIGIL ORBS</span>
        <span className="orb-bar-title-right">
          {collapsed && <span className="orb-bar-count">{count} / {ALL_ORBS.length}</span>}
          <span className="orb-bar-chevron">{collapsed ? '▸' : '▾'}</span>
        </span>
      </div>
      {!collapsed && (
        <>
          <div className="orb-bar-orbs">
            {ALL_ORBS.map(orb => {
              const acq      = orbState[orb.id];
              const collected = !!acq;
              const flashing  = flashingOrbs.has(orb.id);
              const bgColor = collected
                ? orb.color.replace('oklch(', 'oklch(').replace(')', ' / 0.18)')
                : 'transparent';
              return (
                <div
                  key={orb.id}
                  className="orb-pip"
                  title={collected ? acquisitionTitle(acq) : `${orb.label} Orb — not yet gathered`}
                >
                  <div
                    className={`orb-gem ${collected ? 'collected' : 'missing'}${flashing ? ' just-collected' : ''}`}
                    style={{ borderColor: orb.color, color: orb.color, background: bgColor }}
                  >
                    {orb.icon}
                  </div>
                  <div className="orb-label">{orb.label.toUpperCase()}</div>
                  {collected && (
                    <div className="orb-source">{acquisitionLabel(acq)}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="orb-count-badge">
            <strong>{count}</strong> / 9 orbs
          </div>
          <div className="orb-count-badge">
            {count >= minOrbs
              ? <span style={{ color: 'oklch(60% 0.16 145)' }}>Boss unlocked</span>
              : <span style={{ color: 'oklch(55% 0.14 25)' }}>{minOrbs - count} more to unlock boss</span>
            }
          </div>
        </>
      )}
    </div>
  );
}
