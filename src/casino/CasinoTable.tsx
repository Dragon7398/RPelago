import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, onValue, get } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../firebase/config';
import { setCurrentSeason, sRef, ownHandPath, ownHolePath } from '../firebase/season';
import type { GMMission, GMParticipant, CasinoStats, CasinoDeckChoice } from '../types';
import type { DeckCard, CasinoGame, CardTypeKey } from '../lib/casinoData';
import {
  DECK_VARIANTS, DECK_VARIANT_ORDER, deckSizeFor, CASINO_GAMES, CARD_TYPES, seatSpend,
} from '../lib/casinoData';
import { type GambitCard, GAMBIT_DEFS_BY_ID } from '../lib/casinoGambits';
import { handStake, handStakeFromSlots, applyDeckBoost } from '../lib/casinoSlots';
import { parseApYaml, checkWorldCount } from '../lib/apYaml';
import { uploadCasinoYaml, MAX_YAML_BYTES } from '../firebase/casinoYaml';
import { CASINO_START_STATS, nameColorValue } from '../lib/constants';
import { CardFace } from './CardFace';
import { GambitCardFace } from './GambitCardFace';
import { PotDisplay, Seat, ChallengePanel, PokerReadout, BlackjackGauge, ResultRow } from './TableComponents';
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
  | 'manifest'  // name the game you'll play for each committed card (Slot Fill)
  | 'locked'
  | 'deployed';

// Phases owned by local interaction. The Firebase-derived effect must not yank
// the player out of one of these mid-hand. `holdwait` is deliberately NOT here:
// it exists precisely to be pushed forward by the server's community reveal.
const LOCAL_PHASES: Phase[] = ['deckselect', 'play', 'holdplay', 'folded', 'gambit', 'manifest'];

const GAME_BLURB: Record<CasinoGame, string> = {
  five_card_draw:
    'Five cards, one hand. Mark any you would rather not play — reroll them once for a ' +
    'fresh draw, or just leave them out. Commit the games you like (fewer than five is fine).',
  seven_card_stud:
    'Seven cards, dealt at once. Drop the two you least want to play and commit the best five.',
  holdem:
    'Two hole cards now. Once every seat is in, five shared cards are revealed — then pay the ' +
    'play-on to build your best five out of all seven, or fold and walk away from your ante.',
  blackjack:
    'Push your luck. Draw from two cards up to six — every card is another game you commit to. ' +
    'You may discard at most one before you lock; at six cards you must discard exactly one.',
};

// Card-type visuals for the Slot-Fill badges: suit from CARD_TYPES, hue mirroring
// CardFace's TYPE_META.
const CARD_HUE: Record<CardTypeKey, number> = { wild: 75, broad: 200, platform: 295, franchise: 30, narrow: 150 };

