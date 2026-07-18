import { useState, type ReactNode } from 'react';
import type { AdvSlot, GMMission, GMParticipant, SlotStatus } from '../../types';
import type { CasinoGame, DeckCard } from '../../lib/casinoData';
import { CASINO_GAMES } from '../../lib/casinoData';
import { casinoSeatPaid, currentMaxSlots, fmtClock, missionDisplayLabel } from '../../lib/missionLogic';
import { useSeason } from '../../contexts/SeasonContext';
import OddsTrio from './OddsTrio';
import { CardFace } from '../../casino/CardFace';
import '../../casino/cards.css';

type View = 'lounge' | 'floor';

const seatHue = (i: number): number => [75, 200, 295, 30, 150, 260, 340, 110][i % 8];
const initial = (name: string): string => (name.trim()[0] ?? '?').toUpperCase();
// Blackjack is the lone "Casino"-family game; the rest are poker variants whose
// committed cards are a deliberate take, hence the different stake wording.
const stakeLabel = (g: CasinoGame): string => (g === 'blackjack' ? "You're playing for" : 'Your committed take');

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

// Deploy-progress bar: seats filled (soft) over seats played (bright); turns
// green once the table is ready to deal in. Mirrors the design's DeployBar.
function DeployBar({ m, max }: { m: GMMission; max: number }) {
  const seats  = Object.values(m.participants ?? {});
  const filled = seats.length;
  const played = seats.filter(s => s.played).length;
  const ready  = filled > 0 && filled >= max && played === filled;
  const pct    = (n: number) => (max ? Math.min(100, (n / max) * 100) : 0);
  return (
    <div className={`rl-deploy${ready ? ' ready' : ''}`}>
      <div className="rl-deploy-head">
        <span>Deploy progress</span>
        <span><b>{filled}</b>/{max} seated · <b>{played}</b> played</span>
      </div>
      <div className="rl-deploy-track">
        <div className="rl-deploy-filled" style={{ width: `${pct(filled)}%` }} />
        <div className="rl-deploy-played" style={{ width: `${pct(played)}%` }} />
      </div>
    </div>
  );
}

// The player's OWN committed cards, persisted publicly at lock (see lockCasinoResult).
function LockedHand({ cards, width }: { cards: DeckCard[] | undefined; width: number }) {
  if (!cards?.length) return null;
  return <div className="rl-hand">{cards.map((c, i) => <CardFace key={i} card={c} look="plate" width={width} />)}</div>;
}

function Stake({ amount, label }: { amount: number; label: string }) {
  return (
    <div className="rl-stakewrap">
      <span className="rl-stake-lbl">{label}</span>
      <span className="rl-stake"><span className="n">{amount}</span><span className="u">g on the table</span></span>
    </div>
  );
}

// Roster as avatar chips (Lounge) — name + "Ng locked" / "seated · to play".
function RosterChips({ m, uid, max }: { m: GMMission; uid: string; max: number }) {
  const seats = Object.values(m.participants ?? {});
  return (
    <div className="rl-roster">
      {seats.map((s, i) => (
        <div key={s.playerId} className={`rl-seat${s.playerId === uid ? ' you' : ''}`}>
          <span className="rl-seat-av" style={{ '--ph': seatHue(i) } as React.CSSProperties}>{initial(s.playerName)}</span>
          <div className="rl-seat-txt">
            <span className="rl-seat-nm">{s.playerId === uid ? 'You' : s.playerName}</span>
            <span className={`rl-seat-st ${s.played ? 'played' : 'wait'}`}>{s.played ? `${s.goldSwing ?? 0}g locked` : 'seated · to play'}</span>
          </div>
        </div>
      ))}
      {Array.from({ length: Math.max(0, max - seats.length) }, (_, i) => (
        <div key={`e${i}`} className="rl-seat empty">
          <span className="rl-seat-av">·</span>
          <div className="rl-seat-txt"><span className="rl-seat-nm">Open seat</span><span className="rl-seat-st open">waiting</span></div>
        </div>
      ))}
    </div>
  );
}

