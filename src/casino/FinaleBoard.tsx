import { useEffect, useMemo, useState } from 'react';
import type { CasinoDeckChoice, FinaleStars } from '../types';
import type { DeckCard } from '../lib/casinoData';
import {
  FINALE_ROWS, FINALE_ROW_REELS, FINALE_MAX_REROLL_REELS, finaleRowIndices,
} from '../lib/casinoData';
import { finaleOwnGold, sumStars, starsFor, FINALE_BASE_GOLD, FINALE_GOLD_PER_STAR, FINALE_REBUY_GOLD } from '../lib/finaleStars';
import { CardFace, CardBack } from './CardFace';
import './finale.css';

// The reels settle one at a time, left to right — NOT one row at a time. The
// first lands at 650ms and each later reel 260ms after the one before, so the
// whole board is up in a shade under 1.7s.
const SPIN_FIRST_MS = 650;
const SPIN_STEP_MS  = 260;

export type FinalePhase = 'armed' | 'spinning' | 'reroll' | 'rowpick' | 'keep';

interface Props {
  phase:       FinalePhase;
  board:       DeckCard[];
  /** The mission's FROZEN star snapshot, keyed by card name. */
  stars:       Record<string, FinaleStars>;
  deckChoice:  CasinoDeckChoice;
  /** What a fresh board would cost right now — 0 the first time, the rebuy after a fold. */
  rebuyCost:   number;
  /**
   * Has the entry deadline passed? The deadline closes ENTRY, not play, so this
   * changes nothing about what a seated player may do with a board they already
   * hold — but it decides whether there is a board to go BACK to after a fold.
   * `dealFinaleBoard` allows the first board past the close and refuses only the
   * rebuy, so folding here forfeits the finale outright. Three pieces of copy
   * would otherwise state the opposite of what the server will do.
   */
  entryClosed: boolean;
  /**
   * Is the arm itself dead? Decided by `finaleBoardRefusal` in the container, not
   * re-derived here, because it is the rule `dealFinaleBoard` enforces — a first
   * board IS still dealt after the close, and only a rebuy is refused. A second
   * copy of that rule is exactly what got it wrong the first time.
   */
  armBlocked:  boolean;
  busy:        boolean;
  onArm:       () => void;
  onSpinDone:  () => void;
  onReroll:    (reels: number[]) => void;
  onSkipReroll:() => void;
  onPickRow:   (row: 1 | 2 | 3) => void;
  onBackToRows:() => void;
  onFold:      () => void;
  onCommit:    (row: 1 | 2 | 3, keepUids: number[]) => void;
}

