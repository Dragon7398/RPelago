import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, get } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase/config';
import { setCurrentSeason, sRef, ownHandPath } from '../firebase/season';
import type { GMMission, GMParticipant, CasinoStats, CasinoDeckChoice } from '../types';
import type { DeckCard, CasinoGame } from '../lib/casinoData';
import {
  DECK_VARIANTS, DECK_VARIANT_ORDER, deckSizeFor, CASINO_GAMES, seatSpend,
} from '../lib/casinoData';
import { makeGambitDeck, type GambitCard, GAMBIT_DEFS_BY_ID } from '../lib/casinoGambits';
import { handStake, handStakeFromSlots, applyDeckBoost } from '../lib/casinoSlots';
import { CASINO_START_STATS } from '../lib/constants';
import { CardFace } from './CardFace';
import { GambitCardFace } from './GambitCardFace';
import { PotDisplay, Seat, ChallengePanel, PokerReadout, BlackjackGauge, ResultRow } from './TableComponents';
import { MissionSlots } from './MissionBar';
import { DeckPreview } from './DeckPreview';

// ── Types ─────────────────────────────────────────────────────────────────────

// The game is NOT chosen here any more — each table is pinned to one game via
// `mission.casinoGame` (the multi-table model). What used to be the `choose`
// phase is now `ante`: read the table you sat at, then pay in.
type Phase =
  | 'loading'
  | 'error'
  | 'deckselect'
  | 'ante'
  | 'play'      // single sitting in progress: Five Card Draw · Seven Card Stud · Blackjack
  | 'holdwait'  // Hold 'Em sitting 1 done — waiting on the shared community reveal
  | 'holdplay'  // Hold 'Em sitting 2 — build the best five, or fold
  | 'folded'
  | 'gambit'
  | 'locked'
  | 'deployed';

// Phases owned by local interaction. The Firebase-derived effect must not yank
// the player out of one of these mid-hand. `holdwait` is deliberately NOT here:
// it exists precisely to be pushed forward by the server's community reveal.
const LOCAL_PHASES: Phase[] = ['deckselect', 'play', 'holdplay', 'folded', 'gambit'];

const GAME_BLURB: Record<CasinoGame, string> = {
  five_card_draw:
    'Five cards, one hand. Mark any you would rather not play and reroll them once — ' +
    'you commit to whatever you are holding when you are done.',
  seven_card_stud:
    'Seven cards, dealt at once. Drop the two you least want to play and commit the best five.',
  holdem:
    'Two hole cards now. Once every seat is in, five shared cards are revealed — then pay the ' +
    'play-on to build your best five out of all seven, or fold and walk away from your ante.',
  blackjack:
    'Push your luck. Draw from two cards up to six — every card is another game you commit to. ' +
    'Keep at most five.',
};

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
  if (p.holeLocked) return 'playing' as const;   // Hold 'Em: in, waiting on the reveal
  if (p.startBy && now > p.startBy - 900_000) return 'deadline' as const; // warn in last 15 min
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