interface ManifestVal { name: string; game: string }

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
  const [secretHole, setSecretHole]   = useState<DeckCard[] | null>(null);
  // Live name-color per seated player (subscribed by uid), so a mid-mission change
  // is reflected on the table just like on the landing.
  const [nameColors, setNameColors]   = useState<Record<string, string | null>>({});
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
  // Slot Fill (Manifest): the game (+ optional slot name) named for each committed
  // card, keyed by card uid; plus the attached YAML text and its parse warnings.
  const [manifest, setManifest]   = useState<Record<number, ManifestVal>>({});
  const [yamlText, setYamlText]   = useState<string | null>(null);
  const [yamlInfo, setYamlInfo]   = useState<{ name: string; docs: number; filled: number } | null>(null);
  const [yamlWarn, setYamlWarn]   = useState<string[]>([]);
  // True while re-editing an already-locked config (forming self-tweak, or after a
  // host denial): reuses the Manifest phase, but Submit resubmits instead of locking.
  const [resubmitting, setResubmitting] = useState(false);
  const [flash, setFlash]         = useState('');
  const [busy, setBusy]           = useState(false);
  const [now, setNow]             = useState(() => Date.now());
  const [potBump, setPotBump]     = useState(false);
  const [preferredDeck, setPreferredDeck] = useState<CasinoDeckChoice>('purist');
  const [previewDeck, setPreviewDeck]     = useState<CasinoDeckChoice | null>(null);

  const prevPot = useRef<number | null>(null);
  const yamlInputRef = useRef<HTMLInputElement>(null);

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

  // Hold 'Em only: the seat's hole cards, kept past play-on so a forming resubmit
  // can rebuild the pool (hole + public community) to re-select from.
  useEffect(() => {
    if (!db || !uid || !missionId || !seasonReady) return;
    return onValue(ref(db, ownHolePath(missionId, uid)), snap => {
      setSecretHole(snap.exists() ? (snap.val() as DeckCard[]) : null);
    });
  }, [uid, missionId, seasonReady]);

  // Live name-color for each seated player (narrow per-uid subs, so a gold/pot tick
  // doesn't re-fire them). Re-subscribes when the set of seated players changes.
  const seatUidsKey = useMemo(
    () => Object.keys(mission?.participants ?? {}).sort().join(','),
    [mission?.participants],
  );
  useEffect(() => {
    if (!db || !seasonReady) return;
    const database = db;
    const uids = seatUidsKey ? seatUidsKey.split(',') : [];
    const unsubs = uids.map(pid =>
      onValue(sRef(database, `players/${pid}/nameColor`), snap => {
        setNameColors(m => ({ ...m, [pid]: (snap.val() as string | null) ?? null }));
      }),
    );
    return () => unsubs.forEach(u => u());
  }, [seatUidsKey, seasonReady]);

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

    // A settled table always wins — even if the player is mid-resubmit.
    if (mission.state === 'complete') { setResubmitting(false); setPhase('deployed'); return; }
    // Actively re-editing a locked config: hold the Manifest view against mission
    // ticks (a subscription update would otherwise force locked/deployed and boot us).
    if (resubmitting) return;
    if (mission.state === 'inprogress') { setPhase('deployed'); return; }
    if (seat?.played) { setPhase('locked'); return; }
    if (LOCAL_PHASES.includes(phase)) return;

    // Recovery: the gambit was already played but the seat isn't locked (a reload
    // after the gambit committed) — resume at the Slot Fill step, where Submit
    // skips the already-played gambit and locks.
    if (seat?.gambitPlayed && secretHand?.length) {
      setHand(secretHand);
      setKeep(new Set(secretHand.map(c => c.uid)));
      setPhase('manifest');
      return;
    }

    if (game === 'holdem') {
      // Sitting 2 already paid for: the server narrowed the secret hand to the
      // cards chosen, so the only thing left is the gambit → lock flow.
      if (seat?.playedOn && secretHand?.length) {
        // At the gambit step but not yet resolved — the offer is fetched from the
        // server by the effect below (idempotent, so a reload returns the same 3).
        setHand(secretHand);
        setKeep(new Set(secretHand.map(c => c.uid)));
        setSpent(seatSpend('holdem', { playedOn: true }));
        setGOffer([]);
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
    // every phase change and loop. `resubmitting` IS a dep: the guard above reads
    // it, so the effect must see its current value when a mission tick fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, mission, secretHand, game, cfg, resubmitting]);
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

  // What actually gets committed:
  //  · Five Card Draw — everything you DIDN'T mark. A mark means "reroll or drop":
  //    you may reroll the marked cards once, or just leave them out and commit the
  //    rest (fewer than five is fine — you commit the games you like).
  //  · subsetSelect games (Stud / Hold 'Em / Blackjack) — the cards you kept.
  const committedCards = useMemo(() => {
    if (!cfg) return [];
    if (game === 'five_card_draw') return hand.filter(c => !reject.has(c.uid));
    return cfg.subsetSelect ? hand.filter(c => keep.has(c.uid)) : hand;
  }, [hand, keep, reject, cfg, game]);

  const overPick = cfg ? committedCards.length > cfg.pickMax : false;
  const canCommit = committedCards.length > 0 && !overPick;

  // Blackjack is push-your-luck: a seat may drop AT MOST one card (mandatory at
  // the six-card cap), so its keep-floor is handLength−1. Every other game keeps
  // a free ≤pickMax subset (floor 1). Keeping fewer than the floor is blocked, so
  // you can't cherry-pick a six-card Blackjack hand down to the two you like.
  const minKeep = game === 'blackjack' ? Math.max(1, hand.length - 1) : 1;

  // Fill empty seats up to baseMax
  const baseMax = mission?.baseMax ?? 6;
  const seatEntries: [string, GMParticipant | null][] =
    Object.entries(mission?.participants ?? {});
  while (seatEntries.length < baseMax) seatEntries.push([`__empty_${seatEntries.length}`, null]);

  const lockedHand = ['gambit', 'manifest', 'locked'].includes(phase) ? committedCards : [];
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
    await dealGambit();
    setPhase('gambit');
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

  // Fetch this seat's gambit offer from the SHARED, server-authoritative deck.
  // Idempotent, so the deck depletes only once even across reloads. The negative
  // -guard and the random-3 draw both happen server-side now.
  const dealGambit = async () => {
    const res = await call<object, { offer: GambitCard[] }>('dealGambitOffer')({ missionId });
    setGOffer(res.offer);
    setGPick(null);
  };

  const toGambit = () => run(async () => { await dealGambit(); setPhase('gambit'); },
    'Could not draw your gambits. Try again.');

  // Recovery: landed on the gambit step without the offer (a reload, or the Hold
  // 'Em play-on recovery path) — fetch it. Idempotent server-side, so this never
  // re-draws or double-depletes the shared deck. The fetch's setState all runs
  // after the await, so nothing is set synchronously inside the effect.
  useEffect(() => {
    if (phase !== 'gambit' || gOffer.length > 0) return;
    if (uid && mission?.participants?.[uid]?.gambitPlayed) return;  // resolved — lock directly
    void dealGambit().catch(e => doFlash((e as { message?: string })?.message ?? 'Could not draw your gambits. Try again.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Slot Fill (Manifest) ────────────────────────────────────────────────────

  // Move a committed card's named game (+ slot name) up or down among the manifest
  // rows — so an out-of-order YAML import (Hollow Knight landing on a Puzzle card)
  // can be realigned to the right card without editing the file.
  const moveManifest = (index: number, dir: -1 | 1) => {
    const a = committedCards[index];
    const b = committedCards[index + dir];
    if (!a || !b) return;
    setManifest(m => ({
      ...m,
      [a.uid]: m[b.uid] ?? { name: '', game: '' },
      [b.uid]: m[a.uid] ?? { name: '', game: '' },
    }));
  };

  // Attach a YAML: parse in-browser, prefill the manifest in committed order, and
  // surface broken-file / wrong-world-count / randomized warnings (non-blocking).
  const onPickYaml = (file: File | null) => {
    if (!file) { setYamlText(null); setYamlInfo(null); setYamlWarn([]); return; }
    // Reject oversized files up front (the upload + storage rule enforce it too).
    if (file.size >= MAX_YAML_BYTES) {
      setYamlText(null); setYamlInfo(null);
      setYamlWarn([`That file is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Configs must be under 1 MB.`]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const { slots: parsed, errors } = parseApYaml(text);
      setManifest(m => {
        const next = { ...m };
        committedCards.forEach((c, i) => {
          const p = parsed[i];
          if (p) next[c.uid] = { name: p.name || (m[c.uid]?.name ?? ''), game: p.game || (m[c.uid]?.game ?? '') };
        });
        return next;
      });
      // World-count mismatch is derived in render as a hard block (below), not a
      // soft warning here — a too-many-worlds file would otherwise fill every card
      // and slip past the submit gate.
      const warn = [...errors];
      if (parsed.some(p => p.randomized))
        warn.push('One or more games are a weighted / randomized choice — your host resolves the actual game from your config.');
      setYamlText(text);
      setYamlInfo({ name: file.name, docs: parsed.length, filled: Math.min(parsed.length, committedCards.length) });
      setYamlWarn(warn);
    };
    reader.readAsText(file);
  };

  const mySeat     = uid ? mission?.participants?.[uid] : undefined;
  const yamlDenied = mySeat?.yamlDenied === true;
  // A locked player may re-select their cards on a resubmit only while the table is
  // still FORMING and the pool is still preserved (deploy clears the secrets). The
  // pool is the full dealt hand for single-sitting games, or the persisted hole
  // cards + the PUBLIC community for Hold 'Em (its sitting 2 is a subset-select just
  // like Seven Card Stud). The gambit is never re-openable.
  const resubmitPool: DeckCard[] = game === 'holdem'
    ? [...(secretHole ?? []), ...(mission?.community ?? [])]
    : (secretHand ?? []);
  const canChangeCards = !!mySeat?.played && mission?.state === 'forming'
    && (game === 'holdem' ? (secretHole?.length ?? 0) > 0 && (mission?.community?.length ?? 0) > 0
                          : (secretHand?.length ?? 0) > 0);

  const manifestReady = committedCards.filter(c => (manifest[c.uid]?.game ?? '').trim().length > 0).length;
  // A new attach is REQUIRED for an initial submit and for a denied resubmit (the
  // host deleted the old file). A forming self-resubmit keeps the stored file, so a
  // reorder-only pass with no new attach is allowed. Every slot must still be named.
  const attachRequired = !resubmitting || yamlDenied;
  // A wrong world count is a HARD block: too many worlds would fill every card and
  // slip past the manifestReady gate. Only checkable when a config was attached this
  // session (yamlInfo present); a reorder-only resubmit keeps its already-valid file.
  const countErr = yamlInfo ? checkWorldCount(yamlInfo.docs, { count: committedCards.length }) : null;
  const canSubmit = manifestReady === committedCards.length && (yamlText != null || !attachRequired) && !countErr;

  // Submit: store the YAML (owner-scoped), then either lock (initial) or resubmit
  // (already-locked). The per-card manifest is keyed by card uid, so reordering the
  // games among cards is captured regardless of the committed order.
  const doSubmit = () => run(async () => {
    if (yamlText && uid) await uploadCasinoYaml(resolvedSeasonId, missionId, uid, yamlText);
    const manifestPayload = Object.fromEntries(committedCards.map(c => [String(c.uid), {
      game: (manifest[c.uid]?.game ?? '').trim(),
      name: (manifest[c.uid]?.name ?? '').trim(),
    }]));

    if (resubmitting) {
      // Send the (possibly re-selected) committed cards so the server can re-lock
      // and recompute the reward; omit when card-change isn't allowed (YAML only).
      await call<object, unknown>('resubmitCasinoYaml')({
        missionId, manifest: manifestPayload,
        ...(canChangeCards ? { keepUids: committedCards.map(c => c.uid) } : {}),
      });
      setResubmitting(false);
      doFlash('Config resubmitted to your host.');
      setPhase(mission?.state === 'forming' ? 'locked' : 'deployed');
      return;
    }

    const seatGambitPlayed = uid ? mission?.participants?.[uid]?.gambitPlayed === true : false;
    if (!seatGambitPlayed) {
      await call<object, unknown>('playCasinoGambit')({ missionId, gambitDefId: gPick ?? null });
    }
    await call<object, { goldSwing: number }>('lockCasinoResult')({
      missionId, keepUids: committedCards.map(c => c.uid), manifest: manifestPayload,
    });
    setPhase('locked');
  }, 'Submit failed. Please try again.');

  // Reopen a locked config in the Manifest view so the player can reorder games or
  // attach an updated file. When card-change is allowed, the FULL dealt hand is
  // loaded (with the current commit pre-selected) so "← Change cards" can re-select;
  // otherwise only the committed cards are loaded. Seeds the manifest from the
  // current slots so a YAML-only tweak loses nothing.
  const startResubmit = () => {
    const cards = mySeat?.lockedCards ?? [];
    const slots = mySeat?.slots ?? [];
    const fullHand = canChangeCards ? resubmitPool : cards;
    setHand(fullHand);
    const committed = new Set(cards.map(c => c.uid));
    if (game === 'five_card_draw') {
      // FCD commits the un-rejected cards, so reject everything NOT currently committed.
      setReject(new Set(fullHand.filter(c => !committed.has(c.uid)).map(c => c.uid)));
      setKeep(new Set());
    } else {
      setKeep(committed);
      setReject(new Set());
    }
    // No re-drawing on a resubmit — the hand is fixed, only the commit is re-picked.
    // stood=true so Blackjack shows its commit button (its draw phase is over).
    setStood(true);
    const seeded: Record<number, ManifestVal> = {};
    cards.forEach((c, i) => { seeded[c.uid] = { name: slots[i]?.name ?? '', game: slots[i]?.game ?? '' }; });
    setManifest(seeded);
    setYamlText(null); setYamlInfo(null); setYamlWarn([]);
    setResubmitting(true);
    setPhase('manifest');
  };

  // Play-phase forward: initial flow deals the gambit; a resubmit skips straight
  // to the Manifest (the gambit is locked and never re-openable).
  const advanceFromPlay = () => { if (resubmitting) setPhase('manifest'); else toGambit(); };

  const cancelResubmit = () => {
    setResubmitting(false);
    setPhase(mission?.state === 'forming' ? 'locked' : 'deployed');
  };

  const toggle = (set: Set<number>, uidKey: number) => {
    const next = new Set(set);
    if (next.has(uidKey)) next.delete(uidKey); else next.add(uidKey);
    return next;
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const HAND_W = 108;
  const GAMB_W = 130;

  // Post-lock config resubmit: allowed while the table is still FORMING (a
  // self-initiated tweak) or whenever the host has DENIED this seat's config.
  // "Reopen my slots" drops back into the Manifest view (startResubmit) so games can
  // be reordered or an updated file attached. Shown in locked (forming) + deployed.
  const canResubmit = !!mySeat?.played && mission?.state !== 'complete'
    && (mission?.state === 'forming' || yamlDenied);
  const resubmitBlock = canResubmit ? (
    <div className={`cz-resubmit${yamlDenied ? ' denied' : ''}`}>
      <div className="cz-resub-head">
        {yamlDenied
          ? <><b>⛔ Your config was denied</b><span>{mySeat?.yamlDeniedReason || 'Your host asked you to fix and resubmit your Archipelago config.'}</span></>
          : <><b>Need to tweak a setting or the order?</b><span>Reopen your slots to reorder games or attach an updated config while the table is still forming.</span></>}
      </div>
      <button className="cz-btn" disabled={busy} onClick={startResubmit}>
        {yamlDenied ? 'Fix & resubmit config' : 'Reopen my slots'}
      </button>
    </div>
  ) : null;

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
              playerId={id}
              avatarHash={p?.avatarHash}
              nameColor={nameColorValue(nameColors[id])}
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
                <button className="cz-btn ghost" onClick={() => setPhase('deckselect')} disabled={busy}>← Change deck</button>
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
                {resubmitting ? 'Re-pick your cards' : cfg.label}
                {!resubmitting && game === 'five_card_draw' && rerolled ? ' · reroll spent' : ''}
                {!resubmitting && game === 'blackjack' ? ` · ${hand.length}/${cfg.maxDraw} drawn` : ''}
              </div>
              {resubmitting && (
                <div className="cz-stage-note">
                  Choose which of your dealt cards to commit — drop one you've cooled on, or add one to be
                  bolder. Your gambit stays as it is; you'll re-attach your config after.
                </div>
              )}

              <div className="cz-hand">
                {hand.map(c => {
                  // FCD: a marked card is left out of the commit — rerolled once if
                  // you reroll, otherwise simply dropped. Other games mark to DROP.
                  const marked    = game === 'five_card_draw' && reject.has(c.uid);
                  const kept      = keep.has(c.uid);
                  const dropped   = cfg.subsetSelect && !kept;
                  // A kept card can only be dropped while doing so stays at/above
                  // the keep-floor (Blackjack: at most one discard); a dropped card
                  // can always be picked back up.
                  const canToggle = kept ? keep.size > minKeep : true;
                  const selectable = game === 'five_card_draw'
                    ? true
                    : (game !== 'blackjack' || stood) && canToggle;
                  return (
                    <div
                      key={c.uid}
                      className={`cz-card-slot${marked ? ' rejected' : ''}${dropped ? ' discarding' : ''}`}
                      onClick={() => {
                        if (busy) return;
                        if (game === 'five_card_draw') { setReject(r => toggle(r, c.uid)); return; }
                        if (!selectable) return;
                        setKeep(k => toggle(k, c.uid));
                      }}
                    >
                      {game === 'five_card_draw'
                        ? <span className={`cz-mark ${marked ? 'reject' : 'keep'}`}>{marked ? '✕' : '✓'}</span>
                        : dropped && <span className="cz-mark reject">✕</span>}
                      <CardFace card={c} look="plate" width={HAND_W} />
                      {(game === 'five_card_draw' || (game === 'blackjack' ? stood : true)) && (
                        <div className="cz-card-cap">
                          {game === 'five_card_draw'
                            ? (marked ? (rerolled ? 'dropped' : 'reroll or drop') : 'committed')
                            : dropped ? 'dropped' : selectable ? 'tap to drop' : 'committed'}
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
                {resubmitting && (
                  <button className="cz-btn" onClick={() => setPhase('manifest')} disabled={busy}>← Back to config</button>
                )}
                {cfg.reroll && !resubmitting && (
                  <button className="cz-btn" onClick={doReroll} disabled={busy || rerolled || reject.size === 0}>
                    Reroll {reject.size > 0 ? `${reject.size} ` : ''}({cfg.rerollCost}g)
                  </button>
                )}
                {game === 'blackjack' && !stood && !resubmitting && (
                  <>
                    <button className="cz-btn" onClick={doHit} disabled={busy || hand.length >= cfg.maxDraw}>
                      Hit ({hand.length}/{cfg.maxDraw})
                    </button>
                    <button className="cz-btn primary" onClick={() => setStood(true)} disabled={busy}>Stand</button>
                  </>
                )}
                {(resubmitting || !(game === 'blackjack' && !stood)) && (
                  <button className="cz-btn primary" onClick={advanceFromPlay} disabled={busy || !canCommit}>
                    {overPick
                      ? `Drop ${committedCards.length - cfg.pickMax} to commit`
                      : resubmitting
                        ? `Use these ${committedCards.length} ${committedCards.length === 1 ? 'card' : 'cards'} →`
                        : `Commit ${committedCards.length} ${committedCards.length === 1 ? 'game' : 'games'} · ${applyDeckBoost(handStake(committedCards), effectiveDeckChoice)}g`}
                  </button>
                )}
                {!resubmitting && <button className="cz-btn danger" onClick={doFold} disabled={busy}>Fold</button>}
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
          {phase === 'gambit' && (() => {
            // Offer empty but gambit not yet resolved → it's still being drawn
            // from the shared server deck (or a reload is re-fetching it).
            const gambitDone   = uid ? mission.participants?.[uid]?.gambitPlayed === true : false;
            const loadingOffer = gOffer.length === 0 && !gambitDone;
            return (
              <>
                <div className="cz-stage-title">Play a Gambit?</div>
                <div className="cz-stage-note">
                  You locked in {lockedHand.length} games worth {applyDeckBoost(handStake(lockedHand), effectiveDeckChoice)}g.
                  Choose one of these to bend the room's odds for everyone — or play none and lock in.
                </div>
                <div className="cz-gambit-offer">
                  {loadingOffer
                    ? <div className="cz-card-cap">Drawing your gambits from the deck…</div>
                    : gOffer.map(card => {
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
                  <button className="cz-btn ghost" onClick={() => setPhase(game === 'holdem' ? 'holdplay' : 'play')} disabled={busy}>
                    ← Back to cards
                  </button>
                  <button className="cz-btn primary" onClick={() => setPhase('manifest')} disabled={busy || loadingOffer}>
                    {loadingOffer ? 'Drawing…' : gOffer.length === 0 ? 'Continue →' : gPick ? 'Play this gambit & continue →' : 'Skip & continue →'}
                  </button>
                </div>
                <div className="cz-flash">{flash}</div>
              </>
            );
          })()}

          {/* MANIFEST — Slot Fill: name the game you'll play for each committed card */}
          {phase === 'manifest' && (
            <>
              {!resubmitting && (
                <div className="sf-steps">
                  <span className="done">✓ Cards</span><span className="dot" />
                  <span className="done">✓ Gambit</span><span className="dot" />
                  <span className="now">Fill your slots</span><span className="dot" />
                  <span>Submit</span>
                </div>
              )}
              <div className="cz-stage-title">{resubmitting ? 'Reopen your slots' : 'Fill your slots'}</div>
              <div className="cz-stage-note">
                {resubmitting
                  ? (canChangeCards
                      ? 'Attach an updated config, re-map games with the ↑/↓ arrows, or ← Change cards to re-pick which games you commit to. Your gambit is locked in and unchanged.'
                      : 'Attach an updated config, or use the ↑/↓ arrows to re-map games to cards. Your committed cards and gambit are unchanged.')
                  : "Attach your Archipelago config below — we read each world's game and slot name and map them to your committed cards in order. Use ↑/↓ to line a game up with the right card. Your host reviews every submission."}
              </div>

              {/* Mission Manifest — per-card mapping (display-only, from the config) + YAML attach */}
              <div className="sf-panel">
                <div className="sf-panel-title">Mission Manifest</div>
                <div className="sf-manifest">
                  {committedCards.map((c, i) => {
                    const v  = manifest[c.uid];
                    const nm = v?.name?.trim();
                    const gm = v?.game?.trim();
                    return (
                      <div className="sf-mrow" key={c.uid} style={{ '--th': CARD_HUE[c.type] } as React.CSSProperties}>
                        <div className="sf-cat">
                          <span className="sf-suit">{CARD_TYPES[c.type].suit}</span>
                          <span className="sf-cat-txt">
                            <span className="sf-cat-type">{CARD_TYPES[c.type].label}</span>
                            <span className="sf-cat-name">{c.name}</span>
                          </span>
                        </div>
                        <div className="sf-mrow-map">
                          <span className={`sf-mline-slot${nm ? '' : ' empty'}`}>{nm || '(from config)'}</span>
                          <span className="sf-mline-arrow">→</span>
                          <span className={`sf-mline-game${gm ? '' : ' empty'}`}>{gm || 'awaiting config'}</span>
                        </div>
                        <div className="sf-move">
                          <button className="sf-movebtn" title="Move up" disabled={busy || i === 0}
                                  onClick={() => moveManifest(i, -1)}>↑</button>
                          <button className="sf-movebtn" title="Move down" disabled={busy || i === committedCards.length - 1}
                                  onClick={() => moveManifest(i, 1)}>↓</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="sf-yaml">
                  <div className="sf-yaml-head">
                    <span className="sf-yaml-lbl">Attach your config (.yaml) {attachRequired
                      ? <span className="req">✳ required</span>
                      : <span className="opt">— optional; keeps your current file</span>}</span>
                    <button type="button" className="cz-btn" onClick={() => yamlInputRef.current?.click()} disabled={busy}>Choose file</button>
                  </div>
                  <input ref={yamlInputRef} type="file" accept=".yaml,.yml,.txt" style={{ display: 'none' }}
                         onChange={e => onPickYaml(e.target.files?.[0] ?? null)} />
                  {yamlInfo && (
                    <div className={`sf-yaml-file${yamlInfo.filled ? '' : ' none'}`}>
                      {yamlInfo.filled
                        ? <>✓ {yamlInfo.name} — filled <b>{yamlInfo.filled}</b> slot{yamlInfo.filled === 1 ? '' : 's'} from {yamlInfo.docs} world{yamlInfo.docs === 1 ? '' : 's'}</>
                        : <>⚠ {yamlInfo.name} — no <code>name</code>/<code>game</code> fields found; check the file.</>}
                    </div>
                  )}
                  {countErr && (
                    <div className="sf-yaml-err">
                      ⛔ {countErr} Attach a config with exactly {committedCards.length} game{committedCards.length === 1 ? '' : 's'}.
                    </div>
                  )}
                  {yamlWarn.map((w, i) => <div className="sf-yaml-warn" key={i}>⚠ {w}</div>)}
                </div>
              </div>

              <div className="sf-foot">
                <span className={`sf-ready${canSubmit ? ' go' : ''}`}>
                  {canSubmit ? '✓ ' : ''}<b>{manifestReady}</b>/{committedCards.length} slots ready
                  {attachRequired && !yamlText && <> · <span className="sf-ready-need">config required</span></>}
                  {countErr && <> · <span className="sf-ready-need">wrong game count</span></>}
                </span>
                <div className="sf-foot-acts">
                  {resubmitting ? (
                    <>
                      {canChangeCards && <button className="cz-btn" disabled={busy} onClick={() => setPhase('play')}>← Change cards</button>}
                      <button className="cz-btn" disabled={busy} onClick={cancelResubmit}>Cancel</button>
                    </>
                  ) : (
                    <button className="cz-btn" disabled={busy} onClick={() => setPhase('gambit')}>← Back</button>
                  )}
                  <button className="cz-btn primary" disabled={busy || !canSubmit} onClick={doSubmit}>
                    {busy ? 'Submitting…' : resubmitting ? 'Resubmit to guildmaster →' : 'Submit to guildmaster →'}
                  </button>
                </div>
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
              {resubmitBlock}
            </>
          )}

          {/* DEPLOYED — reveal */}
          {phase === 'deployed' && (
            <>
              <div className="cz-stage-title">{missionLabel} · Results</div>
              {resubmitBlock}
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
                    playerId={id}
                    avatarHash={p.avatarHash}
                    nameColor={nameColorValue(nameColors[id])}
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

      {previewDeck && <DeckPreview choice={previewDeck} onClose={() => setPreviewDeck(null)} />}
    </div>
  );
}
