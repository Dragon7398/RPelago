import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { calcLevel, xpForLevel, xpForNextLevel } from '../lib/gameLogic';
import { ADV_ICONS, MAX_LEVEL, SHOP_ITEMS } from '../lib/constants';
import type { AdvClass } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProfileLightbox({ open, onClose }: Props) {
  const { user } = useAuth();
  const { gameState, renameAdventurer } = useGameState();

  const player = user && gameState ? gameState.players[user.id] : null;
  const adventurers = player ? Object.values(player.adventurers) : [];
  const level  = player ? calcLevel(player.xp) : 1;
  const xpCurr = player?.xp ?? 0;
  const xpThis = xpForLevel(level);
  const xpNext = xpForNextLevel(level);
  const maxed  = level >= MAX_LEVEL;
  const xpPct  = xpNext ? Math.round(((xpCurr - xpThis) / (xpNext - xpThis)) * 100) : 100;

  // Per-adventurer rename state
  const [renames, setRenames] = useState<Record<string, { first: string; last: string }>>({});

  const getRename = (advId: string, defaultFirst: string, defaultLast: string) => {
    return renames[advId] ?? { first: defaultFirst, last: defaultLast };
  };

  const handleRenameChange = (advId: string, field: 'first' | 'last', val: string) => {
    setRenames(prev => ({
      ...prev,
      [advId]: { ...getRename(advId, '', ''), [field]: val.slice(0, 12) },
    }));
  };

  const handleRenameSave = async (advId: string, firstName: string, lastName: string) => {
    if (!user) return;
    await renameAdventurer(user.id, advId, firstName, lastName);
    setRenames(prev => {
      const next = { ...prev };
      delete next[advId];
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className={`profile-overlay ${open ? 'open' : ''}`}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="profile-box">
        <button className="profile-close" onClick={onClose}>✕</button>
        {!player ? (
          <div style={{ fontFamily: "'Crimson Pro', serif", color: 'var(--gold-dim)', fontStyle: 'italic' }}>
            No profile data found.
          </div>
        ) : (
          <>
            <div className="profile-player-name">{user!.displayName.toUpperCase()}</div>
            <div className="profile-level-line">LEVEL {level} ADVENTURER</div>

            <div className="profile-stats-grid">
              <div className="profile-stat">
                <div className="profile-stat-icon">✨</div>
                <div className="profile-stat-value">{player.xp.toLocaleString()}</div>
                <div className="profile-stat-label">TOTAL XP</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-icon">🪙</div>
                <div className="profile-stat-value">{player.gold.toLocaleString()}</div>
                <div className="profile-stat-label">GOLD</div>
              </div>
            </div>

            <div className="profile-xp-bar-wrap">
              <div className="profile-xp-bar-label">
                <span>LV {level}</span>
                {!maxed && xpNext && (
                  <span className="profile-xp-remaining">{xpNext - xpCurr} XP to LV {level + 1}</span>
                )}
                {!maxed && <span>LV {level + 1}</span>}
              </div>
              {maxed ? (
                <div className="profile-max-level">✦ Max Level Reached ✦</div>
              ) : (
                <div className="profile-xp-bar-bg">
                  <div className="profile-xp-bar-fill" style={{ width: `${xpPct}%` }} />
                </div>
              )}
            </div>

            {/* Inventory */}
            {(() => {
              const inv = player.inventory ?? {};
              const ownedItems = SHOP_ITEMS.filter(i => (inv[i.id] ?? 0) > 0);
              if (ownedItems.length === 0) return null;
              return (
                <div className="profile-adv-section">
                  <div className="profile-adv-title">INVENTORY</div>
                  {ownedItems.map(item => (
                    <div key={item.id} className="profile-inv-row">
                      <div className="profile-inv-info">
                        <div className="profile-inv-name">{item.name}</div>
                        <div className="profile-inv-desc">{item.description}</div>
                      </div>
                      <div className="profile-inv-qty">×{inv[item.id]}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div className="profile-adv-section">
              <div className="profile-adv-title">ADVENTURERS</div>
              {adventurers.map(adv => {
                const { first, last } = getRename(adv.id, adv.firstName, adv.lastName);
                return (
                  <div key={adv.id} className="lb-adv-row" style={{ marginBottom: '0.5rem' }}>
                    <span className="lb-adv-icon">{ADV_ICONS[adv.cls as AdvClass] ?? '⚔️'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--gold-dim)', fontFamily: "'Cinzel', serif", letterSpacing: '0.06em' }}>
                        {adv.cls}{adv.busy && adv.busyTile ? ` · ${adv.busyTile}` : ''}
                      </div>
                      <div className="profile-rename-row">
                        <input
                          className="profile-rename-input"
                          value={first}
                          maxLength={12}
                          placeholder="First"
                          onChange={e => handleRenameChange(adv.id, 'first', e.target.value)}
                        />
                        <input
                          className="profile-rename-input"
                          value={last}
                          maxLength={12}
                          placeholder="Last"
                          onChange={e => handleRenameChange(adv.id, 'last', e.target.value)}
                        />
                        <button
                          className="profile-rename-btn"
                          onClick={() => handleRenameSave(adv.id, first, last)}
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
