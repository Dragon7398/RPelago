import { createContext, useContext, useState, type ReactNode } from 'react';
import type { AdvSlot, AdvStatusNote, GMMission, GMParticipant, SlotStatus, TriState } from '../../types';
import type { CasinoGame, DeckCard, CardTypeKey } from '../../lib/casinoData';
import { CASINO_GAMES, CARD_TYPES } from '../../lib/casinoData';
import { FREE_COMPLETED_STATUSES, nameColorValue } from '../../lib/constants';
import { discordAvatarUrl } from '../../lib/discordAvatar';

// The player's chosen name-color, resolved LIVE per playerId so a mid-mission
// change is reflected everywhere. Provided by the shell (from gameState.players).
const NameColorCtx = createContext<(playerId: string) => string>(() => nameColorValue(undefined));
const useNameColor = () => useContext(NameColorCtx);
// The player's Discord handle, resolved the same way. Shown on the game cards so
// the room can be organised on Discord — the map's tile lightbox did the same.
const HandleCtx = createContext<(playerId: string) => string | null>(() => null);
const useHandle = () => useContext(HandleCtx);

// Both player lookups travel together — every view that renders a name may also
// render its handle, so they're provided as one wrapper.
function PlayerCtx({ colorOf, handleOf, children }: {
  colorOf: (playerId: string) => string;
  handleOf: (playerId: string) => string | null;
  children: ReactNode;
}) {
  return (
    <NameColorCtx.Provider value={colorOf}>
      <HandleCtx.Provider value={handleOf}>{children}</HandleCtx.Provider>
    </NameColorCtx.Provider>
  );
}
import { awaitingRoom, casinoSeatPaid, fmtDayClock, missionDisplayLabel, seatTally } from '../../lib/missionLogic';
import { claimEntries } from '../../lib/slotHelpers';
import { slotIdleTier, type SlotIdle } from '../../lib/statusReport';
import { useSeason } from '../../contexts/SeasonContext';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import OddsTrio from './OddsTrio';
import { CardFace } from '../../casino/CardFace';
import '../../casino/cards.css';

type View = 'lounge' | 'floor';

const seatHue = (i: number): number => [75, 200, 295, 30, 150, 260, 340, 110][i % 8];
const initial = (name: string): string => (name.trim()[0] ?? '?').toUpperCase();

// The player's Discord avatar in a seat circle, falling back to the letter avatar
// when they have no custom avatar or the image fails to load.
function PlayerAvatar({ cls, playerId, avatarHash, name, hue }: {
  cls: string; playerId: string; avatarHash?: string | null; name: string; hue: number;
}) {
  const url = discordAvatarUrl(playerId, avatarHash);
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img className={`${cls} rl-av-img`} src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return <span className={cls} style={{ '--ph': hue } as React.CSSProperties}>{initial(name)}</span>;
}

// Card-type visuals: suit from CARD_TYPES, hue mirroring CardFace's TYPE_META.
const CARD_HUE: Record<CardTypeKey, number> = { wild: 75, broad: 200, platform: 295, franchise: 30, narrow: 150 };
const suitOf = (t: CardTypeKey | undefined) => (t ? CARD_TYPES[t].suit : '✦');
const hueOf  = (t: CardTypeKey | undefined) => (t ? CARD_HUE[t] : 75);

// SlotStatus → the design's status-pill class.
const STATUS_CLS: Record<SlotStatus, string> = {
  'Unstarted': 'unstarted', 'In-Progress': 'inprog', '100%': 'full', 'Goaled': 'goal', 'Done': 'done',
};

// One committed game at the table: the slot's real game (once filled) paired with
// the card it came from (suit/hue/flavour) via the persisted lockedCards.
interface SeatGame {
  // NB: `slot` is the slot's NAME, not the slot object — `raw` is the object.
  slot: string; game: string; cardName: string; type?: CardTypeKey; status: SlotStatus;
  claimed?: boolean; claimedFrom?: string;
  /** Index into the seat's `slots` array — the address `setSlotStatusNote` writes to. */
  idx: number;
  raw: AdvSlot;
}
function seatGames(seat: GMParticipant): SeatGame[] {
  const slots = seat.slots ?? [];
  const cards = seat.lockedCards ?? [];
  return slots.map((s, i) => ({
    slot:     s.name?.trim() || `Seat ${i + 1}`,
    game:     s.game?.trim() || cards[i]?.name || 'Unfilled',
    cardName: cards[i]?.name ?? '',
    type:     cards[i]?.type,
    status:   s.status ?? 'Unstarted',
    idx:      i,
    raw:      s,
    // A slot taken over from someone who left. Worth showing: it explains why a
    // seat holds more cards than it was dealt, and who was originally on the hook.
    ...(s.claimed ? { claimed: true, claimedFrom: s.claimedFrom } : {}),
  }));
}

