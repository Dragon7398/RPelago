"use strict";
// Casino engine — server-side mirror of src/lib/casino*.ts.
// Keep in sync with: casinoData.ts, casinoEngine.ts, casinoGambits.ts, casinoSlots.ts
// This file is compiled by functions/tsconfig.json (CommonJS, no Vite).
Object.defineProperty(exports, "__esModule", { value: true });
exports.GAMBIT_DEFS_BY_ID = exports.GAMBIT_DEFS = exports.DECK_VARIANTS = exports.CASINO_REROLL_COST = exports.CASINO_ANTE = exports.CASINO_START_STATS = exports.CASINO_POT_CUT_PCT = exports.CASINO_POT_SEED = exports.CASINO_MIN_ENLIST_GOLD = void 0;
exports.buildDeck = buildDeck;
exports.deckChoiceOf = deckChoiceOf;
exports.shuffle = shuffle;
exports.makeDrawableDeck = makeDrawableDeck;
exports.makeDeck = makeDeck;
exports.handStake = handStake;
exports.applyDeckBoost = applyDeckBoost;
exports.buildGambitDeck = buildGambitDeck;
exports.applyGambit = applyGambit;
exports.rollCasinoOdds = rollCasinoOdds;
exports.cardsToSlots = cardsToSlots;
// ── Casino mission constants ─────────────────────────────────────────────────
// Mirror of CASINO_MIN_ENLIST_GOLD and CASINO_START_STATS in src/lib/constants.ts
exports.CASINO_MIN_ENLIST_GOLD = 30;
exports.CASINO_POT_SEED = 50;
exports.CASINO_POT_CUT_PCT = 0.40;
exports.CASINO_START_STATS = { release: 60, collect: 30, hint: 10, xp: 50 };
exports.CASINO_ANTE = {
    poker: 40,
    blackjack: 30,
};
exports.CASINO_REROLL_COST = 20;
// ── Card deck ────────────────────────────────────────────────────────────────
const CARD_TYPE_COPIES = {
    wild: 5,
    broad: 3,
    platform: 2,
    franchise: 1,
    narrow: 1,
};
const CARD_TYPE_RANGES = {
    broad: [15, 30],
    platform: [20, 35],
    franchise: [25, 40],
    narrow: [25, 50],
};
const RAW = [
    ['2D platformer', 'broad', 57],
    ['3D platformer', 'broad', 24],
    ['Action RPG', 'broad', 35],
    ['Turn-based RPG', 'broad', 35],
    ['Roguelike / roguelite', 'broad', 19],
    ['Puzzle', 'broad', 21],
    ['FPS / shooter', 'broad', 11],
    ['Strategy', 'broad', 12],
    ['Simulation / builder', 'broad', 15],
    ['Exploration / open world', 'broad', 17],
    ['Metroidvania', 'narrow', 35],
    ['Factory builder', 'narrow', 6],
    ['Survival / sandbox', 'narrow', 9],
    ['Horror / unsettling', 'narrow', 10],
    ['Cozy games', 'narrow', 19],
    ['Card games', 'narrow', 14],
    ['Rhythm / music game', 'narrow', 8],
    ['Tactical RPG', 'narrow', 6],
    ['Racing / driving', 'narrow', 8],
    ['Zelda', 'franchise', 14],
    ['Mario', 'franchise', 25],
    ['Pokemon', 'franchise', 14],
    ['Castlevania', 'franchise', 5],
    ['Mega Man', 'franchise', 6],
    ['Kingdom Hearts', 'franchise', 5],
    ['Final Fantasy', 'franchise', 9],
    ['Sonic', 'franchise', 9],
    ['Metroid', 'franchise', 5],
    ['Donkey Kong', 'franchise', 7],
    ['NES / Famicom', 'platform', 9],
    ['SNES / Super Famicom', 'platform', 30],
    ['Game Boy', 'platform', 25],
    ['Non-Nintendo Console', 'platform', 10],
    ['AP-original', 'platform', 30],
];
const CARD_NOTES = {
    'Game Boy': 'e.g. GB, GBA, GBC',
    'AP-original': 'A game made specifically for Archipelago',
};
const WILD_BASE = {
    name: 'Wild', type: 'wild', count: null,
    value: 10, copies: 5, blurb: 'Choose any game you like.',
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
        blurb: 'Pulls every Platform card from the deck — no NES, SNES, Game Boy or AP-original.',
    },
    indie: {
        key: 'indie', label: 'Indie',
        excludeTypes: ['franchise'], gpBoost: 0,
        blurb: 'Pulls every Franchise card from the deck — no Zelda, Mario, Pokemon.',
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
// Mirror of applyDeckBoost in src/lib/casinoSlots.ts.
function applyDeckBoost(reward, choice) {
    const boost = exports.DECK_VARIANTS[choice].gpBoost;
    return boost > 0 ? Math.round(reward * (1 + boost)) : reward;
}
// ── Gambit deck ──────────────────────────────────────────────────────────────
const GAMBIT_STATS = {
    release: { short: 'Release', full: 'Release Odds', betterWhen: 'up' },
    collect: { short: 'Collect', full: 'Collect Odds', betterWhen: 'up' },
    hint: { short: 'Hint', full: 'Hint Cost', betterWhen: 'down' },
};
const GAMBIT_RAW = [
    ['release', 2, 'small', 3, 0, 0, 0],
    ['release', -2, 'small', 3, 0, 5, 15],
    ['release', 5, 'big', 2, 15, 0, 0],
    ['release', -5, 'big', 2, 0, 10, 30],
    ['collect', 2, 'small', 3, 0, 0, 0],
    ['collect', -2, 'small', 3, 0, 5, 15],
    ['collect', 5, 'big', 2, 15, 0, 0],
    ['collect', -5, 'big', 2, 0, 10, 30],
    ['hint', -0.5, 'small', 3, 0, 0, 0],
    ['hint', 0.5, 'small', 3, 0, 3, 15],
    ['hint', -1, 'big', 2, 10, 0, 0],
    ['hint', 1, 'big', 2, 0, 5, 30],
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