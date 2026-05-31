import { useState, useEffect } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useAuth } from '../../contexts/AuthContext';
import type { GMMission, AdvSlot, AdvStatusNote } from '../../types';
import { computeMissionCard, fmtClock, missionDisplayLabel, type GMMissionCard } from '../../lib/missionLogic';
import { MISSION_DEFS } from '../../lib/constants';

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

function Rewards({ m }: { m: GMMission }) {
  return (
    <div className="lb-rewards" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
      <span className="lb-reward-chip xp">✨ {m.xp} XP</span>
      {m.gp > 0
        ? <span className="lb-reward-chip gold">🪙 {m.gp} GP</span>
        : <span className="lb-reward-chip zero">🪙 0 GP</span>}
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
            disabled={!draft.trim()}
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
    const ts = new Date(note.timestamp).toLocaleDateString();
    return (
      <div className="lb-adv-note">
        <span className="lb-adv-note-text">{note.text}</span>
        <span className="lb-adv-note-meta">
          <span className="lb-adv-note-time">{ts}</span>
          {isOwner && (
            <>
              <button className="lb-adv-note-edit" onClick={() => { setDraft(note.text); setEditing(true); }}>edit</button>
              <button className="lb-adv-note-edit" onClick={() => setMissionParticipantStatusNote(missionId, null)}>✕</button>
            </>
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

// ── Participant roster ────────────────────────────────────────────────────────

function MissionRoster({ mission, uid }: { mission: GMMission; uid: string | null }) {
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
                </span>
              </div>
              {(!p.slots || p.slots.length === 0) ? (
                isOwner ? (
                  <div className="gm-slot-prompt">
                    No game set yet — submit a YAML to lock in your challenge. In the RPelago thread, send:
                    <span className="gm-slot-prompt-msg">Game YAML for {mLabel} at RPelago-D3.</span>
                  </div>
                ) : null
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
    <div className="lb-link-row" style={{ fontSize: '0.68rem', color: 'var(--gold-dim)', margin: '0.3rem 0' }}>
      <span>Release: <b>{mission.release}</b></span>
      <span style={{ margin: '0 0.5rem' }}>·</span>
      <span>Collect: <b>{mission.collect}</b></span>
      <span style={{ margin: '0 0.5rem' }}>·</span>
      <span>Hint: <b>{mission.hint}%</b></span>
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

function MissionCard({ card, uid, activeMissionId, basicTrainingDone, onEnlist, onStandDown }: {
  card: GMMissionCard;
  uid: string | null;
  activeMissionId: string | null;
  basicTrainingDone: boolean;
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
        </div>
        <Rewards m={card.mission} />
      </div>

      {/* Description */}
      <div className="gmb-desc">{def.description}</div>

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

      {/* Room link — same style as tile challenges */}
      {card.mission.link && (
        <div className="lb-archipelago-link">
          <a href={card.mission.link} target="_blank" rel="noopener noreferrer">🗺 Open Archipelago Game →</a>
        </div>
      )}

      {/* Roster */}
      <MissionRoster mission={card.mission} uid={uid} />

      {/* Trait row */}
      {card.mission.traits && Object.entries(card.mission.traits).map(([traitId, tv]) => {
        const traitName = traitId.charAt(0).toUpperCase() + traitId.slice(1);
        return (
          <div key={traitId} className="gmb-traitrow">
            <span className="gm-trait gm-tip" data-tip={`${traitName}: your slot must have at least ${tv.value} checks.`}>
              ⛨ {traitName} <span className="gm-trait-val">{tv.value}</span>
            </span>
          </div>
        );
      })}

      {/* Room settings */}
      <RoomSettings mission={card.mission} />

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
  const player = uid ? gameState?.players[uid] : null;
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