function StatusPill({ status }: { status: SlotStatus }) {
  return <span className={`mp-st ${STATUS_CLS[status]}`}><span className="dot" />{status}</span>;
}

function NetBadge({ n, big }: { n: number; big?: boolean }) {
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'even';
  const str = n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0';
  return <span className={`st-net ${cls}${big ? ' big' : ''}`}>{str}<small>g</small></span>;
}

function GameChip({ g }: { g: SeatGame }) {
  const goaled = isGoaled(g.status);
  return (
    <span className={`st-chip${goaled ? ' goaled' : ''}`} style={{ '--th': hueOf(g.type) } as React.CSSProperties}
          title={`${g.cardName || g.game} · ${g.status}`}>
      <span className="st-chip-suit">{suitOf(g.type)}</span>
      <span className="st-chip-game">{g.game}</span>
      {goaled && <span className="st-chip-tick">✓</span>}
    </span>
  );
}
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

// A seat's roster status, in three states. Hold 'Em adds an interim "ante paid"
// once a seat has locked its hole cards but not yet played on; every other game
// goes straight from seated to played, so `holeLocked` scopes this to Hold 'Em.
function seatRoster(s: GMParticipant): { cls: string; rail: string; full: string } {
  if (s.played)     return { cls: 'played', rail: `${s.goldSwing ?? 0}g`, full: `${s.goldSwing ?? 0}g locked` };
  if (s.holeLocked) return { cls: 'ante',   rail: 'ante paid',           full: 'ante paid' };
  return { cls: 'wait', rail: 'to play', full: 'seated · to play' };
}

