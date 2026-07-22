import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useGameState } from '../../contexts/GameStateContext';
import { useIsAdmin } from '../../contexts/SeasonContext';
import { useToast } from '../../contexts/ToastContext';
import SettingsPanel from '../SettingsPanel';
import HelpModal from '../HelpModal';
import LoginModal from '../LoginModal';
import PrivacyModal from '../PrivacyModal';
import ProfileLink from '../ProfileLink';
import PhasePanel from './PhasePanel';
import { useLastSettled } from './useLastSettled';
import OddsTrio from './OddsTrio';
import { CASINO_GAMES, CASINO_GAME_ORDER, seatSpend, type CasinoGame } from '../../lib/casinoData';
import { CASINO_START_GOLD, NAME_COLORS, nameColorValue } from '../../lib/constants';
import { currentMaxSlots, msToNextDecay, missionDisplayLabel } from '../../lib/missionLogic';
import { toRoman } from '../../lib/constants';
import type { GMMission, ActivityEntry, Player } from '../../types';
import '../../casino/themes.css';
import './landing.css';

// Short relative-time label for the activity feed ("just now", "4m", "2h", "3d").
function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45)    return 'just now';
  if (s < 3600)  return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}


// ── View persistence (Lounge cozy / Floor sleek) ─────────────────────────────
const VIEW_KEY = 'rpelago.casino.view';
type View = 'lounge' | 'floor';
function loadView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'lounge' || v === 'floor') return v; } catch { /* ignore */ }
  return 'lounge';
}

const gameFamily = (g: CasinoGame): string => (g === 'blackjack' ? 'Blackjack' : 'Poker');
const seatHue = (i: number): number => [75, 200, 295, 30, 150, 260, 340, 110][i % 8];

// Compact "1d 4h" / "5h" / "40m" for a forward duration.
function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

// Seat pips: ALL baseMax seats are drawn, so decay is visible — seats past the
// (decayed) max show as closed, and the last still-open seat pulses when a decay
// step is pending. Mirrors the map's mission pips.
function SeatPips({ m, now }: { m: GMMission; now: number }) {
  const baseMax  = m.baseMax;
  const maxSeats = currentMaxSlots(m, now);
  const seats    = Object.values(m.participants ?? {});
  const filled   = seats.length;
  const played   = seats.filter(p => p.played).length;
  const decaying = msToNextDecay(m, now) != null;

  const pips: ReactNode[] = [];
  for (let i = 0; i < baseMax; i++) {
    if (i >= maxSeats) { pips.push(<span key={i} className="rl-pip closed" />); continue; }
    const last = i === maxSeats - 1;
    const cls  = i < played ? 'rl-pip'
      : i < filled ? 'rl-pip unplayed'
      : `rl-pip empty${decaying && last ? ' decaying' : ''}`;
    pips.push(<span key={i} className={cls} style={{ '--ph': seatHue(i) } as React.CSSProperties} />);
  }
  return <div className="rl-pips">{pips}</div>;
}

// One-line decay status: how long until the next seat closes, or how many have.
function DecayNote({ m, now }: { m: GMMission; now: number }) {
  const next   = msToNextDecay(m, now);
  const closed = m.baseMax - currentMaxSlots(m, now);
  if (next != null) return <span className="rl-decay">Next seat closes in {fmtDur(next)}</span>;
  if (closed > 0)   return <span className="rl-decay closed">{closed} seat{closed === 1 ? '' : 's'} closed to decay</span>;
  return null;
}

// ── Table card ────────────────────────────────────────────────────────────────
/**
 * Gold a seat needs before sitting down. Play-on counts: a Hold 'Em seat that
 * antes in and then can't cover the second sitting is forced to fold, forfeiting
 * the ante. Reroll is genuinely optional, so it stays out.
 */
function seatBuyIn(game: CasinoGame): number {
  return seatSpend(game, { playedOn: true });
}

interface TableCardProps {
  m: GMMission;
  now: number;
  seatedHere: boolean;
  locked: boolean;
  lockLabel: string;
  /** Gold a seat must have on hand to see the game through — see `seatBuyIn`. */
  buyIn: number;
  canAfford: boolean;
  onSit: (m: GMMission) => void;
}

