import { useState, type ReactNode } from 'react';
import type { AdvSlot, GMMission, GMParticipant, SlotStatus } from '../../types';
import type { CasinoGame } from '../../lib/casinoData';
import { casinoSeatPaid, currentMaxSlots, fmtClock, missionDisplayLabel } from '../../lib/missionLogic';
import { useSeason } from '../../contexts/SeasonContext';
import OddsTrio from './OddsTrio';

// The single panel above the table list. Its phase is backend-owned — mission
// state IS the phase (forming → Seated, inprogress → Board, complete → Ledger) —
// so there is no local phase state to drift out of sync with the server.
//
//   Seated  — what you're holding, what's on the table, who else is here.
//   Board   — the room's live progress once every seat has played.
//   Ledger  — who took what, after the table settles.

const tableGame = (m: GMMission): CasinoGame => (m.casinoGame ?? 'five_card_draw') as CasinoGame;

const GOALED: SlotStatus[] = ['Goaled', 'Done'];
const isGoaled = (s?: SlotStatus) => !!s && GOALED.includes(s);

/**
 * The table is a standalone Vite entry with no SeasonProvider, so it can only
 * learn its season from this link. Without `seasonId` it falls back to
 * config/activeSeasonId — which is the WRONG season for anyone playtesting a
 * draft, and it then looks for the mission under the active season and reports
 * "Mission not found or unavailable."
 */
