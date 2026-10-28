# The Finale — Slots (casino season closer)

**Audience: whoever implements this.** The design is settled; this is the
implementation handoff. Visual reference (7 artboards, the whole player flow):
<https://claude.ai/artifact/2wFKTJL4ff2mY1itkkSbDD>

One last Archipelago for the casino season, dressed as a slot machine. A 3×5 board
of cards is spun from the player's chosen deck; they get one free reroll of up to
three **reels**, then take **one row**, keep as many of its five cards as they are
willing to actually play, and name a game for each. Payout is star-based, not the
cards' gold values.

> **It is a REAL Archipelago.** Kept cards become slots the player must play, same
> as every other casino table. That obligation is the entire reason reroll and
> discard exist — see §2.

---

## 1. Locked decisions

| # | Decision |
|---|---|
| 1 | 3 rows × 5 reels, dealt from the seat's own **deck variant** (Purist / Unconsoled / Indie / Safety). |
| 2 | **One free reroll**, up to **3 reels**. A reel is a COLUMN — rerolling it respins all three of its cards. |
| 3 | The player then takes **exactly one row**, or folds. |
| 4 | From that row they keep **1–5 cards**. Each kept card is a game they must play. |
| 5 | Payout = **`50 + 10 × stars`**, then the deck's `gpBoost`. Range 60–300 before boost. |
| 6 | Each card is worth **1–5 stars**, set by **inverse weighted popularity** (§3). |
| 7 | **Free to enter, once per player.** After a **fold**, re-entry costs **50 gold**. The fold dialog must state that cost. |
| 8 | **No mission claim consumed.** A player may play regardless of how many tables they hold. |
| 9 | **`restricted` players may play.** This is a celebration; they are not excluded. |
| 10 | **No seat cap.** Time-limited instead, with a visible countdown to close. |
| 11 | The table runs **once**, as the season closer. |
| 12 | Coat of Many Colors treats it as a **5th table type**, still unlocking at **4 of 5** (§6). |

---

## 2. Why reroll and discard exist

Payout rises monotonically with stars, so *keeping every card always pays more*.
Taken alone, discard would be a dead control.

What makes both real is that **a kept card is a game you commit to playing**. The
5★ cards pay most *precisely because the season passed them over* — so the reward
and the burden are the same fact. Sonic pays 5★ because nobody picked Sonic; keeping
it means playing Sonic.

So:

