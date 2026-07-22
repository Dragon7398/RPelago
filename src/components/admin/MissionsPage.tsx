import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import type { GMMission, GMMissionState, GMParticipant, AdvSlot, SlotStatus, TriState, CasinoStats, CasinoLogEntry } from '../../types';
import { SLOT_STATUSES, toRoman } from '../../lib/constants';
import { useSeason } from '../../contexts/SeasonContext';
import { currentMaxSlots, missionDisplayLabel } from '../../lib/missionLogic';
import { seedInitialMissions, setMissionSlotLock, setMissionTracker, setMissionCheese, fetchCheesetrackerId, fetchCheeseDetails, adminUpdateParticipantSlotStatus, adminGetCasinoYamls, adminDenyCasinoYaml, type CasinoYaml } from '../../firebase/db';
import { fetchRoomStatus, extractApSlotName } from '../../lib/archipelagoApi';
import { GAMBIT_DEFS_BY_ID } from '../../lib/casinoGambits';
import { zipSync } from 'fflate';


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
        {isCasino && participant.yamlDenied && (
          <span className="casino-deny-badge" title="Config denied — awaiting the player's resubmit">⛔ resubmit pending</span>
        )}
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

// ── Casino audit log — verifies mission.pot against logged money events ───────

function describeCasinoLogEntry(e: CasinoLogEntry): string {
  switch (e.event) {
    case 'deal':
      return `${e.playerName} dealt ${e.game} — ${e.amount}g ante (${e.potAdd}g → pot)`;
    case 'reroll':
      return `${e.playerName} rerolled — ${e.amount}g (${e.potAdd}g → pot)`;
    case 'gambit': {
      const def = e.gambitDefId ? GAMBIT_DEFS_BY_ID[e.gambitDefId] : undefined;
      const label = def ? `${def.deltaLabel} ${def.statLabel}` : 'a gambit';
      return `${e.playerName} played ${label} — ${e.amount ?? 0}g cost, ${e.potAdd ?? 0}g → pot`;
    }
    case 'lock':
      return `${e.playerName} locked in ${e.game ?? ''} — ${e.goldSwing ?? 0}g${e.deckChoice ? ` (${e.deckChoice})` : ''}`;
    case 'fold':
      return `${e.playerName} folded${e.game ? ` (${e.game})` : ''}`;
    default:
      return e.playerName;
  }
}