// Which gambit each seat played, read back off the PUBLIC audit log. The seat
// record doesn't keep it, but casinoLog does — so the reveal can name it.
function gambitsBySeat(m: GMMission | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of Object.values(m?.casinoLog ?? {})) {
    if (e.event === 'gambit' && e.gambitDefId) out[e.uid] = e.gambitDefId;
  }
  return out;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CasinoTable() {
  const params = useMemo(() => getParams(), []);
  const { missionId, missionLabel } = params;

  const [uid, setUid]             = useState<string | null>(null);
  const [mission, setMission]     = useState<GMMission | null>(null);
  const [seasonReady, setSeasonReady] = useState(false);
  const [resolvedSeasonId, setResolvedSeasonId] = useState('');
  const [shell, setShell]         = useState<'map' | 'casino'>('casino');
  // Read from seasonSecrets/, never from the mission — see the subscription below.
  const [secretHand, setSecretHand]   = useState<DeckCard[] | null>(null);
  const [phase, setPhase]         = useState<Phase>('loading');
  const [hand, setHand]           = useState<DeckCard[]>([]);
  // Two DIFFERENT selection models, one per game family:
  //  · `reject` — Five Card Draw only: cards to REROLL (they are replaced, not dropped).
  //  · `keep`   — the subsetSelect games: the cards to COMMIT, capped at pickMax.
  const [reject, setReject]       = useState<Set<number>>(new Set());
  const [keep, setKeep]           = useState<Set<number>>(new Set());
  const [rerolled, setRerolled]   = useState(false);
  const [stood, setStood]         = useState(false);
  const [spent, setSpent]         = useState(0);
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
  // The shell comes with it: a casino season's XP is inert (gambit XP is paid
  // out as gold instead), so the challenge panel must not advertise XP there.
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

      // Drafts are readable only by admin/alpha — exactly who can open a draft
      // table — so a failed read here just means "not a draft"; default to casino.
      const listed = await get(ref(db, `config/seasonList/${sid}/shell`));
      let sh = listed.val() as 'map' | 'casino' | null;
      if (!sh) {
        const draft = await get(ref(db, `config/draftSeasons/${sid}/shell`)).catch(() => null);
        sh = (draft?.val() as 'map' | 'casino' | null) ?? 'casino';
      }
      if (cancelled) return;

      setShell(sh);
      setCurrentSeason(sid);
      setResolvedSeasonId(sid);
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
      const pot = m.pot ?? 0;
      if (prevPot.current !== null && pot > prevPot.current) {
        setPotBump(true);
        setTimeout(() => setPotBump(false), 520);
      }
      prevPot.current = pot;
    });
  }, [missionId, seasonReady]);

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
  }, [uid, missionId, seasonReady]);

  // Player's remembered deck preference — seeds the picker's default highlight.
  useEffect(() => {
    if (!db || !uid || !seasonReady) return;
    return onValue(sRef(db, `players/${uid}/preferredDeckChoice`), snap => {
      setPreferredDeck((snap.val() as CasinoDeckChoice | null) ?? 'purist');
    });
  }, [uid, seasonReady]);

  const game = mission?.casinoGame ?? null;
  const cfg  = game ? CASINO_GAMES[game] : null;

  // Derive phase from Firebase state (only when not in an active local phase).
  // Also handles session recovery when the player reloads mid-hand.
  //
  // This deliberately mirrors an external subscription (the mission) into the
  // local phase machine: server-driven phases (deployed, locked, the Hold 'Em
  // reveal) and page-reload recovery both require setting phase in response to
  // Firebase changes — the one setState-in-effect pattern the rule sanctions but
  // can't recognize here, so it's scoped off for this effect only.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!uid || !mission || !game || !cfg) return;
    const seat = mission.participants?.[uid];

    if (mission.state === 'inprogress' || mission.state === 'complete') { setPhase('deployed'); return; }
    if (seat?.played) { setPhase('locked'); return; }
    if (LOCAL_PHASES.includes(phase)) return;

    // Recovery: gambit already resolved but not locked — an empty offer means the
    // lock button goes straight to lockCasinoResult without re-playing a gambit.
    if (seat?.gambitPlayed && secretHand?.length) {
      setHand(secretHand);
      setKeep(new Set(secretHand.map(c => c.uid)));
      setGOffer([]);
      setPhase('gambit');
      return;
    }

    if (game === 'holdem') {
      // Sitting 2 already paid for: the server narrowed the secret hand to the
      // cards chosen, so the only thing left is the gambit → lock flow.
      if (seat?.playedOn && secretHand?.length) {
        setHand(secretHand);
        setKeep(new Set(secretHand.map(c => c.uid)));
        setSpent(seatSpend('holdem', { playedOn: true }));
        setGOffer(makeGambitDeck().drawOffer(3));
        setGPick(null);
        setPhase('gambit');
        return;
      }
      if (seat?.holeLocked) {
        setSpent(seatSpend('holdem'));
        if (mission.community?.length && secretHand?.length) {
          // The reveal has landed — open sitting 2 with the whole pool selected.
          const pool = [...secretHand, ...mission.community];
          setHand(pool);
          setKeep(new Set(pool.map(c => c.uid)));
          setPhase('holdplay');
        } else {
          setPhase('holdwait');
        }
        return;
      }
    } else if (secretHand?.length) {
      // Recovery: a single-sitting hand in progress after a page reload.
      setHand(secretHand);
      setKeep(new Set(secretHand.map(c => c.uid)));
      setReject(new Set());
      setRerolled(seat?.rerolled ?? false);
      setStood(secretHand.length >= cfg.maxDraw);
      setSpent(seatSpend(game, { rerolled: seat?.rerolled }));
      setPhase('play');
      return;
    }

    // Nothing dealt yet — pick a deck the first time, otherwise sit and ante in.
    setPhase(seat?.deckChoice == null ? 'deckselect' : 'ante');
    // `secretHand` MUST be a dep: it arrives from its own seasonSecrets
    // subscription, which can resolve after the mission does. Without it, a
    // player reloading mid-hand would never have their hand restored.
    // `phase` is deliberately omitted — including it would re-run this effect on
    // every phase change and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, mission, secretHand, game, cfg]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Callables. The resolved seasonId is injected into every payload so the
  // server writes to the right season — essential when an alpha user is
  // playtesting a table in a draft season.
  const call = useCallback(<T, R>(name: string) => {
    return async (data: T): Promise<R> => {
      if (!functions) throw new Error('Firebase not configured.');
      const fn = httpsCallable<T & { seasonId: string }, R>(functions, name);
      const res = await fn({ ...data, seasonId: resolvedSeasonId });
      return res.data;
    };
  }, [resolvedSeasonId]);

  const doFlash = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(''), 4000); };

  // Every action shares the same shape: block double-clicks, surface the server's
  // own message on failure (it is the authority on gold, seat state and timing).
  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try { await fn(); }
    catch (e) { doFlash((e as { message?: string })?.message ?? fallback); }
    finally { setBusy(false); }
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const pot      = mission?.pot ?? 0;
  const stats    = (mission?.casinoStats ?? CASINO_START_STATS) as CasinoStats;
  const allSeats = Object.values(mission?.participants ?? {});

  const seatDeckChoice   = uid ? (mission?.participants?.[uid]?.deckChoice ?? null) : null;
  const effectiveDeckChoice: CasinoDeckChoice = seatDeckChoice ?? 'purist';

  // Five Card Draw has no larger pool to optimise (5 dealt, 5 committed), so its
  // marks mean "reroll", not "drop": the whole hand is always what gets committed.
  const committedCards = useMemo(() => {
    if (!cfg) return [];
    return cfg.subsetSelect ? hand.filter(c => keep.has(c.uid)) : hand;
  }, [hand, keep, cfg]);

  const overPick = cfg ? committedCards.length > cfg.pickMax : false;
  const canCommit = committedCards.length > 0 && !overPick;

  // Fill empty seats up to baseMax
  const baseMax = mission?.baseMax ?? 6;
  const seatEntries: [string, GMParticipant | null][] =
    Object.entries(mission?.participants ?? {});
  while (seatEntries.length < baseMax) seatEntries.push([`__empty_${seatEntries.length}`, null]);

  const lockedHand = ['gambit', 'locked'].includes(phase) ? committedCards : [];
  const seatGambits = useMemo(() => gambitsBySeat(mission), [mission]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const chooseDeck = (choice: CasinoDeckChoice) => run(async () => {
    await call<object, unknown>('setCasinoDeckChoice')({ missionId, deckChoice: choice });
    setPhase('ante');
  }, 'Failed to set deck. Try again.');

  // Sit in. The table dictates the game, so this takes no game argument — Hold 'Em
  // buys 2 hole cards and waits; everything else deals its whole pool at once.
  const doAnte = () => run(async () => {
    if (!game || !cfg) return;
    if (game === 'holdem') {
      await call<object, { hole: DeckCard[] }>('dealHoldemHole')({ missionId });
      setSpent(seatSpend('holdem'));
      setPhase('holdwait');
      return;
    }
    const res = await call<object, { hand: DeckCard[] }>('dealCasinoHand')({ missionId });
    setHand(res.hand);
    setKeep(new Set(res.hand.map(c => c.uid)));   // start holding everything; drop down to pickMax
    setReject(new Set());
    setRerolled(false);
    setStood(false);
    setSpent(seatSpend(game));
    setPhase('play');
  }, 'Failed to deal. Try again.');

  const doReroll = () => run(async () => {
    if (!game) return;
    const res = await call<object, { hand: DeckCard[] }>('casinoDraw')({
      missionId, action: 'reroll', rejectUids: [...reject],
    });
    setHand(res.hand);
    setKeep(new Set(res.hand.map(c => c.uid)));
    setReject(new Set());
    setRerolled(true);
    setSpent(seatSpend(game, { rerolled: true }));
  }, 'Reroll failed. Try again.');

  const doHit = () => run(async () => {
    const res = await call<object, { hand: DeckCard[] }>('casinoDraw')({ missionId, action: 'hit' });
    setHand(res.hand);
    setKeep(new Set(res.hand.map(c => c.uid)));   // a drawn card is committed until dropped
    if (cfg && res.hand.length >= cfg.maxDraw) setStood(true);   // nothing left to draw
  }, 'Draw failed. Try again.');

  // Hold 'Em sitting 2: pay the play-on and hand the server the ≤5 cards to build
  // from. It writes them back as the seat's hand, and the normal gambit → lock
  // flow takes over from there.
  const doPlayOn = () => run(async () => {
    const res = await call<object, { hand: DeckCard[] }>('holdemPlayOn')({
      missionId, selectedUids: [...keep],
    });
    setHand(res.hand);
    setKeep(new Set(res.hand.map(c => c.uid)));
    setSpent(seatSpend('holdem', { playedOn: true }));
    toGambit();
  }, 'Play-on failed. Try again.');

  // Folding after a Hold 'Em reveal EMPTIES the seat for good — it isn't the
  // single-sitting fold, which leaves you seated and free to redeal.
  const doHoldemFold = () => run(async () => {
    await call<object, unknown>('holdemFold')({ missionId });
    setHand([]);
    setKeep(new Set());
    setPhase('folded');
  }, 'Fold failed. Try again.');

  const doFold = () => run(async () => {
    await call<object, unknown>('casinoFold')({ missionId });
    setHand([]);
    setKeep(new Set());
    setReject(new Set());
    setRerolled(false);
    setStood(false);
    setSpent(0);
    setPhase('folded');
  }, 'Fold failed. Try again.');

  function toGambit() {
    setGOffer(makeGambitDeck().drawOffer(3));
    setGPick(null);
    setPhase('gambit');
  }

  const doLock = () => run(async () => {
    // Skip the gambit callable if it was already resolved before a page reload.
    const seatGambitPlayed = uid ? mission?.participants?.[uid]?.gambitPlayed === true : false;
    if (!seatGambitPlayed) {
      await call<object, unknown>('playCasinoGambit')({ missionId, gambitDefId: gPick ?? null });
    }
    // The server takes the cards to COMMIT (`keepUids`), not the ones to drop.
    // It re-derives the take from them, and reads a missing list as "commit the
    // whole hand" — so a discard-shaped payload here silently overpays the seat.
    await call<object, { goldSwing: number }>('lockCasinoResult')({
      missionId, keepUids: committedCards.map(c => c.uid),
    });
    setPhase('locked');
  }, 'Lock failed. Please try again.');

  const toggle = (set: Set<number>, uidKey: number) => {
    const next = new Set(set);
    if (next.has(uidKey)) next.delete(uidKey); else next.add(uidKey);
    return next;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const HAND_W = 108;
  const GAMB_W = 130;

  if (phase === 'loading') {
    return (
      <div className="cz-root">
        <div className="cz-center"><span className="cz-spin">✦</span>Loading the table…</div>
      </div>
    );
  }

  if (phase === 'error' || !mission || !uid || !game || !cfg) {
    return (
      <div className="cz-root">
        <div className="cz-center">
          {!uid
            ? 'You must be signed in to play.'
            : mission && !mission.casinoGame
              ? 'This table has no game assigned.'
              : 'Mission not found or unavailable.'}
          <button className="cz-btn" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    );
  }

  const reveal = mission.release !== 'special' && mission.collect !== 'special'
    ? { releaseOn: mission.release === 'on', collectOn: mission.collect === 'on' }
    : null;

  return (
    <div className="cz-root">
      {/* ── Header ── */}
      <div className="cz-top">
        <div className="cz-brand">
          <span className="cz-kick">RPelago Casino</span>
          <h1>{cfg.label} <span className="cz-kick">· Table {mission.series}</span></h1>
        </div>
        <div className="cz-top-right">
          {seatDeckChoice && (phase === 'ante' || phase === 'folded') && (
            <button className="cz-btn ghost cz-deck-badge" onClick={() => setPhase('deckselect')} disabled={busy}>
              Deck: {DECK_VARIANTS[seatDeckChoice].label}
            </button>
          )}
          <PotDisplay amount={pot} bump={potBump} />
        </div>
      </div>

      <div className="cz-room-tag">
        {mission.state === 'forming'
          ? `${allSeats.filter(p => p?.played).length}/${baseMax} seats played · 40% of every entry feeds the pot · non-folded players split it`
          : 'This table has concluded.'}
      </div>

      {/* ── Seat rail ── */}
      <div className="cz-rail">
        {seatEntries.map(([id, p]) => {
          const isMe   = id === uid;
          const status = seatStatus(p, isMe, now);
          const stake  = p?.played ? (p.goldSwing ?? handStakeFromSlots(p.slots)) : undefined;
          const sbLeft = p?.startBy ? p.startBy - now : 0;
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
        open={mission.casinoOpenStats ?? null}
        roll={phase === 'deployed' ? reveal : null}
        showXp={shell !== 'casino'}
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

          {/* ANTE — the table picks the game; this is just the buy-in */}
          {phase === 'ante' && (
            <>
              <div className="cz-stage-title">Your turn — {cfg.label}</div>
              <div className="cz-stage-note">{GAME_BLURB[game]}</div>
              <div className="cz-actions">
                <button className="cz-btn primary" onClick={doAnte} disabled={busy}>
                  {game === 'holdem'
                    ? `Ante ${cfg.ante}g · take two hole cards`
                    : `Ante ${cfg.ante}g · deal me in`}
                </button>
              </div>
              <div className="cz-stage-note">
                Every card you commit to is a game you will play this round — win its gold;
                the rarer the genre, the richer the reward.
                {cfg.reroll   && ` One reroll available for ${cfg.rerollCost}g.`}
                {cfg.playOn > 0 && ` Playing on after the reveal costs a further ${cfg.playOn}g.`}
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* PLAY — one of the three single-sitting games */}
          {phase === 'play' && (
            <>
              <div className="cz-stage-title">
                {cfg.label}
                {game === 'five_card_draw' && rerolled ? ' · reroll spent' : ''}
                {game === 'blackjack' ? ` · ${hand.length}/${cfg.maxDraw} drawn` : ''}
              </div>

              <div className="cz-hand">
                {hand.map(c => {
                  // FCD marks a card to be REPLACED; the others mark it to be DROPPED.
                  const rerolling = game === 'five_card_draw' && reject.has(c.uid);
                  const dropped   = cfg.subsetSelect && !keep.has(c.uid);
                  const selectable = game === 'five_card_draw'
                    ? !rerolled
                    : game !== 'blackjack' || stood;
                  return (
                    <div
                      key={c.uid}
                      className={`cz-card-slot${rerolling ? ' rejected' : ''}${dropped ? ' discarding' : ''}`}
                      onClick={() => {
                        if (busy || !selectable) return;
                        if (game === 'five_card_draw') setReject(r => toggle(r, c.uid));
                        else setKeep(k => toggle(k, c.uid));
                      }}
                    >
                      {game === 'five_card_draw'
                        ? <span className={`cz-mark ${rerolling ? 'reject' : 'keep'}`}>{rerolling ? '✕' : '✓'}</span>
                        : dropped && <span className="cz-mark reject">✕</span>}
                      <CardFace card={c} look="plate" width={HAND_W} />
                      {selectable && (
                        <div className="cz-card-cap">
                          {game === 'five_card_draw'
                            ? (rerolling ? 'rerolling' : 'keeping')
                            : (dropped ? 'dropped' : 'tap to drop')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* The "best possible" gauge only means something when there is a
                  larger pool to whittle down; Five Card Draw commits all five. */}
              {cfg.subsetSelect && (
                <BlackjackGauge shownCards={committedCards} allCards={hand} deckChoice={effectiveDeckChoice} />
              )}
              <PokerReadout cards={committedCards} spent={spent} deckChoice={effectiveDeckChoice} />

              <div className="cz-actions">
                {cfg.reroll && (
                  <button className="cz-btn" onClick={doReroll} disabled={busy || rerolled || reject.size === 0}>
                    Reroll {reject.size > 0 ? `${reject.size} ` : ''}({cfg.rerollCost}g)
                  </button>
                )}
                {game === 'blackjack' && !stood && (
                  <>
                    <button className="cz-btn" onClick={doHit} disabled={busy || hand.length >= cfg.maxDraw}>
                      Hit ({hand.length}/{cfg.maxDraw})
                    </button>
                    <button className="cz-btn primary" onClick={() => setStood(true)} disabled={busy}>Stand</button>
                  </>
                )}
                {!(game === 'blackjack' && !stood) && (
                  <button className="cz-btn primary" onClick={toGambit} disabled={busy || !canCommit}>
                    {overPick
                      ? `Drop ${committedCards.length - cfg.pickMax} to commit`
                      : `Commit ${committedCards.length} ${committedCards.length === 1 ? 'game' : 'games'} · ${applyDeckBoost(handStake(committedCards), effectiveDeckChoice)}g`}
                  </button>
                )}
                <button className="cz-btn danger" onClick={doFold} disabled={busy}>Fold</button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* HOLDWAIT — Hold 'Em sitting 1 is in; the reveal is a table-wide event */}
          {phase === 'holdwait' && (
            <>
              <div className="cz-stage-title">Hole cards locked</div>
              <div className="cz-stage-note">
                Your two cards are in and your ante has fed the pot. The five shared cards are
                dealt once every seat at this table is filled and locked — come back then to
                play on or fold. Nothing more is owed until you do.
              </div>
              {secretHand && secretHand.length > 0 && (
                <div className="cz-hand">
                  {secretHand.map(c => (
                    <div key={c.uid} className="cz-card-slot">
                      <CardFace card={c} look="plate" width={HAND_W} />
                      <div className="cz-card-cap">your hole card</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="cz-ap-banner"><div className="cz-ap-icon">✦</div></div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* HOLDPLAY — Hold 'Em sitting 2: build the best five, or walk */}
          {phase === 'holdplay' && (
            <>
              <div className="cz-stage-title">The reveal · build your best five</div>
              <div className="cz-stage-note">
                Your two hole cards and the five shared cards are all in play. Drop any you don't
                want and play on for {cfg.playOn}g — or fold and forfeit the {cfg.ante}g you're in for.
              </div>
              <div className="cz-hand">
                {hand.map(c => {
                  const isHole  = !!secretHand?.some(h => h.uid === c.uid);
                  const dropped = !keep.has(c.uid);
                  return (
                    <div
                      key={c.uid}
                      className={`cz-card-slot${dropped ? ' discarding' : ''}`}
                      onClick={() => !busy && setKeep(k => toggle(k, c.uid))}
                    >
                      {dropped && <span className="cz-mark reject">✕</span>}
                      <CardFace card={c} look="plate" width={HAND_W} />
                      <div className="cz-card-cap">
                        {dropped ? 'dropped' : isHole ? 'your hole card' : 'shared'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <BlackjackGauge shownCards={committedCards} allCards={hand} deckChoice={effectiveDeckChoice} />
              <PokerReadout cards={committedCards} spent={spent + cfg.playOn} deckChoice={effectiveDeckChoice} />
              <div className="cz-actions">
                <button className="cz-btn primary" onClick={doPlayOn} disabled={busy || !canCommit}>
                  {overPick
                    ? `Drop ${committedCards.length - cfg.pickMax} to play on`
                    : `Play on (${cfg.playOn}g) with ${committedCards.length} ${committedCards.length === 1 ? 'game' : 'games'}`}
                </button>
                <button className="cz-btn danger" onClick={doHoldemFold} disabled={busy}>Fold</button>
              </div>
              <div className="cz-flash">{flash}</div>
            </>
          )}

          {/* FOLDED */}
          {phase === 'folded' && (
            <>
              <div className="cz-stage-title">You folded</div>
              <div className="cz-stage-note">
                {game === 'holdem'
                  ? "Your ante is forfeit — its share already fed the pot — and your seat at this table is gone. You're free to sit at another table."
                  : 'Your entry is forfeit — its share already fed the pot. You can ante in again for another hand, or give up your seat.'}
              </div>
              <div className="cz-actions">
                {game === 'holdem'
                  ? <button className="cz-btn ghost" onClick={() => window.close()}>Close table</button>
                  : <button className="cz-btn primary" onClick={() => { setFlash(''); setPhase('ante'); }} disabled={busy}>Try again</button>}
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
                  {gOffer.length === 0 ? 'Lock in' : gPick ? 'Play this gambit & lock in' : 'Skip & lock in'}
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
              {reveal && (
                <div className="cz-roll-banner">
                  <span className={`cz-roll ${reveal.releaseOn ? 'on' : 'off'}`}>
                    Release {reveal.releaseOn ? 'ON' : 'OFF'}
                  </span>
                  <span className={`cz-roll ${reveal.collectOn ? 'on' : 'off'}`}>
                    Collect {reveal.collectOn ? 'ON' : 'OFF'}
                  </span>
                </div>
              )}
              <div className="cz-results">
                {Object.entries(mission.participants ?? {}).map(([id, p]) => (
                  <ResultRow
                    key={id}
                    name={p.playerName}
                    isMe={id === uid}
                    played={!!p.played}
                    stake={p.goldSwing ?? handStakeFromSlots(p.slots)}
                    gambit={seatGambits[id] ? (GAMBIT_DEFS_BY_ID[seatGambits[id]] ?? null) : null}
                  />
                ))}
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
