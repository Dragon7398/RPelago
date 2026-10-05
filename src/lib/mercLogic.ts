// ── Mercenaries ──────────────────────────────────────────────────────────────
//
// "Mercing" a slot: the owner finds another player to play some or all of it. It
// is deliberately lighter than a claim —
//
//   • the slot stays the OWNER's: their adventurer / mission claim, their status
//     report incidents, their early-release clock. Nothing moves.
//   • the merc holds no seat and spends no claim or adventurer.
//   • at settle the merc takes MERC_SHARE (60%) of the slot's value, and the
//     owner keeps the rest (40%).
//
// "The slot's value" is only explicit on a casino seat (a card, and a pot weight).
// Tiles and non-casino missions pay per PLAYER, not per slot, so a slot's value
// there is defined as the owner's feat-multiplied base reward divided by their slot
// count, plus that slot's own bonusXP / bonusGold. The merc gets no feat bonuses of
// their own. Every merc cut is FLOORED; the rounding remainder stays with the owner.
//
// All pure: settlement (completeMission / awardTileRewards / casinoTableShares) is
// client-side, so there is no server mirror of this math.

import type { AdvSlot, GMParticipant, SlotMerc } from '../types';
import { DECK_VARIANTS, deckChoiceOf } from './casinoData';

/**
 * The merc's cut of a merced slot, as a ratio so the arithmetic stays exact on
 * integers (`x * 3 / 5` never lands a hair under a whole number the way `x * 0.6`
 * can before a floor). The owner keeps the remaining 2/5.
 */
export const MERC_SHARE_NUM = 3;
export const MERC_SHARE_DEN = 5;
/** For copy: "60%". */
export const MERC_SHARE_PCT = Math.round((MERC_SHARE_NUM / MERC_SHARE_DEN) * 100);

/** The merc's floored cut of a value. */
const mercPart = (v: number): number => Math.floor((v * MERC_SHARE_NUM) / MERC_SHARE_DEN);

/** One mercenary's take from one or more slots. `weight` is casino pot weight, in seat units. */
export interface MercCut {
  playerName: string;
  xp:         number;
  gold:       number;
  weight:     number;
  slots:      number;
}

/** Keyed by the merc's playerId. */
export type MercCuts = Map<string, MercCut>;

/**
 * The slot's merc, if it has a valid one. A merc naming the owner themselves is
 * ignored (the callable refuses it, but a hand-edited record must not pay a player
 * a cut of their own slot as if it were someone else's).
 */
export function mercOf(slot: AdvSlot | null | undefined, ownerId: string): SlotMerc | null {
  const m = slot?.merc;
  return m && m.playerId && m.playerId !== ownerId ? m : null;
}

function addCut(cuts: MercCuts, m: SlotMerc, xp: number, gold: number, weight: number): void {
  const c = cuts.get(m.playerId) ?? { playerName: m.playerName, xp: 0, gold: 0, weight: 0, slots: 0 };
  c.xp     += xp;
  c.gold   += gold;
  c.weight += weight;
  c.slots  += 1;
  cuts.set(m.playerId, c);
}

/** Fold `from` into `into` — one merc may help several owners on the same world. */
export function mergeMercCuts(into: MercCuts, from: MercCuts): void {
  for (const [id, c] of from) {
    const cur = into.get(id);
    if (!cur) { into.set(id, { ...c }); continue; }
    cur.xp += c.xp; cur.gold += c.gold; cur.weight += c.weight; cur.slots += c.slots;
  }
}

/** What an owner hands over in total. */
export function mercTotals(cuts: MercCuts): { xp: number; gold: number; weight: number } {
  let xp = 0, gold = 0, weight = 0;
  for (const c of cuts.values()) { xp += c.xp; gold += c.gold; weight += c.weight; }
  return { xp, gold, weight };
}

/**
 * Per-slot split of a flat per-player reward — tiles and non-casino missions.
 *
 * `baseXp` / `baseGold` are the owner's reward AFTER feat multipliers and BEFORE
 * slot bonuses; each slot is worth an even share of that plus its own bonus, and a
 * merced slot gives away MERC_SHARE of it.
 */
export function flatMercCuts(
  baseXp: number,
  baseGold: number,
  slots: readonly (AdvSlot | null | undefined)[],
  ownerId: string,
): MercCuts {
  const cuts: MercCuts = new Map();
  const live = slots.filter((s): s is AdvSlot => !!s);
  const n = live.length;
  if (n === 0) return cuts;
  for (const s of live) {
    const m = mercOf(s, ownerId);
    if (!m) continue;
    const xp   = baseXp   / n + (s.bonusXP   ?? 0);
    const gold = baseGold / n + (s.bonusGold ?? 0);
    addCut(cuts, m, mercPart(xp), mercPart(gold), 0);
  }
  return cuts;
}