const CARD_W = 104;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A card's star strip. Stars are the finale's whole value signal, so they are never hidden. */
function Stars({ n, name }: { n: number; name: string }) {
  return (
    <span className="fin-stars" role="img" aria-label={`${name}: ${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} className={i <= n ? 'fin-star on' : 'fin-star'} aria-hidden>★</span>
      ))}
    </span>
  );
}

export default function FinaleBoard({
  phase, board, stars, deckChoice, rebuyCost, entryClosed, armBlocked, busy,
  onArm, onSpinDone, onReroll, onSkipReroll, onPickRow, onBackToRows, onFold, onCommit,
}: Props) {
  // How many reels have stopped. Only meaningful while `spinning`; every other
  // phase shows the whole board.
  const [settled, setSettled] = useState(0);
  const [picked,  setPicked]  = useState<number[]>([]);
  const [row,     setRow]     = useState<1 | 2 | 3 | null>(null);
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const [confirmFold, setConfirmFold] = useState(false);

  // ── Resetting on a phase or board change ────────────────────────────────────
  //
  // Both of these adjust state when a PROP changes, which React does during render
  // rather than in an effect (the same pattern `Countdown` uses on the mission
  // card). Doing it in an effect would mean a frame rendered with the previous
  // spin's `settled` count, or with a row selected from a board that has already
  // been replaced.
  const [prevPhase, setPrevPhase] = useState(phase);
  if (prevPhase !== phase) {
    setPrevPhase(phase);
    // Entering `spinning` restarts the settle from nothing; every other phase
    // shows the whole board.
    setSettled(phase === 'spinning' ? 0 : FINALE_ROW_REELS);
  }

  // Keyed on the CARDS, not the array identity: the board prop is a fresh `[]`
  // whenever the secret has not loaded, and comparing references would clear the
  // player's selections on an unrelated re-render.
  const boardKey = board.map(c => c?.uid).join(',');
  const [prevBoardKey, setPrevBoardKey] = useState(boardKey);
  if (prevBoardKey !== boardKey) {
    setPrevBoardKey(boardKey);
    // A reroll or a rebuy replaced cards, so a stale row or drop set would now
    // point at cards that are no longer there.
    setPicked([]);
    setRow(null);
    setDropped(new Set());
  }

  // ── The spin ────────────────────────────────────────────────────────────────
  // Only schedules timers; every setState happens in a timer callback, which is
  // what an effect is for.
  useEffect(() => {
    if (phase !== 'spinning') return;
    // Reduced motion: the board is already dealt server-side, so there is nothing
    // to reveal gradually — show it at once and hand over.
    if (prefersReducedMotion()) {
      const t = window.setTimeout(() => { setSettled(FINALE_ROW_REELS); onSpinDone(); }, 60);
      return () => window.clearTimeout(t);
    }
    const timers: number[] = [];
    for (let reel = 0; reel < FINALE_ROW_REELS; reel++) {
      timers.push(window.setTimeout(
        () => setSettled(reel + 1),
        SPIN_FIRST_MS + reel * SPIN_STEP_MS,
      ));
    }
    // One hand-over, after the last reel lands. No re-entrancy guard is needed:
    // the cleanup below clears this timer if the phase moves on first, and it is
    // the only thing that ever calls onSpinDone.
    timers.push(window.setTimeout(
      onSpinDone,
      SPIN_FIRST_MS + (FINALE_ROW_REELS - 1) * SPIN_STEP_MS + 260,
    ));
    return () => timers.forEach(window.clearTimeout);
    // `onSpinDone` is deliberately not a dep: re-running on its identity would
    // restart the animation mid-spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const starOf = (c: DeckCard | undefined) => starsFor(stars, c?.name);

  const rowCards = useMemo(
    () => (row ? finaleRowIndices(row).map(i => board[i]).filter(Boolean) : []),
    [row, board],
  );
  const kept     = rowCards.filter(c => !dropped.has(c.uid));
  const keptStars = sumStars(kept, stars);
  const keptGold  = finaleOwnGold(keptStars, deckChoice);
  const atFloor   = kept.length <= 1;

  const atCap = picked.length >= FINALE_MAX_REROLL_REELS;
  const toggleReel = (reel: number) => setPicked(prev =>
    prev.includes(reel) ? prev.filter(r => r !== reel)
    : prev.length >= FINALE_MAX_REROLL_REELS ? prev
    : [...prev, reel]);

  const toggleCard = (uid: number) => setDropped(prev => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid);
    else {
      // The floor is one card: a hand has to be worth playing something.
      if (rowCards.length - next.size <= 1) return prev;
      next.add(uid);
    }
    return next;
  });

  // ── The arm ─────────────────────────────────────────────────────────────────
  //
  // `armBlocked` is the ONE state in which the arm cannot be pulled: entry has
  // closed and this would be a rebuy. A first board is still dealt after the close
  // (the deadline closes entry, and enlisting is entry — see `finaleBoardRefusal`),
  // so the live button is correct for a player who enlisted in time and has not
  // spun yet.
  if (phase === 'armed') {
    return (
      <div className="fin-wrap">
        <div className="fin-head">
          <h2 className="fin-title">{armBlocked ? 'The finale has closed' : 'One last Archipelago'}</h2>
          <p className="fin-sub">
            {armBlocked ? (
              // Says only what `finaleBoardRefusal` actually established: entry is
              // closed and this board would be a rebuy. WHEN the fold happened is
              // not knowable from here — it may have been days before the deadline,
              // or on a seat that was swept and re-entered — so the copy must not
              // claim the close caught them mid-board, nor that this particular
              // fold is what ended things.
              <>Entry to the finale has closed, and a board after a fold is a rebuy —
              so there is no fresh one to buy. Your seat clears itself shortly.</>
            ) : (
              <>Three rows, five reels. You will take <strong>one row</strong> and keep only the
              cards you are willing to play — so the arm is the easy part.
              {rebuyCost > 0 && <> This board costs <strong>{rebuyCost}g</strong>.</>}</>
            )}
          </p>
        </div>
        {entryClosed && !armBlocked && (
          <div className="fin-note">
            <strong>Entry has closed and the table is waiting on you.</strong>{' '}
            You were let in before the deadline, so the spin is still yours — but the
            finale cannot deploy until you take a row and lock in.
          </div>
        )}
        <div className="fin-machine fin-idle" aria-hidden>
          {Array.from({ length: FINALE_ROWS * FINALE_ROW_REELS }, (_, i) => (
            <CardBack key={i} width={CARD_W} variant="medallion" />
          ))}
        </div>
        {!armBlocked && (
          <div className="fin-actions">
            <button className="fin-arm" disabled={busy} onClick={onArm}>
              {busy ? 'Spinning…' : rebuyCost > 0 ? `⟳ Pull the arm · ${rebuyCost}g` : '⟳ Pull the arm'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Spinning / reroll / rowpick / keep all render the machine ───────────────
  const reelSelectable = phase === 'reroll';
  const rowSelectable  = phase === 'rowpick';

  return (
    <div className="fin-wrap">
      <div className="fin-head">
        {phase === 'spinning' && <>
          <h2 className="fin-title">Spinning…</h2>
          <p className="fin-sub">Five reels, one at a time.</p>
        </>}
        {phase === 'reroll' && <>
          <h2 className="fin-title">Your one reroll</h2>
          <p className="fin-sub">
            Tap up to <strong>three reels</strong>. A reel is a whole column — all three of its
            cards respin. Look for games you are willing to <strong>play</strong>, not just high stars.
          </p>
        </>}
        {phase === 'rowpick' && <>
          <h2 className="fin-title">Take one row</h2>
          <p className="fin-sub">
            Whichever row you take, you choose which of its cards to keep next — and every card
            you keep is a game you will play.
          </p>
        </>}
        {phase === 'keep' && <>
          <h2 className="fin-title">Row {row} — keep what you want</h2>
          <p className="fin-sub">
            Drop as many as you like; keep at least one. More stars pay more <em>and</em> ask more.
          </p>
        </>}
      </div>

      {phase === 'reroll' && (
        <div className="fin-note">
          <strong>{picked.length} of {FINALE_MAX_REROLL_REELS} reels selected.</strong>{' '}
          {atCap ? 'That is all three — deselect one to swap it.'
            : picked.length === 0 ? 'Or keep the board as it stands; the reroll is optional.'
            : `You may pick ${FINALE_MAX_REROLL_REELS - picked.length} more.`}
        </div>
      )}

      <div className={`fin-machine${phase === 'spinning' ? ' fin-spinning' : ''}`}>
        {Array.from({ length: FINALE_ROWS }, (_, r) => {
          const rowNum = (r + 1) as 1 | 2 | 3;
          const inChosenRow = phase === 'keep' && row === rowNum;
          const dimRow = phase === 'keep' && row !== rowNum;
          return finaleRowIndices(rowNum).map((idx, reel) => {
            const card = board[idx];
            const stopped = phase !== 'spinning' || reel < settled;
            const reelOn  = picked.includes(reel);
            const isDropped = inChosenRow && card && dropped.has(card.uid);

            const cls = [
              'fin-cell',
              stopped ? 'fin-stopped' : 'fin-rolling',
              reelSelectable && reelOn ? 'fin-reel-on' : '',
              reelSelectable && atCap && !reelOn ? 'fin-reel-blocked' : '',
              dimRow ? 'fin-dim' : '',
              isDropped ? 'fin-dropped' : '',
            ].filter(Boolean).join(' ');

            const label = !card ? ''
              : reelSelectable ? `Reel ${reel + 1}: respin ${card.name}`
              : rowSelectable  ? `Take row ${rowNum}`
              : inChosenRow    ? `${isDropped ? 'Keep' : 'Drop'} ${card.name}`
              : card.name;

            const onClick = !stopped || !card ? undefined
              : reelSelectable ? () => toggleReel(reel)
              : rowSelectable  ? () => { setRow(rowNum); onPickRow(rowNum); }
              : inChosenRow    ? () => toggleCard(card.uid)
              : undefined;

            const inner = stopped && card ? (
              <>
                <CardFace card={card} look="plate" width={CARD_W} stars={starOf(card)} />
                <Stars n={starOf(card)} name={card.name} />
                {inChosenRow && (
                  <span className={`fin-tag${isDropped ? '' : ' on'}`}>
                    {isDropped ? 'DROPPED' : 'KEEPING'}
                  </span>
                )}
              </>
            ) : <CardBack width={CARD_W} variant="lattice" />;

            return onClick ? (
              <button
                key={idx} type="button" className={cls} onClick={onClick}
                aria-pressed={reelSelectable ? reelOn : inChosenRow ? !isDropped : undefined}
                aria-label={label} disabled={busy}
              >{inner}</button>
            ) : (
              <div key={idx} className={cls}>{inner}</div>
            );
          });
        })}
      </div>

      {phase === 'rowpick' && (
        <div className="fin-rowbtns">
          {([1, 2, 3] as const).map(r => (
            <button key={r} className="fin-rowbtn" disabled={busy}
              onClick={() => { setRow(r); onPickRow(r); }}>
              Take row {r}
              <small>
                {sumStars(finaleRowIndices(r).map(i => board[i]).filter(Boolean), stars)}★ ·
                up to {finaleOwnGold(sumStars(finaleRowIndices(r).map(i => board[i]).filter(Boolean), stars), deckChoice)}g
              </small>
            </button>
          ))}
        </div>
      )}

      {phase === 'keep' && (
        <div className="fin-tally">
          <div className="fin-tally-fig">
            {/* "GAMES TO PLAY", never "kept" — the obligation is what makes
                dropping a card a real choice rather than a dead control. */}
            <span className="fin-tally-lbl">Games to play</span>
            <strong>{kept.length} of {rowCards.length}</strong>
          </div>
          <div className="fin-tally-fig">
            <span className="fin-tally-lbl">Stars</span>
            <strong>{keptStars}</strong>
          </div>
          <div className="fin-sum">
            {FINALE_BASE_GOLD} + {FINALE_GOLD_PER_STAR} × {keptStars}
            {keptGold !== FINALE_BASE_GOLD + FINALE_GOLD_PER_STAR * keptStars && <> · {deckChoice}</>}
            {' = '}<strong>{keptGold}g</strong>
          </div>
          {atFloor && <div className="fin-floor">One card is the minimum — this one stays.</div>}
        </div>
      )}

      {confirmFold ? (
        <div className="fin-fold-warn" role="alertdialog" aria-label="Fold this board">
          {entryClosed ? (
            <p>
              <strong>Entry to the finale has closed</strong>, so this board cannot be replaced —
              there is no rebuy left to buy. Folding it now <strong>ends your finale</strong>, and
              it can only be played once, so there is no second entry either.
            </p>
          ) : (
            <p>
              Folding throws this whole board away. A fresh one costs{' '}
              <strong>{rebuyCost > 0 ? rebuyCost : FINALE_REBUY_GOLD}g</strong> — and so does every
              board after that. The rebuy is charged each time you fold, not once, and it stops
              being available the moment entry closes.
            </p>
          )}
          <p className="fin-fold-why">
            {entryClosed
              ? 'Worth it only if you would rather play nothing at all than anything on this board.'
              : 'Worth it only if nothing here is worth playing at the price it pays.'}
          </p>
          <div className="fin-actions">
            <button className="fin-danger" disabled={busy} onClick={onFold}>
              {busy ? '…' : entryClosed ? 'Fold — give up my finale' : 'Fold the board'}
            </button>
            <button className="fin-ghost" disabled={busy} onClick={() => setConfirmFold(false)}>
              Keep looking
            </button>
          </div>
        </div>
      ) : (
        <div className="fin-actions">
          {phase === 'reroll' && <>
            <button className="fin-primary" disabled={busy || picked.length === 0}
              onClick={() => onReroll(picked)}>
              {busy ? '…' : `⟳ Spin ${picked.length} selected`}
            </button>
            <button className="fin-ghost" disabled={busy} onClick={onSkipReroll}>
              Keep this board
            </button>
          </>}
          {phase === 'rowpick' && (
            <button className="fin-ghost" disabled={busy} onClick={() => setConfirmFold(true)}>
              {entryClosed ? 'Fold — and give up the finale' : 'Fold — nothing here is playable'}
            </button>
          )}
          {phase === 'keep' && row && <>
            <button className="fin-primary" disabled={busy || kept.length === 0}
              onClick={() => onCommit(row, kept.map(c => c.uid))}>
              Name {kept.length} {kept.length === 1 ? 'game' : 'games'} · {keptGold}g
            </button>
            <button className="fin-ghost" disabled={busy}
              onClick={() => { setRow(null); setDropped(new Set()); onBackToRows(); }}>
              ← Pick a different row
            </button>
          </>}
        </div>
      )}
    </div>
  );
}