function TableCard({ m, now, seatedHere, locked, lockLabel, buyIn, canAfford, onSit }: TableCardProps) {
  const game    = (m.casinoGame ?? 'five_card_draw') as CasinoGame;
  const cfg     = CASINO_GAMES[game];
  const maxSeats = currentMaxSlots(m, now);
  const seats   = Object.values(m.participants ?? {});
  const filled  = seats.length;
  const played  = seats.filter(p => p.played).length;
  const full    = filled >= maxSeats;
  const ante    = cfg.ante;

  const takeable = !locked && !full && canAfford;

  return (
    <div className={`rl-tcard${seatedHere ? ' seated-here' : ''}${locked && !seatedHere ? ' locked' : ''}`}>
      <div className="rl-tcard-felt">
        <div className="rl-tcard-tag">{gameFamily(game)}</div>
        <div className="rl-tcard-name">
          {cfg.label}
          <span className="rl-pot">
            <span className="n">{m.pot ?? 0}</span><span className="u">g pot</span>
            {/* What one seat can expect: the pot split across the seats still open. */}
            <span className="s">≈{Math.floor((m.pot ?? 0) / Math.max(1, maxSeats))}g ea</span>
          </span>
        </div>
        <div className="rl-tcard-room">Cohort {toRoman(m.series)}</div>
      </div>
      <div className="rl-tcard-body">
        <SeatPips m={m} now={now} />
        <DecayNote m={m} now={now} />
        {m.casinoStats && <OddsTrio stats={m.casinoStats} open={m.casinoOpenStats} />}
        <div className="rl-tcard-stats">
          <div className="rl-mini"><span className="rl-mini-lbl">Seats</span><span className="rl-mini-val">{filled}/{maxSeats}</span></div>
          <div className="rl-mini"><span className="rl-mini-lbl">Played</span><span className="rl-mini-val">{played}</span></div>
          <div className="rl-mini"><span className="rl-mini-lbl">Ante</span><span className="rl-mini-val gold">{ante}g</span></div>
        </div>
        <div className="rl-entry">
          {(m.entryCosts ?? []).map((c, i) => <span key={i}>{c.label} <b>{c.gold}g</b></span>)}
        </div>
        <div className="rl-tcard-foot">
          {seatedHere
            ? <span className="rl-badge seated">Your seat</span>
            : full
              ? <span className="rl-badge open">Table full</span>
              : <span className="rl-badge ready">Taking seats</span>}
          {seatedHere
            ? <span className="rl-time">You're seated here</span>
            : <button className="rl-btn primary" disabled={!takeable} onClick={() => onSit(m)}
                title={locked ? lockLabel : !canAfford ? `Need ${buyIn}g to play this table through` : full ? 'Table full' : undefined}>
                {locked ? lockLabel : !canAfford ? 'Not enough gold' : 'Take a seat'}
              </button>}
        </div>
      </div>
    </div>
  );
}

// ── Nav modals (compact, real data) ───────────────────────────────────────────
function Modal({ title, tag, onClose, children }: { title: string; tag: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="rl-overlay" onClick={onClose}>
      <div className="rl-modal" onClick={e => e.stopPropagation()}>
        <button className="rl-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="rl-modal-name">{title}</div>
        <div className="rl-modal-tag">{tag}</div>
        {children}
      </div>
    </div>
  );
}

function GamesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="The Games" tag="Tonight's Tables" onClose={onClose}>
      {CASINO_GAME_ORDER.map(g => {
        const c = CASINO_GAMES[g];
        const cost = [`${c.ante}g ante`, c.reroll ? `${c.rerollCost}g reroll` : '', c.playOn ? `${c.playOn}g play-on` : '']
          .filter(Boolean).join(' · ');
        return (
          <div key={g} style={{ borderTop: '1px solid var(--border)', padding: '0.7rem 0' }}>
            <div className="rl-spread" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="rl-mini-val gold">{c.label}</span>
              <span className="rl-mini-val">{cost}</span>
            </div>
            <div className="rl-muted">Commit up to {c.pickMax} cards{c.sittings === 2 ? ' · two sittings (hole cards, then community reveal)' : ''}.</div>
          </div>
        );
      })}
    </Modal>
  );
}

interface ProfileStats { gold: number; net: number; tablesPlayed: number; biggestWin: number; }

function ProfStat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'pos' | 'neg' }) {
  return (
    <div className={`rl-prof-stat${tone ? ` rl-prof-stat--${tone}` : ''}`}>
      <div className="rl-mini-lbl">{label}</div>
      <div className="rl-prof-statval" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    </div>
  );
}