/**
 * Per-slot split of a casino seat. A slot's value there is explicit:
 *   gold   — its card's value: deck-boosted for the seat's own cards, flat for a
 *            card it claimed (mirrors seatGoldSwing);
 *   weight — its pot weight: 1/lockedCount for an own card, `claimedFraction` for
 *            a claimed one (mirrors seatPotWeight);
 *   xp     — an even share of `baseXp` (the seat's feat-multiplied mission XP; the
 *            casino has no per-card XP).
 * The merc takes MERC_SHARE of each. `slots` and `lockedCards` are compacted before
 * pairing, exactly as the server's splitSeatCards does, so a null hole left by an
 * old repair cannot shift which card a slot is read against.
 */
export function casinoMercCuts(p: GMParticipant, baseXp: number): MercCuts {
  const cuts: MercCuts = new Map();
  const slots = (p.slots ?? []).filter((s): s is AdvSlot => !!s);
  if (!slots.some(s => mercOf(s, p.playerId))) return cuts;

  const cards = (p.lockedCards ?? []).filter(Boolean);
  const owned = slots.filter(s => !s.claimed).length;
  const denom = p.lockedCount && p.lockedCount > 0 ? p.lockedCount : owned;
  const boost = DECK_VARIANTS[deckChoiceOf(p)].gpBoost;
  const n     = slots.length;

  slots.forEach((s, i) => {
    const m = mercOf(s, p.playerId);
    if (!m) return;
    const value  = cards[i]?.value ?? 0;
    const gold   = s.claimed ? value : value * (1 + boost);
    const weight = s.claimed ? (s.claimedFraction ?? 0) : (denom > 0 ? 1 / denom : 0);
    addCut(cuts, m, mercPart(baseXp / n), mercPart(gold),
           (weight * MERC_SHARE_NUM) / MERC_SHARE_DEN);
  });
  return cuts;
}

/** Every slot on a list that a given player is mercing, with its index. */
export function slotsMercedBy<T extends AdvSlot>(
  slots: readonly (T | null | undefined)[] | undefined,
  uid: string,
): { slot: T; idx: number }[] {
  const out: { slot: T; idx: number }[] = [];
  (slots ?? []).forEach((s, idx) => { if (s?.merc?.playerId === uid) out.push({ slot: s, idx }); });
  return out;
}

/**
 * `@Name ` → `name`. Discord usernames are lowercase, but a typed one may not be.
 * Mirrored by `normalizeHandle` in functions/src/index.ts (the server resolves the
 * hire; this only drives the picker's live "matches …" preview).
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').trim().toLowerCase();
}

/** Every season player whose Discord handle matches what was typed. */
export function playersByHandle<P extends { id?: string; discordHandle?: string }>(
  players: Record<string, P> | undefined,
  raw: string,
): P[] {
  const h = normalizeHandle(raw);
  if (!h) return [];
  return Object.values(players ?? {}).filter(p =>
    p && p.id && typeof p.discordHandle === 'string' && normalizeHandle(p.discordHandle) === h);
}

// ── Hiring limits ────────────────────────────────────────────────────────────
//
// Three guards against abuse. HARD for players (the server refuses), SOFT for the
// admin (warned, then allowed on confirmation). Mirrored by `mercHireBlockers` in
// functions/src/index.ts — a change to one must be made in both.
//
//   claimed     — a slot the owner CLAIMED is already a take-over; passing it on
//                 again would just pass the buck.
//   casinoLimit — on a casino table an owner may have at most ONE merced slot,
//                 or a player could commit a fat hand expecting to merc it out
//                 for free money. Casino only.
//   allSlots    — an owner may never merc every slot they hold on a world (one
//                 slot ⇒ none; three ⇒ two). Someone has to still be playing.
//
// Counting is by the owner's whole holding on the world: their seat on a mission,
// every adventurer of theirs on a tile. The target is excluded from "already
// merced", so the admin REPLACING a merc never trips a limit it already met.

export type MercBlocker = 'claimed' | 'casinoLimit' | 'allSlots';

export const MERC_BLOCKER_TEXT: Readonly<Record<MercBlocker, string>> = {
  claimed:     'This slot was claimed from another player — it can’t be passed on to a merc.',
  casinoLimit: 'Only one slot per casino table can be merced, and another one already is.',
  allSlots:    'At least one of the owner’s slots on this world must stay un-merced.',
};

export function mercHireBlockers(
  target: AdvSlot,
  ownerSlots: readonly (AdvSlot | null | undefined)[],
  casino: boolean,
): MercBlocker[] {
  const live   = ownerSlots.filter((s): s is AdvSlot => !!s);
  const others = live.filter(s => !!s.merc).length - (target.merc ? 1 : 0);
  const out: MercBlocker[] = [];
  if (target.claimed)                 out.push('claimed');
  if (casino && others >= 1)          out.push('casinoLimit');
  if (others + 1 >= live.length)      out.push('allSlots');
  return out;
}
