import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, get } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase/config';
import { setCurrentSeason, sRef, ownHandPath } from '../firebase/season';
import type { GMMission, GMParticipant, CasinoStats, CasinoDeckChoice } from '../types';
import type { DeckCard } from '../lib/casinoData';
import { DECK_VARIANTS, DECK_VARIANT_ORDER, deckSizeFor } from '../lib/casinoData';
import { makeGambitDeck, type GambitCard, GAMBIT_DEFS_BY_ID } from '../lib/casinoGambits';
import { handStake, handStakeFromSlots, applyDeckBoost } from '../lib/casinoSlots';
import { CASINO_START_STATS, CASINO_ANTE, CASINO_REROLL_COST } from '../lib/constants';
import { CardFace } from './CardFace';
import { GambitCardFace } from './GambitCardFace';
import { PotDisplay, Seat, ChallengePanel, PokerReadout, BlackjackGauge, ResultRow } from './TableComponents';
import { MissionSlots } from './MissionBar';
import { DeckPreview } from './DeckPreview';

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'loading'
  | 'error'
  | 'deckselect'
  | 'choose'
  | 'poker'
  | 'blackjack'
  | 'folded'
  | 'gambit'
  | 'locked'
  | 'deployed';

type Game = 'poker' | 'blackjack';

// ── URL params ────────────────────────────────────────────────────────────────

function getParams() {
  const q = new URLSearchParams(window.location.search);
  return {
    missionId:    q.get('missionId') ?? '',
    missionLabel: q.get('mission')   ?? 'A Night at the Casino',
    // The table is a standalone Vite entry with no SeasonProvider, so the season
    // is passed in by the landing. Falls back to config/activeSeasonId; the
    // explicit param is what lets an alpha user open a table in a DRAFT season.
    seasonId:     q.get('seasonId')  ?? '',
  };
}

// ── Seat status helper ────────────────────────────────────────────────────────

