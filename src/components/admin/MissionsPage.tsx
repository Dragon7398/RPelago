import { useEffect, useMemo, useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import type { GMMission, GMMissionState, GMParticipant, AdvSlot, SlotStatus, TriState, CasinoStats, CasinoLogEntry } from '../../types';
import { SLOT_STATUSES, toRoman } from '../../lib/constants';
import { useSeason } from '../../contexts/SeasonContext';
import { currentMaxSlots, fmtDayClock, missionDisplayLabel, seatTally, sourcedGameLists, gameNoveltyInYaml, type GameToFetch } from '../../lib/missionLogic';
import { currentApList } from '../../lib/apLists';
import { seedInitialMissions, setMissionSlotLock, setMissionTracker, setMissionCheese, fetchCheesetrackerId, fetchCheeseDetails, adminUpdateParticipantSlotStatus, adminUpdateParticipantSlotActivity, adminUpdateParticipantSlotName, adminGetCasinoYamls, adminDenyCasinoYaml, adminRemoveCasinoSlot, adminVoidCasinoSeat, adminReleaseClaimableSlot, freeMissionClaim, type CasinoYaml } from '../../firebase/db';
import { fetchRoomStatus, extractApSlotName, parseCheeseTs, deriveSlotStatus, resolveNumberedSlotName } from '../../lib/archipelagoApi';
import { slotsAllFree, claimEntries } from '../../lib/slotHelpers';
import { checkProgressionBalancing } from '../../lib/apYaml';
import { GAMBIT_DEFS_BY_ID } from '../../lib/casinoGambits';
import { zipSync } from 'fflate';


const MISSION_STATE_BUTTONS: { state: GMMissionState; label: string; cls: string }[] = [
  { state: 'forming',    label: 'Forming',     cls: 'btn-available'  },
  { state: 'inprogress', label: 'In Progress', cls: 'btn-inprogress' },
  { state: 'complete',   label: 'Complete',    cls: 'btn-complete'   },
];

// ── Per-participant slot editor — mirrors AdvSlotEditor UX exactly ─────────────

function MissionParticipantSlots({
  missionId, playerId, participant, locked, isCasino, isLive, mismatchedNames, onKick,
}: {
  missionId: string;
  playerId: string;
  participant: GMParticipant;
  locked: boolean;
  isCasino?: boolean;
  /** Mission is in progress — a room exists, so a kicked slot can actually be taken over. */
  isLive?: boolean;
  mismatchedNames?: Set<string>;
  onKick: () => void;
}) {
  const { adminSetParticipantSlots, adminUpdateParticipantSlotStatus } = useGameState();
  const { addToast } = useToast();
  const slots = participant.slots ?? [];
  const [draft, setDraft] = useState<{ name: string; game: string; details: string; status: SlotStatus; bonusXP: number; bonusGold: number }>({
    name: '', game: '', details: '', status: 'Unstarted', bonusXP: 0, bonusGold: 0,
  });
  // Removals come in two flavours at two scopes, and the difference is always the
  // same one: where the removed slot's share of the pot goes.
  //
  //   VOID — the slot is dead. Nobody can take it over, and its pot weight returns
  //          to the table, raising every remaining seat's share. No warning: this
  //          says the card was unplayable, not that the player walked away.
  //   KICK — the Archipelago slot is still good, so it reopens as a claimable slot
  //          carrying its card and pot fraction, reserved for whoever takes it (and
  //          unpaid if nobody does). Punitive, so it also warns the player.
  // Whether the void/kick choice is offered at all. It only means something on a
  // LIVE casino table, where a removed slot is a real Archipelago slot someone else
  // could pick up. Before deploy there is nothing to hand on, so the two collapse
  // into one no-fault removal.
  const splitRemoval = !!isCasino && !!isLive;
  const [confirmSeat, setConfirmSeat] = useState<null | 'void' | 'kick'>(null);
  const [confirmDel, setConfirmDel]   = useState<null | { i: number; mode: 'void' | 'kick' }>(null);
  const [delBusy, setDelBusy]         = useState(false);
  const [seatBusy, setSeatBusy]       = useState(false);

  const save = (next: AdvSlot[]) => adminSetParticipantSlots(missionId, playerId, next);

  // A casino slot can't be dropped with a plain `save()`: the seat's lockedCards
  // (index-aligned, and the only record of each card's gold value) and its stored
  // goldSwing have to move with it, so removal goes through a callable that does
  // all three atomically. Every other mission type is a straight slot filter.
  const removeSlot = async (i: number, mode: 'void' | 'kick') => {
    if (!isCasino) { save(slots.filter((_, j) => j !== i)); setConfirmDel(null); return; }
    setDelBusy(true);
    try {
      const { goldSwing, remaining } = await adminRemoveCasinoSlot(missionId, playerId, i, mode);
      addToast(mode === 'kick'
        ? `Card kicked — reopened as an open slot. ${remaining} left on this seat, reward now ${goldSwing}g.`
        : isLive
          ? `Card voided — its share returns to the table. ${remaining} left on this seat, reward now ${goldSwing}g.`
          : `Card voided. ${remaining} left on this seat, reward now ${goldSwing}g.`,
        'success');
      setConfirmDel(null);
    } catch (err) {
      addToast(`Could not remove slot: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setDelBusy(false);
    }
  };

  const removeSeat = async (mode: 'void' | 'kick') => {
    if (mode === 'kick') { onKick(); setConfirmSeat(null); return; }
    setSeatBusy(true);
    try {
      await adminVoidCasinoSeat(missionId, playerId);
      addToast(isLive
        ? `${participant.playerName}'s seat voided — its whole share returns to the table.`
        : `${participant.playerName} removed from the table — they forfeit what they anted in.`, 'success');
      setConfirmSeat(null);
    } catch (err) {
      addToast(`Could not void seat: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setSeatBusy(false);
    }
  };

  return (
    <div className="admin-slot-adv">
      <div className="admin-slot-adv-header">
        <span className="admin-slot-adv-name">{participant.playerName}</span>
        {isCasino && participant.yamlDenied && (
          <span className="casino-deny-badge" title="Config denied — awaiting the player's resubmit">⛔ resubmit pending</span>
        )}
        {confirmSeat ? (
          <span className="admin-remove-confirm">
            <span className="admin-remove-explain">
              {!splitRemoval
                ? isCasino
                  ? `Remove ${participant.playerName} from this table? Nothing has deployed yet, so there is nothing to hand on — they simply forfeit everything they have anted in. No warning is recorded.`
                  : `Kick ${participant.playerName}? Their slots reopen for a replacement and they are warned.`
                : confirmSeat === 'kick'
                  ? `Kick ${participant.playerName}? Each of their ${slots.length} card${slots.length === 1 ? '' : 's'} reopens as its own open slot, carrying its share of the pot. They are warned and keep nothing.`
                  : `Void ${participant.playerName}'s seat? Every card is killed — nobody can take them over — and the seat's whole share of the pot returns to the table. No warning is recorded.`}
            </span>
            <button
              className="dash-action-btn danger"
              style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
              disabled={seatBusy}
              onClick={() => void removeSeat(confirmSeat)}
            >{seatBusy ? '…'
              : !splitRemoval ? 'Confirm Remove'
              : confirmSeat === 'kick' ? 'Confirm Kick' : 'Confirm Void'}</button>
            <button
              className="dash-action-btn"
              style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
              disabled={seatBusy}
              onClick={() => setConfirmSeat(null)}
            >Cancel</button>
          </span>
        ) : (
          <span style={{ display: 'flex', gap: '0.3rem' }}>
            {/* Void vs kick is a LIVE-table distinction: it only means something once
                there is an Archipelago slot that could be handed to someone else. On a
                forming table both collapse into one no-fault removal — the forfeited
                ante is the whole penalty, so there is no second choice to offer. */}
            {splitRemoval && (
              <button className="dash-void-btn" onClick={() => setConfirmSeat('void')}
                title="Void the whole seat — kills every card, returns its share to the table, no warning">
                ⊘⊘ Void seat
              </button>
            )}
            <button className={splitRemoval || !isCasino ? 'dash-kick-btn' : 'dash-void-btn'}
              onClick={() => setConfirmSeat(splitRemoval || !isCasino ? 'kick' : 'void')}
              title={!splitRemoval && isCasino
                ? 'Remove this seat — no replacement, no warning; they forfeit what they anted in'
                : isCasino
                  ? 'Kick the whole seat — every card reopens as an open slot for someone else, and the player is warned'
                  : 'Kick this player from the mission'}>
              {!isCasino ? 'Kick' : splitRemoval ? '✕✕ Kick seat' : '⊘ Remove seat'}
            </button>
          </span>
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
          {!locked && (confirmDel?.i === i ? (
            <span className="admin-remove-confirm">
              <span className="admin-remove-explain">
                {confirmDel.mode === 'kick'
                  ? 'Reopen this card as an open slot? Its share of the pot is held for whoever takes it — and goes unpaid if nobody does. The player is warned.'
                  : !isCasino
                    ? 'Remove this slot?'
                    : isLive
                      ? "Void this card? Nobody can take it over, and its share of the pot returns to the table. The player keeps the rest of their hand and isn't warned."
                      : "Void this card? The table has not deployed, so no pot shares exist yet — the seat simply loses this card and its value. The player can still re-pick their own cards while the table is forming, which is usually the better route."}
              </span>
              <button
                className="dash-action-btn danger"
                style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
                disabled={delBusy}
                onClick={() => removeSlot(i, confirmDel.mode)}
              >{delBusy ? '…' : !isCasino ? 'Remove' : confirmDel.mode === 'kick' ? 'Confirm Kick' : 'Confirm Void'}</button>
              <button
                className="dash-action-btn"
                style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
                disabled={delBusy}
                onClick={() => setConfirmDel(null)}
              >Cancel</button>
            </span>
          ) : (
            <span style={{ display: 'flex', gap: '0.2rem' }}>
              <button
                className={`admin-slot-del${isCasino ? ' void' : ''}`}
                title={isCasino
                  ? 'Void this card — kills the slot outright and returns its share of the pot to the table'
                  : 'Remove slot'}
                onClick={() => setConfirmDel({ i, mode: 'void' })}
              >{isCasino ? '⊘' : '✕'}</button>
              {/* Kicking a card offers it to a replacement, which only means anything
                  once there's a room to join — before deploy there is nothing to take over. */}
              {isCasino && isLive && (
                <button
                  className="admin-slot-del"
                  title="Kick this card — reopens it as an open slot another player can take over"
                  onClick={() => setConfirmDel({ i, mode: 'kick' })}
                >✕</button>
              )}
            </span>
          ))}
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
    case 'adminvoid':
      return `Host struck ${e.cardName ? `${e.cardName} from ` : 'a card from '}${e.playerName} — reward now ${e.goldSwing ?? 0}g`;
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

// One flag beside a seat's name for the APworlds it still costs the host:
//   NEW — never downloaded for any other room; fetch it from the current sheet.
//   OLD — downloaded, but back on an older sheet, so it may have been updated
//         since; check it against the current one before generating.
// A game already fetched under the current list is in neither bucket and shows
// nothing. The word carries the meaning, so the colours are only reinforcement.
function FetchBadge({ kind, games }: { kind: 'new' | 'old'; games: GameToFetch[] }) {
  if (games.length === 0) return null;
  const list  = currentApList().label;
  const names = games.map(g => (kind === 'old' && g.seenOn ? `${g.title} — last got it ${g.seenOn.label}` : g.title));
  const lead  = kind === 'new'
    ? `Never downloaded for another room. Grab from the ${list} list:`
    : `Downloaded before the ${list} list — check it there for an update:`;
  return (
    <span className={`casino-yaml-fetch ${kind}`} title={`${lead}\n• ${names.join('\n• ')}`}>
      {kind === 'new' ? 'NEW' : 'OLD'}{games.length > 1 ? ` ×${games.length}` : ''}
    </span>
  );
}

// The host verifies + generates the Archipelago room from these. Fetched on demand
// (admin-only callable, which reads the owner-scoped bucket via the Admin SDK).
// Deliberately kept as separate files — YAMLs are verified one at a time and later
// replayed individually by other players — so downloads are per-seat or a .zip of
// all seats, never a combined single file.
function CasinoYamlDownload({ missionId, label }: { missionId: string; label: string }) {
  const { addToast } = useToast();
  const { gameState } = useGameState();
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

  // Every game already downloaded for some OTHER room — a live table with a link
  // or a settled one — mapped to the newest APworld-list era it was fetched under.
  // This table is excluded on purpose: its own games are the ones being verified
  // right now, and none of them has been sourced yet, so two seats here asking for
  // the same unfamiliar game are both correctly flagged.
  const sourced = useMemo(
    () => sourcedGameLists(
      [...Object.values(gameState?.missions ?? {}), ...Object.values(gameState?.missionsHistory ?? {})],
      missionId,
    ),
    [gameState?.missions, gameState?.missionsHistory, missionId],
  );

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
            <span>
              {yamls.length} YAML{yamls.length === 1 ? '' : 's'} uploaded
              {/* Names the sheet the NEW/OLD flags below are judged against, so the
                  badges never have to be taken on trust after a list changes. */}
              <span className="casino-yaml-list-note"> · vs. {currentApList().label} list</span>
            </span>
            <button className="dash-action-btn" onClick={downloadZip}>⬇ All (.zip)</button>
          </div>
          {yamls.map((y, i) => {
            // Screened here in the host's own browser from the downloaded config —
            // the player's submit gate blocks reject-level PB, so anything flagged
            // here (esp. a ⛔) slipped past the client and is worth a look / deny.
            const pb = checkProgressionBalancing(y.text);
            // Flags the APworlds this seat still costs the host before the room can
            // be generated: NEW = never downloaded, OLD = downloaded off an earlier
            // sheet and due a look at the current one's "updated" column.
            const { brandNew, outdated } = gameNoveltyInYaml(y.text, sourced);
            return (
            <div key={y.uid} className="casino-yaml-row">
              <span className="casino-yaml-name">
                {y.playerName}
                <FetchBadge kind="new" games={brandNew} />
                <FetchBadge kind="old" games={outdated} />
                {pb.map((f, j) => (
                  <span key={j} className={`casino-yaml-pb ${f.severity}`}
                        title={`${f.world}: ${f.message}`}>
                    {f.severity === 'reject' ? '⛔' : '⚠'} PB {f.value}
                  </span>
                ))}
              </span>
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
            );
          })}
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
      const apNames = status.players.map(([name]: [string, string]) => name);
      // A `{NUMBER}` name never matches the room as typed — AP expanded the token at
      // generation. Adopt the generated name when it's unambiguous; anything still
      // holding a token falls through to the mismatch list for the host to map.
      const parts = Object.entries(mission.participants ?? {})
        .map(([pid, p]) => ({ pid, slots: (p.slots ?? []).map(s => ({ ...s })) }));
      for (const { pid, slots } of parts) {
        for (let i = 0; i < slots.length; i++) {
          const real = resolveNumberedSlotName(slots[i].name, apNames);
          if (!real) continue;
          slots[i].name = real;
          await adminUpdateParticipantSlotName(mission.id, pid, i, real);
        }
      }
      const apNameSet = new Set(apNames);
      const allSlots = parts.flatMap(p => p.slots);
      const mismatched = new Set(allSlots.map(s => s.name).filter(n => n && !apNameSet.has(n)));
      setMismatchedNames(mismatched);
      if (status.tracker) {
        await setMissionTracker(mission.id, status.tracker);
        try {
          const cheeseId = await fetchCheesetrackerId(status.tracker);
          await setMissionCheese(mission.id, cheeseId);
          try {
            const games = await fetchCheeseDetails(cheeseId);
            const statusMap = new Map<string, SlotStatus>();
            // last_activity = STRONG server-verified activity; last_checked = WEAK
            // manual self-report. Absent on the tracker → null. Recorded for every
            // slot, whether or not its status changed.
            const timeMap = new Map<string, { lastChecked: number | null; lastActivity: number | null }>();
            for (const g of games) {
              const key = extractApSlotName(g.name);
              const s = deriveSlotStatus(g);
              if (s) statusMap.set(key, s);
              timeMap.set(key, { lastChecked: parseCheeseTs(g.last_checked), lastActivity: parseCheeseTs(g.last_activity) });
            }
            for (const { pid, slots } of parts) {
              for (let i = 0; i < slots.length; i++) {
                const newStatus = statusMap.get(slots[i].name);
                if (newStatus) await adminUpdateParticipantSlotStatus(mission.id, pid, i, newStatus);
                const t = timeMap.get(slots[i].name);
                if (t) await adminUpdateParticipantSlotActivity(mission.id, pid, i, t.lastChecked, t.lastActivity);
              }
              // Pooled claims: if this sync leaves all the participant's slots
              // terminal and they still hold this mission's claim, release it —
              // the mission analogue of freeing a tile adventurer (mirrors the
              // server tick block in tickSlotStatuses).
              const resolved = slots.map(s => ({ status: statusMap.get(s.name) ?? s.status }));
              if (mission.state === 'inprogress'
                  && slotsAllFree(resolved)
                  && gameState?.players?.[pid]?.activeMissions?.[mission.id]) {
                await freeMissionClaim(pid, mission.id);
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
  // Ticks the Elapsed / since-report clocks below. A status-report monitor is only
  // useful if the times advance live, so re-render once a second rather than only
  // on RTDB changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const label        = missionDisplayLabel(mission);
  const participants = Object.entries(mission.participants ?? {});
  const filled       = participants.length;
  const maxSlots     = currentMaxSlots(mission, now);
  const tally        = seatTally(mission, now);   // display-only; `maxSlots` still drives the logic below
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

  // Elapsed clock origin: the room link going up is when play can actually start,
  // matching the player-facing PhasePanel. Fall back through deploy → first join →
  // creation so every card — forming or in progress — always shows something.
  const clockOrigin = mission.linkedAt ?? mission.deployedAt ?? mission.firstJoinAt ?? mission.createdAt;
  const elapsed     = clockOrigin != null ? fmtDayClock((now - clockOrigin) / 1000) : '—';
  // "Since last report" runs from the most recent status report; with none filed
  // yet (feature lands next task) it falls back to the Elapsed origin.
  const reportOrigin = mission.lastReportAt ?? clockOrigin;
  const sinceReport  = reportOrigin != null ? fmtDayClock((now - reportOrigin) / 1000) : '—';

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
        <span style={{ fontSize: '0.65rem', color: 'var(--gold-dim)', marginLeft: 'auto' }} title={tally.title}>{tally.label}</span>
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

      {/* Elapsed + time-since-last-report clocks — for admin status-report cadence */}
      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', fontSize: '0.62rem', color: 'var(--gold-dim)', marginTop: '0.3rem' }}>
        <span>Elapsed <b style={{ color: 'var(--parchment)', fontVariantNumeric: 'tabular-nums' }}>{elapsed}</b></span>
        <span>
          Since report <b style={{ color: 'var(--parchment)', fontVariantNumeric: 'tabular-nums' }}>{sinceReport}</b>
          {mission.lastReportAt == null && <span style={{ opacity: 0.6 }}> (none yet)</span>}
        </span>
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
          isLive={mission.state === 'inprogress'}
          mismatchedNames={mismatchedNames}
          onKick={() => adminKickMissionParticipant(mission.id, pid)}
        />
      )) : (
        <div className="dash-empty">No participants yet.</div>
      ))}
      {slotsOpen && <MissionClaimableSlots mission={mission} />}
    </div>
  );
}

// ── Open (claimable) slots ────────────────────────────────────────────────────
// Kicked slots waiting for a replacement. Nothing else in the admin surfaces
// these, so without this panel a slot could sit open (holding its share of the
// pot hostage) with no way to see it, let alone withdraw it.
function MissionClaimableSlots({ mission }: { mission: GMMission }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const entries = claimEntries(mission);
  if (entries.length === 0) return null;

  const release = async (key: string) => {
    setBusy(key);
    try {
      await adminReleaseClaimableSlot(mission.id, key);
      addToast('Open slot withdrawn — its share of the pot returns to the table.', 'success');
      setConfirm(null);
    } catch (err) {
      addToast(`Could not withdraw slot: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally { setBusy(null); }
  };

  return (
    <div className="admin-claimable">
      <div className="admin-claimable-head">
        ⚐ OPEN SLOTS <span className="admin-claimable-count">{entries.length}</span>
        <span className="admin-claimable-note">
          waiting for a replacement — each holds its share of the pot until claimed
        </span>
      </div>
      {entries.map(([key, entry]) => {
        const slot = entry.slots[0];
        const pct  = entry.potFraction ? Math.round(entry.potFraction * 100) : 0;
        return (
          <div key={key} className="admin-claimable-row">
            <span className="admin-claimable-card">
              {entry.card?.name ?? slot?.name ?? '—'}
              {entry.card?.value != null && <b> {entry.card.value}g</b>}
            </span>
            <span className="admin-claimable-game">{slot?.game?.trim() || '—'}</span>
            <span className="admin-claimable-status">{slot?.status ?? 'Unstarted'}</span>
            {pct > 0 && <span className="admin-claimable-share" title="Share of one seat's pot cut, reserved for the claimant">{pct}% share</span>}
            {entry.fromPlayerName && <span className="admin-claimable-from">from {entry.fromPlayerName}</span>}
            {confirm === key ? (
              <span className="admin-remove-confirm">
                <span className="admin-remove-explain">
                  Withdraw this open slot? Nobody will be able to take it over, and the
                  {pct > 0 ? ` ${pct}% ` : ' '}share it is holding returns to the table.
                </span>
                <button className="dash-action-btn danger" style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
                  disabled={busy !== null} onClick={() => void release(key)}>
                  {busy === key ? '…' : 'Confirm'}
                </button>
                <button className="dash-action-btn" style={{ fontSize: '0.6rem', padding: '0.18rem 0.45rem' }}
                  disabled={busy !== null} onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <button className="admin-slot-del void" title="Withdraw this open slot and return its share to the table"
                onClick={() => setConfirm(key)}>⊘</button>
            )}
          </div>
        );
      })}
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
  // The ledger holds two kinds of injection. `kind` is absent on every entry
  // weeklyGoldTopUp has ever written, so a missing value means WEEKLY.
  const manual      = entries.filter(([, e]) => e.kind === 'manual');
  const manualTotal = manual.reduce((s, [, e]) => s + (e.granted ?? 0), 0);
  const weeklyTotal = topupTotal - manualTotal;

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
            <span>Gold-floor top-ups: <b>{weeklyTotal.toLocaleString()}g</b> · {entries.length - manual.length} event{entries.length - manual.length === 1 ? '' : 's'} · {players} player{players === 1 ? '' : 's'}</span>
            <span>Admin grants: <b>{manualTotal.toLocaleString()}g</b> · {manual.length} adjustment{manual.length === 1 ? '' : 's'}</span>
            <span>Pot seeds: <b>{potSeedTotal.toLocaleString()}g</b> · opening pots across {tableCount} table{tableCount === 1 ? '' : 's'}</span>
          </div>
          <div className="casino-log-list">
            {entries.length === 0
              ? <div className="casino-log-row casino-topup-empty">No outside gold yet — nobody has dipped below the floor, and no hand-adjustments have been made.</div>
              : entries.map(([id, e]) => (
                  <div key={id} className="casino-log-row casino-topup-row">
                    <span className="casino-topup-when">{fmtWhen(e.ts)}</span>
                    <span className="casino-topup-name">{e.playerName}</span>
                    {e.kind === 'manual' && (
                      <span className="casino-topup-tag" title={e.reason || 'Hand-adjusted by the admin on the Players page'}>
                        ADMIN
                      </span>
                    )}
                    {/* granted may be negative (a manual clawback), so the sign is
                        formatted rather than hardcoded to "+". */}
                    <span className={`casino-topup-amt${e.granted < 0 ? ' neg' : ''}`}>
                      {e.granted < 0 ? '−' : '+'}{Math.abs(e.granted).toLocaleString()}g
                    </span>
                    <span className="casino-topup-bal">→ {e.resultingBalance.toLocaleString()}g</span>
                    {e.reason && <span className="casino-topup-why">{e.reason}</span>}
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
