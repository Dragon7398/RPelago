import { useState, useEffect } from 'react';
import { get } from 'firebase/database';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { useToast } from '../contexts/ToastContext';
import { calcLevel, xpForLevel, xpForNextLevel, getPlayerFeatIds, getAvailableFeatsForSlot, pendingFeatSlot } from '../lib/gameLogic';
import { ADV_ICONS, MAX_LEVEL, SHOP_ITEMS, NAME_COLORS, FEATS } from '../lib/constants';
import { db as firebaseDb } from '../firebase/config';
import { sRef } from '../firebase/season';
import { syncPlayerProfile } from '../firebase/db';
import ProfileLink from './ProfileLink';
import type { AdvClass, PlayerFeats, CompletedChallenge } from '../types';

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

  // History — lazy loaded when lightbox opens
  const [pastChallenges, setPastChallenges] = useState<CompletedChallenge[] | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  useEffect(() => {
    if (!open || !user || !firebaseDb) return;
    if (pastChallenges !== null) return; // already loaded

    const uid = user.id;
    get(sRef(firebaseDb, `players/${uid}/completedChallenges`)).then(cSnap => {
      const challenges: CompletedChallenge[] = cSnap.exists()
        ? Object.values(cSnap.val() as Record<string, CompletedChallenge>)
            .filter(c => c.xpAwarded !== 0 || c.goldAwarded !== 0)
        : [];
      challenges.sort((a, b) => b.completedAt - a.completedAt);
      setPastChallenges(challenges);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [featSaving, setFeatSaving] = useState(false);

  const [syncing, setSyncing] = useState(false);

  const handleSyncProfile = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { tileCount, missionCount, gameCount } = await syncPlayerProfile();
      addToast(`Profile synced: ${tileCount} tile${tileCount !== 1 ? 's' : ''}, ${missionCount} mission${missionCount !== 1 ? 's' : ''}, ${gameCount} game${gameCount !== 1 ? 's' : ''}.`, 'success');
    } catch {
      addToast('Profile sync failed. Please try again.', 'error');
    } finally {
      setSyncing(false);
    }
  };

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
              <ProfileLink uid={user!.id} />
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

            {/* History sections */}
            <div className="profile-adv-section" style={{ marginTop: '1rem' }}>
              <button
                className="gm-bt-done-toggle"
                style={{ width: '100%', textAlign: 'left', marginBottom: historyExpanded ? '0.6rem' : 0 }}
                onClick={() => setHistoryExpanded(e => !e)}
              >
                {historyExpanded ? '▾' : '▸'} HISTORY
              </button>

              {historyExpanded && (
                <>
                  {pastChallenges === null ? (
                    <div style={{ fontSize: '0.7rem', color: 'var(--gold-dim)', fontStyle: 'italic' }}>Loading…</div>
                  ) : pastChallenges.length === 0 ? (
                    <div style={{ fontSize: '0.7rem', color: 'var(--gold-dim)', fontStyle: 'italic' }}>No challenges completed yet.</div>
                  ) : pastChallenges.map((c, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '0.2rem 0', borderBottom: '1px solid var(--border)', color: 'var(--parchment)' }}>
                      <span>{c.name} <span style={{ color: 'var(--gold-dim)' }}>({c.coord})</span></span>
                      <span style={{ color: 'var(--gold-dim)', display: 'flex', gap: '0.5rem' }}>
                        <span>✨ {c.xpAwarded} · 🪙 {c.goldAwarded}</span>
                        <span>{new Date(c.completedAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <button
              className="profile-sync-btn"
              disabled={syncing}
              onClick={handleSyncProfile}
            >
              {syncing ? 'SYNCING…' : 'SYNC PROFILE'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
