import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useGameState } from '../../contexts/GameStateContext';
import { useIsAdmin } from '../../contexts/SeasonContext';
import SettingsPanel from '../SettingsPanel';
import HelpModal from '../HelpModal';
import { CASINO_GAMES, CASINO_GAME_ORDER, type CasinoGame } from '../../lib/casinoData';
import { CASINO_START_GOLD } from '../../lib/constants';
import { currentMaxSlots } from '../../lib/missionLogic';
import { toRoman } from '../../lib/constants';
import type { GMMission } from '../../types';
import '../../casino/themes.css';
import './landing.css';

// ── View persistence (Lounge cozy / Floor sleek) ─────────────────────────────
const VIEW_KEY = 'rpelago.casino.view';
type View = 'lounge' | 'floor';
function loadView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'lounge' || v === 'floor') return v; } catch { /* ignore */ }
  return 'lounge';
}

const gameFamily = (g: CasinoGame): string => (g === 'blackjack' ? 'Blackjack' : 'Poker');
const seatHue = (i: number): number => [75, 200, 295, 30, 150, 260, 340, 110][i % 8];

// ── Table card ────────────────────────────────────────────────────────────────
interface TableCardProps {
  m: GMMission;
  now: number;
  seatedHere: boolean;
  locked: boolean;
  lockLabel: string;
  canAfford: boolean;
  onSit: (m: GMMission) => void;
}