// Deploy-progress bar: seats filled (soft) over seats played (bright); turns
// green once the table is ready to deal in. Mirrors the design's DeployBar.
function DeployBar({ m, max, over, title }: { m: GMMission; max: number; over: boolean; title: string }) {
  const seats  = Object.values(m.participants ?? {});
  const filled = seats.length;
  const played = seats.filter(s => s.played).length;
  const ready  = filled > 0 && filled >= max && played === filled;
  const pct    = (n: number) => (max ? Math.min(100, (n / max) * 100) : 0);
  return (
    <div className={`rl-deploy${ready ? ' ready' : ''}`} title={title}>
      <div className="rl-deploy-head">
        <span>Deploy progress</span>
        <span><b>{filled}</b>/{max}{over && '*'} seated · <b>{played}</b> played</span>
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
  const colorOf = useNameColor();
  return (
    <div className="rl-roster">
      {seats.map((s, i) => {
        const st = seatRoster(s);
        return (
          <div key={s.playerId} className={`rl-seat${s.playerId === uid ? ' you' : ''}`}>
            <PlayerAvatar cls="rl-seat-av" playerId={s.playerId} avatarHash={s.avatarHash} name={s.playerName} hue={seatHue(i)} />
            <div className="rl-seat-txt">
              <span className="rl-seat-nm" style={{ color: colorOf(s.playerId) }}>{s.playerName}</span>
              <span className={`rl-seat-st ${st.cls}`}>{st.full}</span>
            </div>
          </div>
        );
      })}
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
  const colorOf = useNameColor();
  return (
    <div className="rl-seatgrid">
      {Array.from({ length: max }, (_, i) => {
        const s = seats[i];
        if (!s) return (
          <div className="rl-railseat empty" key={i}>
            <span className="rl-seat-av">·</span><span className="rl-seat-st open">open</span>
          </div>
        );
        const st = seatRoster(s);
        return (
          <div className={`rl-railseat${s.playerId === uid ? ' you' : ''}`} key={i}>
            <PlayerAvatar cls="rl-seat-av" playerId={s.playerId} avatarHash={s.avatarHash} name={s.playerName} hue={seatHue(i)} />
            <span className="rl-seat-nm" style={{ color: colorOf(s.playerId) }}>{s.playerName}</span>
            <span className={`rl-seat-st ${st.cls}`}>{st.rail}</span>
          </div>
        );
      })}
    </div>
  );
}

// Host denied this seat's config — the player must head to the table and resubmit.
// Shown in both Seated (forming) and Board (in-progress), since a denial can land
// at either state and is the only case where an in-progress seat must act.
function DenyNotice({ seat, href }: { seat: GMParticipant; href: string | null }) {
  if (!seat.yamlDenied) return null;
  return (
    <div className="rl-deny">
      <span className="rl-deny-icon">⛔</span>
      <div className="rl-deny-txt">
        <b>Your config was denied.</b>
        <span>{seat.yamlDeniedReason || 'Your host asked you to resubmit your Archipelago config.'}</span>
      </div>
      {href && (
        <a className="rl-btn primary" href={href} target="_blank" rel="noopener noreferrer">Resubmit config →</a>
      )}
    </div>
  );
}

function SeatedView({ m, uid, now, seasonId, view, onLeave }: {
  m: GMMission; uid: string; now: number; seasonId: string; view: View; onLeave: () => void;
}) {
  const seat = m.participants?.[uid];
  // Display max — never below the fill count, so a table that decayed past full
  // (see seatTally) still draws every seated player in the roster and seat grid.
  const tally = seatTally(m, now);
  const max   = tally.max;
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
    ? <LockedHand cards={seat.lockedCards} width={view === 'lounge' ? 84 : 68} />
    : <div className="rl-hand-empty">{standing.note}</div>;

  const actions = (
    <>
      {href && (
        <a className="rl-btn primary" href={href} target="_blank" rel="noopener noreferrer">
          {seat.played ? 'Review your hand →' : 'Head to the table →'}
        </a>
      )}
      <button className="rl-btn" onClick={onLeave}>Leave your seat</button>
    </>
  );

  if (view === 'lounge') {
    return (
      <div className="rl-ct lounge">
        {head}
        <DenyNotice seat={seat} href={href} />
        {hand}
        {seat.played && <Stake amount={seat.goldSwing ?? 0} label={stakeLabel(game)} />}
        {m.casinoStats && <OddsTrio stats={m.casinoStats} open={m.casinoOpenStats} />}
        <DeployBar m={m} max={max} over={tally.over} title={tally.title} />
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
      <DenyNotice seat={seat} href={href} />
      <SeatGrid m={m} uid={uid} max={max} />
      <div className="rl-ct-cols">
        <div>
          <div className="rl-ct-cell-lbl">{seat.played ? 'Your hand' : 'Your seat'}</div>
          {hand}
          {seat.played && <Stake amount={seat.goldSwing ?? 0} label={stakeLabel(game)} />}
        </div>
        <div className="rl-ct-col">
          {m.casinoStats && <div><div className="rl-ct-cell-lbl">Odds rolled</div><OddsTrio stats={m.casinoStats} open={m.casinoOpenStats} /></div>}
          <DeployBar m={m} max={max} over={tally.over} title={tally.title} />
        </div>
      </div>
      <div className="rl-ct-acts">{actions}</div>
    </div>
  );
}

// ── Board (mission in progress) ───────────────────────────────────────────────

// The Archipelago room — how players actually play their games to finish the
// table — plus the optional Cheesetracker for richer progress detail. Both are
// admin-set after deploy, so each appears only once available. Mirrors the map
// mission card (link) and agenda drawer (🧀 tracker).
function ChallengeLinks({ m }: { m: GMMission }) {
  // The play button is ABSENT, not disabled, while the room is pending — an empty
  // gap where the only actionable control lives reads as "something is broken /
  // everyone else got a link but me". Say so instead.
  const pending = awaitingRoom(m);
  if (!m.link && !m.cheese && !pending) return null;
  return (
    <div className="rl-chlinks">
      {m.link && (
        <a className="rl-btn primary rl-chlink-play" href={m.link} target="_blank" rel="noopener noreferrer">
          🗺 Open Archipelago Game →
        </a>
      )}
      {pending && (
        <div className="rl-pending">
          <span className="rl-pending-icon">⏳</span>
          <div className="rl-pending-txt">
            <b>The room isn't up yet.</b>
            <span>
              Your seat is locked in and your host is still generating this table — it can take a
              while. Nothing for you to do; the Archipelago link appears right here the moment it's
              ready.
            </span>
          </div>
        </div>
      )}
      {m.cheese && (
        <a className="rl-chlink-cheese" title="Open Cheesetracker — challenge progress"
           href={`https://cheesetrackers.theincrediblewheelofchee.se/tracker/${m.cheese}`}
           target="_blank" rel="noopener noreferrer">🧀 Tracker</a>
      )}
    </div>
  );
}

// ── Open (claimable) slots ────────────────────────────────────────────────────
//
// A slot someone vacated after the table went live. Because the Archipelago room
// already exists, taking one over is instant: no ante, no deal, no config to
// submit — the claimant adopts the live slot exactly as it stands. It also costs
// nothing, neither gold nor one of the player's mission claims, so the only limit
// is one claimed slot per player per table.

/** The claimed slot's cut of the pot, as a share of what one full seat takes. */
function shareLabel(fraction: number | undefined): string | null {
  if (!fraction || fraction <= 0) return null;
  const pct = Math.round(fraction * 100);
  return pct >= 100 ? 'a full seat share' : `${pct}% of a seat share`;
}

function OpenSlots({ m, uid }: { m: GMMission; uid: string | null }) {
  const { claimMissionSlot } = useGameState();
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const entries = claimEntries(m);
  if (entries.length === 0) return null;

  const seat = uid ? m.participants?.[uid] : undefined;
  // One claimed slot per player per table — otherwise a single player could absorb
  // an entire vacated hand. Holding your own seat here does NOT block you.
  const alreadyClaimed = !!seat && (seat.slots ?? []).some(s => s?.claimed);

  const take = async (key: string) => {
    setBusy(key);
    try { await claimMissionSlot(m.id, key); }
    catch (err) {
      const code = (err as { message?: string }).message ?? '';
      addToast(
        code.includes('already-claimed-here') ? 'You already hold an open slot at this table.'
        : code.includes('Slot no longer available') ? 'Someone else just took that slot.'
        : 'Could not claim that slot. Please try again.', 'error');
    }
    finally { setBusy(null); }
  };

  return (
    <div className="mp-open">
      <div className="mp-cell-lbl">
        Open slots <span className="mp-open-count">{entries.length}</span>
      </div>
      <p className="mp-open-note">
        A player left these behind. The room is already running, so taking one over is
        instant — no buy-in, and it doesn&apos;t use up a mission claim.
      </p>
      <div className="mp-open-grid">
        {entries.map(([key, entry]) => {
          const slot  = entry.slots[0];
          const share = shareLabel(entry.potFraction);
          return (
            <div key={key} className="mp-openslot" style={{ '--th': hueOf(entry.card?.type as CardTypeKey | undefined) } as React.CSSProperties}>
              <div className="mp-openslot-head">
                <span className="mp-openslot-suit">{suitOf(entry.card?.type as CardTypeKey | undefined)}</span>
                <span className="mp-openslot-card">{entry.card?.name ?? slot?.name ?? 'Open slot'}</span>
                {entry.card?.value != null && <span className="mp-openslot-gold">{entry.card.value}<small>g</small></span>}
              </div>
              <div className="mp-openslot-game">{slot?.game?.trim() || 'Game not recorded'}</div>
              <div className="mp-openslot-meta">
                {slot?.status && <StatusPill status={slot.status} />}
                {share && <span className="mp-openslot-share" title="Paid out on top of the card's value when the table settles">+{share}</span>}
              </div>
              {entry.fromPlayerName && (
                <div className="mp-openslot-from">vacated by {entry.fromPlayerName}</div>
              )}
              {!uid
                ? <div className="mp-openslot-login">Sign in to take this slot.</div>
                : (
                  <button className="rl-btn primary mp-openslot-btn"
                    disabled={alreadyClaimed || busy !== null}
                    title={alreadyClaimed ? 'You already hold an open slot at this table' : undefined}
                    onClick={() => void take(key)}>
                    {busy === key ? '…' : alreadyClaimed ? 'Already holding one' : '⚐ Take this slot'}
                  </button>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A player's committed game, tagged with its owner — for the board's tile grids.
interface OwnedGame extends SeatGame { ownerName: string; ownerId: string; ownerAvatar?: string | null; you: boolean; ownerHue: number; }

function Completion({ goaled, total }: { goaled: number; total: number }) {
  const pct  = total ? Math.round((goaled / total) * 100) : 0;
  const done = total > 0 && goaled === total;
  return (
    <div className="mp-complete-wrap">
      <div className="mp-complete">
        <span className="big">{goaled}</span><span className="of">/ {total}</span>
        <span className="lab">slots goaled · {pct}%</span>
      </div>
      <div className={`mp-meter${done ? ' done' : ''}`}><div className="mp-meter-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function rollTag(t: TriState) {
  if (t === 'on')  return <span className="mp-roll on">On</span>;
  if (t === 'off') return <span className="mp-roll off">Off</span>;
  return <span className="mp-roll pending">to roll</span>;
}

function Telemetry({ m, elapsed }: { m: GMMission; elapsed: string }) {
  const s = m.casinoStats;
  return (
    <div className="mp-tele">
      <div className="mp-tele-item">
        <span className="mp-tele-val" style={{ '--oh': 200 } as React.CSSProperties}>{s?.release ?? '—'}<small>%</small></span>
        <span className="mp-tele-lbl">Release {rollTag(m.release)}</span>
      </div>
      <div className="mp-tele-item">
        <span className="mp-tele-val" style={{ '--oh': 295 } as React.CSSProperties}>{s?.collect ?? '—'}<small>%</small></span>
        <span className="mp-tele-lbl">Collect {rollTag(m.collect)}</span>
      </div>
      <div className="mp-tele-item">
        <span className="mp-tele-val" style={{ '--oh': 30 } as React.CSSProperties}>{m.hint}<small>%</small></span>
        <span className="mp-tele-lbl">Hint cost</span>
      </div>
      <div className="mp-tele-item">
        <span className="mp-tele-val" style={{ '--oh': 75 } as React.CSSProperties}>{elapsed}</span>
        <span className="mp-tele-lbl">Elapsed</span>
      </div>
    </div>
  );
}

// ── Idle badge + slot notes ───────────────────────────────────────────────────

const NOTE_MAX = 280;

const fmtNoteTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Outline clock (caution) / filled-chip triangle (alert). Deliberately SVG, not
// emoji: an emoji ⚠️ paints in its own fixed colours and would ignore --caution
// and --alert entirely, reading as a foreign object in every light and
// colour-blind theme.
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);

/**
 * "N hours idle" on a slot. Shown for EVERY slot on a board, not just your own —
 * a stalled table is the room's problem, and seeing whose slot is holding it up
 * is most of why you'd open another table's board at all.
 *
 * The hour count is rendered as TEXT, not just colour — with ten themes (four
 * light, four on a colour-blind-safe lightness ladder) the number is the only
 * channel that never fails. Focusable so the alert copy is reachable without a
 * mouse.
 *
 * The copy is owner-aware: the actionable half ("please play this slot") is an
 * instruction to the slot's holder, so it appears only on your own. On someone
 * else's it would be telling the wrong person what to do.
 */
function IdleBadge({ idle, mine, ownerName }: { idle: SlotIdle; mine: boolean; ownerName: string }) {
  const alert = idle.tier === 'alert';
  // "Since last activity" would be a lie on a slot that never had any — when the
  // clock is running from the room link, say so instead.
  const title = mine
    ? (idle.fromRoom
        ? `Not started — ${idle.hours}h since the room went up.`
        : `${idle.hours}h since last activity.`)
      + (alert ? ' Please play this slot or report on your status.' : '')
    : (idle.fromRoom
        ? `${ownerName} hasn't started this — ${idle.hours}h since the room went up.`
        : `${ownerName} — ${idle.hours}h since last activity.`);
  return (
    <span className={`mp-idle ${idle.tier}`} tabIndex={0} title={title}>
      {alert ? <AlertIcon /> : <ClockIcon />}{idle.hours}h
    </span>
  );
}

const NoteIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    {filled && <><path d="M8 9h8" /><path d="M8 13h5" /></>}
  </svg>
);

/**
 * The note affordance for one slot. Owns its own open/editing state so a board
 * of ~28 cards doesn't lift 28 booleans into the grid.
 *
 * Your own note renders open; someone else's stays collapsed behind the button —
 * a seven-seat table would otherwise triple in height and bury your own progress.
 * A slot that is neither yours nor noted shows nothing at all (mirrors
 * AdvNoteEditor's `if (!isOwner && !note) return null`).
 */
function SlotNote({ missionId, slotIdx, note, isOwner }: {
  missionId: string; slotIdx: number; note?: AdvStatusNote; isOwner: boolean;
}) {
  const { setSlotStatusNote } = useGameState();
  const { addToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [draft,   setDraft]   = useState('');
  const [saving,  setSaving]  = useState(false);

  if (!isOwner && !note) return null;

  const save = async () => {
    setSaving(true);
    try {
      await setSlotStatusNote(missionId, slotIdx, draft.trim() || null);
      setEditing(false);
    } catch {
      addToast('Could not save that note. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => { setDraft(note?.text ?? ''); setEditing(true); };
  // Your own note is always shown; others' toggle.
  const showBody = !editing && !!note && (isOwner || open);

  return (
    <>
      <button
        type="button"
        className={`mp-note-btn${note ? ' has' : ''}${editing ? ' focus' : ''}`}
        title={isOwner
          ? (note ? 'Your status note — click to edit' : 'Add a status note for this slot')
          : 'Read this player’s status note'}
        onClick={() => (isOwner ? (editing ? setEditing(false) : startEdit()) : setOpen(o => !o))}
      >
        <NoteIcon filled={!!note} />Note
      </button>

      {editing && (
        <div className="mp-note-editor">
          <textarea
            className="mp-note-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="Where does this slot stand?"
            autoFocus
          />
          <div className="mp-note-actions">
            <span className="mp-note-chars">{draft.length}/{NOTE_MAX}</span>
            <button className="mp-note-cancel" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button className="mp-note-save" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {showBody && note && (
        <div className="mp-note">
          <div className="mp-note-text">{note.text}</div>
          <div className="mp-note-meta">
            <span>{fmtNoteTime(note.timestamp)}</span>
            {isOwner && <button className="mp-note-edit" onClick={startEdit}>Edit</button>}
          </div>
        </div>
      )}
    </>
  );
}

// Spatial card tiles — one per committed game, coloured by its card's suit.
//
// `missionId` / `linkedAt` are threaded in for the note write path and the idle
// clock's room-link fallback. Both callers already hold the mission.
function TileGrid({ tiles, wide, missionId, linkedAt, now }: {
  tiles: OwnedGame[]; wide?: boolean; missionId: string; linkedAt?: number | null; now: number;
}) {
  const colorOf  = useNameColor();
  const handleOf = useHandle();
  return (
    <div className={`mp-board${wide ? ' mp-board-wide' : ''}`}>
      {tiles.map((t, i) => {
        const handle = handleOf(t.ownerId);
        const idle = slotIdleTier(t.raw, now, linkedAt);
        return (
          <div key={i} className={`mp-tile${isGoaled(t.status) ? ' goaled' : ''}${t.you ? ' you' : ''}`}
               style={{ '--th': hueOf(t.type) } as React.CSSProperties}>
            <div className="mp-tile-status">
              <StatusPill status={t.status} />
              {t.claimed && (
                <span className="mp-tile-claimed"
                      title={t.claimedFrom ? `Taken over from ${t.claimedFrom}` : 'Taken over from a vacated seat'}>⚐</span>
              )}
              {idle && <IdleBadge idle={idle} mine={t.you} ownerName={t.ownerName} />}
              <SlotNote missionId={missionId} slotIdx={t.idx} note={t.raw.note} isOwner={t.you} />
            </div>
            <div className="mp-tile-slot">{suitOf(t.type)} {t.cardName || t.slot}</div>
            <div className="mp-tile-game">{t.game}</div>
            <div className="mp-tile-owner">
              <PlayerAvatar cls="mp-pav" playerId={t.ownerId} avatarHash={t.ownerAvatar} name={t.ownerName} hue={t.ownerHue} />
              <span className="mp-tile-who">
                <span><span style={{ color: colorOf(t.ownerId) }}>{t.ownerName}</span> · {t.slot}</span>
                {handle && <span className="mp-tile-handle">@{handle}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Sort tier for the three-band ordering the boards use: still owed work, then
 * finished-but-still-owning-the-slot, then Done.
 *
 * Tier 1 is exactly `FREE_COMPLETED_STATUSES` minus Done, so the band that sits
 * below the divider stays the same set the rest of the app calls "completed" —
 * there is no second definition of finished to drift.
 */
const finishTier = (s: SlotStatus): 0 | 1 | 2 =>
  (s === 'Done' ? 2 : FREE_COMPLETED_STATUSES.has(s) ? 1 : 0);

/**
 * Tier first, then alphabetical by the title the tile leads with. Ties fall
 * through to the owner so a table running two copies of one game keeps a stable,
 * non-jittery order across re-renders.
 */
const byTierThenName = (a: OwnedGame, b: OwnedGame): number =>
  finishTier(a.status) - finishTier(b.status)
  || (a.game || a.slot).localeCompare(b.game || b.slot, undefined, { sensitivity: 'base' })
  || a.ownerName.localeCompare(b.ownerName);

/**
 * A board's game tiles, ordered by `byTierThenName` and — for anyone else's games
 * — split at a divider: only Unstarted / In-Progress above it, everything
 * finished below. Done games have nothing left to act on at all, so they start
 * collapsed behind a toggle inside that lower section.
 *
 * `mine` renders the flat variant: your own games get the same three-band sort
 * but are never divided or hidden, because your own seat is the one place you
 * always want the whole picture. On a mixed board (the peek, where you may hold a
 * seat) that rule survives per tile — your own Done games ignore the toggle and
 * the count only ever offers to hide other players'.
 */
function GamesBoard({ tiles, wide, missionId, linkedAt, now, mine }: {
  tiles: OwnedGame[]; wide?: boolean; missionId: string; linkedAt?: number | null; now: number;
  mine?: boolean;
}) {
  const [showDone, setShowDone] = useState(false);
  const sorted = [...tiles].sort(byTierThenName);
  const grid = (list: OwnedGame[]) =>
    <TileGrid tiles={list} wide={wide} missionId={missionId} linkedAt={linkedAt} now={now} />;

  if (mine) return grid(sorted);

  const active   = sorted.filter(t => finishTier(t.status) === 0);
  const finished = sorted.filter(t => finishTier(t.status) > 0);
  if (!finished.length) return grid(active);

  // Only someone else's Done tile is ever hidden, so it is also the only kind the
  // toggle should count — offering to "hide 2 done" and hiding none reads broken.
  const hidden   = (t: OwnedGame) => t.status === 'Done' && !t.you;
  const hideable = finished.filter(hidden);
  const shown    = showDone ? finished : finished.filter(t => !hidden(t));

  return (
    <>
      {active.length ? grid(active) : <span className="mp-muted">Nothing left unstarted or in progress.</span>}
      <div className="mp-split">
        <span className="mp-split-lbl">Finished · {finished.length}</span>
        <span className="mp-split-rule" />
        {hideable.length > 0 && (
          <button type="button" className="mp-split-btn" onClick={() => setShowDone(v => !v)}
                  aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} {hideable.length} done
          </button>
        )}
      </div>
      {shown.length > 0 && grid(shown)}
    </>
  );
}

function BoardView({ m, uid, now, seasonId, view }: { m: GMMission; uid: string; now: number; seasonId: string; view: View }) {
  // The Lounge has room to breathe, so its game cards get a wider minimum before
  // the grid adds another column; the Floor keeps its tighter rail.
  const wide = view === 'lounge';
  const mine: OwnedGame[] = [];
  const others: OwnedGame[] = [];
  Object.values(m.participants ?? {}).forEach((p, idx) => {
    const you = p.playerId === uid;
    const hue = seatHue(idx);
    for (const g of seatGames(p)) (you ? mine : others).push({ ...g, ownerName: p.playerName, ownerId: p.playerId, ownerAvatar: p.avatarHash, you, ownerHue: hue });
  });
  const all       = [...mine, ...others];
  const goaled    = all.filter(g => isGoaled(g.status)).length;
  const myGoaled  = mine.filter(g => isGoaled(g.status)).length;
  // Elapsed counts from the room link going up (when play can actually start),
  // not from deploy — a table can sit deployed for a while before it has a room.
  // Tables that were linked before `linkedAt` existed fall back to deploy time.
  const clockFrom = m.linkedAt ?? (m.link ? m.deployedAt : undefined);
  const elapsed   = clockFrom  ? fmtDayClock((now - clockFrom) / 1000) : '—';
  const sinceDeploy = m.deployedAt ? fmtDayClock((now - m.deployedAt) / 1000) : '—';
  const href      = tableHref(m, seasonId);
  const seat      = m.participants?.[uid];
  const pending   = awaitingRoom(m);

  return (
    <div className="mp-ct">
      <div className="mp-ct-rim" />
      <div className="mp-ct-head">
        <div>
          <div className="mp-ct-kick">Your table · {pending ? 'awaiting room' : 'live'}</div>
          <div className="mp-ct-name">{missionDisplayLabel(m)}</div>
          {/* "deployed 14h ago" is the most prominent time on the panel and reads as
              "playable for 14h and you haven't started" — exactly wrong while the room
              is pending. Same clock, honest framing. */}
          <div className="mp-ct-room">
            {CASINO_GAMES[tableGame(m)].label} · {pending ? `seats locked ${sinceDeploy} ago` : `deployed ${sinceDeploy} ago`}
          </div>
        </div>
        <span className={`mp-phase-chip ${pending ? 'pending' : 'inprogress'}`}>
          {pending ? 'Awaiting room' : 'In progress'}
        </span>
      </div>

      <div className="mp-ct-body">
        {seat && <DenyNotice seat={seat} href={href} />}
        <div className="mp-row" style={{ gap: '1.6rem', alignItems: 'flex-start' }}>
          {/* No room means no play, so 0/N goaled is a foregone zero — a full-width
              empty meter that only reads as failure. Hidden until there's a room. */}
          {!pending && <Completion goaled={goaled} total={all.length} />}
          <Telemetry m={m} elapsed={elapsed} />
        </div>

        <ChallengeLinks m={m} />

        <OpenSlots m={m} uid={uid} />

        <div className="mp-mine">
          <div className="mp-cell-lbl">
            Your games {!pending && <span className="mp-mine-count">{myGoaled}/{mine.length} goaled</span>}
          </div>
          {mine.length
            ? <GamesBoard tiles={mine} wide={wide} missionId={m.id} linkedAt={m.linkedAt} now={now} mine />
            : <span className="mp-muted">No games recorded for your seat yet.</span>}
        </div>

        {others.length > 0 && (
          <div>
            <div className="mp-cell-lbl">The rest of the table</div>
            <GamesBoard tiles={others} wide={wide} missionId={m.id} linkedAt={m.linkedAt} now={now} />
          </div>
        )}

        {href && (
          <div className="mp-row">
            <a className="rl-btn" href={href} target="_blank" rel="noopener noreferrer">View the table →</a>
          </div>
        )}
      </div>
    </div>
  );
}

// A standalone read-only slot overview for ANY table, reusing the Board view's
// tile grid. The landing's in-progress table cards open this in a modal so the
// floor's live rooms can be inspected without holding a seat there. `uid` only
// tints the viewer's own tiles (harmless when they hold no seat at this table).
export function TableSlotsBoard({ m, uid, now, colorOf, handleOf }: {
  m: GMMission; uid: string | null; now: number;
  colorOf: (playerId: string) => string;
  handleOf: (playerId: string) => string | null;
}) {
  const tiles: OwnedGame[] = [];
  Object.values(m.participants ?? {}).forEach((p, idx) => {
    const hue = seatHue(idx);
    for (const g of seatGames(p))
      tiles.push({ ...g, ownerName: p.playerName, ownerId: p.playerId, ownerAvatar: p.avatarHash, you: p.playerId === uid, ownerHue: hue });
  });
  const goaled = tiles.filter(g => isGoaled(g.status)).length;
  return (
    <PlayerCtx colorOf={colorOf} handleOf={handleOf}>
      {/* Mirrors BoardView: no room yet ⇒ the completion meter is a guaranteed zero. */}
      {!awaitingRoom(m) && <Completion goaled={goaled} total={tiles.length} />}
      <ChallengeLinks m={m} />
      <OpenSlots m={m} uid={uid} />
      {tiles.length
        ? <div style={{ marginTop: '1rem' }}>
            <GamesBoard tiles={tiles} wide missionId={m.id} linkedAt={m.linkedAt} now={now} />
          </div>
        : <p className="mp-muted" style={{ marginTop: '0.8rem' }}>No games are recorded at this table yet.</p>}
    </PlayerCtx>
  );
}

// ── Ledger (settled) ──────────────────────────────────────────────────────────

const rollText = (t: TriState) => (t === 'on' ? 'On' : t === 'off' ? 'Off' : '—');

function LedgerView({ m, uid, onDismiss }: { m: GMMission; uid: string; onDismiss: () => void }) {
  const colorOf = useNameColor();
  const rows = Object.values(m.participants ?? {})
    .map((seat, i) => ({
      seat,
      hue:     seatHue(i),
      hand:    seat.goldSwing ?? 0,
      pot:     seat.potShare  ?? 0,
      entries: casinoSeatPaid(m, seat.playerId),
      // `net` is stamped at settle; the fallback keeps pre-stamp tables readable.
      net:     seat.net ?? (seat.goldSwing ?? 0) + (seat.potShare ?? 0) - casinoSeatPaid(m, seat.playerId),
      games:   seatGames(seat),
    }))
    .sort((a, b) => b.net - a.net);

  const winner = rows[0];

  return (
    <div className="rl-settled-wrap">
      <div className="st-head">
        <div className="st-seal">🂡</div>
        <div className="st-kick">The night is settled</div>
        <div className="st-title">{missionDisplayLabel(m)}</div>
        <div className="st-facts">
          <span>Pot <b>{m.pot ?? 0}g</b></span>
          <span className="st-dot">·</span>
          <span>Release <b className={m.release === 'on' ? 'on' : 'off'}>{rollText(m.release)}</b></span>
          <span className="st-dot">·</span>
          <span>Collect <b className={m.collect === 'on' ? 'on' : 'off'}>{rollText(m.collect)}</b></span>
          {winner && (
            <>
              <span className="st-dot">·</span>
              <span>Best night <b className="gold">{winner.seat.playerName}</b>{' '}
                {winner.net >= 0 ? '+' : '−'}{Math.abs(winner.net)}g</span>
            </>
          )}
        </div>
      </div>

      <div className="st-ledger">
        <div className="st-lcols">
          <span>Player</span><span>Games brought</span>
          <span className="num">Hand</span><span className="num">Pot</span><span className="num">Entries</span><span className="num">Net</span>
        </div>
        {rows.map(r => {
          const you = r.seat.playerId === uid;
          return (
            <div key={r.seat.playerId} className={`st-lrow${you ? ' you' : ''}`}>
              <span className="st-lname">
                <PlayerAvatar cls="st-pav sm" playerId={r.seat.playerId} avatarHash={r.seat.avatarHash} name={r.seat.playerName} hue={r.hue} />
                <span style={{ color: colorOf(r.seat.playerId) }}>{r.seat.playerName}</span>
              </span>
              <span className="st-chips">{r.games.map((g, i) => <GameChip key={i} g={g} />)}</span>
              <span className="st-lnum">{r.hand}g</span>
              <span className="st-lnum">+{r.pot}g</span>
              <span className="st-lnum neg">−{r.entries}g</span>
              <span className="st-lnum"><NetBadge n={r.net} /></span>
            </div>
          );
        })}
      </div>

      <div className="rl-ct-acts" style={{ justifyContent: 'center' }}>
        <button className="rl-btn" onClick={onDismiss}>Clear the felt</button>
      </div>
    </div>
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
  /** Dismissed-ledger id, lifted to the shell so the tables heading stays in sync. */
  dismissedId: string | null;
  onDismiss: (id: string) => void;
  /** Live name-color resolver (shell reads it from gameState.players per render). */
  colorOf: (playerId: string) => string;
  /** Live Discord-handle resolver, same source; null when the player has none. */
  handleOf: (playerId: string) => string | null;
}

export default function PhasePanel({ mission, settled, uid, now, view, onLeave, dismissedId, onDismiss, colorOf, handleOf }: Props) {
  const seasonId = useSeason().season?.id ?? '';
  const [confirmLeave, setConfirmLeave] = useState(false);

  const seat = uid && mission ? mission.participants?.[uid] : undefined;
  const showLedger = !mission && settled && settled.id !== dismissedId;

  if (mission && uid && seat) {
    const played = !!seat.played;
    return (
      <PlayerCtx colorOf={colorOf} handleOf={handleOf}>
        {mission.state === 'inprogress'
          ? <BoardView m={mission} uid={uid} now={now} seasonId={seasonId} view={view} />
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
      </PlayerCtx>
    );
  }

  if (showLedger && settled && uid) {
    return (
      <PlayerCtx colorOf={colorOf} handleOf={handleOf}>
        <LedgerView m={settled} uid={uid} onDismiss={() => onDismiss(settled.id)} />
      </PlayerCtx>
    );
  }

  return (
    <Panel kick="No seat yet" name="You're not seated at a table"
           sub="Pull up a chair at any open table below to start playing for gold." />
  );
}
