import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import type { GMMission, GMMissionState, GMParticipant, AdvSlot, SlotStatus, TriState, CasinoStats } from '../../types';
import { SLOT_STATUSES, toRoman } from '../../lib/constants';
import { currentMaxSlots, missionDisplayLabel } from '../../lib/missionLogic';
import { seedInitialMissions, setMissionSlotLock, setMissionTracker } from '../../firebase/db';
import { fetchRoomStatus } from '../../lib/archipelagoApi';


const MISSION_STATE_BUTTONS: { state: GMMissionState; label: string; cls: string }[] = [
  { state: 'forming',    label: 'Forming',     cls: 'btn-available'  },
  { state: 'inprogress', label: 'In Progress', cls: 'btn-inprogress' },
  { state: 'complete',   label: 'Complete',    cls: 'btn-complete'   },
];

// ── Per-participant slot editor — mirrors AdvSlotEditor UX exactly ─────────────

function MissionParticipantSlots({
  missionId, playerId, participant, locked, isCasino, mismatchedNames, onKick,
}: {
  missionId: string;
  playerId: string;
  participant: GMParticipant;
  locked: boolean;
  isCasino?: boolean;
  mismatchedNames?: Set<string>;
  onKick: () => void;
}) {
  const { adminSetParticipantSlots, adminUpdateParticipantSlotStatus } = useGameState();
  const slots = participant.slots ?? [];
  const [draft, setDraft] = useState<{ name: string; game: string; details: string; status: SlotStatus; bonusXP: number; bonusGold: number }>({
    name: '', game: '', details: '', status: 'Unstarted', bonusXP: 0, bonusGold: 0,
  });
  const [confirmKick, setConfirmKick] = useState(false);

  const save = (next: AdvSlot[]) => adminSetParticipantSlots(missionId, playerId, next);

  return (
    <div className="admin-slot-adv">
      <div className="admin-slot-adv-header">
        <span className="admin-slot-adv-name">{participant.playerName}</span>
        {confirmKick ? (
          <span style={{ display: 'flex', gap: '0.3rem' }}>
            <button
              className="dash-action-btn danger"
              style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
              onClick={() => { onKick(); setConfirmKick(false); }}
            >Confirm Kick</button>
            <button
              className="dash-action-btn"
              style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
              onClick={() => setConfirmKick(false)}
            >Cancel</button>
          </span>
        ) : (
          <button className="dash-kick-btn" onClick={() => setConfirmKick(true)}>Kick</button>
        )}
      </div>

      {slots.map((s, i) => (
        <div key={i} className="admin-slot-row">
          {mismatchedNames?.has(s.name) && (
            <span className="ap-sync-warn" title="Slot name not found in Archipelago room">⚠</span>
          )}
          <input
            className="admin-slot-edit-input"
            key={`mn-${missionId}-${playerId}-${i}-${s.name}`}
            defaultValue={s.name} placeholder="Slot name"
            onBlur={e => { const v = e.target.value.trim(); if (v !== s.name) save(slots.map((sl, j) => j === i ? { ...sl, name: v } : sl)); }}
          />
          <input
            className="admin-slot-edit-input"
            key={`mg-${missionId}-${playerId}-${i}-${s.game}`}
            defaultValue={s.game} placeholder="Game"
            onBlur={e => { const v = e.target.value.trim(); if (v !== s.game) save(slots.map((sl, j) => j === i ? { ...sl, game: v } : sl)); }}
          />
          <input
            className="admin-slot-edit-input"
            key={`md-${missionId}-${playerId}-${i}-${s.details ?? ''}`}
            defaultValue={s.details ?? ''} placeholder="Details"
            onBlur={e => {
              const v = e.target.value.trim();
              const cur = s.details ?? '';
              if (v !== cur) {
                const u = { ...s };
                if (v) u.details = v; else delete u.details;
                save(slots.map((sl, j) => j === i ? u : sl));
              }
            }}
          />
          <input
            type="number" min={0} className="admin-bonus-input" placeholder="+XP"
            key={`mx-${missionId}-${playerId}-${i}-${s.bonusXP ?? 0}`}
            defaultValue={s.bonusXP ?? 0}
            onBlur={e => { const v = parseInt(e.target.value) || 0; const u = { ...s }; if (v > 0) u.bonusXP = v; else delete u.bonusXP; save(slots.map((sl, j) => j === i ? u : sl)); }}
          />
          <input
            type="number" min={0} className="admin-bonus-input" placeholder="+Gold"
            key={`mg2-${missionId}-${playerId}-${i}-${s.bonusGold ?? 0}`}
            defaultValue={s.bonusGold ?? 0}
            onBlur={e => { const v = parseInt(e.target.value) || 0; const u = { ...s }; if (v > 0) u.bonusGold = v; else delete u.bonusGold; save(slots.map((sl, j) => j === i ? u : sl)); }}
          />
          <select
            className="admin-slot-status-select"
            value={s.status ?? 'Unstarted'}
            onChange={e => adminUpdateParticipantSlotStatus(missionId, playerId, i, e.target.value as SlotStatus)}
          >
            {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
          {!locked && <button className="admin-slot-del" title="Remove slot" onClick={() => save(slots.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}

      {/* Casino: slots are written by lockCasinoResult — suppress the manual add row.
          Admin can still edit existing details lines for fixups via the rows above. */}
      {!locked && !isCasino && <div className="admin-slot-add-row">
        <input className="admin-text-input" placeholder="Slot name" value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        <input className="admin-text-input" placeholder="Game" value={draft.game}
          onChange={e => setDraft(d => ({ ...d, game: e.target.value }))} />
        <input className="admin-text-input" placeholder="Details (optional)" value={draft.details}
          onChange={e => setDraft(d => ({ ...d, details: e.target.value }))} />
        <input type="number" min={0} className="admin-bonus-input" placeholder="+XP"
          value={draft.bonusXP || ''}
          onChange={e => setDraft(d => ({ ...d, bonusXP: parseInt(e.target.value) || 0 }))} />
        <input type="number" min={0} className="admin-bonus-input" placeholder="+Gold"
          value={draft.bonusGold || ''}
          onChange={e => setDraft(d => ({ ...d, bonusGold: parseInt(e.target.value) || 0 }))} />
        <select className="admin-slot-status-select" value={draft.status}
          onChange={e => setDraft(d => ({ ...d, status: e.target.value as SlotStatus }))}>
          {SLOT_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <button
          className="admin-slot-add-btn"
          disabled={!draft.name.trim() || !draft.game.trim()}
          onClick={() => {
            const newSlot: AdvSlot = { name: draft.name.trim(), game: draft.game.trim(), status: draft.status };
            if (draft.details.trim()) newSlot.details   = draft.details.trim();
            if (draft.bonusXP > 0)   newSlot.bonusXP   = draft.bonusXP;
            if (draft.bonusGold > 0) newSlot.bonusGold = draft.bonusGold;
            save([...slots, newSlot]);
            setDraft({ name: '', game: '', details: '', status: 'Unstarted', bonusXP: 0, bonusGold: 0 });
          }}
        >+ Add</button>
      </div>}

      {participant.statusNote && (
        <div className="dash-adv-note" style={{ marginTop: '0.3rem' }}>
          <span className="dash-adv-note-text">{participant.statusNote.text}</span>
          <span className="dash-adv-note-time">
            {new Date(participant.statusNote.timestamp).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Unified mission card ───────────────────────────────────────────────────────

function MissionCard({ mission }: { mission: GMMission }) {
  const {
    adminForceDeploy, adminCompleteMission,
    adminSetMissionLink, adminSetMissionRoomSettings,
    adminKickMissionParticipant, gameState,
  } = useGameState();

  const [link,    setLink]    = useState(mission.link ?? '');
  const [release, setRelease] = useState<TriState>(mission.release);
  const [collect, setCollect] = useState<TriState>(mission.collect);
  const [hint,    setHint]    = useState(mission.hint);
  const [transitioning,  setTransitioning]  = useState(false);
  const [completionWarn, setCompletionWarn] = useState<{ unfinishedSlots: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [mismatchedNames, setMismatchedNames] = useState<Set<string>>(new Set());

  const handleSync = async () => {
    const roomLink = mission.link ?? link;
    if (!roomLink) return;
    setSyncing(true);
    try {
      const status = await fetchRoomStatus(roomLink);
      const apNames = new Set(status.players.map(([name]: [string, string]) => name));
      const allSlots = Object.values(mission.participants ?? {}).flatMap(p => p.slots ?? []);
      const mismatched = new Set(allSlots.map(s => s.name).filter(n => n && !apNames.has(n)));
      setMismatchedNames(mismatched);
      if (status.tracker) {
        await setMissionTracker(mission.id, status.tracker);
      }
    } catch (err) {
      console.error('AP sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };
  const slotsLocked = mission.slotsLocked ?? false;
  const [now] = useState(() => Date.now());

  const label        = missionDisplayLabel(mission);
  const participants = Object.entries(mission.participants ?? {});
  const filled       = participants.length;
  const maxSlots     = currentMaxSlots(mission, now);

  const nextDecayMs = mission.state === 'forming' && mission.firstJoinAt != null
    ? mission.firstJoinAt + Math.ceil((now - mission.firstJoinAt) / (24 * 3600_000)) * (24 * 3600_000) - now
    : null;

  const handleStateBtn = async (target: GMMissionState) => {
    if (target === mission.state) return;
    if (target === 'forming') return; // no going back

    if (target === 'inprogress') {
      setTransitioning(true);
      try { await adminForceDeploy(mission.id); } finally { setTransitioning(false); }
    } else if (target === 'complete') {
      setTransitioning(true);
      try {
        const result = await adminCompleteMission(mission.id, false);
        if (result.warned && result.unfinishedSlots) {
          setCompletionWarn({ unfinishedSlots: result.unfinishedSlots });
        }
      } finally { setTransitioning(false); }
    }
  };

  const handleConfirmComplete = async () => {
    setTransitioning(true);
    try { await adminCompleteMission(mission.id, true); } finally { setTransitioning(false); setCompletionWarn(null); }
  };

  return (
    <div className="dash-tile-card">
      {/* Header */}
      <div className="dash-tile-header">
        <span className="dash-tile-name">{label}</span>
        {mission.type === 'casino' && (
          <span className="dash-mission-type-pill">🎲 CASINO</span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--gold-dim)', marginLeft: 'auto' }}>{filled}/{maxSlots}</span>
        {/* Casino: spectate / test the card table */}
        {mission.type === 'casino' && mission.tableUrl && (
          <a
            className="dash-tile-link"
            href={`${mission.tableUrl}?missionId=${encodeURIComponent(mission.id)}&mission=${encodeURIComponent(mission.label)}&cohort=${encodeURIComponent(toRoman(mission.series))}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open card table"
          >🎰</a>
        )}
        {mission.state === 'inprogress' && mission.link && (
          <a className="dash-tile-link" href={mission.link} target="_blank" rel="noopener noreferrer" title="Open room">🔗</a>
        )}
        {mission.tracker && (
          <a className="dash-tile-link" href={`https://archipelago.gg/tracker/${mission.tracker}`} target="_blank" rel="noopener noreferrer" title="Open Archipelago tracker">📊</a>
        )}
        {(mission.link || link) && (
          <button className="dash-copy-room-btn ap-sync-btn" onClick={handleSync} disabled={syncing}>
            {syncing ? '…' : 'Sync'}
          </button>
        )}
      </div>

      {/* Casino: variable reward display */}
      {mission.variableReward && (
        <div style={{ fontSize: '0.62rem', color: 'var(--gold-dim)', marginTop: '0.2rem' }}>
          {mission.state === 'inprogress'
            ? <>{mission.xp} XP · <span style={{ opacity: 0.7 }}>? GP (paid at complete)</span></>
            : <>{mission.xp}+ XP · <span style={{ opacity: 0.7 }}>? GP</span></>}
        </div>
      )}

      {/* State selector — mirrors Map page */}
      <div className="admin-detail-row" style={{ marginTop: '0.6rem' }}>
        <div className="admin-detail-label">STATE</div>
        <div className="admin-state-btns">
          {MISSION_STATE_BUTTONS.map(({ state, label: btnLabel, cls }) => {
            const isCurrent = mission.state === state;
            const isDisabled =
              transitioning ||
              isCurrent ||
              state === 'forming' ||                                     // can't go back
              (state === 'inprogress' && mission.state !== 'forming') || // can only deploy from forming
              (state === 'complete'   && mission.state !== 'inprogress') || // can only complete from inprogress
              (state === 'inprogress' && filled === 0);                  // can't deploy empty

            return (
              <button
                key={state}
                className={`admin-state-btn ${cls}${isCurrent ? ' active' : ''}`}
                disabled={isDisabled}
                onClick={() => handleStateBtn(state)}
              >
                {transitioning && !isCurrent && state !== 'forming' ? '…' : btnLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* Completion confirmation */}
      {completionWarn && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.4rem' }}>
          <span className="admin-complete-warn">
            {completionWarn.unfinishedSlots} participant(s) have unfinished slots. Complete anyway?
          </span>
          <button className="dash-action-btn danger" onClick={handleConfirmComplete} disabled={transitioning}>
            {transitioning ? '…' : 'Yes, Complete'}
          </button>
          <button className="dash-action-btn" onClick={() => setCompletionWarn(null)}>Cancel</button>
        </div>
      )}

      {nextDecayMs != null && (
        <div style={{ fontSize: '0.68rem', color: 'oklch(60% 0.08 60)', marginTop: '0.35rem' }}>
          Next decay in {Math.floor(nextDecayMs / 3600_000)}h {Math.floor((nextDecayMs % 3600_000) / 60_000)}m
        </div>
      )}

      {/* Casino: live gambit odds while forming — read-only, updated as players play gambits */}
      {mission.type === 'casino' && mission.state === 'forming' && (() => {
        const s = mission.casinoStats as CasinoStats | undefined;
        if (!s) return null;
        return (
          <div style={{ fontSize: '0.62rem', color: 'var(--gold-dim)', marginTop: '0.3rem', display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
            <span>Release <b style={{ color: 'var(--parchment)' }}>{s.release}%</b></span>
            <span>Collect <b style={{ color: 'var(--parchment)' }}>{s.collect}%</b></span>
            <span>Hint <b style={{ color: 'var(--parchment)' }}>{s.hint}%</b></span>
            <span>XP floor <b style={{ color: 'var(--parchment)' }}>{s.xp}</b></span>
          </div>
        );
      })()}

      {/* Room link + settings — inprogress only */}
      {mission.state === 'inprogress' && (
        <>
          <div className="admin-detail-row">
            <div className="admin-detail-label">ARCH. LINK</div>
            <input
              className="admin-text-input"
              placeholder="https://…"
              value={link}
              onChange={e => setLink(e.target.value)}
              onBlur={() => adminSetMissionLink(mission.id, link)}
            />
            {link && (
              <button
                className="dash-copy-room-btn"
                onClick={() => {
                  const pids = Object.keys(mission.participants ?? {});
                  const handles = pids.map(pid => {
                    const p = gameState?.players[pid];
                    return '@' + (p?.discordHandle ?? p?.displayName ?? pid);
                  }).join(' ');
                  let text = `New room generated:  ${label}!\n${link}`;
                  if (mission.tracker) text += `\nhttps://archipelago.gg/tracker/${mission.tracker}`;
                  text += `\n${handles}`;
                  navigator.clipboard.writeText(text);
                }}
              >Copy Room Text</button>
            )}
          </div>

          {(['release', 'collect'] as const).map(field => {
            const current = field === 'release' ? release : collect;
            return (
              <div className="admin-detail-row" key={field}>
                <div className="admin-detail-label">{field.toUpperCase()}</div>
                <div className="admin-tristate">
                  {(['on', 'off', 'special'] as TriState[]).map(v => (
                    <button
                      key={v}
                      className={`admin-tri-btn${current === v ? ` active-${v}` : ''}`}
                      onClick={() => {
                        if (field === 'release') {
                          setRelease(v); adminSetMissionRoomSettings(mission.id, v, collect, hint);
                        } else {
                          setCollect(v); adminSetMissionRoomSettings(mission.id, release, v, hint);
                        }
                      }}
                    >{v.toUpperCase()}</button>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="admin-detail-row">
            <div className="admin-detail-label">HINT %</div>
            <div className="admin-hint-wrap">
              <input
                type="number" className="admin-count-input" min={0} max={100}
                value={hint}
                onChange={e => setHint(parseInt(e.target.value) || 0)}
                onBlur={() => adminSetMissionRoomSettings(mission.id, release, collect, hint)}
              />
              <span>%</span>
            </div>
          </div>
        </>
      )}

      {/* Slots — always shown */}
      <div className="admin-detail-row" style={{ marginTop: '0.75rem', marginBottom: '0.4rem', alignItems: 'center' }}>
        <div className="admin-detail-label">SLOTS</div>
        <button className={`admin-slot-lock-btn${slotsLocked ? ' locked' : ''}`} onClick={() => setMissionSlotLock(mission.id, !slotsLocked)}>
          {slotsLocked ? '🔒 LOCKED' : '🔓 LOCK'}
        </button>
      </div>
      {participants.length > 0 ? participants.map(([pid, p]) => (
        <MissionParticipantSlots
          key={pid}
          missionId={mission.id}
          playerId={pid}
          participant={p}
          locked={slotsLocked}
          isCasino={mission.type === 'casino'}
          mismatchedNames={mismatchedNames}
          onKick={() => adminKickMissionParticipant(mission.id, pid)}
        />
      )) : (
        <div className="dash-empty">No participants yet.</div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MissionsPage() {
  const { gameState } = useGameState();
  const { addToast }  = useToast();
  const [seeding, setSeeding] = useState(false);

  const missions = gameState?.missions ?? {};
  const active   = Object.values(missions).filter(m => m.state !== 'complete');
  const forming  = active.filter(m => m.state === 'forming')   .sort((a, b) => (a.createdAt  ?? 0) - (b.createdAt  ?? 0));
  const inprog   = active.filter(m => m.state === 'inprogress').sort((a, b) => (a.deployedAt ?? 0) - (b.deployedAt ?? 0));

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const created = await seedInitialMissions();
      addToast(
        created
          ? 'Missions seeded — Basic Training · Cohort I, Patrol · Cohort I, and A Night at the Casino · Cohort I are now live.'
          : 'All mission types already have an active cohort.',
        'success',
      );
    } catch (err) {
      addToast(`Failed to seed missions: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">⚜ Guildmaster Missions</h2>

      <div className="dash-challenges-cols">
        <div className="dash-col">
          <div className="dash-col-header">
            <span>Forming</span>
            <span className="dash-col-count">{forming.length}</span>
          </div>
          {forming.length === 0 ? (
            <div className="dash-empty" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span>No forming missions.</span>
              {active.length === 0 && (
                <button className="dash-action-btn" disabled={seeding} onClick={handleSeed}>
                  {seeding ? '…' : '⚜ Seed Initial Missions'}
                </button>
              )}
            </div>
          ) : (
            forming.map(m => <MissionCard key={m.id} mission={m} />)
          )}
        </div>

        <div className="dash-col">
          <div className="dash-col-header">
            <span>In Progress</span>
            <span className="dash-col-count">{inprog.length}</span>
          </div>
          {inprog.length === 0 ? (
            <div className="dash-empty">No missions in progress.</div>
          ) : (
            inprog.map(m => <MissionCard key={m.id} mission={m} />)
          )}
        </div>
      </div>
    </div>
  );
}