function TableCard({ m, now, seatedHere, locked, lockLabel, canAfford, onSit }: TableCardProps) {
  const game    = (m.casinoGame ?? 'five_card_draw') as CasinoGame;
  const cfg     = CASINO_GAMES[game];
  const maxSeats = currentMaxSlots(m, now);
  const seats   = Object.values(m.participants ?? {});
  const filled  = seats.length;
  const played  = seats.filter(p => p.played).length;
  const full    = filled >= maxSeats;
  const ante    = cfg.ante;

  const pips: ReactNode[] = [];
  for (let i = 0; i < maxSeats; i++) {
    if (i < played)      pips.push(<span key={i} className="rl-pip"          style={{ '--ph': seatHue(i) } as React.CSSProperties} />);
    else if (i < filled) pips.push(<span key={i} className="rl-pip unplayed" style={{ '--ph': seatHue(i) } as React.CSSProperties} />);
    else                 pips.push(<span key={i} className="rl-pip empty" />);
  }

  const takeable = !locked && !full && canAfford;

  return (
    <div className={`rl-tcard${seatedHere ? ' seated-here' : ''}${locked && !seatedHere ? ' locked' : ''}`}>
      <div className="rl-tcard-felt">
        <div className="rl-tcard-tag">{gameFamily(game)}</div>
        <div className="rl-tcard-name">
          {cfg.label}
          <span className="rl-pot"><span className="n">{m.pot ?? 0}</span><span className="u">g pot</span></span>
        </div>
        <div className="rl-tcard-room">Cohort {toRoman(m.series)}</div>
      </div>
      <div className="rl-tcard-body">
        <div className="rl-pips">{pips}</div>
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
                title={locked ? lockLabel : !canAfford ? `Need ${ante}g to ante up` : full ? 'Table full' : undefined}>
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

function ProfileModal({ name, gold, net, onClose }: { name: string; gold: number; net: number; onClose: () => void }) {
  return (
    <Modal title={name || 'Your Profile'} tag="At the Casino" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
        <div className="rl-tcard-felt" style={{ borderRadius: 9, textAlign: 'center' }}>
          <div className="rl-mini-lbl">Gold on hand</div>
          <div className="rl-gold-amt">{gold}<small>g</small></div>
        </div>
        <div className="rl-tcard-felt" style={{ borderRadius: 9, textAlign: 'center' }}>
          <div className="rl-mini-lbl">This season</div>
          <div className="rl-gold-amt" style={{ color: net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {net >= 0 ? '+' : '−'}{Math.abs(net)}<small>g</small>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── The landing shell ─────────────────────────────────────────────────────────
export default function CasinoShell() {
  const { user } = useAuth();
  const { gameState, enlistInMission } = useGameState();
  const isAdmin = useIsAdmin();
  const [view, setView] = useState<View>(loadView);
  const [modal, setModal] = useState<null | 'profile' | 'games'>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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

  const tables = useMemo(() => {
    const all = Object.values(gameState?.missions ?? {});
    return all
      .filter(m => m.type === 'casino' && m.state === 'forming')
      .sort((a, b) => (a.casinoGame ?? '').localeCompare(b.casinoGame ?? '') || a.series - b.series);
  }, [gameState?.missions]);

  const locked    = !!activeMission;
  const lockLabel = 'Seated elsewhere';

  const sit = (m: GMMission) => {
    void enlistInMission(m.id, `${CASINO_GAMES[(m.casinoGame ?? 'five_card_draw') as CasinoGame].label} · Cohort ${toRoman(m.series)}`);
  };

  const isFloor = view === 'floor';

  return (
    <div className="rl-root">
      <div className="rl-ambient" aria-hidden />

      <div className="rl-top">
        <div className="rl-brand">
          <span className="rl-kick">RPelago · Midseason</span>
          <h1>The Casino</h1>
          <span className="rl-sub">{isFloor ? 'Walk the floor' : 'A quiet corner of the archipelago'}</span>
        </div>
        <div className="rl-top-right">
          <div className="rl-gold">
            <div className="rl-gold-ico">◈</div>
            <div className="rl-gold-info">
              <span className="rl-gold-lbl">Your gold</span>
              <span className="rl-gold-amt">
                {gold}<small>g</small>
                {net !== 0 && <span className={`rl-gold-net ${net > 0 ? 'pos' : 'neg'}`}>{net > 0 ? '+' : '−'}{Math.abs(net)} this season</span>}
              </span>
            </div>
          </div>
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
            <button className="rl-navbtn" title="Profile" onClick={() => setModal('profile')}>☺</button>
            <button className="rl-navbtn" title="Adventurer's Guide" onClick={() => setHelpOpen(true)}>?</button>
          </div>
        </div>
      </div>

      {/* Current-seat line — the full evolving phase panel lands in a later slice. */}
      <div className="rl-seatline">
        <div className="rl-ct-kick">{activeMission ? 'Your seat' : 'No seat yet'}</div>
        <div className="rl-ct-name">{activeMission ? 'You are seated at a table' : "You're not seated at a table"}</div>
        <p className="rl-muted">
          {activeMission ? 'Head to the card table to play your hand.' : 'Pull up a chair at any open table below to start playing for gold.'}
        </p>
      </div>

      <div className="rl-sec">
        <div className="rl-sec-head">
          <span className="rl-sec-title">{isFloor ? 'The Floor' : "Tonight's Tables"}</span>
          <span className="rl-sec-note">{tables.length} table{tables.length === 1 ? '' : 's'} taking seats</span>
        </div>
        {tables.length === 0
          ? <p className="rl-muted">No tables are open right now — check back soon.</p>
          : <div className={`rl-grid${isFloor ? ' rl-grid-tight' : ''}`}>
              {tables.map(m => (
                <TableCard key={m.id} m={m} now={now}
                  seatedHere={activeMission === m.id}
                  locked={locked} lockLabel={lockLabel}
                  canAfford={gold >= CASINO_GAMES[(m.casinoGame ?? 'five_card_draw') as CasinoGame].ante}
                  onSit={sit} />
              ))}
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

      {modal === 'games'   && <GamesModal   onClose={() => setModal(null)} />}
      {modal === 'profile' && <ProfileModal name={me?.displayName ?? ''} gold={gold} net={net} onClose={() => setModal(null)} />}
    </div>
  );
}