function CasinoAuditLog({ mission }: { mission: GMMission }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(mission.casinoLog ?? {}).sort((a, b) => a[1].ts - b[1].ts);
  if (entries.length === 0) return null;

  const loggedTotal = entries.reduce((s, [, e]) => s + (e.potAdd ?? 0), 0);
  const actual      = mission.pot ?? 0;
  // The opening pot is variable (rollTableSetup) and banked at creation. Tables
  // created before casinoOpenPot existed fall back to (actual − logged), which
  // can't detect drift but won't raise a false alarm.
  const opening     = mission.casinoOpenPot ?? (actual - loggedTotal);
  const expected    = opening + loggedTotal;
  const mismatch    = expected !== actual;

  return (
    <div className="casino-log-block">
      <div className="casino-log-toggle" onClick={() => setOpen(o => !o)}>
        <span>AUDIT LOG ({entries.length})</span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <>
          <div className={`casino-log-check${mismatch ? ' warn' : ' ok'}`}>
            Pot check: {opening}g open + {loggedTotal}g logged = {expected}g expected vs {actual}g actual
            {mismatch ? ' ⚠ mismatch' : ' ✓'}
          </div>
          <div className="casino-log-list">
            {entries.map(([id, e]) => (
              <div key={id} className="casino-log-row">{describeCasinoLogEntry(e)}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Casino: download the seats' uploaded Slot-Fill YAMLs ─────────────────────

function sanitizeFile(name: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'player';
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function downloadText(fileName: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: 'text/yaml' }));
}

// Give each seat a distinct `<player>.yaml` filename, disambiguating any two
// players whose names sanitize to the same slug (…, …_2, …_3).
function yamlFileNames(yamls: CasinoYaml[]): string[] {
  const seen = new Map<string, number>();
  return yamls.map(y => {
    const base = sanitizeFile(y.playerName);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}${n > 1 ? `_${n}` : ''}.yaml`;
  });
}

// The host verifies + generates the Archipelago room from these. Fetched on demand
// (admin-only callable, which reads the owner-scoped bucket via the Admin SDK).
// Deliberately kept as separate files — YAMLs are verified one at a time and later
// replayed individually by other players — so downloads are per-seat or a .zip of
// all seats, never a combined single file.
function CasinoYamlDownload({ missionId, label }: { missionId: string; label: string }) {
  const { addToast } = useToast();
  const [yamls, setYamls]     = useState<CasinoYaml[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDeny, setConfirmDeny] = useState<string | null>(null);
  const [denyReason, setDenyReason]   = useState('');

  const openDeny = (uid: string) => { setConfirmDeny(uid); setDenyReason(''); };

  const load = async () => {
    setLoading(true);
    try {
      setYamls(await adminGetCasinoYamls(missionId));
    } catch (err) {
      addToast(`Could not load YAMLs: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Deny invalidates the stored config and flags the seat so the player must
  // resubmit. The file is gone afterwards, so drop it from the list.
  const deny = async (uid: string) => {
    try {
      await adminDenyCasinoYaml(missionId, uid, denyReason.trim() || undefined);
      setYamls(list => (list ?? []).filter(y => y.uid !== uid));
      setConfirmDeny(null);
      addToast('Config denied — the player must resubmit.', 'success');
    } catch (err) {
      addToast(`Deny failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  // A .zip of the individual per-seat files (still separate inside the archive),
  // for grabbing a whole table at once without collapsing them into one document.
  const downloadZip = () => {
    if (!yamls?.length) return;
    const names = yamlFileNames(yamls);
    const enc = new TextEncoder();
    const files: Record<string, Uint8Array> = {};
    yamls.forEach((y, i) => { files[names[i]] = enc.encode(y.text); });
    downloadBlob(`${sanitizeFile(label)}.zip`, new Blob([zipSync(files)], { type: 'application/zip' }));
  };

  const names = yamls ? yamlFileNames(yamls) : [];

  return (
    <div className="casino-yaml-block">
      {yamls === null ? (
        <button className="dash-action-btn" disabled={loading} onClick={load}>
          {loading ? 'Loading…' : '⬇ Player YAMLs'}
        </button>
      ) : yamls.length === 0 ? (
        <span className="dash-empty" style={{ padding: 0 }}>No YAMLs uploaded yet.</span>
      ) : (
        <div className="casino-yaml-list">
          <div className="casino-yaml-head">
            <span>{yamls.length} YAML{yamls.length === 1 ? '' : 's'} uploaded</span>
            <button className="dash-action-btn" onClick={downloadZip}>⬇ All (.zip)</button>
          </div>
          {yamls.map((y, i) => (
            <div key={y.uid} className="casino-yaml-row">
              <span className="casino-yaml-name">{y.playerName}</span>
              <span className="casino-yaml-acts">
                {/* ︎ = text-presentation selector: renders the glyph monochrome so it takes the CSS tint. */}
                <button className="dash-tile-link" title={`Download ${names[i]}`}
                        onClick={() => downloadText(names[i], y.text)}>{'⬇︎'}</button>
                {confirmDeny === y.uid ? (
                  <span className="casino-yaml-deny-confirm">
                    <input className="casino-yaml-reason" placeholder="Reason (optional — shown to player)"
                           value={denyReason} autoFocus
                           onChange={e => setDenyReason(e.target.value)}
                           onKeyDown={e => { if (e.key === 'Enter') deny(y.uid); if (e.key === 'Escape') setConfirmDeny(null); }} />
                    <button className="dash-action-btn danger" onClick={() => deny(y.uid)}>Deny</button>
                    <button className="dash-action-btn" onClick={() => setConfirmDeny(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="dash-tile-link deny" title="Deny — invalidate this config and require a resubmit"
                          onClick={() => openDeny(y.uid)}>{'⛔︎'}</button>
                )}
              </span>
            </div>
          ))}
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
        try {
          const cheeseId = await fetchCheesetrackerId(status.tracker);
          await setMissionCheese(mission.id, cheeseId);
          try {
            const games = await fetchCheeseDetails(cheeseId);
            const statusMap = new Map<string, SlotStatus>();
            for (const g of games) {
              const isGoal = g.tracker_status === 'goal_completed';
              const is100 = g.checks_total > 0 && g.checks_done === g.checks_total;
              const isInProgress = !isGoal && g.checks_done > 0 && g.checks_done < g.checks_total;
              const s = isGoal && is100 ? 'Done' as const : isGoal ? 'Goaled' as const : is100 ? '100%' as const : isInProgress ? 'In-Progress' as const : null;
              if (s) statusMap.set(extractApSlotName(g.name), s);
            }
            for (const [pid, p] of Object.entries(mission.participants ?? {})) {
              const slots = p.slots ?? [];
              for (let i = 0; i < slots.length; i++) {
                const newStatus = statusMap.get(slots[i].name);
                if (newStatus) await adminUpdateParticipantSlotStatus(mission.id, pid, i, newStatus);
              }
            }
          } catch { /* cheese details fetch is best-effort */ }
        } catch {
          // cheese fetch is best-effort
        }
      }
    } catch (err) {
      console.error('AP sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };
  const slotsLocked = mission.slotsLocked ?? false;
  // The slot ledger is the tallest part of a card, so it collapses. A room that
  // already has a link is one you're monitoring, not filling in — start it shut.
  // Mount-time only, deliberately: setting the link on a live panel must not yank
  // the section closed while the host is still working in it.
  const [slotsOpen, setSlotsOpen] = useState(() => !mission.link);
  const [now] = useState(() => Date.now());

  const label        = missionDisplayLabel(mission);
  const participants = Object.entries(mission.participants ?? {});
  const filled       = participants.length;
  const maxSlots     = currentMaxSlots(mission, now);
  const needsRoom    = mission.state === 'forming'
    ? (filled > 0 && maxSlots > 0 && filled >= maxSlots)
    : !mission.link;
  const readyToComplete = mission.state === 'inprogress' && participants.length > 0 && participants.every(([, p]) => {
    const slots = p.slots ?? [];
    return slots.length > 0 && slots.every(s => s.status === 'Done' || s.status === 'Goaled');
  });

  // Progress at a glance, for the collapsed SLOTS header.
  const allSlots   = participants.flatMap(([, p]) => p.slots ?? []);
  const totalSlots = allSlots.length;
  const doneSlots  = allSlots.filter(s => s.status === 'Done' || s.status === 'Goaled').length;

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
        {needsRoom && (
          <span className="dash-room-warn" title={mission.state === 'forming' ? 'Mission is full — will auto-deploy soon, prepare a room' : 'Mission is In Progress but has no room URL'}>⚠</span>
        )}
        {readyToComplete && (
          <span className="dash-complete-ready" title="All slots are Goaled/Done — ready to mark Complete">✓</span>
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
        {mission.cheese && (
          <a className="dash-tile-link" href={`https://cheesetrackers.theincrediblewheelofchee.se/tracker/${mission.cheese}`} target="_blank" rel="noopener noreferrer" title="Open Cheesetracker">🧀</a>
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

      {/* Casino: audit trail of every money-moving/outcome event, for pot verification */}
      {mission.type === 'casino' && <CasinoAuditLog mission={mission} />}

      {/* Casino: download the seats' uploaded Slot-Fill YAMLs (host verify / room gen) */}
      {mission.type === 'casino' && <CasinoYamlDownload missionId={mission.id} label={missionDisplayLabel(mission)} />}

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
                  if (mission.cheese) text += `\nhttps://cheesetrackers.theincrediblewheelofchee.se/tracker/${mission.cheese} (optional)`;
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

      {/* Slots — collapsible; the header carries a summary while collapsed */}
      <div className="admin-detail-row" style={{ marginTop: '0.75rem', marginBottom: '0.4rem', alignItems: 'center' }}>
        <button className="admin-slots-toggle" onClick={() => setSlotsOpen(o => !o)} aria-expanded={slotsOpen}>
          <span className="admin-slots-caret">{slotsOpen ? '▾' : '▸'}</span>
          SLOTS
          {!slotsOpen && (
            <span className="admin-slots-summary">
              {participants.length} seat{participants.length === 1 ? '' : 's'}
              {totalSlots > 0 && ` · ${doneSlots}/${totalSlots} done`}
            </span>
          )}
        </button>
        <button className={`admin-slot-lock-btn${slotsLocked ? ' locked' : ''}`} onClick={() => setMissionSlotLock(mission.id, !slotsLocked)}>
          {slotsLocked ? '🔒 LOCKED' : '🔓 LOCK'}
        </button>
      </div>
      {slotsOpen && (participants.length > 0 ? participants.map(([pid, p]) => (
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
      ))}
    </div>
  );
}

// ── Season-level money-in audit ─────────────────────────────────────────────────
// The per-table CasinoAuditLog only sees one mission. This is the season view of
// gold ENTERING the economy: weekly floor top-ups (logged) + pot seeds (each table
// starts with a seeded pot, so every table ever opened injected that much).
function GoldTopUpAudit() {
  const { gameState } = useGameState();
  const [open, setOpen] = useState(false);

  const entries = Object.entries(gameState?.goldTopUpLog ?? {}).sort((a, b) => b[1].ts - a[1].ts);
  const topupTotal = entries.reduce((s, [, e]) => s + (e.granted ?? 0), 0);
  const players    = new Set(entries.map(([, e]) => e.uid)).size;

  // Pot seeds are variable per table (rollTableSetup), banked as casinoOpenPot at
  // creation. Sum the actual opening pots — the injected-via-pot money — across
  // every casino table ever opened (live + settled).
  const casinoTables = [...Object.values(gameState?.missions ?? {}), ...Object.values(gameState?.missionsHistory ?? {})]
    .filter(m => m.type === 'casino');
  const tableCount   = casinoTables.length;
  const potSeedTotal = casinoTables.reduce((s, m) => s + (m.casinoOpenPot ?? 0), 0);

  const fmtWhen = (ts: number) =>
    new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="casino-topup-block">
      <div className="casino-log-toggle" onClick={() => setOpen(o => !o)}>
        <span>💰 Season money-in · {(topupTotal + potSeedTotal).toLocaleString()}g</span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <>
          <div className="casino-topup-sums">
            <span>Gold-floor top-ups: <b>{topupTotal.toLocaleString()}g</b> · {entries.length} event{entries.length === 1 ? '' : 's'} · {players} player{players === 1 ? '' : 's'}</span>
            <span>Pot seeds: <b>{potSeedTotal.toLocaleString()}g</b> · opening pots across {tableCount} table{tableCount === 1 ? '' : 's'}</span>
          </div>
          <div className="casino-log-list">
            {entries.length === 0
              ? <div className="casino-log-row casino-topup-empty">No floor top-ups yet — nobody has dipped below the gold floor.</div>
              : entries.map(([id, e]) => (
                  <div key={id} className="casino-log-row casino-topup-row">
                    <span className="casino-topup-when">{fmtWhen(e.ts)}</span>
                    <span className="casino-topup-name">{e.playerName}</span>
                    <span className="casino-topup-amt">+{e.granted.toLocaleString()}g</span>
                    <span className="casino-topup-bal">→ {e.resultingBalance.toLocaleString()}g</span>
                  </div>
                ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

// Casino and non-casino missions now live in separate admin tabs (permanent
// split — casino gets its own tab in every season). One component serves both,
// filtered by mission type; each MissionCard already renders casino vs map
// details from `mission.type`.
type MissionFilter = 'casino' | 'noncasino' | 'all';

export default function MissionsPage({ filter = 'all' }: { filter?: MissionFilter }) {
  const { gameState } = useGameState();
  const { addToast }  = useToast();
  const [seeding, setSeeding] = useState(false);

  // New cohorts spawn only while the season is draft or active — a closing or
  // archived season is winding down (mirrors gmSpawnAllowed server-side).
  const { season } = useSeason();
  const seedAllowed = season?.status === 'draft' || season?.status === 'active';
  // The seed/open button belongs on the tab that matches the season's native
  // mission kind: the Casino tab in a casino season, the Missions tab in a map
  // season. (S2's casino-in-a-map-season seeding is a separate future concern.)
  const nativeFilter: MissionFilter = season?.shell === 'casino' ? 'casino' : 'noncasino';
  const canSeedHere = filter === 'all' || filter === nativeFilter;
  const isCasinoTab = filter === 'casino';

  const missions = gameState?.missions ?? {};
  const matchesFilter = (m: GMMission) =>
    filter === 'all' ? true : filter === 'casino' ? m.type === 'casino' : m.type !== 'casino';
  const active   = Object.values(missions).filter(m => m.state !== 'complete' && matchesFilter(m));
  const forming  = active.filter(m => m.state === 'forming')   .sort((a, b) => (a.createdAt  ?? 0) - (b.createdAt  ?? 0));
  const inprog   = active.filter(m => m.state === 'inprogress').sort((a, b) => (a.deployedAt ?? 0) - (b.deployedAt ?? 0));

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const { shell, created } = await seedInitialMissions();
      addToast(
        created === 0
          ? 'Nothing to seed — this season already has its cohorts open.'
          : shell === 'casino'
            ? `Opened ${created} casino table${created === 1 ? '' : 's'}, each pinned to a game.`
            : `Seeded ${created} mission cohort${created === 1 ? '' : 's'}.`,
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
      <h2 className="dash-page-title">{isCasinoTab ? '🂡 Casino Tables' : '⚜ Guildmaster Missions'}</h2>

      {isCasinoTab && <GoldTopUpAudit />}

      <div className="dash-challenges-cols">
        <div className="dash-col">
          <div className="dash-col-header">
            <span>Forming</span>
            <span className="dash-col-count">{forming.length}</span>
          </div>
          {forming.length === 0 ? (
            <div className="dash-empty" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
              <span>No forming {isCasinoTab ? 'tables' : 'missions'}.</span>
              {active.length === 0 && canSeedHere && (
                seedAllowed ? (
                  <button className="dash-action-btn" disabled={seeding} onClick={handleSeed}>
                    {seeding ? '…' : season?.shell === 'casino' ? '🂡 Open Casino Tables' : '⚜ Seed Initial Missions'}
                  </button>
                ) : (
                  <span className="dash-empty" style={{ padding: 0 }}>New {isCasinoTab ? 'tables are' : 'missions are'} closed for this season.</span>
                )
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