function ProfileModal({ name, uid, player, stats, onSetColor, onSignOut, onClose }: {
  name: string; uid: string; player: Player | undefined; stats: ProfileStats;
  onSetColor: (colorId: string | null) => void; onSignOut: () => void; onClose: () => void;
}) {
  const { gold, net, tablesPlayed, biggestWin } = stats;
  const hasCoat  = (player?.inventory?.['coat_of_many_colors'] ?? 0) > 0;
  const done     = player?.casinoGamesCompleted ?? {};
  const doneCount = CASINO_GAME_ORDER.filter(g => done[g]).length;

  return (
    <Modal title={name || 'Your Profile'} tag="At the Casino" onClose={onClose}>
      <div className="rl-prof-namerow">
        <span className="rl-prof-name" style={{ color: nameColorValue(player?.nameColor) }}>
          {(name || 'Player').toUpperCase()}
        </span>
        <ProfileLink uid={uid} />
      </div>

      <div className="rl-prof-grid">
        <ProfStat label="Gold on hand" value={<>{gold}<small>g</small></>} />
        <ProfStat label="This season" tone={net >= 0 ? 'pos' : 'neg'}
              value={<>{net >= 0 ? '+' : '−'}{Math.abs(net)}<small>g</small></>} />
        <ProfStat label="Tables played" value={tablesPlayed} />
        <ProfStat label="Biggest win" tone={biggestWin > 0 ? 'pos' : undefined}
              value={biggestWin > 0 ? <>+{biggestWin}<small>g</small></> : '—'} />
      </div>

      <div className="rl-prof-sec">
        <div className="rl-prof-sec-head">Name Color</div>
        {hasCoat ? (
          <div className="rl-prof-swatches">
            {NAME_COLORS.map(nc => (
              <button key={nc.id} title={nc.label} style={{ backgroundColor: nc.value }}
                className={`rl-prof-swatch${(player?.nameColor ?? 'default') === nc.id ? ' on' : ''}`}
                onClick={() => onSetColor(nc.id === 'default' ? null : nc.id)} />
            ))}
          </div>
        ) : (
          <div className="rl-prof-coat">
            <p className="rl-muted" style={{ margin: 0 }}>
              Complete a table of all four games to earn the <b>Coat of Many Colors</b> and unlock name colors.
            </p>
            <div className="rl-prof-coatprog">
              {CASINO_GAME_ORDER.map(g => (
                <span key={g} className={`rl-prof-coatpip${done[g] ? ' on' : ''}`} title={CASINO_GAMES[g].label}>
                  {done[g] ? '✓' : '·'}
                </span>
              ))}
              <span className="rl-mini-lbl" style={{ marginLeft: '0.4rem' }}>{doneCount}/4</span>
            </div>
          </div>
        )}
      </div>

      <button className="rl-btn rl-full" style={{ marginTop: '1.1rem' }} onClick={onSignOut}>
        Leave the Casino
      </button>
    </Modal>
  );
}

function FeedModal({ entries, now, onClose }: { entries: ActivityEntry[]; now: number; onClose: () => void }) {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  return (
    <Modal title="The Floor Report" tag="Recent Happenings" onClose={onClose}>
      {sorted.length === 0
        ? <p className="rl-muted">Nothing has stirred at the tables yet.</p>
        : <div className="rl-feed">
            {sorted.map(e => (
              <div key={e.id} className="rl-feed-row">
                <span className="rl-feed-ico">{e.icon || '•'}</span>
                <span className="rl-feed-msg">{e.message}</span>
                <span className="rl-feed-time">{fmtAgo(e.timestamp, now)}</span>
              </div>
            ))}
          </div>}
    </Modal>
  );
}