function tableHref(m: GMMission, seasonId: string): string | null {
  if (!m.tableUrl) return null;
  const p = new URLSearchParams({ missionId: m.id, mission: m.label, cohort: String(m.series), seasonId });
  return `${m.tableUrl}?${p}`;
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function Panel({ kick, name, sub, children }: { kick: string; name: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="rl-phase">
      <div className="rl-phase-head">
        <div className="rl-ct-kick">{kick}</div>
        <div className="rl-ct-name">{name}</div>
        {sub && <p className="rl-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'gold' | 'pos' | 'neg' }) {
  return (
    <div className="rl-mini">
      <span className="rl-mini-lbl">{label}</span>
      <span className={`rl-mini-val${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

const gold = (n: number) => <>{n}<small>g</small></>;
const signed = (n: number) => <>{n >= 0 ? '+' : '−'}{Math.abs(n)}<small>g</small></>;

function SlotPill({ slot }: { slot: AdvSlot }) {
  const done = isGoaled(slot.status);
  return (
    <span className={`rl-slotpill${done ? ' goaled' : ''}`} title={slot.details || undefined}>
      {done && <span className="rl-tick" aria-hidden>✓</span>}
      <span className="rl-slotpill-game">{slot.game?.trim() || 'Unfilled'}</span>
      {slot.status && <span className="rl-slotpill-st">{slot.status}</span>}
    </span>
  );
}

// ── Seated (mission forming) ──────────────────────────────────────────────────

/**
 * What this seat is currently holding. Deliberately game-aware: Hold 'Em's two
 * sittings mean "locked" is not one state, and a seat waiting on the community
 * reveal needs to know it's waiting rather than that it's done.
 */
function seatStanding(m: GMMission, seat: GMParticipant): { badge: string; take: number | null; note: string } {
  const game = tableGame(m);
  if (seat.played) {
    return { badge: 'Hand locked', take: seat.goldSwing ?? 0, note: 'Your take is paid out when the table settles.' };
  }
  if (game === 'holdem') {
    if (!seat.holeLocked)   return { badge: 'Not dealt in', take: null, note: 'Head to the table for your hole cards.' };
    if (!m.communityDrawnAt) return { badge: 'Hole locked',  take: null, note: 'Waiting on the community reveal — every seat must lock in first.' };
    return { badge: 'Community is out', take: null, note: 'Play on to finish your hand, or fold and forfeit your ante.' };
  }
  return { badge: 'Hand in progress', take: null, note: 'Head back to the table to finish your hand.' };
}

function Roster({ m, uid, max }: { m: GMMission; uid: string; max: number }) {
  const seats = Object.values(m.participants ?? {});
  return (
    <div className="rl-roster">
      {seats.map(s => (
        <div key={s.playerId} className={`rl-roster-row${s.playerId === uid ? ' you' : ''}`}>
          <span className="rl-roster-name">{s.playerName}{s.playerId === uid && <span className="rl-you">you</span>}</span>
          <span className={`rl-badge ${s.played ? 'seated' : 'open'}`}>{s.played ? 'Played' : 'Playing'}</span>
        </div>
      ))}
      {Array.from({ length: Math.max(0, max - seats.length) }, (_, i) => (
        <div key={`e${i}`} className="rl-roster-row empty"><span className="rl-roster-name">Empty seat</span></div>
      ))}
    </div>
  );
}

function SeatedView({ m, uid, now, seasonId, onLeave }: { m: GMMission; uid: string; now: number; seasonId: string; onLeave: () => void }) {
  const seat  = m.participants?.[uid];
  const max   = currentMaxSlots(m, now);
  const seats = Object.values(m.participants ?? {});
  const href  = tableHref(m, seasonId);
  if (!seat) return null;

  const standing = seatStanding(m, seat);
  const paid = casinoSeatPaid(m, uid);

  return (
    <Panel kick="Your seat" name={missionDisplayLabel(m)} sub={standing.note}>
      <div className="rl-phase-stats">
        <Stat label="Standing" value={standing.badge} />
        <Stat label="Your take" value={standing.take === null ? '—' : gold(standing.take)} tone="gold" />
        <Stat label="On the table" value={gold(m.pot ?? 0)} tone="gold" />
        <Stat label="You've paid" value={gold(paid)} />
        <Stat label="Seats" value={`${seats.length}/${max}`} />
        <Stat label="Played" value={seats.filter(s => s.played).length} />
      </div>

      {m.casinoStats && <OddsTrio stats={m.casinoStats} />}

      <Roster m={m} uid={uid} max={max} />

      <div className="rl-phase-acts">
        {href && (
          <a className="rl-btn primary" href={href} target="_blank" rel="noopener noreferrer">
            {seat.played ? 'Review your hand →' : 'Return to the table →'}
          </a>
        )}
        <button className="rl-btn" onClick={onLeave}>Leave the table</button>
      </div>
      <p className="rl-muted rl-fine">
        The table deals in once every seat is filled and played. Seats decay one per 36h, so a
        quiet table still runs.
      </p>
    </Panel>
  );
}

// ── Board (mission in progress) ───────────────────────────────────────────────

function allSlots(m: GMMission): { seat: GMParticipant; slots: AdvSlot[] }[] {
  return Object.values(m.participants ?? {}).map(seat => ({ seat, slots: seat.slots ?? [] }));
}

function BoardView({ m, uid, now, seasonId }: { m: GMMission; uid: string; now: number; seasonId: string }) {
  const rows    = allSlots(m);
  const slots   = rows.flatMap(r => r.slots);
  const goaled  = slots.filter(s => isGoaled(s.status)).length;
  const pct     = slots.length ? Math.round((goaled / slots.length) * 100) : 0;
  const elapsed = m.deployedAt ? fmtClock((now - m.deployedAt) / 1000) : '—';
  const mine    = rows.find(r => r.seat.playerId === uid);
  const others  = rows.filter(r => r.seat.playerId !== uid);
  const href    = tableHref(m, seasonId);

  return (
    <Panel kick="Your table · in progress" name={missionDisplayLabel(m)}
           sub="Every seat has played. Now the room races the board.">
      <div className="rl-meter" role="img" aria-label={`${goaled} of ${slots.length} slots goaled`}>
        <div className="rl-meter-fill" style={{ width: `${pct}%` }} />
        <span className="rl-meter-lbl">{goaled}/{slots.length} goaled</span>
      </div>

      <div className="rl-phase-stats">
        <Stat label="Release" value={m.release === 'on' ? 'On' : 'Off'} tone={m.release === 'on' ? 'pos' : undefined} />
        <Stat label="Collect" value={m.collect === 'on' ? 'On' : 'Off'} tone={m.collect === 'on' ? 'pos' : undefined} />
        <Stat label="Hint cost" value={<>{m.hint}<small>%</small></>} />
        <Stat label="Elapsed" value={elapsed} />
        <Stat label="On the table" value={gold(m.pot ?? 0)} tone="gold" />
      </div>

      {mine && (
        <div className="rl-mine">
          <div className="rl-mini-lbl">Your games</div>
          <div className="rl-slotwrap">
            {mine.slots.length
              ? mine.slots.map((s, i) => <SlotPill key={i} slot={s} />)
              : <span className="rl-muted">No games recorded for your seat.</span>}
          </div>
        </div>
      )}

      {others.map(r => (
        <div key={r.seat.playerId} className="rl-seatslots">
          <div className="rl-mini-lbl">{r.seat.playerName}</div>
          <div className="rl-slotwrap">{r.slots.map((s, i) => <SlotPill key={i} slot={s} />)}</div>
        </div>
      ))}

      {href && (
        <div className="rl-phase-acts">
          <a className="rl-btn" href={href} target="_blank" rel="noopener noreferrer">View the table →</a>
        </div>
      )}
    </Panel>
  );
}

// ── Ledger (settled) ──────────────────────────────────────────────────────────

function LedgerView({ m, uid, onDismiss }: { m: GMMission; uid: string; onDismiss: () => void }) {
  const rows = Object.values(m.participants ?? {})
    .map(seat => ({
      seat,
      hand: seat.goldSwing ?? 0,
      pot:  seat.potShare  ?? 0,
      // `net` is stamped at settle; the fallback keeps pre-stamp tables readable.
      net:  seat.net ?? (seat.goldSwing ?? 0) + (seat.potShare ?? 0) - casinoSeatPaid(m, seat.playerId),
    }))
    .sort((a, b) => b.net - a.net);

  const best  = rows.length ? rows[0].net : 0;
  const yours = rows.find(r => r.seat.playerId === uid);

  return (
    <Panel kick="Settled" name={missionDisplayLabel(m)}
           sub={yours ? `You walked away ${yours.net >= 0 ? 'up' : 'down'} ${Math.abs(yours.net)}g.` : undefined}>
      <div className="rl-ledger">
        {rows.map(r => {
          const you    = r.seat.playerId === uid;
          const winner = r.net === best && best > 0;
          return (
            <div key={r.seat.playerId} className={`rl-ledger-row${you ? ' you' : ''}${winner ? ' winner' : ''}`}>
              <div className="rl-ledger-who">
                <span className="rl-roster-name">
                  {r.seat.playerName}
                  {you && <span className="rl-you">you</span>}
                  {winner && <span className="rl-crown" title="Biggest win">♛</span>}
                </span>
                <div className="rl-slotwrap">{(r.seat.slots ?? []).map((s, i) => <SlotPill key={i} slot={s} />)}</div>
              </div>
              <div className="rl-ledger-nums">
                <Stat label="Hand" value={gold(r.hand)} />
                <Stat label="Pot" value={gold(r.pot)} />
                <Stat label="Entries" value={gold(casinoSeatPaid(m, r.seat.playerId))} />
                <Stat label="Net" value={signed(r.net)} tone={r.net >= 0 ? 'pos' : 'neg'} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="rl-phase-acts">
        <button className="rl-btn" onClick={onDismiss}>Clear the felt</button>
      </div>
    </Panel>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────

interface Props {
  /** The table this player is seated at right now, if any. */
  mission: GMMission | null;
  /** Their most recently settled table — only consulted when they hold no seat. */
  settled: GMMission | null;
  uid: string | null;
  now: number;
  onLeave: (m: GMMission) => void;
}

export default function PhasePanel({ mission, settled, uid, now, onLeave }: Props) {
  const seasonId = useSeason().season?.id ?? '';
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const seat = uid && mission ? mission.participants?.[uid] : undefined;
  const showLedger = !mission && settled && settled.id !== dismissed;

  if (mission && uid && seat) {
    const played = !!seat.played;
    return (
      <>
        {mission.state === 'inprogress'
          ? <BoardView m={mission} uid={uid} now={now} seasonId={seasonId} />
          : <SeatedView m={mission} uid={uid} now={now} seasonId={seasonId} onLeave={() => setConfirmLeave(true)} />}
        {confirmLeave && (
          <div className="rl-overlay" onClick={() => setConfirmLeave(false)}>
            <div className="rl-modal" onClick={e => e.stopPropagation()}>
              <div className="rl-modal-name">Leave the table?</div>
              <div className="rl-modal-tag">{missionDisplayLabel(mission)}</div>
              <p className="rl-muted">
                {played
                  // Standing down is allowed right up until the table deals in, so a
                  // locked seat CAN walk — it just walks away from everything it paid.
                  ? 'You have already locked your hand. Leaving forfeits your take and everything you have paid in — the pot keeps it.'
                  : 'Anything you have paid in so far stays with the table. You can take another seat afterwards.'}
              </p>
              <div className="rl-phase-acts">
                <button className="rl-btn" onClick={() => setConfirmLeave(false)}>Stay seated</button>
                <button className="rl-btn primary" onClick={() => { setConfirmLeave(false); onLeave(mission); }}>
                  Leave the table
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (showLedger && settled && uid) {
    return <LedgerView m={settled} uid={uid} onDismiss={() => setDismissed(settled.id)} />;
  }

  return (
    <Panel kick="No seat yet" name="You're not seated at a table"
           sub="Pull up a chair at any open table below to start playing for gold." />
  );
}
