import { createContext, useContext, useState, type ReactNode } from 'react';
import type { GMMission, GMParticipant, SlotStatus, TriState } from '../../types';
import type { CasinoGame, DeckCard, CardTypeKey } from '../../lib/casinoData';
import { CASINO_GAMES, CARD_TYPES } from '../../lib/casinoData';
import { nameColorValue } from '../../lib/constants';
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
import { casinoSeatPaid, currentMaxSlots, fmtClock, missionDisplayLabel } from '../../lib/missionLogic';
import { useSeason } from '../../contexts/SeasonContext';
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
interface SeatGame { slot: string; game: string; cardName: string; type?: CardTypeKey; status: SlotStatus; }
function seatGames(seat: GMParticipant): SeatGame[] {
  const slots = seat.slots ?? [];
  const cards = seat.lockedCards ?? [];
  return slots.map((s, i) => ({
    slot:     s.name?.trim() || `Seat ${i + 1}`,
    game:     s.game?.trim() || cards[i]?.name || 'Unfilled',
    cardName: cards[i]?.name ?? '',
    type:     cards[i]?.type,
    status:   s.status ?? 'Unstarted',
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
          <DeployBar m={m} max={max} />
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
  if (!m.link && !m.cheese) return null;
  return (
    <div className="rl-chlinks">
      {m.link && (
        <a className="rl-btn primary rl-chlink-play" href={m.link} target="_blank" rel="noopener noreferrer">
          🗺 Open Archipelago Game →
        </a>
      )}
      {m.cheese && (
        <a className="rl-chlink-cheese" title="Open Cheesetracker — challenge progress"
           href={`https://cheesetrackers.theincrediblewheelofchee.se/tracker/${m.cheese}`}
           target="_blank" rel="noopener noreferrer">🧀 Tracker</a>
      )}
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

// Spatial card tiles — one per committed game, coloured by its card's suit.
function TileGrid({ tiles }: { tiles: OwnedGame[] }) {
  const colorOf  = useNameColor();
  const handleOf = useHandle();
  return (
    <div className="mp-board">
      {tiles.map((t, i) => {
        const handle = handleOf(t.ownerId);
        return (
          <div key={i} className={`mp-tile${isGoaled(t.status) ? ' goaled' : ''}${t.you ? ' you' : ''}`}
               style={{ '--th': hueOf(t.type) } as React.CSSProperties}>
            <div className="mp-tile-status"><StatusPill status={t.status} /></div>
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

function BoardView({ m, uid, now, seasonId }: { m: GMMission; uid: string; now: number; seasonId: string }) {
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
  const elapsed   = clockFrom  ? fmtClock((now - clockFrom) / 1000) : '—';
  const sinceDeploy = m.deployedAt ? fmtClock((now - m.deployedAt) / 1000) : '—';
  const href      = tableHref(m, seasonId);
  const seat      = m.participants?.[uid];

  return (
    <div className="mp-ct">
      <div className="mp-ct-rim" />
      <div className="mp-ct-head">
        <div>
          <div className="mp-ct-kick">Your table · live</div>
          <div className="mp-ct-name">{missionDisplayLabel(m)}</div>
          <div className="mp-ct-room">{CASINO_GAMES[tableGame(m)].label} · deployed {sinceDeploy} ago</div>
        </div>
        <span className="mp-phase-chip inprogress">In progress</span>
      </div>

      <div className="mp-ct-body">
        {seat && <DenyNotice seat={seat} href={href} />}
        <div className="mp-row" style={{ gap: '1.6rem', alignItems: 'flex-start' }}>
          <Completion goaled={goaled} total={all.length} />
          <Telemetry m={m} elapsed={elapsed} />
        </div>

        <ChallengeLinks m={m} />

        <div className="mp-mine">
          <div className="mp-cell-lbl">Your games <span className="mp-mine-count">{myGoaled}/{mine.length} goaled</span></div>
          {mine.length
            ? <TileGrid tiles={mine} />
            : <span className="mp-muted">No games recorded for your seat yet.</span>}
        </div>

        {others.length > 0 && (
          <div>
            <div className="mp-cell-lbl">The rest of the table</div>
            <TileGrid tiles={others} />
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