// ── The landing shell ─────────────────────────────────────────────────────────
export default function CasinoShell() {
  const { user, signOut } = useAuth();
  const { gameState, enlistInMission, standDownFromMission, setNameColor, activityLog } = useGameState();
  const { addToast } = useToast();
  const isAdmin = useIsAdmin();
  const [view, setView] = useState<View>(loadView);
  const [modal, setModal] = useState<null | 'profile' | 'games' | 'feed'>(null);
  const [helpOpen, setHelpOpen]       = useState(false);
  const [loginOpen, setLoginOpen]     = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(() => window.location.hash === '#privacy');
  const [now, setNow] = useState(() => Date.now());
  const [sitFlash, setSitFlash] = useState<string | null>(null);

  // The casino token layer (casino/themes.css) is scoped to `.casino-scope` so it
  // never repaints the map's themes. Apply it — and the player's saved theme — for
  // the duration of the casino landing, then release it on unmount.
  //
  // useLayoutEffect, not useEffect: this must land BEFORE paint, or the first
  // frame renders with every casino token (--felt, --panel, …) undefined.
  // (Theme selection itself is owned by the shared SettingsPanel below.)
  useLayoutEffect(() => {
    document.body.classList.add('casino-scope');
    return () => { document.body.classList.remove('casino-scope'); };
  }, []);

  // Keep decay-derived seat counts/timers fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const setViewPersisted = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const me   = user && gameState ? gameState.players[user.id] : undefined;
  const gold = me?.gold ?? 0;
  const net  = gold - CASINO_START_GOLD;
  const activeMission = me?.activeMission ?? null;

  // Lifetime casino record, computed from settled tables (the profile-site
  // counters live in a separate `profiles/` tree this shell can't read). A seat
  // only reaches missionsHistory with `played` set if it saw the hand through —
  // folds are removed at fold — so this matches `handsPlayed`'s predicate.
  const profileStats = useMemo<ProfileStats>(() => {
    const uid = user?.id;
    let tablesPlayed = 0, biggestWin = 0;
    if (uid) {
      for (const m of Object.values(gameState?.missionsHistory ?? {})) {
        const seat = m.type === 'casino' ? m.participants?.[uid] : undefined;
        if (!seat?.played) continue;
        tablesPlayed++;
        biggestWin = Math.max(biggestWin, seat.net ?? 0);
      }
    }
    return { gold, net, tablesPlayed, biggestWin };
  }, [gameState?.missionsHistory, user?.id, gold, net]);

  const tables = useMemo(() => {
    const all = Object.values(gameState?.missions ?? {});
    return all
      .filter(m => m.type === 'casino' && m.state === 'forming')
      .sort((a, b) => (a.casinoGame ?? '').localeCompare(b.casinoGame ?? '') || a.series - b.series);
  }, [gameState?.missions]);

  // The table you hold a seat at — live, so it carries you from forming through
  // in-progress without the panel tracking phase itself.
  const seatedAt   = activeMission ? gameState?.missions?.[activeMission] ?? null : null;
  const lastSettled = useLastSettled(gameState?.missionsHistory, user?.id ?? null);
  // Dismissed-ledger id lives here (not in PhasePanel) so the tables heading below
  // and the panel agree on whether the Ledger is showing.
  const [dismissedSettled, setDismissedSettled] = useState<string | null>(null);

  const locked    = !!activeMission;
  const lockLabel = 'Seated elsewhere';

  const sit = (m: GMMission) => {
    const label = `${CASINO_GAMES[(m.casinoGame ?? 'five_card_draw') as CasinoGame].label} · Cohort ${toRoman(m.series)}`;
    setSitFlash(label);
    window.setTimeout(() => setSitFlash(null), 2200);
    void enlistInMission(m.id, label);
  };

  const chooseNameColor = (colorId: string | null) => {
    if (!user) return;
    void setNameColor(user.id, colorId).catch(() =>
      addToast('Failed to update name color. Please try again.', 'error'));
  };

  const isFloor = view === 'floor';

  // The tables grid retitles with the player's seat phase, closing the loop per the
  // design: it invites you back once you're mid-room or just settled up. Mirrors
  // PhasePanel's Board (in-progress) / Ledger (settled, not yet dismissed) states.
  const showingLedger = !seatedAt && !!lastSettled && lastSettled.id !== dismissedSettled;
  const tablesTitle =
    seatedAt?.state === 'inprogress' ? 'Other Tables Forming'
    : showingLedger                  ? 'Your Seat Is Free — Pull Up Again'
    :                                  "Tonight's Tables";

  return (
    <div className="rl-root">
      <div className="rl-ambient" aria-hidden />

      <div className="rl-top">
        <div className="rl-brand">
          <span className="rl-kick">RPelago · Midseason</span>
          <h1>The Casino</h1>
        </div>
        <div className="rl-top-right">
          {user ? (
            <div className="rl-gold">
              <div className="rl-gold-ico">◈</div>
              <div className="rl-gold-info">
                <span className="rl-gold-lbl">Your gold</span>
                <span className="rl-gold-amt">
                  {gold}<small>g</small>
                </span>
              </div>
            </div>
          ) : (
            <button className="rl-btn primary" onClick={() => setLoginOpen(true)}>⚔ ENTER RPelago</button>
          )}
          <div className="rl-viewtoggle" role="tablist" aria-label="Landing view">
            {(['lounge', 'floor'] as View[]).map(v => (
              <button key={v} role="tab" aria-selected={view === v}
                className={`rl-vt${view === v ? ' on' : ''}`} onClick={() => setViewPersisted(v)}>
                {v === 'lounge' ? 'Lounge' : 'Floor'}
              </button>
            ))}
          </div>
          {/* Settings lives in the shared S1 panel (theme + font size), not a
              casino-specific modal — see SettingsPanel at the foot of the page. */}
          <div className="rl-nav">
            <button className="rl-navbtn" title="The Games" onClick={() => setModal('games')}>♠</button>
            <button className="rl-navbtn" title="The Floor Report" onClick={() => setModal('feed')}>☷</button>
            {user && <button className="rl-navbtn" title="Profile" onClick={() => setModal('profile')}>☺</button>}
            <button className="rl-navbtn" title="Adventurer's Guide" onClick={() => setHelpOpen(true)}>?</button>
          </div>
        </div>
      </div>

      {/* One panel, phase owned by the backend: mission state IS the phase. */}
      <PhasePanel
        mission={seatedAt} settled={lastSettled} uid={user?.id ?? null} now={now} view={view}
        onLeave={m => void standDownFromMission(m.id, missionDisplayLabel(m))}
        dismissedId={dismissedSettled} onDismiss={setDismissedSettled}
        colorOf={pid => nameColorValue(gameState?.players?.[pid]?.nameColor)}
        handleOf={pid => gameState?.players?.[pid]?.discordHandle ?? null}
      />

      <div className="rl-sec">
        <div className="rl-sec-head">
          <span className="rl-sec-title">{tablesTitle}</span>
          <span className="rl-sec-note">{tables.length} table{tables.length === 1 ? '' : 's'} taking seats</span>
        </div>
        {tables.length === 0
          ? <p className="rl-muted">No tables are open right now — check back soon.</p>
          : <div className={`rl-grid${isFloor ? ' rl-grid-tight' : ''}`}>
              {tables.map(m => {
                const buyIn = seatBuyIn((m.casinoGame ?? 'five_card_draw') as CasinoGame);
                return (
                  <TableCard key={m.id} m={m} now={now}
                    seatedHere={activeMission === m.id}
                    locked={locked} lockLabel={lockLabel}
                    buyIn={buyIn} canAfford={gold >= buyIn}
                    onSit={sit} />
                );
              })}
            </div>}
      </div>

      {/* Shared site settings (theme + font size + reduced motion). The font
          scale drives html{font-size}, so it scales the casino too. */}
      <SettingsPanel variant="casino" />

      {/* Admin-only, in the same S1 treatment as the map so the two shells look
          the same to the admin — and so previewing the casino always leaves a
          route back to the dashboard (and the season switcher). */}
      {isAdmin && (
        <a className="admin-toggle" href="/#admin" target="_blank" rel="noreferrer">⚙ ADMIN</a>
      )}

      {/* Shared guide, filtered to the sections a casino season actually has. */}
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} variant="casino" />

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onPrivacyClick={() => { setLoginOpen(false); setPrivacyOpen(true); }}
      />
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      {modal === 'games' && <GamesModal onClose={() => setModal(null)} />}
      {modal === 'feed'  && <FeedModal entries={activityLog} now={now} onClose={() => setModal(null)} />}
      {modal === 'profile' && user && (
        <ProfileModal
          name={me?.displayName ?? user.displayName ?? ''}
          uid={user.id}
          player={me}
          stats={profileStats}
          onSetColor={chooseNameColor}
          onSignOut={() => { setModal(null); void signOut(); }}
          onClose={() => setModal(null)}
        />
      )}

      {/* Sit flash — a brief confirmation as the seat is taken; the PhasePanel
          then carries the player through the round. */}
      {sitFlash && (
        <div className="rl-sitflash" onClick={() => setSitFlash(null)}>
          <div className="rl-sitflash-card">
            <div className="rl-sitflash-chip">♠</div>
            <div className="rl-sitflash-kick">Seat taken</div>
            <div className="rl-sitflash-name">{sitFlash}</div>
          </div>
        </div>
      )}
    </div>
  );
}
