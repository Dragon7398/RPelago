import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import type { GMMission, GMParticipant, AdvSlot, SlotStatus, TriState } from '../../types';
import { SLOT_STATUSES } from '../../lib/constants';
import { currentMaxSlots, missionDisplayLabel } from '../../lib/missionLogic';
import { seedInitialMissions } from '../../firebase/db';

const TRISTATE_OPTIONS: TriState[] = ['on', 'off', 'special'];

// ── Slot editor for one participant ──────────────────────────────────────────

function ParticipantSlotEditor({
  missionId, playerId, participant,
}: { missionId: string; playerId: string; participant: GMParticipant }) {
  const { adminSetParticipantSlots, adminUpdateParticipantSlotStatus } = useGameState();
  const [slots, setSlots] = useState<AdvSlot[]>(participant.slots ?? []);
  const [saving, setSaving] = useState(false);

  const handleSlotChange = (i: number, field: keyof AdvSlot, value: string | number) => {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  const addSlot = () => setSlots(prev => [...prev, { name: '', game: '', status: 'Unstarted' }]);
  const removeSlot = (i: number) => setSlots(prev => prev.filter((_, idx) => idx !== i));

  const saveSlots = async () => {
    setSaving(true);
    try {
      await adminSetParticipantSlots(missionId, playerId, slots);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (i: number, status: SlotStatus) => {
    const updated = slots.map((s, idx) => idx === i ? { ...s, status } : s);
    setSlots(updated);
    await adminUpdateParticipantSlotStatus(missionId, playerId, i, status);
  };

  return (
    <div className="dash-adv-slots" style={{ marginTop: '0.4rem' }}>
      {slots.map((slot, i) => (
        <div key={i} className="dash-adv-slot-row" style={{ flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.3rem' }}>
          <input
            className="dash-edit-input"
            style={{ width: '120px' }}
            placeholder="Slot name"
            value={slot.name}
            onChange={e => handleSlotChange(i, 'name', e.target.value)}
          />
          <input
            className="dash-edit-input"
            style={{ flex: 1, minWidth: '120px' }}
            placeholder="Game title"
            value={slot.game}
            onChange={e => handleSlotChange(i, 'game', e.target.value)}
          />
          <select
            className="dash-select"
            value={slot.status ?? 'Unstarted'}
            onChange={e => updateStatus(i, e.target.value as SlotStatus)}
          >
            {SLOT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            className="dash-edit-input"
            style={{ width: '60px' }}
            type="number"
            placeholder="+XP"
            value={slot.bonusXP ?? ''}
            onChange={e => handleSlotChange(i, 'bonusXP', e.target.value === '' ? 0 : Number(e.target.value))}
          />
          <input
            className="dash-edit-input"
            style={{ width: '60px' }}
            type="number"
            placeholder="+GP"
            value={slot.bonusGold ?? ''}
            onChange={e => handleSlotChange(i, 'bonusGold', e.target.value === '' ? 0 : Number(e.target.value))}
          />
          <button className="dash-action-btn danger" onClick={() => removeSlot(i)}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
        <button className="dash-action-btn" onClick={addSlot}>+ Add Slot</button>
        <button className="dash-action-btn" onClick={saveSlots} disabled={saving}>
          {saving ? 'Saving…' : 'Save Slots'}
        </button>
      </div>
      {participant.statusNote && (
        <div className="dash-adv-note" style={{ marginTop: '0.3rem' }}>
          <span className="dash-adv-note-text">{participant.statusNote.text}</span>
          <span className="dash-adv-note-time">
            {new Date(participant.statusNote.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Inprogress mission card ───────────────────────────────────────────────────

function InProgressMissionCard({ mission }: { mission: GMMission }) {
  const {
    adminSetMissionLink, adminSetMissionRoomSettings,
    adminKickMissionParticipant, adminCompleteMission,
  } = useGameState();

  const [link, setLink]         = useState(mission.link ?? '');
  const [release, setRelease]   = useState<TriState>(mission.release);
  const [collect, setCollect]   = useState<TriState>(mission.collect);
  const [hint, setHint]         = useState(mission.hint);
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionWarn, setCompletionWarn] = useState<{ unfinishedSlots: number } | null>(null);

  const handleSaveLink = () => adminSetMissionLink(mission.id, link);
  const handleSaveRoom = () => adminSetMissionRoomSettings(mission.id, release, collect, hint);

  const handleKick = async (playerId: string) => {
    await adminKickMissionParticipant(mission.id, playerId);
    setConfirmKick(null);
  };

  const handleComplete = async (confirmed = false) => {
    setCompleting(true);
    try {
      const result = await adminCompleteMission(mission.id, confirmed);
      if (result.warned && result.unfinishedSlots) {
        setCompletionWarn({ unfinishedSlots: result.unfinishedSlots });
      }
    } finally {
      setCompleting(false);
    }
  };

  const participants = Object.entries(mission.participants ?? {});
  const label = missionDisplayLabel(mission);

  return (
    <div className="dash-tile-card">
      <div className="dash-tile-header">
        <div>
          <span className="dash-tile-name">{label}</span>
          <span className="dash-tile-state inprogress" style={{ marginLeft: '0.5rem' }}>IN PROGRESS</span>
        </div>
      </div>

      {/* Room link */}
      <div className="dash-section-label" style={{ marginTop: '0.75rem' }}>ROOM LINK</div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
        <input
          className="dash-edit-input"
          style={{ flex: 1 }}
          placeholder="Archipelago room URL"
          value={link}
          onChange={e => setLink(e.target.value)}
        />
        <button className="dash-action-btn" onClick={handleSaveLink}>Save</button>
      </div>

      {/* Room settings */}
      <div className="dash-section-label" style={{ marginTop: '0.75rem' }}>ROOM SETTINGS</div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
          Release:
          <select className="dash-select" value={release} onChange={e => setRelease(e.target.value as TriState)}>
            {TRISTATE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
          Collect:
          <select className="dash-select" value={collect} onChange={e => setCollect(e.target.value as TriState)}>
            {TRISTATE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
          Hint %:
          <input
            className="dash-edit-input"
            type="number"
            style={{ width: '60px' }}
            value={hint}
            onChange={e => setHint(Number(e.target.value))}
          />
        </label>
        <button className="dash-action-btn" onClick={handleSaveRoom}>Save</button>
      </div>

      {/* Participants */}
      <div className="dash-section-label" style={{ marginTop: '0.75rem' }}>PARTICIPANTS</div>
      {participants.map(([pid, p]) => (
        <div key={pid} className="dash-player-row" style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="dash-player-tag">{p.playerName}</span>
            {confirmKick === pid ? (
              <span style={{ display: 'flex', gap: '0.35rem' }}>
                <button className="dash-action-btn danger" onClick={() => handleKick(pid)}>Confirm Kick</button>
                <button className="dash-action-btn" onClick={() => setConfirmKick(null)}>Cancel</button>
              </span>
            ) : (
              <button className="dash-action-btn danger" onClick={() => setConfirmKick(pid)}>Kick</button>
            )}
          </div>
          <ParticipantSlotEditor missionId={mission.id} playerId={pid} participant={p} />
        </div>
      ))}
      {participants.length === 0 && (
        <div className="dash-empty">No participants.</div>
      )}

      {/* Mark Complete */}
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {completionWarn ? (
          <>
            <span style={{ fontSize: '0.72rem', color: 'var(--amber)' }}>
              {completionWarn.unfinishedSlots} participant(s) have unfinished slots. Complete anyway?
            </span>
            <button className="dash-action-btn danger" onClick={() => handleComplete(true)} disabled={completing}>
              {completing ? '…' : 'Yes, Complete'}
            </button>
            <button className="dash-action-btn" onClick={() => setCompletionWarn(null)}>Cancel</button>
          </>
        ) : (
          <button className="dash-action-btn" style={{ background: 'oklch(28% 0.12 145 / 0.4)', borderColor: 'oklch(45% 0.12 145)' }}
            onClick={() => handleComplete(false)} disabled={completing}>
            {completing ? '…' : '✓ Mark Complete'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Forming mission card ──────────────────────────────────────────────────────

function FormingMissionCard({ mission }: { mission: GMMission }) {
  const { adminForceDeploy } = useGameState();
  const [deploying, setDeploying] = useState(false);
  const [now] = useState(() => Date.now());
  const maxSlots = currentMaxSlots(mission, now);
  const filled   = Object.keys(mission.participants ?? {}).length;
  const label    = missionDisplayLabel(mission);
  const participants = Object.values(mission.participants ?? {});

  const nextDecayMs = mission.firstJoinAt != null
    ? mission.firstJoinAt + Math.ceil((now - mission.firstJoinAt) / (24 * 3600_000)) * (24 * 3600_000) - now
    : null;

  const handleForceDeploy = async () => {
    setDeploying(true);
    try { await adminForceDeploy(mission.id); }
    finally { setDeploying(false); }
  };

  return (
    <div className="dash-tile-card">
      <div className="dash-tile-header">
        <div>
          <span className="dash-tile-name">{label}</span>
          <span className="dash-tile-state available" style={{ marginLeft: '0.5rem' }}>FORMING</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--gold-dim)' }}>{filled}/{maxSlots} slots</span>
          <button className="dash-action-btn" onClick={handleForceDeploy} disabled={deploying || filled === 0}>
            {deploying ? '…' : '⚑ Force Deploy'}
          </button>
        </div>
      </div>

      {nextDecayMs != null && (
        <div style={{ fontSize: '0.7rem', color: 'oklch(60% 0.08 60)', marginTop: '0.3rem' }}>
          Next slot decay in {Math.floor(nextDecayMs / 3600_000)}h {Math.floor((nextDecayMs % 3600_000) / 60_000)}m
        </div>
      )}
      {!mission.firstJoinAt && (
        <div style={{ fontSize: '0.7rem', color: 'var(--gold-dim)', marginTop: '0.3rem' }}>
          Timer starts on first enlist.
        </div>
      )}

      {participants.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <div className="dash-section-label">ENLISTED</div>
          {participants.map(p => (
            <div key={p.playerId} className="dash-player-tag" style={{ display: 'inline-block', margin: '0.2rem 0.3rem 0 0' }}>
              {p.playerName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MissionsPage() {
  const { gameState } = useGameState();
  const { addToast } = useToast();
  const missions = gameState?.missions ?? {};
  const [seeding, setSeeding] = useState(false);

  const active  = Object.values(missions).filter(m => m.state !== 'complete');
  const forming = active.filter(m => m.state === 'forming').sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const inprog  = active.filter(m => m.state === 'inprogress').sort((a, b) => (a.deployedAt ?? 0) - (b.deployedAt ?? 0));

  // History is stored at missionsHistory — not in game/missions, so we won't have it
  // in gameState. In a full implementation, this would be lazy-loaded. For now show a note.

  return (
    <div className="dash-page">
      <div className="dash-page-title">⚜ Guildmaster Missions</div>

      {inprog.length > 0 && (
        <section>
          <div className="dash-section-label" style={{ marginBottom: '0.75rem' }}>IN PROGRESS</div>
          {inprog.map(m => <InProgressMissionCard key={m.id} mission={m} />)}
        </section>
      )}

      {forming.length > 0 && (
        <section style={{ marginTop: '1.5rem' }}>
          <div className="dash-section-label" style={{ marginBottom: '0.75rem' }}>FORMING</div>
          {forming.map(m => <FormingMissionCard key={m.id} mission={m} />)}
        </section>
      )}

      {active.length === 0 && (
        <div className="dash-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          <span>No active missions.</span>
          <button
            className="dash-action-btn"
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              try {
                const created = await seedInitialMissions();
                addToast(created ? 'Missions seeded — Basic Training · Cohort I and Patrol · Cohort I are now live.' : 'Missions already exist.', 'success');
              } catch (err) {
                addToast(`Failed to seed missions: ${err instanceof Error ? err.message : String(err)}`, 'error');
              } finally {
                setSeeding(false);
              }
            }}
          >
            {seeding ? '…' : '⚜ Seed Initial Missions'}
          </button>
        </div>
      )}
    </div>
  );
}