function seatStatus(p: GMParticipant | null | undefined, isMe: boolean, now: number) {
  if (!p) return 'empty' as const;
  if (p.played) return 'locked' as const;
  if (isMe) return 'playing' as const;
  if (p.startBy && now > p.startBy - 900_000) return 'deadline' as const; // warn in last 15 min
  if (p.gameType) return 'playing' as const;
  return 'waiting' as const;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CasinoTable() {
  const params = useMemo(() => getParams(), []);
  const { missionId, missionLabel } = params;

  const [uid, setUid]             = useState<string | null>(null);
  const [mission, setMission]     = useState<GMMission | null>(null);
  const [seasonReady, setSeasonReady] = useState(false);
  // Read from seasonSecrets/, never from the mission — see the subscription below.
  const [secretHand, setSecretHand]   = useState<DeckCard[] | null>(null);
  const [phase, setPhase]         = useState<Phase>('loading');
  const [hand, setHand]           = useState<DeckCard[]>([]);
  const [gameType, setGameType]   = useState<Game | null>(null);
  const [spent, setSpent]         = useState(0);
  const [pReject, setPReject]     = useState<Set<number>>(new Set());
  const [pRedrawn, setPRedrawn]   = useState(false);
  const [bStood, setBStood]       = useState(false);
  const [bDiscardUid, setBDiscardUid] = useState<number | null>(null);
  const [gOffer, setGOffer]       = useState<GambitCard[]>([]);
  const [gPick, setGPick]         = useState<string | null>(null);
  const [flash, setFlash]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [now, setNow]             = useState(Date.now());
  const [potBump, setPotBump]     = useState(false);
  const [preferredDeck, setPreferredDeck] = useState<CasinoDeckChoice>('purist');
  const [previewDeck, setPreviewDeck]     = useState<CasinoDeckChoice | null>(null);

  const prevPot = useRef<number | null>(null);

  // 1-second tick for countdown timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auth subscription
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, user => {
      setUid(user?.uid ?? null);
      if (!user) setPhase('error');
    });
  }, []);

  // Resolve which season this table belongs to, and publish it to the path
  // helpers. Everything below waits on this — sRef() throws until it has run.
  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    (async () => {
      let sid = params.seasonId;
      if (!sid) {
        const snap = await get(ref(db, 'config/activeSeasonId'));
        sid = (snap.val() as string | null) ?? '';
      }
      if (cancelled) return;
      if (!sid) { setPhase('error'); return; }
      setCurrentSeason(sid);
      setSeasonReady(true);
    })();
    return () => { cancelled = true; };
  }, [params.seasonId]);

  // Mission subscription
  useEffect(() => {
    if (!db || !missionId || !seasonReady) return;
    return onValue(sRef(db, `missions/${missionId}`), snap => {
      const m = snap.exists() ? (snap.val() as GMMission) : null;
      setMission(m);
      if (!m) { setPhase('error'); return; }

      // Detect pot bump for animation
      const pot = (m as any).pot as number ?? 0;
      if (prevPot.current !== null && pot > prevPot.current) {
        setPotBump(true);
        setTimeout(() => setPotBump(false), 520);
      }
      prevPot.current = pot;
    });
  }, [db, missionId, seasonReady]);

  // The player's OWN hand — the one secret a client may read.
  //
  // It lives in seasonSecrets/, NOT on the mission, because RTDB read rules
  // cascade downward: the season tree is world-readable, so anything stored
  // inside it is public. Keeping the hand (and the draw deck) on the mission is
  // exactly what leaked them to every visitor under the old `game/` tree.
  // See docs/season-architecture-plan.md.
  useEffect(() => {
    if (!db || !uid || !missionId || !seasonReady) return;
    return onValue(ref(db, ownHandPath(missionId, uid)), snap => {
      setSecretHand(snap.exists() ? (snap.val() as DeckCard[]) : null);
    });
  }, [db, uid, missionId, seasonReady]);

  // Player's remembered deck preference — seeds the picker's default highlight.
  useEffect(() => {
    if (!db || !uid || !seasonReady) return;
    return onValue(sRef(db, `players/${uid}/preferredDeckChoice`), snap => {
      setPreferredDeck((snap.val() as CasinoDeckChoice | null) ?? 'purist');
    });
  }, [db, uid, seasonReady]);

  // Extended seat type. `hand` no longer lives on the participant record — it is
  // merged in from the seasonSecrets subscription below.
  type Seat = GMParticipant & { hand?: DeckCard[]; gameType?: Game; rerolled?: boolean };

  // Derive phase from Firebase state (only when not in an active local game phase).
  // Also handles session recovery when the player reloads mid-hand.
  useEffect(() => {
    if (!uid || !mission) return;
    const rawSeat = mission.participants?.[uid] as Seat | undefined;
    // Splice the secret hand back onto the public seat record.
    const seat: Seat | undefined = rawSeat
      ? { ...rawSeat, hand: secretHand ?? undefined }
      : undefined;

    if (mission.state === 'inprogress' || mission.state === 'complete') {
      setPhase('deployed');
      return;
    }
    if (seat?.played) {
      setPhase('locked');
      return;
    }
    // Don't override active local phases already set by user interaction.
    if (['poker', 'blackjack', 'folded', 'gambit', 'deckselect'].includes(phase)) return;

    // Session recovery: gambit already resolved but not locked — skip straight to lock.
    if (seat?.gambitPlayed && !seat.played && seat.hand?.length) {
      setHand(seat.hand);
      setGameType(seat.gameType ?? null);
      setGOffer([]);  // empty = gambit already done, lock button goes directly to lockCasinoResult
      if (seat.gameType) setSpent(CASINO_ANTE[seat.gameType] + (seat.rerolled ? CASINO_REROLL_COST : 0));
      setPhase('gambit');
      return;
    }

    // Session recovery: hand in progress (poker/blackjack) after page reload.
    if (seat?.hand?.length && seat.gameType && !seat.gambitPlayed) {
      setHand(seat.hand);
      setGameType(seat.gameType);
      setSpent(CASINO_ANTE[seat.gameType] + (seat.rerolled ? CASINO_REROLL_COST : 0));
      setPRedrawn(seat.rerolled ?? false);
      setPhase(seat.gameType);
      return;
    }

    // First time this cohort — pick a deck before the game choice.
    setPhase(seat?.deckChoice == null ? 'deckselect' : 'choose');
    // `secretHand` MUST be a dep: it arrives from its own seasonSecrets
    // subscription, which can resolve after the mission does. Without it, a
    // player reloading mid-hand would never have their hand restored.
    // `phase` is deliberately omitted — including it would re-run this effect on
    // every phase change and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, mission, secretHand]);

  // Callables
  const call = useCallback(<T, R>(name: string) => {
    return async (data: T): Promise<R> => {
      if (!functions) throw new Error('Firebase not configured.');
      const fn = httpsCallable<T, R>(functions, name);
      const res = await fn(data);
      return res.data;
    };
  }, []);

  const doFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(''), 4000); };

  // ── Actions ───────────────────────────────────────────────────────────────

  async function chooseDeck(choice: CasinoDeckChoice) {
    setBusy(true);
    try {
      await call<object, unknown>('setCasinoDeckChoice')({ missionId, deckChoice: choice });
      setPhase('choose');
    } catch (e: any) {
      doFlash(e?.message ?? 'Failed to set deck. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseGame(game: Game) {
    setBusy(true);
    try {
      const res = await call<object, { hand: DeckCard[]; potAdd: number }>('dealCasinoHand')({ missionId, game });
      setHand(res.hand);
      setGameType(game);
      setSpent(CASINO_ANTE[game]);
      setPReject(new Set());
      setPRedrawn(false);
      setBStood(false);
      setBDiscardUid(null);
      setPhase(game);
    } catch (e: any) {
      doFlash(e?.message ?? 'Failed to deal. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doReroll() {
    if (pReject.size === 0) { doFlash('Mark games to reroll first.'); return; }
    if (pRedrawn)           { doFlash('You may only reroll once.'); return; }
    setBusy(true);
    try {
      const res = await call<object, { hand: DeckCard[] }>('casinoDraw')({
        missionId, action: 'reroll', rejectUids: [...pReject],
      });
      setHand(res.hand);
      setSpent(s => s + CASINO_REROLL_COST);
      setPReject(new Set());
      setPRedrawn(true);
    } catch (e: any) {
      doFlash(e?.message ?? 'Reroll failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function doHit() {
    if (hand.length >= 6) { doFlash('Maximum 6 cards reached.'); return; }
    setBusy(true);
    try {
      const res = await call<object, { hand: DeckCard[] }>('casinoDraw')({ missionId, action: 'hit' });
      setHand(res.hand);
    } catch (e: any) {
      doFlash(e?.message ?? 'Draw failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function commitToGambit() {
    const offer = makeGambitDeck().drawOffer(3);
    setGOffer(offer);
    setGPick(null);
    setPhase('gambit');
  }

  async function doFold() {
    setBusy(true);
    try {
      await call<object, unknown>('casinoFold')({ missionId });
      setHand([]);
      setGameType(null);
      setSpent(0);
      setPReject(new Set());
      setPRedrawn(false);
      setBStood(false);
      setBDiscardUid(null);
      setPhase('folded');
    } catch (e: any) {
      doFlash(e?.message ?? 'Fold failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function rejoin() {
    setPhase('choose');
    setFlash('');
  }

  async function doLock() {
    setBusy(true);
    try {
      // Skip the gambit callable if it was already resolved before a page reload.
      const seatGambitPlayed =
        uid ? (mission?.participants?.[uid] as { gambitPlayed?: boolean } | undefined)?.gambitPlayed === true : false;

      if (!seatGambitPlayed) {
        await call<object, unknown>('playCasinoGambit')({
          missionId,
          gambitDefId: gPick ?? null,
        });
      }
      await call<object, { goldSwing: number }>('lockCasinoResult')({
        missionId,
        discardUid:       gameType === 'blackjack' ? bDiscardUid : null,
        pokerRejectUids:  gameType === 'poker' ? [...pReject] : null,
      });
      setPhase('locked');
    } catch (e: any) {
      doFlash(e?.message ?? 'Lock failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const pot      = (mission as any)?.pot as number ?? 0;
  const stats    = (mission?.casinoStats ?? CASINO_START_STATS) as CasinoStats;
  const allSeats = Object.values(mission?.participants ?? {}) as (GMParticipant & { hand?: DeckCard[] })[];

  const seatDeckChoice   = uid ? (mission?.participants?.[uid]?.deckChoice ?? null) : null;
  const effectiveDeckChoice: CasinoDeckChoice = seatDeckChoice ?? 'purist';

  const committedCards = useMemo(
    () => gameType === 'poker' ? hand.filter(c => !pReject.has(c.uid)) : hand.filter((_, i) => i !== hand.findIndex(c => c.uid === bDiscardUid)),
    [hand, pReject, bDiscardUid, gameType],
  );

  const lockedHand = useMemo<DeckCard[]>(() => {
    if (phase === 'gambit' || phase === 'locked' || phase === 'deployed') {
      return gameType === 'poker'
        ? hand.filter(c => !pReject.has(c.uid))
        : hand.filter(c => c.uid !== bDiscardUid);
    }
    return [];
  }, [phase, hand, pReject, bDiscardUid, gameType]);

  // Fill empty seats up to baseMax
  const baseMax   = mission?.baseMax ?? 6;
  const seatEntries: [string, (GMParticipant & { hand?: DeckCard[] }) | null][] = [];
  for (const [id, p] of Object.entries(mission?.participants ?? {})) {
    seatEntries.push([id, p as GMParticipant & { hand?: DeckCard[] }]);
  }
  while (seatEntries.length < baseMax) seatEntries.push([`__empty_${seatEntries.length}`, null]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const HAND_W  = 108;
  const GAMB_W  = 130;

  if (phase === 'loading') {
    return (
      <div className="cz-root">
        <div className="cz-center"><span className="cz-spin">✦</span>Loading the table…</div>
      </div>
    );
  }

  if (phase === 'error' || !mission || !uid) {
    return (
      <div className="cz-root">
        <div className="cz-center">
          {!uid ? 'You must be signed in to play.' : 'Mission not found or unavailable.'}
          <button className="cz-btn" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cz-root">
      {/* ── Header ── */}
      <div className="cz-top">
        <div className="cz-brand">
          <span className="cz-kick">RPelago Casino</span>
          <h1>The Card Table</h1>
        </div>
        <div className="cz-top-right">
          {seatDeckChoice && (phase === 'choose' || phase === 'folded') && (
            <button className="cz-btn ghost cz-deck-badge" onClick={() => setPhase('deckselect')} disabled={busy}>
              Deck: {DECK_VARIANTS[seatDeckChoice].label}
            </button>
          )}
          <PotDisplay amount={pot} bump={potBump} />
        </div>
      </div>

      <div className="cz-room-tag">
        {mission.state === 'forming'
          ? `${allSeats.filter(p => p?.played).length}/${baseMax} seats played · ${Math.round(40)}% of every ante feeds the pot · non-folded players split it`
          : 'This table has concluded.'}
      </div>

      {/* ── Seat rail ── */}
      <div className="cz-rail">
        {seatEntries.map(([id, p]) => {
          const isMe    = id === uid;
          const status  = seatStatus(p, isMe, now);
          const stake   = p?.played ? (p.goldSwing ?? handStakeFromSlots(p.slots)) : undefined;
          const sbLeft  = p?.startBy ? p.startBy - now : 0;
          return (
            <Seat
              key={id}
              name={p?.playerName ?? null}
              status={isMe && phase !== 'locked' && phase !== 'deployed' ? 'playing' : status}
              isMe={isMe}
              stake={stake}
              startByLabel={status === 'deadline' && sbLeft > 0 ? fmtCountdown(sbLeft) : undefined}
            />
          );
        })}
      </div>

      {/* ── Challenge panel ── */}
      <ChallengePanel
        stats={stats}
        roll={phase === 'deployed' ? (() => {
          const rel = mission.release;
          const col = mission.collect;
          return rel !== 'special' && col !== 'special'
            ? { releaseOn: rel === 'on', collectOn: col === 'on' }
            : null;
        })() : null}
      />

      {/* ── Felt stage ── */}
      <div className="cz-felt">
        <div className="cz-felt-rim" />
        <div className="cz-stage">

          {/* DECKSELECT */}
          {phase === 'deckselect' && (
            <>
              <div className="cz-stage-title">Choose your deck</div>
              <div className="cz-stage-note">
                This filters which cards you can draw for every hand you play at this table
                this cohort. Change it again any time you aren't mid-hand via the Deck badge above.
              </div>
              <div className="cz-choices">
                {DECK_VARIANT_ORDER.map(key => {
                  const v = DECK_VARIANTS[key];
                  const highlightKey = seatDeckChoice ?? preferredDeck;
                  const isHighlighted = key === highlightKey;
                  return (
                    <div key={key} className="cz-choice">
                      <button className="cz-choice-select" onClick={() => chooseDeck(key)} disabled={busy}>
                        <div className="cz-choice-name">
                          {v.label}
                          {isHighlighted && (
                            <span className="cz-choice-cost">{seatDeckChoice ? 'current' : 'last played'}</span>
                          )}
                        </div>
                        <div className="cz-choice-desc">{v.blurb}</div>
                        <div className="cz-choice-desc">{deckSizeFor(key)} of {deckSizeFor('purist')} cards in play</div>
                      </button>
                      <button
                        type="button"
                        className="cz-choice-preview"
                        onClick={e => { e.stopPropagation(); setPreviewDeck(key); }}
                      >
                        Preview
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* CHOOSE */}
          {phase === 'choose' && (
            <>
              <div className="cz-stage-title">Your turn — choose a game</div>
              <div className="cz-stage-note">
                Each card you commit to is a game you will play this round.
                Win its gold; the rarer the genre, the richer the reward.
              </div>
              <div className="cz-choices">
                <button className="cz-choice" onClick={() => chooseGame('poker')} disabled={busy}>
                  <div className="cz-choice-name">Poker <span className="cz-choice-cost">{CASINO_ANTE.poker}g</span></div>
                  <div className="cz-choice-desc">Five-card draw. Reject games you would rather not play and reroll once for {CASINO_REROLL_COST}g. Commit any remaining games you like.</div>
                </button>
                <button className="cz-choice" onClick={() => chooseGame('blackjack')} disabled={busy}>
                  <div className="cz-choice-name">Blackjack <span className="cz-choice-cost">{CASINO_ANTE.blackjack}g</span></div>
                  <div className="cz-choice-desc">Push your luck. Draw from two cards up to six — every card is another game you commit to. Keep at most five.</div>
                </button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* POKER */}
          {phase === 'poker' && (
            <>
              <div className="cz-stage-title">Poker · Five-Card Draw {pRedrawn ? '· reroll spent' : ''}</div>
              <div className="cz-hand">
                {hand.map(c => {
                  const rej = pReject.has(c.uid);
                  return (
                    <div
                      key={c.uid}
                      className={`cz-card-slot${rej ? ' rejected' : ''}`}
                      onClick={() => !busy && setPReject(r => { const next = new Set(r); next.has(c.uid) ? next.delete(c.uid) : next.add(c.uid); return next; })}
                    >
                      <span className={`cz-mark ${rej ? 'reject' : 'keep'}`}>{rej ? '✕' : '✓'}</span>
                      <CardFace card={c} look="plate" width={HAND_W} />
                      <div className="cz-card-cap">{rej ? 'rerolled' : 'committed'}</div>
                    </div>
                  );
                })}
              </div>
              <PokerReadout cards={committedCards} spent={spent} deckChoice={effectiveDeckChoice} />
              <div className="cz-actions">
                <button className="cz-btn" onClick={doReroll} disabled={busy || pRedrawn || pReject.size === 0}>
                  Reroll {pReject.size > 0 ? `${pReject.size} ` : ''}({CASINO_REROLL_COST}g)
                </button>
                <button className="cz-btn primary" onClick={commitToGambit} disabled={busy || committedCards.length === 0}>
                  Commit {committedCards.length} {committedCards.length === 1 ? 'game' : 'games'}
                </button>
                <button className="cz-btn danger" onClick={doFold} disabled={busy}>Fold</button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* BLACKJACK */}
          {phase === 'blackjack' && (
            <>
              <div className="cz-stage-title">Blackjack · Push Your Luck</div>
              <div className="cz-hand">
                {hand.map((c) => {
                  const isDiscard = c.uid === bDiscardUid;
                  return (
                    <div
                      key={c.uid}
                      className={`cz-card-slot${isDiscard ? ' discarding' : ''}`}
                      onClick={() => bStood && !busy && setBDiscardUid(d => d === c.uid ? null : c.uid)}
                    >
                      {isDiscard && <span className="cz-mark reject">✕</span>}
                      <CardFace card={c} look="plate" width={HAND_W} />
                      {bStood && <div className="cz-card-cap">{isDiscard ? 'discarding' : 'tap to discard'}</div>}
                    </div>
                  );
                })}
              </div>
              <BlackjackGauge
                shownCards={hand.filter(c => c.uid !== bDiscardUid)}
                allCards={hand}
                deckChoice={effectiveDeckChoice}
              />
              <div className="cz-actions">
                {!bStood ? (
                  <>
                    <button className="cz-btn" onClick={doHit} disabled={busy || hand.length >= 6}>
                      Hit ({hand.length}/6)
                    </button>
                    <button className="cz-btn primary" onClick={() => setBStood(true)} disabled={busy}>Stand</button>
                  </>
                ) : (
                  <button
                    className="cz-btn primary"
                    onClick={commitToGambit}
                    disabled={busy || (hand.length >= 6 && bDiscardUid === null)}
                  >
                    {hand.length >= 6 && bDiscardUid === null
                      ? 'Drop one card to lock in'
                      : `Lock in ${hand.filter(c => c.uid !== bDiscardUid).length} games · ${applyDeckBoost(hand.filter(c => c.uid !== bDiscardUid).reduce((s, c) => s + c.value, 0), effectiveDeckChoice)}g`}
                  </button>
                )}
                <button className="cz-btn danger" onClick={doFold} disabled={busy}>Fold</button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* FOLDED */}
          {phase === 'folded' && (
            <>
              <div className="cz-stage-title">You folded</div>
              <div className="cz-stage-note">
                Your entry is forfeit — its share already fed the pot.
                You can try again within the next hour, or give up your seat.
              </div>
              <div className="cz-actions">
                <button className="cz-btn primary" onClick={rejoin} disabled={busy}>Try again</button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* GAMBIT */}
          {phase === 'gambit' && (
            <>
              <div className="cz-stage-title">Play a Gambit?</div>
              <div className="cz-stage-note">
                You locked in {lockedHand.length} games worth {applyDeckBoost(handStake(lockedHand), effectiveDeckChoice)}g.
                Choose one of these to bend the room's odds for everyone — or play none and lock in.
              </div>
              <div className="cz-gambit-offer">
                {gOffer.map(card => {
                  const selected = gPick === card.defId;
                  return (
                    <div
                      key={card.uid}
                      className={`cz-gambit-pick${selected ? ' selected' : ''}`}
                      onClick={() => !busy && setGPick(sel => sel === card.defId ? null : card.defId)}
                    >
                      <GambitCardFace card={card} width={GAMB_W} />
                      <div className="cz-card-cap">{selected ? 'selected' : 'tap to choose'}</div>
                    </div>
                  );
                })}
              </div>
              <div className="cz-actions">
                <button className="cz-btn primary" onClick={doLock} disabled={busy}>
                  {gPick ? 'Play this gambit & lock in' : 'Skip & lock in'}
                </button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* LOCKED — waiting for others */}
          {phase === 'locked' && (
            <>
              <div className="cz-stage-title">You're locked in</div>
              <div className="cz-stage-note">
                Your hand is committed. Waiting for the other seats to lock in.
                Once everyone has played, the mission deploys.
              </div>
              <div className="cz-ap-banner"><div className="cz-ap-icon">✦</div></div>
            </>
          )}

          {/* DEPLOYED — reveal */}
          {phase === 'deployed' && (
            <>
              <div className="cz-stage-title">{missionLabel} · Results</div>
              {mission.release !== 'special' && mission.collect !== 'special' && (
                <div className="cz-roll-banner">
                  <span className={`cz-roll ${mission.release === 'on' ? 'on' : 'off'}`}>
                    Release {mission.release === 'on' ? 'ON' : 'OFF'}
                  </span>
                  <span className={`cz-roll ${mission.collect === 'on' ? 'on' : 'off'}`}>
                    Collect {mission.collect === 'on' ? 'ON' : 'OFF'}
                  </span>
                </div>
              )}
              <div className="cz-results">
                {Object.entries(mission.participants ?? {}).map(([id, p]) => {
                  const part  = p as GMParticipant;
                  const stake = part.goldSwing ?? handStakeFromSlots(part.slots);
                  const gambitDefId = undefined; // gambit info not tracked post-deploy
                  return (
                    <ResultRow
                      key={id}
                      name={part.playerName}
                      isMe={id === uid}
                      played={!!part.played}
                      stake={stake}
                      gambit={gambitDefId ? (GAMBIT_DEFS_BY_ID[gambitDefId] ?? null) : null}
                    />
                  );
                })}
              </div>
              <div className="cz-stage-note" style={{ marginTop: '0.5rem' }}>
                Gold payouts (hand reward + pot share) are credited when the admin marks this mission complete.
              </div>
              <div className="cz-actions">
                <button className="cz-btn ghost" onClick={() => window.close()}>Close table</button>
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── Locked slots panel ── */}
      {lockedHand.length > 0 && (
        <MissionSlots hand={lockedHand} missionLabel={missionLabel} deckChoice={effectiveDeckChoice} />
      )}

      {previewDeck && <DeckPreview choice={previewDeck} onClose={() => setPreviewDeck(null)} />}
    </div>
  );
}
