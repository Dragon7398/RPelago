// Seat rail, pot chip, challenge panel, readout, gauge, and reveal row components.

import type { DeckCard } from '../lib/casinoData';
import type { CasinoStats, CasinoDeckChoice } from '../types';
import type { GambitDef } from '../lib/casinoGambits';
import { applyDeckBoost } from '../lib/casinoSlots';

// ── Pot display ───────────────────────────────────────────────────────────────

interface PotDisplayProps { amount: number; bump?: boolean; }

export function PotDisplay({ amount, bump }: PotDisplayProps) {
  return (
    <div className="cz-pot">
      <div className="cz-pot-coins">
        <span className="cz-pot-coin" /><span className="cz-pot-coin" /><span className="cz-pot-coin" />
      </div>
      <div className="cz-pot-info">
        <span className="cz-pot-label">The Pot</span>
        <span className={`cz-pot-amt${bump ? ' bump' : ''}`}>
          {amount}<span style={{ fontSize: '0.6em', color: 'var(--gold-dim)' }}>g</span>
        </span>
      </div>
    </div>
  );
}

// ── Player seat in the rail ───────────────────────────────────────────────────

type SeatStatus = 'empty' | 'waiting' | 'deadline' | 'playing' | 'locked';

interface SeatProps {
  name: string | null;
  status: SeatStatus;
  isMe: boolean;
  stake?: number;         // gold they're playing for (once locked)
  startByLabel?: string;  // "XX:XX left" deadline display
}

const STATUS_DOT: Record<SeatStatus, string> = {
  empty:    '',
  waiting:  'wait',
  deadline: 'live',
  playing:  'live',
  locked:   'lock',
};

const STATUS_TEXT: Record<SeatStatus, string> = {
  empty:    'Open',
  waiting:  'Waiting',
  deadline: 'Must start',
  playing:  'Playing…',
  locked:   'Locked in',
};

export function Seat({ name, status, isMe, stake, startByLabel }: SeatProps) {
  const cls = ['cz-seat'];
  if (isMe)           cls.push('you');
  if (status === 'playing') cls.push('active');
  if (status === 'empty')   cls.push('empty');

  const initial = name ? name[0].toUpperCase() : '?';
  const dot     = STATUS_DOT[status];
  const text    = STATUS_TEXT[status];

  return (
    <div className={cls.join(' ')}>
      <div className="cz-seat-head">
        <div className="cz-seat-av">{initial}</div>
        <div className="cz-seat-id">
          <span className="cz-seat-name">{name ?? '—'}</span>
        </div>
      </div>
      {stake != null && stake > 0 && (
        <div className="cz-seat-stake">
          <span className="cz-seat-stake-val">{stake}g</span>
          <span className="cz-seat-stake-lbl">on table</span>
        </div>
      )}
      <div className="cz-seat-status">
        {dot && <span className={`cz-status-dot ${dot}`} />}
        {text}
      </div>
      {startByLabel && status === 'deadline' && (
        <div className="cz-seat-startby">{startByLabel} to start</div>
      )}
    </div>
  );
}

// ── Archipelago challenge panel ───────────────────────────────────────────────

const CH_ROWS = [
  { key: 'release' as keyof CasinoStats, label: 'Release Odds', hue: 200 },
  { key: 'collect' as keyof CasinoStats, label: 'Collect Odds', hue: 295 },
  { key: 'hint'    as keyof CasinoStats, label: 'Hint Cost',    hue: 30  },
];

const BASE_STATS: CasinoStats = { release: 60, collect: 30, hint: 10, xp: 50 };

interface ChallengePanelProps {
  stats: CasinoStats;
  roll?: { releaseOn: boolean; collectOn: boolean } | null;
}

