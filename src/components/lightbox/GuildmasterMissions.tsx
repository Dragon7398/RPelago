import { useState, useEffect } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useAuth } from '../../contexts/AuthContext';
import type { GMMission, AdvSlot, AdvStatusNote, Player } from '../../types';
import { computeMissionCard, fmtClock, missionDisplayLabel, type GMMissionCard } from '../../lib/missionLogic';
import { calcFeatBonuses, buildXpBonusTooltip, buildGoldBonusTooltip } from '../../lib/gameLogic';
import { AdvFeatIcons } from './AdvRow';
import { MISSION_DEFS, toRoman } from '../../lib/constants';
import { handStakeFromSlots } from '../../lib/casinoSlots';

// ── Claimable slot row ────────────────────────────────────────────────────────

function ClaimableSlots({
  mission, uid, activeMissionId, basicTrainingDone,
}: {
  mission: GMMission;
  uid: string | null;
  activeMissionId: string | null;
  basicTrainingDone: boolean;
}) {
  const { claimMissionSlot } = useGameState();
  const [loading, setLoading] = useState<string | null>(null);

  const entries = Object.entries(mission.claimableSlots ?? {});
  if (entries.length === 0 || !uid) return null;

  const alreadyIn    = uid in (mission.participants ?? {});
  const onOtherMission = activeMissionId !== null && activeMissionId !== mission.id;
  const btBlocked    = mission.type === 'basic' && basicTrainingDone;
  if (alreadyIn || onOtherMission || btBlocked) return null;

  return (
    <div className="gm-claim-section">
      <div className="gm-roster-head" style={{ marginTop: '0.6rem' }}>⚐ OPEN SPOTS — REPLACEMENT AVAILABLE</div>
      {entries.map(([key, slots]) => {
        const games = (slots as AdvSlot[]).map(s => s.game).filter(Boolean);
        return (
          <div key={key} className="gm-claim-row">
            {games.length > 0 && (
              <span className="gm-claim-info">{games.join(', ')}</span>
            )}
            <button
              className="gm-take-btn"
              style={{ marginTop: '0.3rem' }}
              onClick={async () => {
                setLoading(key);
                try { await claimMissionSlot(mission.id, key); }
                finally { setLoading(null); }
              }}
              disabled={loading !== null}
            >
              {loading === key ? '…' : '⚑ CLAIM THIS SPOT'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Countdown chip ────────────────────────────────────────────────────────────

function Countdown({ card }: { card: GMMissionCard }) {
  const [sec, setSec] = useState(card.liveSec);
  const [prevLiveSec, setPrevLiveSec] = useState(card.liveSec);

  // Adjust state when the prop changes (React-recommended pattern for prop-derived state).
  if (prevLiveSec !== card.liveSec) {
    setPrevLiveSec(card.liveSec);
    setSec(card.liveSec);
  }

  useEffect(() => {
    if (card.status !== 'filling') return;
    const t = setInterval(() => setSec(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [card.status]);

  if (card.status === 'open') return null;
  if (card.status === 'inprogress') {
    return (
      <div className="gm-cd-subtle" style={{ color: 'oklch(64% 0.12 60)' }}>
        <span className="gm-cd-ico">⚑</span> Cohort full — deployed
      </div>
    );
  }
  return (
    <div className="gm-cd-chip">
      <span>SLOT DECAYS IN</span>
      <span className="gm-cd-clock">{fmtClock(sec)}</span>
    </div>
  );
}

// ── Slot pips ─────────────────────────────────────────────────────────────────

function Pips({ card }: { card: GMMissionCard }) {
  const pips = [];
  for (let i = 0; i < card.mission.baseMax; i++) {
    let cls = 'gm-pip';
    if (i >= card.maxSlots) cls += ' lost';
    else if (i < card.filled) cls += card.youIn && i === 0 ? ' you' : ' filled';
    if (card.status === 'filling' && i === card.maxSlots - 1) cls += ' decaying';
    pips.push(<span key={i} className={cls} />);
  }
  return <span className="gm-pips">{pips}</span>;
}

// ── Rewards ───────────────────────────────────────────────────────────────────

function Rewards({ m, uid, players }: { m: GMMission; uid: string | null; players: Record<string, Player> }) {
  // Casino missions have variable rewards: XP settles when all seats lock in,
  // gold (hand value + pot share) is unknown until the room runs.
  if (m.variableReward) {
    const deployed = m.state === 'inprogress';
    return (
      <div className="lb-rewards" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
        <span className="lb-reward-chip xp gm-tip" data-tip={
          deployed
            ? 'XP locked when the cohort deployed. Gambits raised it from the 50 floor.'
            : 'Starts at 50 XP; each penalty gambit played raises it. Locks when all seats commit.'
        }>
          ✨ {deployed ? `${m.xp} XP` : `${m.xp}+ XP`}
        </span>
        <span className="lb-reward-chip zero gm-tip" data-tip="Your hand's card values plus a share of the pot, minus antes paid. Credited when the admin marks this mission complete.">
          🪙 ? GP
        </span>
      </div>
    );
  }

  const participantIds = Object.keys(m.participants ?? {});
  const userIn = !!uid && participantIds.includes(uid);
  const { xpMultiplier, goldMultiplier } = userIn
    ? calcFeatBonuses(uid!, participantIds, players)
    : { xpMultiplier: 1, goldMultiplier: 1 };
  const xpTip   = userIn ? buildXpBonusTooltip(uid!, participantIds, players)   : null;
  const goldTip = userIn ? buildGoldBonusTooltip(uid!, participantIds, players) : null;
  const adjXP   = Math.round(m.xp * xpMultiplier);
  const adjGold = Math.round(m.gp * goldMultiplier);

  return (
    <div className="lb-rewards" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
      {xpTip ? (
        <span className="lb-reward-chip xp trait-ref" data-tooltip={xpTip}>
          ✨ <span className="lb-val-struck">{m.xp}</span>{' '}
          <span className="lb-val-new">{adjXP}</span> XP *
        </span>
      ) : (
        <span className="lb-reward-chip xp">✨ {m.xp} XP</span>
      )}
      {m.gp > 0 ? (
        goldTip ? (
          <span className="lb-reward-chip gold trait-ref" data-tooltip={goldTip}>
            🪙 <span className="lb-val-struck">{m.gp}</span>{' '}
            <span className="lb-val-new">{adjGold}</span> GP *
          </span>
        ) : (
          <span className="lb-reward-chip gold">🪙 {m.gp} GP</span>
        )
      ) : (
        <span className="lb-reward-chip zero">🪙 0 GP</span>
      )}
    </div>
  );
}

// ── Status note (mirrors AdvNoteEditor pattern) ───────────────────────────────

function MissionStatusNote({
  missionId, note, isOwner,
}: { missionId: string; note?: AdvStatusNote; isOwner: boolean }) {
  const { setMissionParticipantStatusNote } = useGameState();
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');

  if (!isOwner && !note) return null;

  if (editing) {
    return (
      <div className="lb-adv-note-editor">
        <textarea
          className="lb-adv-note-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={280}
          placeholder="Add a progress note…"
          autoFocus
        />
        <div className="lb-adv-note-actions">
          <span className="lb-adv-note-chars">{draft.length}/280</span>
          <button className="lb-adv-note-cancel" onClick={() => setEditing(false)}>Cancel</button>
          <button
            className="lb-adv-note-save"
            onClick={async () => {
              await setMissionParticipantStatusNote(missionId, draft.trim() || null);
              setEditing(false);
            }}
          >Save</button>
        </div>
      </div>
    );
  }

  if (note) {
    const ts = new Date(note.timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    return (
      <div className="lb-adv-note">
        <span className="lb-adv-note-text">{note.text}</span>
        <span className="lb-adv-note-meta">
          <span className="lb-adv-note-time">{ts}</span>
          {isOwner && (
            <button className="lb-adv-note-edit" onClick={() => { setDraft(note.text); setEditing(true); }}>edit</button>
          )}
        </span>
      </div>
    );
  }

  return (
    <button className="lb-adv-note-add" onClick={() => { setDraft(''); setEditing(true); }}>
      + add note
    </button>
  );
}

// ── Casino: house-cut note ────────────────────────────────────────────────────

function CasinoCostNote({ mission }: { mission: GMMission }) {
  const costs = mission.entryCosts;
  if (!costs?.length) return null;
  return (
    <div className="gm-cost">
      <span className="gm-cost-lbl">House takes its cut</span>
      <div className="gm-cost-items">
        {costs.map(c => (
          <span key={c.label} className="gm-cost-item">{c.label} <b>{c.gold}g</b></span>
        ))}
        <span className="gm-cost-item gm-cost-note">
          40% of every ante feeds the shared pot — non-folded seats split it at reveal.
        </span>
      </div>
    </div>
  );
}

// ── Casino: table link (enter or view results) ────────────────────────────────

function CasinoTableLink({ mission, deployed }: { mission: GMMission; deployed: boolean }) {
  const url = mission.tableUrl;
  if (!url) return null;
  const cohort = toRoman(mission.series);
  const href = `${url}?missionId=${encodeURIComponent(mission.id)}&mission=${encodeURIComponent(mission.label)}&cohort=${encodeURIComponent(cohort)}`;
  return (
    <div className="lb-archipelago-link gm-table-link">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {deployed ? '📊 View Results →' : '🂡 Enter the Table →'}
      </a>
      <span className="gm-table-newtab">Opens in a new tab</span>
    </div>
  );
}

// ── Casino: per-seat start deadline countdown ─────────────────────────────────

function CasinoStartByCountdown({ startBy }: { startBy: number }) {
  const [ms, setMs] = useState(() => Math.max(0, startBy - Date.now()));

  useEffect(() => {
    const t = setInterval(() => setMs(Math.max(0, startBy - Date.now())), 1000);
    return () => clearInterval(t);
  }, [startBy]);

  if (ms <= 0) {
    return <div className="gm-startby expired">Seat deadline passed — may be reclaimed by tick</div>;
  }
  return (
    <div className="gm-startby">
      ⏱ Start at the table within <b>{fmtClock(ms / 1000)}</b> or your seat opens
    </div>
  );
}

// ── Participant roster ────────────────────────────────────────────────────────

function MissionRoster({ mission, uid, players }: { mission: GMMission; uid: string | null; players: Record<string, Player> }) {
  const participants = Object.values(mission.participants ?? {});
  if (participants.length === 0) return null;

  const mLabel = missionDisplayLabel(mission);

  return (
    <div className="gm-roster">
      <div className="gm-roster-head">⛓ ARCHIPELAGO ROSTER · {participants.length} ENLISTED</div>
      <div className="lb-adv-list">
        {participants.map(p => {
          const isOwner = p.playerId === uid;
          return (
            <div key={p.playerId} className={`lb-adv-entry${isOwner ? ' you' : ''}`}>
              <div className="lb-adv-row">
                <span className="lb-adv-owner">
                  {p.playerName}
                  {isOwner && <span className="gm-you-tag">YOU</span>}
                  {players[p.playerId]?.discordHandle && (
                    <span className="lb-adv-discord">@{players[p.playerId].discordHandle}</span>
                  )}
                </span>
                <AdvFeatIcons playerId={p.playerId} players={players} />
              </div>
              {(!p.slots || p.slots.length === 0) ? (
                mission.type === 'casino' ? (
                  // Casino: slots are committed at the card table, not via YAML
                  <div className="gm-slot-prompt">
                    {isOwner
                      ? 'Lock in your hand at the card table to commit your slots.'
                      : p.startBy
                        ? 'Playing at the table.'
                        : 'Waiting to start.'}
                  </div>
                ) : isOwner ? (
                  <div className="gm-slot-prompt">
                    No game set yet — submit a YAML to lock in your challenge. In the RPelago thread, send:
                    <span className="gm-slot-prompt-msg">Game YAML for {mLabel} at RPelago-D3.</span>
                  </div>
                ) : <div className="gm-slot-prompt">No game set yet.</div>
              ) : (
                <div className="lb-adv-slots">
                  {(p.slots as AdvSlot[]).map((slot, i) => {
                    const statusCls = slot.status
                      ? 'ss-' + slot.status.replace('%', 'pct').replace('-', '').replace(/\s/g, '')
                      : 'ss-Unstarted';
                    return (
                      <div key={i}>
                        <div className="lb-slot-row">
                          <span className="lb-slot-name">{slot.name}</span>
                          <span className="lb-slot-sep">—</span>
                          <span className="lb-slot-game">{slot.game}</span>
                          <span className={`lb-slot-status ${statusCls}`}>{slot.status ?? 'Unstarted'}</span>
                        </div>
                        {slot.details && (
                          <div className="lb-slot-details">{slot.details}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Casino: show locked stake once the seat has played */}
              {mission.type === 'casino' && p.played && (() => {
                const stake = handStakeFromSlots(p.slots);
                return stake > 0
                  ? <div className="gm-stake">{stake}g on the table</div>
                  : null;
              })()}
              {/* Casino: startBy countdown on the player's own unlocked seat */}
              {mission.type === 'casino' && isOwner && !p.played && p.startBy && (
                <CasinoStartByCountdown startBy={p.startBy} />
              )}
              <MissionStatusNote
                missionId={mission.id}
                note={p.statusNote}
                isOwner={isOwner}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Room settings row ─────────────────────────────────────────────────────────

function RoomSettings({ mission }: { mission: GMMission }) {
  return (
    <div className="lb-meta-row" style={{ justifyContent: 'flex-start', margin: '0.35rem 0 0' }}>
      <span className={`lb-meta-chip ${mission.release}`}>RELEASE: {mission.release.toUpperCase()}</span>
      <span className={`lb-meta-chip ${mission.collect}`}>COLLECT: {mission.collect.toUpperCase()}</span>
      <span className="lb-meta-chip hint">HINT: {mission.hint}%</span>
    </div>
  );
}

// ── Take/enlist button ────────────────────────────────────────────────────────

function TakeMissionButton({
  card, onEnlist, loading,
}: {
  card: GMMissionCard;
  onEnlist: () => void;
  loading: boolean;
}) {
  if (card.youIn && card.status === 'inprogress') {
    return <span className="gm-committed">⚑ COMMITTED</span>;
  }
  if (card.youIn) {
    return (
      <button className="gm-take-btn done" disabled>✓ YOU ARE ENLISTED</button>
    );
  }
  if (card.doneLabel) {
    return (
      <button className="gm-take-btn done" disabled>✓ {card.doneLabel}</button>
    );
  }
  if (!card.takeable) {
    return (
      <span className="gm-tip" data-tip={card.disabledReason ?? undefined} style={{ display: 'block' }}>
        <button className="gm-take-btn disabled" disabled>
          {card.status === 'inprogress' ? 'COHORT DEPLOYED' : 'UNAVAILABLE'}
        </button>
      </span>
    );
  }
  const txt = `TAKE ${card.mission.label.toUpperCase()}`;
  return (
    <button className="gm-take-btn" onClick={onEnlist} disabled={loading}>
      {loading ? '…' : txt}
    </button>
  );
}

// ── Mission card ──────────────────────────────────────────────────────────────

function MissionCard({ card, uid, activeMissionId, basicTrainingDone, onEnlist, onStandDown, players }: {
  card: GMMissionCard;
  uid: string | null;
  activeMissionId: string | null;
  basicTrainingDone: boolean;
  players: Record<string, Player>;
  onEnlist: (card: GMMissionCard) => void;
  onStandDown: (card: GMMissionCard) => void;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const def = MISSION_DEFS[card.mission.type];

  const locked = card.status === 'inprogress' && !card.youIn;

  const handleEnlist = async () => {
    setActionLoading(true);
    try { await onEnlist(card); } finally { setActionLoading(false); }
  };
  const handleStandDown = async () => {
    setActionLoading(true);
    try { await onStandDown(card); } finally { setActionLoading(false); }
  };

  const badgeStatus = card.status === 'open' ? 'open'
    : card.status === 'filling' ? 'filling'
    : 'inprogress';

  return (
    <div className={`gmb-card${locked ? ' locked' : ''}${card.youIn ? ' you' : ''}`}>
      {/* Header row */}
      <div className="gmb-top">
        <div className="gmb-seal">{def.icon}</div>
        <div className="gmb-head">
          <div className="gmb-titlerow">
            <span className="gmb-name">{card.mission.label}</span>
            <span className="gmb-series">{card.seriesLabel}</span>
          </div>
          <div className="gmb-badges">
            <span className={`gm-badge ${badgeStatus}`}>
              {card.status === 'inprogress' ? 'IN PROGRESS' : card.status === 'filling' ? 'FILLING' : 'OPEN'}
            </span>
            {def.special    && <span className="gm-badge special">ONCE PER GM</span>}
            {!def.special   && <span className="gm-badge open">REPEATABLE</span>}
          </div>
          <RoomSettings mission={card.mission} />
          {card.mission.traits && Object.entries(card.mission.traits).map(([traitId, tv], i) => {
            const traitName = traitId.charAt(0).toUpperCase() + traitId.slice(1);
            return (
              <div key={traitId} className="gmb-traitrow" style={i === 0 ? { marginTop: '0.35rem' } : undefined}>
                <span className="gm-trait gm-tip" data-tip={`${traitName}: your slot must have at least ${tv.value} checks.`}>
                  ⛨ {traitName} <span className="gm-trait-val">{tv.value}</span>
                </span>
              </div>
            );
          })}
        </div>
        <Rewards m={card.mission} uid={uid} players={players} />
      </div>

      {/* Description */}
      <div className="gmb-desc">{def.description}</div>

      {/* Casino: house-cut note below description */}
      {card.mission.type === 'casino' && <CasinoCostNote mission={card.mission} />}

      {/* Meta row: pips + countdown */}
      <div className="gmb-meta">
        <div className="gmb-slots">
          <Pips card={card} />
          <span className="gm-slot-count">
            <b>{card.filled}</b> / {card.maxSlots} slots
            {card.decaySteps > 0 && (
              <span style={{ color: 'oklch(60% 0.10 60)' }}> · {card.decaySteps} decayed</span>
            )}
          </span>
        </div>
        <Countdown card={card} />
      </div>

      {/* Casino: table link (enter to play, or view results once deployed) */}
      {card.mission.type === 'casino' && card.mission.tableUrl && card.youIn && (
        <CasinoTableLink
          mission={card.mission}
          deployed={card.status === 'inprogress'}
        />
      )}
      {/* Archipelago game link — shown for all mission types when set */}
      {card.mission.link && (
        <div className="lb-archipelago-link">
          <a href={card.mission.link} target="_blank" rel="noopener noreferrer">🗺 Open Archipelago Game →</a>
        </div>
      )}

      {/* Roster */}
      <MissionRoster mission={card.mission} uid={uid} players={players} />

      {/* CTA */}
      {card.youIn && card.status !== 'inprogress' ? (
        <button className="gm-standdown" style={{ width: '100%', marginTop: '0.4rem' }} onClick={handleStandDown} disabled={actionLoading}>
          {actionLoading ? '…' : 'STAND DOWN'}
        </button>
      ) : (
        <TakeMissionButton card={card} onEnlist={handleEnlist} loading={actionLoading} />
      )}

      {/* Claimable slots — replacement spots created when a participant was kicked */}
      {card.status === 'inprogress' && (
        <ClaimableSlots
          mission={card.mission}
          uid={uid}
          activeMissionId={activeMissionId}
          basicTrainingDone={basicTrainingDone}
        />
      )}
    </div>
  );
}

// ── Active mission banner ─────────────────────────────────────────────────────

function ActiveBanner({ mission, onStandDown }: { mission: GMMission; onStandDown: () => void }) {
  const isDeployed = mission.state === 'inprogress';
  const label = missionDisplayLabel(mission);
  return (
    <div className="gm-banner">
      <div className="gm-banner-seal">✦</div>
      <div className="gm-banner-body">
        <div className="gm-banner-label">CURRENTLY UNDERTAKING</div>
        <div className="gm-banner-name">{label}</div>
        <div className="gm-banner-sub">
          {isDeployed
            ? 'Deployed — committed until the mission completes'
            : 'You may stand down until the cohort fills'}
        </div>
      </div>
      {isDeployed
        ? <span className="gm-committed">⚑ COMMITTED</span>
        : <button className="gm-standdown" onClick={onStandDown}>STAND DOWN</button>}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function GuildmasterMissions() {
  const { gameState, enlistInMission, standDownFromMission } = useGameState();
  const { user } = useAuth();

  const missions = gameState?.missions ?? {};
  const uid = user?.id ?? null;
  const players = gameState?.players ?? {};
  const player = uid ? players[uid] : null;
  const activeMissionId = player?.activeMission ?? null;
  const basicTrainingDone = player?.basicTrainingDone ?? false;

  // useState initializer runs once per mount; sufficient for slot-count display
  // (the Countdown chip handles per-second updates independently).
  const [now] = useState(() => Date.now());

  // Build and sort the mission card list
  const sortGroup = (c: GMMissionCard): number => {
    if (c.youIn) return 0;                                                                      // enrolled mission always first
    if (!basicTrainingDone && c.mission.state === 'forming' && c.mission.type === 'basic') return 1; // BT priority when not yet done
    if (c.mission.state === 'forming') return 2;                                                // other forming missions
    return 3;                                                                                   // inprogress (not enrolled)
  };

  const cards: GMMissionCard[] = Object.values(missions)
    .filter(m => m.state !== 'complete')
    .map(m => computeMissionCard(m, uid, activeMissionId, basicTrainingDone, now))
    .sort((a, b) => {
      const ga = sortGroup(a), gb = sortGroup(b);
      if (ga !== gb) return ga - gb;
      return (a.mission.createdAt ?? 0) - (b.mission.createdAt ?? 0);
    });

  // Split basic-training-done cards into a separate collapsed section
  const mainCards = basicTrainingDone
    ? cards.filter(c => c.mission.type !== 'basic' || c.youIn)
    : cards;
  const btDoneCards = basicTrainingDone
    ? cards.filter(c => c.mission.type === 'basic' && !c.youIn)
    : [];

  const [btExpanded, setBtExpanded] = useState(false);

  const activeMission = activeMissionId ? missions[activeMissionId] : null;

  const handleEnlist = async (card: GMMissionCard) => {
    const label = missionDisplayLabel(card.mission);
    await enlistInMission(card.mission.id, label);
  };

  const handleStandDown = async (card: GMMissionCard) => {
    const label = missionDisplayLabel(card.mission);
    await standDownFromMission(card.mission.id, label);
  };

  const handleBannerStandDown = async () => {
    if (!activeMission) return;
    const label = missionDisplayLabel(activeMission);
    await standDownFromMission(activeMission.id, label);
  };

  return (
    <div className="gm-panel">
      <div className="gm-section-head">
        <span className="gm-rule" />
        ⚜ GUILDMASTER COMMISSIONS
        <span className="gm-rule r" />
      </div>

      {activeMission && (
        <ActiveBanner mission={activeMission} onStandDown={handleBannerStandDown} />
      )}

      <div className="gmb-list">
        {mainCards.map(card => (
          <MissionCard
            key={card.key}
            card={card}
            uid={uid}
            activeMissionId={activeMissionId}
            basicTrainingDone={basicTrainingDone}
            players={players}
            onEnlist={handleEnlist}
            onStandDown={handleStandDown}
          />
        ))}

        {btDoneCards.length > 0 && (
          <div className="gm-bt-done-section">
            <button
              className="gm-bt-done-toggle"
              onClick={() => setBtExpanded(e => !e)}
            >
              {btExpanded ? '▾' : '▸'} BASIC TRAINING — COMPLETED
            </button>
            {btExpanded && btDoneCards.map(card => (
              <MissionCard
                key={card.key}
                card={card}
                uid={uid}
                activeMissionId={activeMissionId}
                basicTrainingDone={basicTrainingDone}
                players={players}
                onEnlist={handleEnlist}
                onStandDown={handleStandDown}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