// Roster as a compact seat grid (Floor/rail) — one small cell per seat.
function SeatGrid({ m, uid, max }: { m: GMMission; uid: string; max: number }) {
  const seats = Object.values(m.participants ?? {});
  return (
    <div className="rl-seatgrid">
      {Array.from({ length: max }, (_, i) => {
        const s = seats[i];
        if (!s) return (
          <div className="rl-railseat empty" key={i}>
            <span className="rl-seat-av">·</span><span className="rl-seat-st open">open</span>
          </div>
        );
        return (
          <div className={`rl-railseat${s.playerId === uid ? ' you' : ''}`} key={i}>
            <span className="rl-seat-av" style={{ '--ph': seatHue(i) } as React.CSSProperties}>{initial(s.playerName)}</span>
            <span className="rl-seat-nm">{s.playerId === uid ? 'You' : s.playerName}</span>
            <span className={`rl-seat-st ${s.played ? 'played' : 'wait'}`}>{s.played ? `${s.goldSwing ?? 0}g` : 'to play'}</span>
          </div>
        );
      })}
    </div>
  );
}

function SeatedView({ m, uid, now, seasonId, view, onLeave }: {
  m: GMMission; uid: string; now: number; seasonId: string; view: View; onLeave: () => void;
}) {
  const seat = m.participants?.[uid];
  const max  = currentMaxSlots(m, now);
  const href = tableHref(m, seasonId);
  if (!seat) return null;

  const game     = tableGame(m);
  const standing = seatStanding(m, seat);
  const seats    = Object.values(m.participants ?? {});
  const ready    = seats.length > 0 && seats.length >= max && seats.every(s => s.played);

  const head = (
    <div>
      <div className="rl-ct-kick">You're seated at</div>
      <div className="rl-ct-name">{missionDisplayLabel(m)}</div>
      <div className="rl-ct-room">{CASINO_GAMES[game].label} · {standing.badge}</div>
    </div>
  );

  const hand = seat.played && seat.lockedCards?.length
    ? <LockedHand cards={seat.lockedCards} width={view === 'lounge' ? 84 : 54} />
    : <div className="rl-hand-empty">{standing.note}</div>;

  const actions = (
    <>
      {href && (
        <a className="rl-btn primary" href={href} target="_blank" rel="noopener noreferrer">
          {seat.played ? 'Review your hand →' : 'Return to the table →'}
        </a>
      )}
      <button className="rl-btn" onClick={onLeave}>Leave your seat</button>
    </>
  );

  if (view === 'lounge') {
    return (
      <div className="rl-ct lounge">
        {head}
        {hand}
        {seat.played && <Stake amount={seat.goldSwing ?? 0} label={stakeLabel(game)} />}
        {m.casinoStats && <OddsTrio stats={m.casinoStats} open={m.casinoOpenStats} />}
        <DeployBar m={m} max={max} />
        <RosterChips m={m} uid={uid} max={max} />
        <div className="rl-ct-acts">{actions}</div>
      </div>
    );
  }

  // rail (Floor)
  return (
    <div className="rl-ct rail">
      <div className="rl-spread">
        {head}
        <span className={`rl-badge ${ready ? 'ready' : 'seated'}`}>{ready ? 'Ready to deploy' : 'Your seat'}</span>
      </div>
      <SeatGrid m={m} uid={uid} max={max} />
      <div className="rl-ct-cols">
        <div>
          <div className="rl-ct-cell-lbl">{seat.played ? 'Your hand' : 'Your seat'}</div>
          {hand}
          {seat.played && <Stake amount={seat.goldSwing ?? 0} label={stakeLabel(game)} />}
        </div>
        <div className="rl-ct-col">
          {m.casinoStats && <div><div className="rl-ct-cell-lbl">Odds rolled</div><OddsTrio stats={m.casinoStats} open={m.casinoOpenStats} /></div>}
          <DeployBar m={m} max={max} />
        </div>
      </div>
      <div className="rl-ct-acts">{actions}</div>
    </div>
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
  /** Landing view — only the Seated panel diverges (lounge = cozy, floor = rail). */
  view: View;
  onLeave: (m: GMMission) => void;
}

export default function PhasePanel({ mission, settled, uid, now, view, onLeave }: Props) {
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
          : <SeatedView m={mission} uid={uid} now={now} seasonId={seasonId} view={view} onLeave={() => setConfirmLeave(true)} />}
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
