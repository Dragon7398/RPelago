import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { useToast } from '../contexts/ToastContext';
import { calcLevel, xpForLevel, xpForNextLevel, getPlayerFeatIds, getAvailableFeatsForSlot, pendingFeatSlot } from '../lib/gameLogic';
import { ADV_ICONS, MAX_LEVEL, SHOP_ITEMS, NAME_COLORS, FEATS } from '../lib/constants';
import type { AdvClass, PlayerFeats } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const SLOT_LABELS: Record<string, string> = {
  level3: 'Level 3',
  level5: 'Level 5',
  level7: 'Level 7',
};

export default function ProfileLightbox({ open, onClose }: Props) {
  const { user } = useAuth();
  const { gameState, renameAdventurer, setNameColor, selectFeat } = useGameState();
  const { addToast } = useToast();

  const player = user && gameState ? gameState.players[user.id] : null;
  const adventurers = player ? Object.values(player.adventurers) : [];
  const level  = player ? calcLevel(player.xp) : 1;
  const xpCurr = player?.xp ?? 0;
  const xpThis = xpForLevel(level);
  const xpNext = xpForNextLevel(level);
  const maxed  = level >= MAX_LEVEL;
  const xpPct  = xpNext ? Math.round(((xpCurr - xpThis) / (xpNext - xpThis)) * 100) : 100;

  const feats    = player?.feats ?? {} as PlayerFeats;
  const featIds  = getPlayerFeatIds(feats);
  const pending  = player ? pendingFeatSlot(level, feats) : null;

  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [featSaving, setFeatSaving] = useState(false);

  // Per-adventurer rename state
  const [renames, setRenames] = useState<Record<string, { first: string; last: string }>>({});

  const getRename = (advId: string, defaultFirst: string, defaultLast: string) => {
    return renames[advId] ?? { first: defaultFirst, last: defaultLast };
  };

  const handleRenameChange = (advId: string, field: 'first' | 'last', val: string, defaultFirst: string, defaultLast: string) => {
    setRenames(prev => ({
      ...prev,
      [advId]: { ...getRename(advId, defaultFirst, defaultLast), [field]: val.slice(0, 12) },
    }));
  };

  const handleRenameSave = async (advId: string, firstName: string, lastName: string) => {
    if (!user) return;
    try {
      await renameAdventurer(user.id, advId, firstName, lastName);
      setRenames(prev => {
        const next = { ...prev };
        delete next[advId];
        return next;
      });
      addToast('Adventurer renamed successfully.', 'success');
    } catch {
      addToast('Failed to rename Adventurer. Please try again.', 'error');
    }
  };

  const handleSelectFeat = async () => {
    if (!user || !pending || !pendingSelection) return;
    setFeatSaving(true);
    try {
      await selectFeat(user.id, pending, pendingSelection);
      setPendingSelection(null);
      addToast(`Feat selected: ${FEATS.find(f => f.id === pendingSelection)?.name ?? pendingSelection}.`, 'success');
    } catch {
      addToast('Failed to select feat. Please try again.', 'error');
    } finally {
      setFeatSaving(false);
    }
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
            <div className="profile-name-row">
              <div
                className="profile-player-name"
                style={{ color: NAME_COLORS.find(c => c.id === (player.nameColor ?? 'default'))?.value }}
              >
                {user!.displayName.toUpperCase()}
              </div>
              <a
                className="profile-ext-link"
                href={`https://profiles.brisbe.org/p/${user!.id}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View Player Profile"
              >
                <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
                  <path d="M10 1 L8.5 8.5 L11.5 8.5 Z" />
                  <path d="M10 19 L11.5 11.5 L8.5 11.5 Z" />
                  <path d="M1 10 L8.5 8.5 L8.5 11.5 Z" />
                  <path d="M19 10 L11.5 11.5 L11.5 8.5 Z" />
                  <path d="M17 3 L12 8.5 L13.5 10 Z" />
                  <path d="M17 17 L11.5 12 L10 13.5 Z" />
                  <path d="M3 17 L8 11.5 L6.5 10 Z" />
                  <path d="M3 3 L8.5 8 L10 6.5 Z" />
                  <circle cx="10" cy="10" r="2" />
                </svg>
              </a>
            </div>
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

            {/* ── Feats ── */}
            {(featIds.length > 0 || pending) && (
              <div className="profile-adv-section">
                <div className="profile-adv-title">FEATS</div>

                {/* Earned feats display */}
                {(feats.level3 || feats.level5 || feats.level7) && (
                  <div className="profile-feats-list">
                    {(['level3', 'level5', 'level7'] as const).map(slot => {
                      const featId = feats[slot];
                      if (!featId) return null;
                      const def = FEATS.find(f => f.id === featId);
                      if (!def) return null;
                      return (
                        <div key={slot} className="profile-feat-row">
                          <span className="profile-feat-icon">{def.icon}</span>
                          <div className="profile-feat-info">
                            <div className="profile-feat-name">{def.name}</div>
                            <div className="profile-feat-desc">{def.description}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pending feat selection */}
                {pending && (
                  <div className="profile-feat-select">
                    <div className="profile-feat-select-title">
                      ✦ {SLOT_LABELS[pending]} FEAT AVAILABLE — Choose one:
                    </div>
                    <div className="profile-feat-options">
                      {getAvailableFeatsForSlot(pending, feats).map(featId => {
                        const def = FEATS.find(f => f.id === featId);
                        if (!def) return null;
                        const selected = pendingSelection === featId;
                        return (
                          <button
                            key={featId}
                            className={`profile-feat-option${selected ? ' selected' : ''}`}
                            onClick={() => setPendingSelection(selected ? null : featId)}
                          >
                            <span className="profile-feat-option-icon">{def.icon}</span>
                            <span className="profile-feat-option-name">{def.name}</span>
                            <span className="profile-feat-option-desc">{def.description}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="profile-feat-confirm"
                      disabled={!pendingSelection || featSaving}
                      onClick={handleSelectFeat}
                    >
                      {featSaving ? '…' : 'CONFIRM FEAT'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {(player.inventory?.['coat_of_many_colors'] ?? 0) > 0 && (
              <div className="profile-adv-section">
                <div className="profile-adv-title">NAME COLOR</div>
                <div className="profile-color-swatches">
                  {NAME_COLORS.map(nc => (
                    <button
                      key={nc.id}
                      className={`profile-color-swatch${(player.nameColor ?? 'default') === nc.id ? ' selected' : ''}`}
                      style={{ backgroundColor: nc.value }}
                      title={nc.label}
                      onClick={async () => {
                        try {
                          await setNameColor(user!.id, nc.id === 'default' ? null : nc.id);
                        } catch {
                          addToast('Failed to update name color. Please try again.', 'error');
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--gold-dim)', fontFamily: "'Cinzel', serif", letterSpacing: '0.06em' }}>
                        {adv.cls}{adv.busy && adv.busyTile ? ` · ${adv.busyTile}` : ''}
                      </div>
                      <div className="profile-rename-row">
                        <input
                          className="profile-rename-input"
                          value={first}
                          maxLength={12}
                          placeholder="First"
                          onChange={e => handleRenameChange(adv.id, 'first', e.target.value, adv.firstName, adv.lastName)}
                        />
                        <input
                          className="profile-rename-input"
                          value={last}
                          maxLength={12}
                          placeholder="Last"
                          onChange={e => handleRenameChange(adv.id, 'last', e.target.value, adv.firstName, adv.lastName)}
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