export function ChallengePanel({ stats, roll }: ChallengePanelProps) {
  return (
    <div className="cz-challenge">
      <div className="cz-ch-head">The Archipelago Challenge</div>
      <div className="cz-ch-stats">
        {CH_ROWS.map(r => {
          const v    = stats[r.key] as number;
          const base = BASE_STATS[r.key] as number;
          const diff = Math.round((v - base) * 10) / 10;
          const on   = roll && r.key !== 'hint'
            ? (r.key === 'release' ? roll.releaseOn : roll.collectOn)
            : null;
          return (
            <div className="cz-ch-stat" key={r.key} style={{ '--ch-hue': r.hue } as React.CSSProperties}>
              <span className="cz-ch-label">{r.label}</span>
              <span className="cz-ch-val">{v}<small>%</small></span>
              {on === null
                ? (diff
                    ? <span className={`cz-ch-diff ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '+' : '−'}{Math.abs(diff)}</span>
                    : <span className="cz-ch-diff flat">—</span>)
                : <span className={`cz-ch-roll ${on ? 'on' : 'off'}`}>{on ? 'ON' : 'OFF'}</span>}
            </div>
          );
        })}
        <div className="cz-ch-stat xp">
          <span className="cz-ch-label">Reward</span>
          <span className="cz-ch-val">{stats.xp}<small> XP</small></span>
          {stats.xp !== BASE_STATS.xp
            ? <span className="cz-ch-diff up">+{stats.xp - BASE_STATS.xp}</span>
            : <span className="cz-ch-diff flat">each</span>}
        </div>
      </div>
    </div>
  );
}

// ── Poker readout ─────────────────────────────────────────────────────────────

interface PokerReadoutProps { cards: DeckCard[]; spent: number; deckChoice?: CasinoDeckChoice; }

export function PokerReadout({ cards, spent, deckChoice }: PokerReadoutProps) {
  const raw     = cards.reduce((s, c) => s + c.value, 0);
  const total   = deckChoice ? applyDeckBoost(raw, deckChoice) : raw;
  const boosted = total !== raw;
  const net     = total - spent;
  return (
    <div className="cz-readout">
      <div className="ro-block">
        <span className="ro-label">Committed</span>
        <span className="ro-val">{cards.length} {cards.length === 1 ? 'game' : 'games'}</span>
      </div>
      <span className="ro-x">·</span>
      <div className="ro-block">
        <span className="ro-label">Reward</span>
        <span className="ro-val ro-total">{total}g</span>
        {boosted && <span className="cz-ch-diff up">+10% Purist</span>}
      </div>
      <span className="ro-x">·</span>
      <div className="ro-block">
        <span className="ro-label">Net of entry</span>
        <span className={`ro-val ${net >= 0 ? 'ro-net-pos' : 'ro-net-neg'}`}>
          {net >= 0 ? '+' : '−'}{Math.abs(net)}g
        </span>
      </div>
    </div>
  );
}

// ── Blackjack gauge ───────────────────────────────────────────────────────────

interface BlackjackGaugeProps { shownCards: DeckCard[]; allCards: DeckCard[]; deckChoice?: CasinoDeckChoice; }

export function BlackjackGauge({ shownCards, allCards, deckChoice }: BlackjackGaugeProps) {
  const sorted     = [...allCards].sort((a, b) => b.value - a.value);
  const potential  = sorted.slice(0, Math.min(5, sorted.length)).reduce((s, c) => s + c.value, 0);
  const keptSumRaw = shownCards.reduce((s, c) => s + c.value, 0);
  const keptSum    = deckChoice ? applyDeckBoost(keptSumRaw, deckChoice) : keptSumRaw;
  const boosted    = keptSum !== keptSumRaw;
  const count      = shownCards.length;
  const leaving    = Math.max(0, potential - keptSumRaw);
  const note       = leaving > 0 ? `leaving ${leaving}g behind` : 'keeping the maximum';
  const pct        = potential > 0 ? Math.min(100, Math.round((keptSumRaw / potential) * 100)) : 0;
  const capped     = allCards.length >= 6;

  return (
    <div className="cz-gauge">
      <div className="cz-gauge-head">
        <span>Gold you're keeping</span>
        <span>of {potential}g possible{capped ? ' · best 5' : ''}</span>
      </div>
      <div className="cz-gauge-track">
        <div className={`cz-gauge-fill ${leaving > 0 ? 'sharp' : 'safe'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="cz-gauge-nums">
        <span className="cz-gauge-sum">
          {keptSum}g · {count} {count === 1 ? 'game' : 'games'}
          {boosted && <span className="cz-ch-diff up"> +10% Purist</span>}
        </span>
        <span className="cz-gauge-tgt">{note}</span>
      </div>
    </div>
  );
}

// ── Reveal result row ─────────────────────────────────────────────────────────

interface ResultRowProps {
  name: string;
  isMe: boolean;
  played: boolean;
  stake: number;         // sum of card values from slots
  gambit?: GambitDef | null;
}

export function ResultRow({ name, isMe, played, stake, gambit }: ResultRowProps) {
  const cls = ['cz-result-row'];
  if (isMe)   cls.push('you');
  if (played) cls.push('win'); else cls.push('fold');

  return (
    <div className={cls.join(' ')}>
      <div className="cz-seat-av" style={{ width: '1.7rem', height: '1.7rem' }}>{name[0]?.toUpperCase()}</div>
      <div className="cz-rr-name">{name}</div>
      <div className="cz-rr-mid">
        {played
          ? <span className="cz-rr-combo">{stake > 0 ? `${stake}g on the table` : 'no stake'}</span>
          : <span className="cz-rr-combo cz-rr-detail">did not play</span>}
        {gambit && (
          <span className="cz-rr-gambit" style={{ '--gh': gambit.kind === 'bonus' ? 150 : 28 } as React.CSSProperties}>
            {gambit.delta > 0 ? '▲' : '▼'} {gambit.deltaLabel} {gambit.statLabel}
          </span>
        )}
      </div>
      <div className={`cz-rr-net ${played ? 'pos' : 'neg'}`}>
        {played ? `${stake}g` : '—'}
        {played && <span className="cz-rr-sub">+ pot share</span>}
      </div>
    </div>
  );
}