- **Reroll** is for finding games you are *willing to play*, not just high stars.
- **Discard** trades gold away to shed a game.
- **Fold** is for a board whose best *playable* hand is not worth it — 50g buys a
  fresh board. (This is the user's stated reason the mechanic exists at all.)

Every surface should say this out loud. The mockup does: the keep/discard counter
reads **"GAMES TO PLAY"**, not "kept".

---

## 3. Stars: inverse weighted popularity

Stars are **not** the card's gold value and **not** raw pick counts. A card scores
high when the season picked it *less often than its share of the pooled deck
predicts*.

The baseline and the ranking already exist: **`src/lib/cardStats.ts`**
(`cardPopularity`, `baselineDeckWeights`), pooling one **Purist + Unconsoled +
Indie** deck. Safety is excluded — it is Unconsoled and Indie combined, so including
it would weight both exclusions twice. Rank **ascending by `index`** (least-picked
first) and cut into tiers:

| Stars | Cards | Which |
|---|---|---|
| 1★ | 8 | **Wild**, plus the 7 most over-picked |
| 2★ | 7 | |
| 3★ | 7 | |
| 4★ | 7 | |
| 5★ | 8 | The 8 most passed-over |

`8 + 7 + 7 + 7 + 8 = 37`, and `CARD_DEFS.length === 37` (36 categories + Wild). The
partition is exact with nothing left over. Worked example from the design: **Zelda
2★ vs Sonic 5★** — equal presence across the decks, Sonic chosen half as often.

> ⚠️ **BANK THE TIERS ON THE MISSION; DO NOT COMPUTE THEM LIVE.** Two reasons, both
> breaking:
> 1. The finale's own hands are casino seats, so computing live means **the finale
>    shifts its own tiers as it is played**.
> 2. A player's payout could then change between their spin and settlement.
>
> Freeze a snapshot (`mission.finaleStars: Record<cardName, 1..5>`) when the table
> is created, and read only that at settle. It is also the audit trail for "why was
> Sonic worth five".

> ⚠️ **`cardPopularity` excludes claimed cards** (inherited, never chosen). Keep that
> — it is correct for this too.

---

## 4. Payout

```
stars = Σ (finaleStars[card.name]) over KEPT cards     // 1..25
base  = 50 + 10 × stars                                // 60..300
gold  = applyDeckBoost(base, seat.deckChoice)          // Purist ×1.1, Safety ×0.9
```

`applyDeckBoost` already exists in `src/lib/casinoSlots.ts` (mirrored in
`functions/src/casinoEngine.ts`) and does exactly this. Purist tops out at 330,
Safety at 270 — the "up to 30 more / 30 less" from the brief.

> ⚠️ **There is NO POT.** The finale pays a closed-form formula, so none of
> `casinoShareUnits`, `casinoVoidedShare`, `casinoPotShares`, `seatPotWeight` or
> `casinoShareDenominator` apply. `completeMission`'s casino branch must **fork**
> before the pot split, or it will divide a pot that was never banked. Settlement is
> per-seat and independent — which also means seat count genuinely does not matter,
> the thing that makes the unlimited-seat design affordable.

### 4a. A claimed card pays its stars only

A card kicked off one seat can be claimed by another player, who plays it through and
earns it (§11). **The gold follows the card, not the seat:**

```
claimant earns = 10 × stars(card)        // no base, no deck boost
owner's payout  = recomputed from their REMAINING lockedCards
```

- **No `+50` base.** That is the sitting-down fee for playing the finale proper —
  spinning, rerolling, choosing a row. A claimant did none of it and adopts one live
  slot.
- **No deck boost.** Exactly the existing rule: *a claimed card pays FLAT —
  `seatGoldSwing` boosts only the seat's own hand, and the claimant never chose the
  deck.* Same reasoning, same answer.
- A 5★ card is therefore worth **50g** to whoever finishes it, which is the figure
  the original owner forfeits. That symmetry is the point of the mechanic.

> ⚠️ **Removing a card must recompute `goldSwing` with the FINALE formula.**
> `adminRemoveCasinoSlot` rewrites `slots`, `lockedCards` and `goldSwing` together,
> and today derives the last through `seatGoldSwing`. For a finale seat it has to be
> `applyDeckBoost(50 + 10 × Σ remaining stars)` instead, or the owner keeps gold for
> a card they are no longer playing. The base survives as long as one card does —
> and `adminRemoveCasinoSlot` already refuses to empty a seat.

> ⚠️ **`handStake` / `handStakeFromSlots` parse `"Genre · Ng"` out of `slot.details`.**
> Finale cards carry stars, not gold values, so either write a parseable gold figure
> into `details` anyway or make sure nothing reads the stake back by parsing. Store
> the authoritative figure in `goldSwing` as the other tables do; `handStakeFromSlots`
> is a display fallback only.

---

## 5. How it departs from a normal casino table

Each row is a gate that currently exists and must be bypassed or replaced.

| Concern | Today | The Finale |
|---|---|---|
| Claim | `enlistInMission` rejects `no-claims-free` when `heldClaimCount >= missionClaimCapacity` | **Skip entirely.** Never consult capacity; never write `activeMissions`. |
| `restricted` | `claimRefusal` bars restricted players from claiming | **Allowed.** No claim is involved, so nothing to bar — just do not borrow the claim gate. |
| Seats | `gmFilledCount >= gmCurrentMaxSlots` → "Mission is full." | **No cap.** |
| Decay | `currentMaxSlots` drops 1 per `decayHours` | **Meaningless.** Do not decay. |
| Display | `seatTally(m, now)` floors max at fill | **Unusable** — there is no max. Show a count and a countdown. |
| Deploy | `shouldDeploy` needs full **and** `allSeatsPlayed` | **Never true.** Deploy on the **deadline**. |
| Entry cost | `seatSpend(game, {playedOn:true})` gold gate | **0 first time, 50 after a fold.** |
| Pot | banked at creation, split at settle | **None** (§4). |
| Mercs | owner may hire onto an unmerced slot | **Forbidden** — new `mercHireBlockers` reason (§11). |
| Kick / void | differ by where pot weight goes | Differ by **claimable slot + warning**; no pot, so the card's **star gold** moves to the claimant instead (§4a, §11). |
| Claims | casino claims are free, consume no claim | **Same, and live here** — a kicked card is claimable (§11). |
| `restricted` + claiming | `claimRefusal` refuses any claim | **Allowed**, one per player; kicked bar stands (§12). |
| Settle trigger | `shouldDeploy` (full **and** `allSeatsPlayed`) | **`finaleClosesAt`** deadline (§11). |

> ⚠️ **The rebuy counter cannot live on the participant.** `casinoFold` *deletes* the
> seat, so a flag on `participants/{uid}` vanishes with it. Use a sibling record that
> survives removal — `kickedPlayers` is the existing precedent for exactly this
> shape. Suggest **`mission.finalePlays/{uid}: { folds: number, played?: true }`**,
> written on fold and on lock-in. It is also what enforces decision 7 (one play
> each): a `played` record refuses a second free entry.

---

## 6. The Coat of Many Colors

Currently in `completeMission` (`src/firebase/db.ts` ~1614):

```ts
const hasAllFour = CASINO_GAME_ORDER.every(g => completed[g]);
```

Needs to become "at least 4 **distinct** types, out of 5".

> ⚠️ **DO NOT add `'finale'` to `CASINO_GAME_ORDER`.** That array drives the table
> **rotation** (`pickNextCasinoGame`, the `casinoSeries` counters, `seedInitialMissions`)
> and `minAnte` in `functions/src/casinoEngine.ts`. Adding the finale would put it in
> the respawn rotation and zero the minimum ante. Introduce a separate list:
>
> ```ts
> export const COAT_TABLE_TYPES = [...CASINO_GAME_ORDER, 'finale'] as const;
> export const COAT_TYPES_REQUIRED = 4;
> ```

Then gate on `COAT_TABLE_TYPES.filter(g => completed[g]).length >= COAT_TYPES_REQUIRED`.

**This is strictly more generous and no existing player can lose the Coat**: anyone
who already has all four still satisfies `>= 4`. It only adds a second route — three
games plus the finale.

Also needs the same treatment (currently `CASINO_GAME_ORDER`-based):

- `CasinoShell.tsx:431` — `doneCount`, the player-facing Coat progress
- `CasinoShell.tsx:307`, `:467` — the game chips / progress rail
- `help/SectionCasino.tsx:65` — the games list
- `admin/StatsPage.tsx:394` — "Casino Tables by Game Type" rows

Keep the Coat gated on **`participant.played`**, as it is now: a pure claimant never
played a hand, and four claims must not buy the Coat.

---

## 7. Data model

```
mission (type: 'casino', casinoGame: 'finale')
  finaleStars:   { [cardName]: 1|2|3|4|5 }        // frozen at creation (§3)
  finaleClosesAt: number                           // ms epoch; drives the countdown + deploy
  finalePlays:    { [uid]: { folds: number, played?: true } }   // survives seat deletion (§5)
  participants/{uid}
    deckChoice, played, lockedCards, slots, goldSwing   // as other tables
    finaleRow?: 1|2|3                              // which row was taken
    finaleRerolled?: readonly number[]             // reels respun, for the audit
seasonSecrets/{seasonId}/missions/{id}/participants/{uid}
  board: DeckCard[15]                              // the 3×5, row-major
  deck:  DeckCard[]                                // remaining draw deck
```

`CasinoGame` gains `'finale'` (`src/types/index.ts:22`), and `CASINO_GAMES` gains an
entry with `ante: 0`, `rerollCost: 0`, `playOn: 0`.

> ⚠️ **Rerolls must draw from the PERSISTED deck, never a fresh `buildDeck()`.**
> `DeckCard.uid` is a per-deck index starting at 0, so a second `buildDeck()` call
> collides with the first — the exact bug `COMMUNITY_UID_BASE` exists to fix for
> Hold 'Em. uid is both the selection protocol and the React key, so a collision
> silently drops cards and double-counts taps. One `DrawableDeck` per seat, 15 dealt,
> replacements drawn from the same instance.

---

## 8. Phase flow

The table mini-app's `Phase` union (`src/casino/CasinoTable.tsx:34`) and
`LOCAL_PHASES` (`:51`) both need the new states. Proposed:

```
deckselect → armed → spinning → reroll → rowpick → keep → manifest → locked → deployed
                                      ↘ folded
```

- **`armed`** — deck chosen, arm ready. The deck **locks** when the arm is pulled;
  it determines the reel contents and cannot change after.
- **`spinning`** — reels stop **left to right, one reel at a time** (the mockup uses
  650ms then +260ms per reel). Presentation only; the server deals all 15 up front.
- **`reroll`** — up to 3 reels; server respins those columns. One reroll only.
- **`rowpick`** — choose one row, or fold (→ the 50g warning).
- **`keep`** — drop any, floor of 1.
- **`manifest`** — reuse the existing phase: a game + slot name per kept card, plus
  the config. Same screening as every other table (`checkBlanketTargets`,
  `checkWorldCount` against the **kept** count, the advisory caps).

`LOCAL_PHASES` governs which phases the Firebase-derived effect may not yank the
player out of. `spinning`, `reroll`, `rowpick` and `keep` are all local interaction
and belong in it. Mind the rule the Hold 'Em play-on learned the hard way:
**nothing that can throw may sit between a committed server call and the phase
advance** — commit, set the phase, then do anything else.

Animation note: wrap the reel motion in `@media (prefers-reduced-motion: reduce)`.
The mockup does.

---

## 9. Mirrors to keep in sync

Per CLAUDE.md's dual-copy rules, all of these need both halves:

| Client | Server |
|---|---|
| `src/lib/casinoData.ts` (`CASINO_GAMES`, deck variants) | `functions/src/casinoEngine.ts` |
| `src/lib/casinoSlots.ts` (`cardsToSlots`, `applyDeckBoost`) | `functions/src/casinoEngine.ts` |
| the star→gold formula | wherever the finale settles |

Settlement for other casino tables is **client-side only** (`completeMission` in
`db.ts`); `onMissionComplete` only snapshots profiles. Keep the finale consistent
with that rather than inventing a second settlement home.

---

## 10. Build order

1. **Star tiers** — derive from `cardStats`, freeze onto the mission, unit-test the
   37-card partition and the tier boundaries. Pure, no UI; everything else depends
   on the numbers being right.
2. **Mission shape + `'finale'` game** — type, `CASINO_GAMES` entry, creation path
   with `finaleStars` and `finaleClosesAt`.
3. **Entry** — `enlistInMission` fork: no claim, no seat cap, restricted allowed,
   0/50g, `finalePlays` enforcement.
4. **Deal + reroll** — 15-card board, one `DrawableDeck`, per-reel respin.
5. **Row pick / keep / fold** — the 50g warning; `lockedCards` = kept subset.
6. **Manifest + lock-in** — reuse the existing phase and screening.
7. **Settlement fork** — star payout, `applyDeckBoost`, no pot.
8. **Coat** — `COAT_TABLE_TYPES`, plus the four display sites in §6.
9. **Deadline deploy** — a `tickGuildmasterMissions` branch on `finaleClosesAt` that
   moves the mission to `inprogress` in place of `shouldDeploy`. The straggler
   workflow after that is existing machinery (§11) — verify rather than build.
10. **Merc block** — the `mercHireBlockers` reason and its server mirror, plus
    hiding the affordance in `MercControl`.
11. **Claim carve-out** — `claimRefusal` plus the inlined copy in
    `claimMissionSlot` (§12). Two lines, two files; easy to do one and forget the other.
12. **Landing card + countdown** — unlimited seats, so no `seatTally`.

Steps 1–2 are safe to land while the casino season is still live; step 3 onward
touches `enlistInMission`, which every live table uses, so test the non-finale path
hard. **Deploy functions before the frontend push**, as always.

---

## 11. Resolved (2026-10-28)

**Reroll redraws cards; stars ride on the card.** A star value is a property of the
card name, read from the frozen `finaleStars` map (§3) — so a reroll just deals new
cards and their stars come along. No re-rolling of star values, and no extra work.

**The host can kick and void. Players cannot merc a finale slot.**

- Add a blocker to **`mercHireBlockers`** (`src/lib/mercLogic.ts`, **plus the server
  mirror in `functions/src/index.ts` — change both**) for a finale world. It then
  inherits the house behaviour automatically: **hard for players, soft for the
  admin** (who gets `details.mercWarnings` and a *Hire anyway*). That is the least
  code and matches every other blocker; say so if you want it hard for the admin too.
- `MercControl` should not offer the hire affordance on a finale slot at all, rather
  than offering one that always fails.
**A kicked card stays claimable, and its gold goes with it.** This is the live,
load-bearing case, not a vestige: a player who is not seeing a 5★ card through loses
its 50g, and it goes to whoever will finish it (§4a). There is no pot to release or
reserve, so **void vs kick reduces to exactly that** — a void kills the card and its
gold with it, a kick reopens it, writes a `PlayerWarning`, and lets another player
earn the stars.

Claims are already the right shape for this: casino claims cost no gold and consume
no mission claim, and a claimant adopts a **live** slot with no config of their own
to submit.

> **Two different removals, and only one of them produces a claimable card.**
>
> - **A straggler at the deadline** never locked in, so the seat holds **no
>   `lockedCards` and no config**. There is nothing to claim and nothing in the room
>   — it is a whole-seat removal in the *forming* shape (no claimable slot, no
>   warning), which is what clears the way to generate.
> - **A card kicked off a seat that DID lock in** is a real Archipelago slot with a
>   config already in the room. That is the normal in-progress kick, it produces a
>   claimable entry, and the claimant plays the game the original owner declared.
>
> Keeping these apart matters: the first must not mint a claimable slot with no
> config behind it, because nobody could play it and it would block the room.

**The finale counts in `profiles/` as part of the casino season.** This **falls out
for free**: the mission is `type: 'casino'`, and both `onMissionComplete` and
`syncPlayerProfile` split casino vs non-casino on the mission's `type`, not on
`casinoGame`. So the only requirement is **not** to special-case `'finale'` out
anywhere. Check `syncPlayerProfile` still mirrors the trigger's shape — it is the
repair path, and a divergence there is invisible in-app.

**At the deadline the room locks as if every seat were filled.**

`finaleClosesAt` closes entry and moves the mission to `inprogress` — it stands in
for `shouldDeploy`, which can never fire here (it wants a full table and
`allSeatsPlayed`). Seats that never locked in are then handled by **machinery that
already exists**, which is the point:

- `seatOwesConfig` flags any seat with no usable config, and `seatsAwaitingConfig`
  renders them as their own roster on the admin card.
- `outstandingConfigsBlockRoom` turns that roster **red** once the table is full or
  live — exactly this state — so it reads as blocking rather than advisory.
- `missionPendingAction` returns `configs`, sorting the card to the top of the host's
  work queue.

So the host flow is: deadline → red roster → Discord reminder → a couple of days →
kick the stragglers → generate the room. **No new mechanism.**

`played` is false for a straggler, so it earns no Coat credit — correct, since it
never played a hand.

---

## 12. Claims and restriction

**A restricted player MAY claim a finale card**, under the same one-per-player cap
everyone else has. The finale is the celebration nobody is excluded from, and a
player willing to finish an abandoned 5★ card is doing the room a favour.

**The cap needs no work.** `claimMissionSlot` already allows *one claimed slot each,
whether or not the player already holds a seat here* — exactly the intended rule.

**The kicked-player bar still holds.** A player who abandoned a card may not claim it
back; only the `restricted` arm is lifted.

So the change is one carve-out in **`claimRefusal`** (`src/lib/slotHelpers.ts`),
which is the single source the UI reads for *why* a claim is refused:

```ts
export function claimRefusal(
  world: { kickedPlayers?: Record<string, unknown>; casinoGame?: string } | null | undefined,
  player: { id?: string; restricted?: boolean | null } | null | undefined,
): ClaimRefusal | null {
  if (!player?.id) return null;
  if (world?.kickedPlayers?.[player.id]) return 'kicked';
  // The finale lifts the restricted bar only — see above. The kicked bar stands.
  if (world?.casinoGame === 'finale') return null;
  if (player.restricted === true) return 'restricted';
  return null;
}
```

> ⚠️ **`claimMissionSlot` inlines its own copy of this** (`functions/src/index.ts`,
> the way it inlines `deriveStatus`) — **the carve-out must go in both**, or the UI
> will offer a restricted player a button the server refuses. The tile path is
> enforced by database rules instead, but the finale is a mission, so rules are not
> involved.

> This is flagged as revisitable by design: if the finale wants its own claim limits
> later, `claimRefusal` and that server copy are the two places to change.

**Nothing in this document is open.** Every decision is recorded in §1, §11 or here.
