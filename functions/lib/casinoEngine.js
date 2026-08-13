"use strict";
// Casino engine — server-side mirror of src/lib/casino*.ts.
// Keep in sync with: casinoData.ts, casinoEngine.ts, casinoGambits.ts, casinoSlots.ts
// This file is compiled by functions/tsconfig.json (CommonJS, no Vite).
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMUNITY_UID_BASE = exports.CASINO_XP_FLOOR = exports.CASINO_GAMBIT_XP_TO_GP = exports.GAMBIT_DEFS_BY_ID = exports.GAMBIT_DEFS = exports.DECK_VARIANTS = exports.CASINO_GAMES = exports.CASINO_GAME_ORDER = exports.CASINO_START_STATS = exports.CASINO_POT_CUT_PCT = void 0;
exports.minCasinoAnte = minCasinoAnte;
exports.seatSpend = seatSpend;
exports.buildDeck = buildDeck;
exports.deckChoiceOf = deckChoiceOf;
exports.shuffle = shuffle;
exports.makeDrawableDeck = makeDrawableDeck;
exports.makeDeck = makeDeck;
exports.handStake = handStake;
exports.initialDealCount = initialDealCount;
exports.selectCommitted = selectCommitted;
exports.applyDeckBoost = applyDeckBoost;
exports.gambitCasinoGold = gambitCasinoGold;
exports.buildGambitDeck = buildGambitDeck;
exports.gambitOfferable = gambitOfferable;
exports.makeGambitDeck = makeGambitDeck;
exports.applyGambit = applyGambit;
exports.rollCasinoOdds = rollCasinoOdds;
exports.rollSeatCount = rollSeatCount;
exports.rollReleaseChance = rollReleaseChance;
exports.rollCollectChance = rollCollectChance;
exports.deriveHintCost = deriveHintCost;
exports.computeInitialPot = computeInitialPot;
exports.potContribution = potContribution;
exports.rollTableSetup = rollTableSetup;
exports.drawCommunity = drawCommunity;
exports.holdemPool = holdemPool;
exports.cardsToSlots = cardsToSlots;
// ── Casino mission constants ─────────────────────────────────────────────────
// Mirror of CASINO_START_STATS in src/lib/constants.ts. (Enlist gold is the
// per-table finish cost — seatSpend(game, { playedOn: true }) — not a constant.)
exports.CASINO_POT_CUT_PCT = 0.40;
exports.CASINO_START_STATS = { release: 60, collect: 30, hint: 10, xp: 50 };
exports.CASINO_GAME_ORDER = [
    'five_card_draw', 'seven_card_stud', 'holdem', 'blackjack',
];
// Entry costs are the S1 values ×3 (cards/pot/stake are ×2) — see the client copy.
exports.CASINO_GAMES = {
    five_card_draw: {
        key: 'five_card_draw', label: 'Five Card Draw',
        sittings: 1, hole: 5, community: 0, maxDraw: 5, pickMax: 5,
        reroll: true, ante: 180, rerollCost: 60, playOn: 0,
        subsetSelect: false,
    },
    seven_card_stud: {
        key: 'seven_card_stud', label: 'Seven Card Stud',
        sittings: 1, hole: 7, community: 0, maxDraw: 7, pickMax: 5,
        reroll: false, ante: 210, rerollCost: 0, playOn: 0,
        subsetSelect: true,
    },
    holdem: {
        key: 'holdem', label: "Texas Hold 'Em",
        sittings: 2, hole: 2, community: 5, maxDraw: 7, pickMax: 5,
        reroll: false, ante: 80, rerollCost: 0, playOn: 120,
        subsetSelect: true,
    },
    blackjack: {
        key: 'blackjack', label: 'Blackjack',
        sittings: 1, hole: 0, community: 0, maxDraw: 6, pickMax: 5,
        reroll: false, ante: 150, rerollCost: 0, playOn: 0,
        subsetSelect: true,
    },
};
function minCasinoAnte() {
    return Math.min(...exports.CASINO_GAME_ORDER.map(g => exports.CASINO_GAMES[g].ante));
}
function seatSpend(game, opts = {}) {
    const g = exports.CASINO_GAMES[game];
    let spent = g.ante;
    if (opts.rerolled && g.reroll)
        spent += g.rerollCost;
    if (opts.playedOn && g.playOn)
        spent += g.playOn;
    return spent;
}
// ── Card deck ────────────────────────────────────────────────────────────────
const CARD_TYPE_COPIES = {
    wild: 5,
    broad: 3,
    platform: 2,
    franchise: 1,
    narrow: 1,
};
// Mirror of CARD_TYPES ranges in src/lib/casinoData.ts (S1 values ×2).
const CARD_TYPE_RANGES = {
    broad: [30, 60],
    platform: [40, 70],
    franchise: [50, 80],
    narrow: [50, 100],
};
const RAW = [
    ['2D platformer', 'broad', 57],
    ['3D platformer', 'broad', 24],
    ['Action RPG', 'broad', 35],
    ['Turn-based RPG', 'broad', 35],
    ['Roguelike / roguelite', 'broad', 19],
    ['Puzzle', 'broad', 22],
    ['FPS / shooter', 'broad', 23],
    ['Strategy', 'broad', 45],
    ['Simulation / builder', 'broad', 15],
    ['Exploration / open world', 'broad', 20],
    ['Metroidvania', 'narrow', 35],
    ['Factory builder', 'narrow', 6],
    ['Survival / sandbox', 'narrow', 9],
    ['Horror / unsettling', 'narrow', 10],
    ['Cozy games', 'narrow', 25],
    ['Card games', 'narrow', 14],
    ['Rhythm / music game', 'narrow', 8],
    ['Tactical RPG', 'narrow', 6],
    ['Racing / driving', 'narrow', 8],
    ['Zelda', 'franchise', 14],
    ['Mario', 'franchise', 25],
    ['Pokemon', 'franchise', 14],
    ['Castlevania', 'franchise', 5],
    ['Mega Man', 'franchise', 12],
    ['Kingdom Hearts', 'franchise', 5],
    ['Final Fantasy', 'franchise', 12],
    ['Sonic', 'franchise', 12],
    ['Metroid', 'franchise', 4],
    ['Donkey Kong', 'franchise', 7],
    ['NES / Famicom', 'platform', 10],
    ['SNES / Super Famicom', 'platform', 30],
    ['Game Boy', 'platform', 30],
    ['DS / 3DS', 'platform', 15],
    ['Non-Nintendo Console', 'platform', 45],
    ['AP-original', 'platform', 35],
    ['N64 / Nintendo 64', 'platform', 27],
];
const CARD_NOTES = {
    'Game Boy': 'e.g. GB, GBA, GBC',
    'AP-original': 'A game made specifically for Archipelago',
};
const WILD_BASE = {
    name: 'Wild', type: 'wild', count: null,
    value: 20, copies: 5, blurb: 'Choose any game you like.',
};
function computeCardDefs() {
    const bounds = {};
    for (const [, type, count] of RAW) {
        if (!bounds[type])
            bounds[type] = { min: count, max: count };
        bounds[type].min = Math.min(bounds[type].min, count);
        bounds[type].max = Math.max(bounds[type].max, count);
    }
    const categories = RAW.map(([name, type, count]) => {
        const [lo, hi] = CARD_TYPE_RANGES[type];
        const { min, max } = bounds[type];
        const frac = max === min ? 0 : (max - count) / (max - min);
        const value = Math.round(lo + frac * (hi - lo));
        const def = {
            name, type, count, value, copies: CARD_TYPE_COPIES[type],
        };
        if (CARD_NOTES[name])
            def.blurb = CARD_NOTES[name];
        return def;
    });
    return [WILD_BASE, ...categories];
}
const CARD_DEFS = computeCardDefs();
function buildDeck(excludeTypes = []) {
    const excl = new Set(excludeTypes);
    const deck = [];
    let uid = 0;
    for (const def of CARD_DEFS) {
        if (excl.has(def.type))
            continue;
        for (let i = 0; i < def.copies; i++) {
            deck.push({ ...def, uid: uid++, copyIndex: i });
        }
    }
    return deck;
}
exports.DECK_VARIANTS = {
    purist: {
        key: 'purist', label: 'Purist',
        excludeTypes: [], gpBoost: 0.10,
        blurb: 'Every card stays in the deck. Rewarded for the flexibility: +10% GP on everything you win.',
    },
    unconsoled: {
        key: 'unconsoled', label: 'Unconsoled',
        excludeTypes: ['platform'], gpBoost: 0,
        blurb: 'Pulls every Platform card from the deck — no console or handheld categories.',
    },
    indie: {
        key: 'indie', label: 'Indie',
        excludeTypes: ['franchise'], gpBoost: 0,
        blurb: 'Pulls every Franchise card from the deck — no Zelda, Mario, Pokemon.',
    },
    safety: {
        key: 'safety', label: 'Safety',
        excludeTypes: ['platform', 'franchise'], gpBoost: -0.10,
        blurb: 'Unconsoled and Indie combined — no console, handheld or Franchise categories at all. '
            + 'The narrowest deck, and you pay for the comfort: −10% GP on everything you win.',
    },
};
function deckChoiceOf(seat) {
    return seat.deckChoice ?? 'purist';
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function makeDrawableDeck(cards) {
    let remaining = cards.slice();
    return {
        remaining: () => remaining.length,
        draw(n) {
            const taken = remaining.slice(0, n);
            remaining = remaining.slice(taken.length);
            return taken;
        },
        drawOne() {
            const card = remaining[0];
            remaining = remaining.slice(1);
            return card;
        },
        toArray() { return remaining.slice(); },
    };
}
function makeDeck() {
    return makeDrawableDeck(shuffle(buildDeck()));
}
// ── Hand evaluation ──────────────────────────────────────────────────────────
function handStake(hand) {
    return hand.reduce((s, c) => s + c.value, 0);
}
// ── Single-sitting play helpers (mirror of src/lib/casinoEngine.ts) ──────────
function initialDealCount(game) {
    return game === 'blackjack' ? 2 : exports.CASINO_GAMES[game].hole;
}
// `minKeep` defaults to 1 (free subset); Blackjack passes handLength−1 so a seat
// may drop AT MOST one card — the push-your-luck rule. Mirror of src/lib/casinoEngine.ts.
function selectCommitted(hand, keepUids, pickMax, minKeep = 1) {
    let committed = hand.slice();
    if (keepUids != null) {
        const keep = new Set(keepUids);
        committed = hand.filter(c => keep.has(c.uid));
        if (committed.length !== keep.size)
            return { ok: false, reason: 'Selected a card not in your hand.' };
    }
    if (committed.length < minKeep) {
        return { ok: false, reason: minKeep > 1 ? 'You may discard at most one card.' : 'Keep at least one card.' };
    }
    if (committed.length > pickMax)
        return { ok: false, reason: `Keep at most ${pickMax} cards.` };
    return { ok: true, committed };
}
// Mirror of applyDeckBoost in src/lib/casinoSlots.ts.
// ⚠️ The guard is `!== 0`, NOT `> 0`: gpBoost is signed (Safety is −0.10), and a
// `> 0` test silently drops every penalty deck, paying the full unmodified stake.
function applyDeckBoost(reward, choice) {
    const boost = exports.DECK_VARIANTS[choice].gpBoost;
    return boost !== 0 ? Math.round(reward * (1 + boost)) : reward;
}
// ── Gambit deck ──────────────────────────────────────────────────────────────
const GAMBIT_STATS = {
    release: { short: 'Release', full: 'Release Odds', betterWhen: 'up' },
    collect: { short: 'Collect', full: 'Collect Odds', betterWhen: 'up' },
    hint: { short: 'Hint', full: 'Hint Cost', betterWhen: 'down' },
};
// Mirror of the RAW gambit table in src/lib/casinoGambits.ts. Keep in sync
// (order matters — defId is derived from array index).
const GAMBIT_RAW = [
    ['release', 3, 'small', 4, 0, 0, 0],
    ['release', 5, 'medium', 3, 15, 0, 0],
    ['release', 7, 'large', 2, 30, 0, 0],
    ['release', -3, 'small', 4, 0, 10, 20],
    ['release', -5, 'medium', 3, 0, 15, 30],
    ['release', -7, 'large', 2, 0, 20, 40],
    ['collect', 3, 'small', 4, 0, 0, 0],
    ['collect', 5, 'medium', 3, 15, 0, 0],
    ['collect', 7, 'large', 2, 30, 0, 0],
    ['collect', -3, 'small', 4, 0, 10, 20],
    ['collect', -5, 'medium', 3, 0, 15, 30],
    ['collect', -7, 'large', 2, 0, 20, 40],
    ['hint', -0.5, 'small', 4, 0, 0, 0],
    ['hint', -1, 'medium', 3, 10, 0, 0],
    ['hint', -1.5, 'large', 2, 20, 0, 0],
    ['hint', 0.5, 'small', 4, 0, 5, 20],
    ['hint', 1, 'medium', 3, 0, 10, 30],
    ['hint', 1.5, 'large', 2, 0, 15, 40],
];
function fmtDelta(d) {
    return (d > 0 ? '+' : '−') + Math.abs(d) + '%';
}
function isBonus(stat, delta) {
    return GAMBIT_STATS[stat].betterWhen === 'up' ? delta > 0 : delta < 0;
}
exports.GAMBIT_DEFS = GAMBIT_RAW.map((r, i) => {
    const [stat, delta, size, copies, goldCost, xp, pot] = r;
    return {
        defId: 'g' + i,
        stat, delta, size, copies, goldCost, xp, pot,
        kind: isBonus(stat, delta) ? 'bonus' : 'penalty',
        deltaLabel: fmtDelta(delta),
        statLabel: GAMBIT_STATS[stat].short,
        statFull: GAMBIT_STATS[stat].full,
    };
});
exports.GAMBIT_DEFS_BY_ID = Object.fromEntries(exports.GAMBIT_DEFS.map(d => [d.defId, d]));
// Mirror of CASINO_GAMBIT_XP_TO_GP / gambitCasinoGold in src/lib/casinoGambits.ts.
// In a casino season a penalty gambit's inert XP is paid to the player as gold.
exports.CASINO_GAMBIT_XP_TO_GP = 2;
function gambitCasinoGold(card) {
    return card.xp * exports.CASINO_GAMBIT_XP_TO_GP;
}
function buildGambitDeck() {
    const deck = [];
    let uid = 0;
    for (const def of exports.GAMBIT_DEFS) {
        for (let i = 0; i < def.copies; i++) {
            deck.push({ ...def, uid: 'gam' + (uid++) });
        }
    }
    return shuffle(deck);
}
// A gambit may be offered only if applying it wouldn't drive its stat below 0.
// Mirror of src/lib/casinoGambits.ts.
function gambitOfferable(stats, card) {
    const current = card.stat === 'release' ? stats.release
        : card.stat === 'collect' ? stats.collect
            : stats.hint;
    return Math.round((current + card.delta) * 10) / 10 >= 0;
}
// Shared, depleting gambit deck. Draws up to n cards with DISTINCT defId; `allow`
// filters out cards that fail it (returned to circulation like duplicates).
// Mirror of src/lib/casinoGambits.ts — the server draws the authoritative offer.
function makeGambitDeck(cards) {
    let remaining = cards ? cards.slice() : buildGambitDeck();
    return {
        remaining: () => remaining.length,
        drawOffer(n, allow) {
            const offer = [];
            const used = new Set();
            const skipped = [];
            while (offer.length < n && remaining.length > 0) {
                const card = remaining.shift();
                if (used.has(card.defId) || (allow && !allow(card))) {
                    skipped.push(card);
                    continue;
                }
                used.add(card.defId);
                offer.push(card);
            }
            remaining = remaining.concat(skipped);
            return offer;
        },
        toArray() {
            return remaining.slice();
        },
    };
}
// ── Gambit application ───────────────────────────────────────────────────────
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
}
function applyGambit(stats, card) {
    const next = { ...stats };
    if (card.stat === 'release') {
        next.release = clamp(next.release + card.delta, 0, 100);
    }
    else if (card.stat === 'collect') {
        next.collect = clamp(next.collect + card.delta, 0, 100);
    }
    else {
        next.hint = Math.max(0, Math.round((next.hint + card.delta) * 10) / 10);
    }
    next.xp = (next.xp ?? 0) + (card.xp ?? 0);
    return {
        stats: next,
        potAdd: card.pot ?? 0,
        goldCost: card.goldCost ?? 0,
        xp: card.xp ?? 0,
    };
}
// Roll the final release/collect outcomes from the settled odds percentages.
function rollCasinoOdds(stats) {
    return {
        releaseOn: Math.random() * 100 < stats.release,
        collectOn: Math.random() * 100 < stats.collect,
    };
}
// ── Table setup: rolled odds, dynamic pot (canonical — carries to S2) ─────────
// Mirror of the table-setup block in src/lib/casinoEngine.ts. Table creation is
// server-side, so this logic must match the client copy exactly. Keep in sync.
exports.CASINO_XP_FLOOR = 50;
function randInt(max, rng) {
    return Math.min(max, Math.floor(rng() * (max + 1)));
}
function rollSeatCount(rng = Math.random) {
    return 5 + randInt(3, rng);
}
function rollReleaseChance(rng = Math.random) {
    return 40 + randInt(6, rng) * 5;
}
function rollCollectChance(rng = Math.random) {
    return 25 + randInt(5, rng) * 5;
}
function deriveHintCost(release, collect) {
    return Math.round(((release + collect) / 10) * 2) / 2;
}
// Mirror of computeInitialPot in src/lib/casinoEngine.ts — base 4×seats²
// (squared so bigger tables pay each seat slightly MORE, not less), a doubled
// random difficulty span, plus a flat 2×(120−R−C) premium (120 is the max
// possible R+C, so it never goes negative). ~3g per point of difficulty.
function computeInitialPot(seats, release, collect, rng = Math.random) {
    const base = 4 * seats * seats;
    const span = Math.max(0, 150 - release - collect);
    const flat = 2 * Math.max(0, 120 - release - collect);
    return base + randInt(span * 2, rng) + flat;
}
function potContribution(fee) {
    return Math.floor(fee * exports.CASINO_POT_CUT_PCT);
}
function rollTableSetup(rng = Math.random) {
    const seats = rollSeatCount(rng);
    const release = rollReleaseChance(rng);
    const collect = rollCollectChance(rng);
    const hint = deriveHintCost(release, collect);
    const pot = computeInitialPot(seats, release, collect, rng);
    return { seats, stats: { release, collect, hint, xp: exports.CASINO_XP_FLOOR }, pot };
}
// ── Texas Hold 'Em community draw (canonical — carries to S2) ─────────────────
// Mirror of drawCommunity in src/lib/casinoEngine.ts. The 5 shared PUBLIC
// community cards: full Purist deck, 1 truly random + one each of Broad / Narrow
// / Franchise / Platform, all distinct. Keep in sync.
const COMMUNITY_TYPES = ['broad', 'narrow', 'franchise', 'platform'];
// ⚠️ `uid` is NOT globally unique — buildDeck numbers it 0..N by position, fresh
// on every call. Hold 'Em is the only game whose pool comes from TWO independent
// buildDeck() calls (the seat's hole deck and the community deck below), so its
// two halves share a uid space and can collide. uid is the selection protocol
// (`selectedUids` / `keepUids`) AND the client's React key, so one uid meaning two
// cards makes the `byUid` Map below silently drop a card and makes the UI count a
// single tap as two commits. Community cards therefore live in their own uid
// range. Applied at draw time, so it only covers tables dealt from here on — see
// holdemPool for the seats already holding a collision.
exports.COMMUNITY_UID_BASE = 1000;
// Step used to move a colliding LEGACY community card out of the way. Chosen so a
// rekeyed uid can never land on a hole uid (0..N) or a modern community uid.
const LEGACY_REKEY_STEP = 2000;
function shuffleWith(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function drawCommunity(rng = Math.random) {
    const deck = shuffleWith(buildDeck(), rng);
    const chosen = [deck[0]];
    const used = new Set([deck[0].uid]);
    for (const t of COMMUNITY_TYPES) {
        const card = deck.find(c => c.type === t && !used.has(c.uid));
        if (!card)
            throw new Error(`drawCommunity: no ${t} card available`);
        chosen.push(card);
        used.add(card.uid);
    }
    // Namespace the whole community so it can never share a uid with a hole card.
    return chosen.map(c => ({ ...c, uid: c.uid + exports.COMMUNITY_UID_BASE }));
}
/**
 * A Hold 'Em seat's selectable pool: its own hole cards, then the shared
 * community. THE one way to assemble it — the reveal, the play-on, and the
 * resubmit re-selection must all agree on which uid means which card.
 *
 * Tables whose community was dealt before COMMUNITY_UID_BASE existed can carry a
 * collision. Their rows are already written, so this de-duplicates on read rather
 * than rewriting stored data: the hole card KEEPS its uid (it is what `hand` and
 * `lockedCards` were written from) and the colliding community card moves. The
 * rekey is pure and deterministic, and both client and server build the pool
 * through this function, so a uid the player taps resolves to the same card here.
 * For every table dealt since, this is a no-op copy.
 *
 * Mirror of holdemPool in src/lib/casinoEngine.ts. Keep in sync.
 */
function holdemPool(hole = [], community = []) {
    const seen = new Set();
    const pool = [];
    for (const card of [...hole, ...community]) {
        let uid = card.uid;
        while (seen.has(uid))
            uid += LEGACY_REKEY_STEP;
        seen.add(uid);
        pool.push(uid === card.uid ? { ...card } : { ...card, uid });
    }
    return pool;
}
// ── Slot conversion ──────────────────────────────────────────────────────────
function cardsToSlots(hand) {
    return hand.map(card => ({
        name: '',
        game: '',
        details: `${card.name} · ${card.value}g`,
        status: 'Unstarted',
    }));
}
//# sourceMappingURL=casinoEngine.js.map