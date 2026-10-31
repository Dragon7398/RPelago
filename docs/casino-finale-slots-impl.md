# The Finale — implementation design

**Companion to [casino-finale-slots-plan.md](casino-finale-slots-plan.md).** That
document is the settled design and the player-facing intent; this one is how it
gets built: workstreams, dependencies, blast radius, and the decisions still
needed from the host.

Read in this order: the plan for *what*, §0 below for *what the plan gets wrong
about the code*, then the workstreams. **§5 records the nine decisions the host has
since made** — every workstream below assumes them.

---

## 0. Corrections to the handoff plan

The plan was written from the design side. Six of its claims about the existing
code are wrong or incomplete, and two of them would have been discovered only
part-way through the build.

### 0.1 `casinoFold` does NOT delete the seat

> Plan §5: *"`casinoFold` **deletes** the seat, so a flag on `participants/{uid}`
> vanishes with it."*

It does not. `casinoFold` (`functions/src/index.ts:2058`) clears `hand`, `deck`,
`rerolled` and `gambitPlayed`, and resets `startBy` to `now + 1h`. The participant
record survives. **`holdemFold` is the one that deletes the seat** — the plan has
the two confused.

**`mission.finalePlays` is still the right answer**, for a different reason: three
other paths *do* delete a finale seat, and each would hand back a free entry.

| Path | Deletes the seat? |
|---|---|
| `casinoFold` | no — clears the hand, keeps the seat |
| `standDownFromMission` | **yes** (forming only) |
| `tickGuildmasterMissions` startBy sweep | **yes** (see §0.2) |
| `adminVoidCasinoSeat` / `adminKickMissionParticipant` | **yes** |

So the exploit is **fold → stand down → re-enlist**, which resets a
participant-held counter and buys a second free spin. A sibling record keyed by
uid is immune to all four. Keep `finalePlays`; fix the rationale.

### 0.2 A one-hour sweep already deletes idle seats

`enlistInMission` stamps `startBy: now + 3_600_000` on every casino seat, and
`tickGuildmasterMissions` deletes any **forming** casino seat whose `startBy` has
passed and which has not `played`. `dealCasinoHand` clears `startBy` — so the
clock runs from enlisting until the player pulls the arm, and stops there.

For a table that fills in an afternoon that is correct. For a finale whose entry
window is open for days it is a decision nobody has made yet, and it quietly
changes who is standing at the deadline. **Resolved — D2 keeps the clock.**

It is also the reason plan §11's straggler workflow is narrower than it reads: a
player who never spins is swept inside the hour and never becomes a straggler. The
stragglers §11 describes are specifically **players who spun and never locked in**
— they have `startBy: null` and are never swept. That workflow is correct; only
its population is smaller than the text implies.

### 0.3 `lockCasinoResult` hard-requires a gambit

```ts
if (!seat.gambitPlayed)
  throw new HttpsError('failed-precondition', 'Resolve the gambit phase before locking.');
```

The plan's phase flow (§8) has no gambit phase, and never mentions gambits at all.
This is the largest gap in the handoff: it is not a detail to be decided during the
build, because gambits set the room's Release / Collect / Hint — the three numbers
that define what playing the finale's Archipelago is actually like.

They also do not survive the unlimited-seat design. The shared gambit deck is **54
cards** (`buildGambitDeck`), each seat is dealt an offer of several; a 25-seat
finale exhausts it. And `liveCasinoStats` replays every seated player's gambit onto
one cohort-wide total, so 25 gambits would slam Release and Collect into their
clamps regardless.

**Resolved — see D1: no gambit phase, and the host hand-picks Release / Collect /
Hint at creation instead.**

### 0.4 `completeMission` does not need a pot fork

> Plan §4: *"`completeMission`'s casino branch must **fork** before the pot split,
> or it will divide a pot that was never banked."*

`casinoPotShares` opens with `if (pot <= 0 || denominator <= 0)` and returns zero
for every recipient. With `pot: 0` the whole pot pipeline — `casinoTableSettlement`,
`casinoShareDenominator`, `seatPotWeight`, the banked `casinoShareUnits` — runs
harmlessly and pays nothing. **Settlement needs no fork at all**, as long as the pot
stays at zero.

Which makes the real risk the opposite one: **anything that adds to the pot turns
the machinery back on.** `potContribution(fee)` takes 40% of every fee into
`mission/pot`, and `casinoShareUnits` *is* banked at deploy, so a pot grown from
50g rebuys would be split for real. **D5 keeps the pot at zero**, which is what
makes this whole section a non-event.

The fork settlement *does* need is upstream, in `goldSwing` — §0.5.

### 0.5 The gold formula forks at four sites, not one

The plan names `lockCasinoResult` and `adminRemoveCasinoSlot`. `goldSwing` is
written in **four** places, all of them through `handStake` (card gold values):

| Site | Line | What it writes |
|---|---|---|
| `lockCasinoResult` | `index.ts:2268` | `applyDeckBoost(handStake(hand), choice)` |
| `claimMissionSlot` | `index.ts:1724` | `seatGoldSwing(nextSeat, own, claimed)` |
| `resubmitCasinoYaml` | `index.ts:2437` | `seatGoldSwing(nextSeat, own, claimed)` — the card re-pick |
| `adminRemoveCasinoSlot` | `index.ts:2988` | `seatGoldSwing(nextSeat, own, claimed)` |

Miss `claimMissionSlot` and a claimant's finale card pays its *gold value* instead
of `10 × stars`. Miss `resubmitCasinoYaml` and a seat that changes its cards keeps
the old figure.

The fix is one function, not four edits:

```ts
// functions/src/index.ts — beside seatGoldSwing, which it replaces at every call site.
function seatGoldSwingFor(m: GMMission, seat: GMParticipant, own: SeatCard[], claimed: SeatCard[]): number {
  if (m.casinoGame !== 'finale') return seatGoldSwing(seat, own, claimed);
  const stars = (c: DeckCard | undefined) => (c ? m.finaleStars?.[c.name] ?? 0 : 0);
  const ownStars = own.reduce((s, p) => s + stars(p.card), 0);
  // The +50 base is the fee for sitting down and spinning; it survives while the
  // seat holds one own card. A pure claimant has no own cards and no base (§4a).
  const base = own.length > 0 ? applyDeckBoost(50 + 10 * ownStars, deckChoiceOf(seat)) : 0;
  return base + claimed.reduce((s, p) => s + 10 * stars(p.card), 0);
}
```

Every site then passes the mission it already holds. `seatGoldSwing` stays as the
non-finale branch so nothing about the live tables moves.

> ⚠️ The `own.length > 0` test is what makes §4a's two rules one expression. Do
> not simplify it to an unconditional base — a pure claimant would collect 50g for
> a table they never sat at.

### 0.6 There is no path that creates one table

The plan's step 2 says *"creation path with `finaleStars` and `finaleClosesAt`"*
without saying where. There isn't one to extend. Casino tables are created in
exactly two places, and neither is reachable on demand:

- `seedInitialMissions` (`src/firebase/db.ts:115`) — bootstraps the opening set,
  no-ops if missions exist.
- `deployMission` — spawns a *replacement* for a table that just deployed.

So the finale needs a **new admin control**, and that is a whole item of work
(WS-B), not a line in an existing function.

### 0.7 Also: deploying the finale spawns an ordinary table after it

`deployMission` calls `gmSpawnAllowed` and, if the season is still `active`, pushes
a fresh casino cohort. Deploy the finale with the season active and the closer is
immediately followed by a brand-new Five Card Draw table. Operationally this is
fixed by flipping the season to `closing` first; in code it wants a guard, because
the finale deploying on a timer at 03:00 is exactly when nobody is watching. WS-F.

---

## 1. Design principles for this build

The casino season is **live** while this is built. Two principles follow, and
they shape every workstream below.

**P1 — New callables over forks, wherever the live path is load-bearing.**
A bug in `dealCasinoHand` breaks every running table tonight. A bug in
`dealFinaleBoard` breaks a table that does not exist yet. So:

| New callable | Instead of forking |
|---|---|
| `dealFinaleBoard` | `dealCasinoHand` (ante, initial deal) |
| `rerollFinaleReels` | `casinoDraw` (`action: 'reroll'`) |
| `foldFinaleBoard` | `casinoFold` |
| `lockFinaleResult` | `lockCasinoResult` |

Each reuses the existing helpers (`mustCasinoSeat`, `casinoLogWrite`,
`makeDrawableDeck`, `selectCommitted`, the YAML existence check) so the duplication
is orchestration, not logic.

**P2 — The unavoidable forks are the test burden.** Six places genuinely have one
entry point and must learn about the finale:

`enlistInMission` · `claimMissionSlot` · `adminRemoveCasinoSlot` ·
`resubmitCasinoYaml` · `tickGuildmasterMissions` · `deployMission`

Every one of these is exercised by live tables. Each needs a non-finale regression
check as well as a finale one, and the finale branch should read as an early
`if (isFinale(m)) { … }` rather than a condition threaded through existing logic.

**The predicate is one function, mirrored.** Client `src/lib/missionLogic.ts`,
server `functions/src/index.ts`:

```ts
export const isFinale = (m: { casinoGame?: CasinoGame }) => m.casinoGame === 'finale';
```

Not `m.label`, not the presence of `finaleClosesAt`. One named predicate so a grep
for it finds every branch — which is how the next person audits this.

---

## 2. Workstreams

Ten streams. The dependency graph matters more than the order: **A, B and H can
land while the season is live and nobody notices**; C onwards touches shared code.

```
A  Stars (pure)
└─ B  Mission shape + creation ─┬─ C  Entry & seat lifecycle ─┐
                                ├─ D  The spin (board/reroll/row/keep)
                                └─ E  Lock-in & money ───────┼─ F  Deadline, room, stragglers
                                                             ├─ G  Claims, kicks, mercs
                                                             └─ I  Landing & admin surfaces
H  Coat & its five display sites        (independent)
J  Tests & the dress rehearsal          (spans all)
```

---

### WS-A — Stars (pure logic) — ✅ DONE

**Depends on:** nothing. **Ships safe during the live season.**

> **Shipped:** `src/lib/finaleStars.ts` + `tests/lib/finaleStars.test.ts` (28 tests),
> and a **Finale ★ column on the admin Stats tab's card-popularity table** — that
> panel already renders the popularity report from live data, and the star value and
> the rate that justifies it belong side by side.
>
> Two deliberate departures from the sketch below:
> 1. **The tier sizes are DERIVED, not hardcoded** (`starTierSizes`). The remainder
>    fills the extremes first, which reproduces the plan's `8/7/7/7/8` exactly for
>    the real deck while staying defined for any deck size — so the plan's table is
>    now an *assertion* rather than a magic constant, and the 37-card tripwire tells
>    you when it needs re-deciding.
> 2. **`baselineMissions` excludes the finale from its own baseline**, so the ranking
>    returns the same answer whenever it is called. Plan §3 warns that counting the
>    finale's own seats would let it shift its tiers as it is played; freezing at
>    creation (D6) is the primary defence, this makes the admin column stable too.
>
> `sumStars`, `finaleOwnGold` and `finaleClaimedGold` are also in place, so WS-E
> calls them rather than re-deriving the formula. **They are not mirrored
> server-side yet** — that is WS-E's first job, and the ⚠️ in the file says why it
> matters more than usual.

Everything else is arithmetic on top of these 37 numbers, so they go first and they
get tests.

1. `src/lib/finaleStars.ts` — `finaleStarTiers(missions): Record<string, 1|2|3|4|5>`.
   Rank `cardPopularity(missions).rows` **ascending by `index`**, cut `8/7/7/7/8`
   from the top (least-picked → 5★).
2. Pin **Wild at 1★** explicitly rather than letting the ranking place it. Wild is
   not a category and its pick rate measures a different thing — **D7** explains
   why it is deliberately the floor.
3. **A deterministic tiebreak is required, not optional.** Every never-committed
   card has `index === 0`, so the 5★/4★ boundary will land inside a tie — and the
   tie is worth 10g a card. `cardPopularity`'s own sort breaks ties on `observed`
   descending, which is useless at zero. Proposed, and it follows the metric's own
   logic: **ascending `index`, then `availability` descending** (among two cards
   nobody picked, the one the deck offered more often was more conspicuously
   avoided), then **name ascending** for total determinism. **Confirmed in D6.**
4. Tests (`tests/lib/finaleStars.test.ts`):
   - the partition is exact — 37 cards, `8/7/7/7/8`, every card in exactly one tier;
   - `CARD_DEFS.length === 37` (a tripwire: adding a card silently breaks the cut);
   - Wild is 1★;
   - the tiebreak is stable under input reordering;
   - the worked example from plan §3 — a card with equal availability and half the
     picks lands in a strictly higher tier.

The snapshot is taken **once, at creation, and never refreshed** (D6) — so this is
the only chance to look at it.

> ⚠️ **Run it against live data before anything is frozen.** Print the 37-row table
> and read it. If it says something the host would not say out loud about the
> season, the tier cut — not the code — is what needs changing, and this is the
> cheapest moment to find that out.

**Done when:** the table can be printed from live missions and the host has read it.

---

### WS-B — Mission shape and creation — ✅ DONE

**Depends on:** A. **Ships safe during the live season** (a draft `finale` table is
invisible until the host makes one).

> **Shipped:** the `'finale'` type widening with all four fallout sites fixed, the
> `CASINO_GAMES.finale` entry and board geometry (both halves), `isFinale`, the
> seat/decay/deploy forks (both halves), `freshFinaleTable`, `createFinaleTable`,
> and an **Open the Finale** panel on the admin Casino tab.
> `tests/lib/finaleTable.test.ts` (34 tests) pins it, including the tripwire that
> the finale stayed out of `CASINO_GAME_ORDER` and did not drag `minCasinoAnte` to 0.
>
> Four deliberate departures from the sketch below:
>
> 1. **Creation is a CLIENT write, not an `adminCreateFinale` callable.**
>    `seasons/$seasonId` already grants `.write` to `config/adminId`, and
>    `seedInitialMissions` creates casino tables from the client the same way — so
>    `createFinaleTable` in `db.ts` needs no callable and no functions deploy ahead
>    of the frontend. More importantly, **the star snapshot is computed in the
>    admin's browser and passed in.** Deriving it server-side would mean mirroring
>    `cardStats` *and* `finaleStars` into `functions/` to run a one-shot
>    computation; passing the reviewed snapshot instead means **what the host read
>    on the Stats tab is literally what gets frozen**, which recomputing could not
>    guarantee. `cardStatsCorpus` makes that a structural guarantee rather than two
>    expressions that happen to agree.
> 2. **`baseMax` is 0, not "the seat count the host expects".** Three seat-pip
>    loops read `m.baseMax` directly as `for (i = 0; i < baseMax; i++)` —
>    `SeatPips`, the map card's `Pips`, the table's empty-seat filler. Zero makes
>    all three degenerate to "draw only the seats that exist", which IS the
>    finale's display rule; the suggested value would have each render a wall of
>    fake empty seats. Both "N decayed" readouts are `> 0`-guarded, so they stay
>    hidden.
> 3. **The hand-picked odds are stored as chances of 100/0 as well as final
>    `'on'`/`'off'` values.** `rollCasinoOdds` is `Math.random() * 100 < chance`, so
>    100 always rolls on and 0 never does — the host's pick therefore survives
>    *even if* the deploy-time roll runs, which demotes WS-F's skip from a
>    correctness requirement to tidiness.
> 4. **No `gmFinaleDeadlinePassed` server-side yet.** `noUnusedLocals` rejected it,
>    and its consumer is WS-F's tick branch, which must land together with
>    deployMission's two guards (no replacement cohort, no `rollCasinoOdds`).
>    Until then a created finale just sits `forming` — the safe half-built state,
>    since `gmShouldDeploy` can never fire for it. The client
>    `finaleDeadlinePassed` is in and used by the admin panel.
>
> **Also found and fixed:** `npx tsc --noEmit` type-checks *nothing* in this repo
> (the root tsconfig is `files: []` with references), so it silently passed on
> broken code. CLAUDE.md's command list said to use it; it now says `npx tsc -b`
> and explains why the two halves of the repo take different commands.

1. `CasinoGame` gains `'finale'` (`src/types/index.ts:22`). This is the widening
   that makes `casinoGamesCompleted.finale` type-check for free (WS-H).
2. `CASINO_GAMES.finale`: `ante: 0, rerollCost: 0, playOn: 0, reroll: true,
   hole: 15, maxDraw: 15, pickMax: 5, sittings: 1, subsetSelect: true`. Mirror into
   `functions/src/casinoEngine.ts`.
   > ⚠️ **`CASINO_GAME_ORDER` must NOT gain it** — plan §6. It drives
   > `pickNextCasinoGame`, the `casinoSeries` counters, `seedInitialMissions` and
   > `minCasinoAnte`. Adding the finale puts it in the respawn rotation and zeroes
   > the minimum ante. Verify with a grep after the type widening: every
   > `Record<CasinoGame, …>` that now demands a `finale` key is a site to read.
3. `GMMission` gains `finaleStars`, `finaleClosesAt`, `finalePlays`;
   `GMParticipant` gains `finaleRow`, `finaleRerolled`.
4. `isFinale` (§1), mirrored.
5. **Seats and decay**, both halves:
   - `gmCurrentMaxSlots` / `currentMaxSlots` → return `Infinity` for a finale (no
     cap, no decay). `baseMax` is still a required field; set it to the seat count
     the host expects so nothing divides by undefined, and never read it.
   - `gmShouldDeploy` / `shouldDeploy` → `false` for a finale, always. The
     deadline is the only trigger (WS-F).
   - `seatTally` → a finale returns `{ filled, max: filled, label: '${filled} seated' }`
     with no `over` flag. Plan §5 is right that the pips are unusable; the tally is
     still the only thing cards read, so it must answer rather than be bypassed.
6. **The creation control** (admin Casino tab = `MissionsPage filter="casino"`):
   an **Open the Finale** panel taking a closing date/time, which calls a new
   `adminCreateFinale` callable. It:
   - refuses if a finale already exists in the season (it runs **once** — decision 11);
   - computes `finaleStars` from the season's missions and freezes it;
   - stores `finaleClosesAt`, sets `pot: 0` and `casinoOpenPot: 0`;
   - takes the host's **hand-picked Release / Collect / Hint** (D1) and writes them
     as FINAL values — `release: 'on' | 'off'`, `collect: 'on' | 'off'`, `hint: n`
     — into `casinoStats` and an identical `casinoOpenStats`;
   - labels it without the `· Cohort I` suffix (`gmMissionLabel` appends a roman
     numeral — the finale wants a name, not a cohort).

   **No Recompute action** (D6): one snapshot, frozen at creation.

**Done when:** the host can open a finale in a draft season, see it on the landing,
and the 37 frozen stars are readable in the RTDB.

---

### WS-C — Entry and the seat lifecycle — ✅ DONE

**Depends on:** B. **First stream that touches live code** — `enlistInMission` is
on the path of every table running tonight.

> **Shipped:** the `enlistInMission` fork, the `computeMissionCard` mirror, the
> landing's claim-lock carve-out, and `tests/lib/finaleEntry.test.ts` (21 tests) —
> a third of which are *regression* tests asserting the four live games still
> refuse on claims, gold, seats and the restricted wording.
>
> **The fork was far smaller than this sketch assumed: ONE skipped gate, not four.**
> WS-B had already made two of them inert — `gmCurrentMaxSlots` returns `Infinity`,
> so a finale is never full, and every cost in `CASINO_GAMES.finale` is 0, so the
> gold gate requires nothing. Both are left **unguarded on purpose**: a redundant
> `!isFinale` on the seat-cap check would imply the cap means something. So the
> server changes are exactly: skip the claim-capacity gate, skip the
> `activeMissions` write, and add the `finalePlays[uid].played` refusal.
>
> **Two things verified rather than changed**, which is the better outcome:
> `standDownFromMission` needs no fork (it deletes the seat and leaves
> `finalePlays` behind — which is precisely what stops fold → stand down →
> re-enlist), and `revertSeatGambitUpdates` returns early on `!seat.gambitPlayed`,
> so with no gambit phase it is already a no-op for every finale seat.
>
> **Four things the sketch did not anticipate:**
> 1. **`clearSeatSecrets` gained `board`.** Its whole job is leaving no orphan, and
>    an orphaned finale board would make `mustCasinoSeat` report *"finish or fold
>    your current hand first"* and lock the player out of re-entry — the exact
>    failure its existing comment warns about for `hand`.
> 2. **`GMMissionCard.countdownLabel`.** The card's countdown chip hardcoded
>    "SLOT DECAYS IN". The finale does not decay, and that same chip now counts
>    down to entry closing, so the label had to become data. A chip saying *slot
>    decays in* over an entry deadline is worse than no chip.
> 3. **`missionDisplayLabel` drops the cohort number for a finale.** "The Finale ·
>    Cohort I" reads as a promise of a second one.
> 4. **The landing needed three changes, not none.** `TableCard` is passed
>    `locked && !isFinale(m)` (otherwise the one table a player is guaranteed
>    entry to is the one shown shut against them); the restricted `lockNote` now
>    names the exception, since "all claims in use" printed above an enterable
>    finale card reads as a bug; and the finale **sorts first** among forming
>    tables — alphabetically `'finale'` lands between Blackjack and Five Card
>    Draw, which is the one ordering that buries the season's closer.

1. `enlistInMission` — an `isFinale` fork **above** the existing gates:
   - skip `heldClaimCount >= MISSION_CLAIM_CAPACITY` entirely, and **do not write
     `players/{uid}/activeMissions/{missionId}`** (decision 8). Every reader of
     `activeMissions` then no-ops for the finale, including the early-release sync
     paths and `completeMission`'s idempotent null.
   - skip `gmFilledCount >= gmCurrentMaxSlots` (free with `Infinity`, but assert it).
   - skip the `seatSpend(…, {playedOn:true})` gold gate — entry is free.
   - charge nothing here (the ante is 0; the rebuy is charged at the deal).
   - refuse when `finalePlays[uid]?.played === true` → `finale-already-played`.
   - `startBy: now + 1h` as normal (D2) — `dealFinaleBoard` clears it on the arm
     pull, so only an un-spun seat is ever swept.
2. `standDownFromMission` — works unchanged (forming only, deletes the seat). It
   leaves `finalePlays` behind, which is the point (§0.1).
3. `computeMissionCard` — the client mirror. Today the
   `heldClaimCount >= claimCapacity` branch sits **above** every casino branch, so
   a player holding one table would be told they cannot join the finale. Hoist an
   `isFinale` branch above it that skips the claim, seat and gold gates, and give
   the card its own copy: free, once, no claim, closes in N.
4. A **restricted** player reaching the finale is expected (decision 9) — verify
   nothing on the landing contradicts it. `CasinoShell.tsx:736`'s `lockNote` is
   about claims, not entry, and stays correct once WS-G lands.

**Done when:** in a draft season, a restricted player already holding two tables
can enlist in the finale, and a player who has locked in cannot enlist twice.
**And:** the four live games still refuse correctly on claims, seats and gold.

---

### WS-D — The spin

**Depends on:** B. **Largest stream, and almost entirely new code** — which is why
it is also the lowest-risk one.

**Server (new callables, P1):**

1. `dealFinaleBoard` — one `DrawableDeck` per seat from the seat's variant, deal
   **15** row-major into the secret `board`, persist the remainder as `deck`.
   Charges `finalePlays[uid].folds > 0 ? 50 : 0`, refuses without the gold, locks
   the deck choice, clears `startBy`. **The 50g goes to the house — never through
   `potContribution`** (D5); it is the drag that stops a player respinning toward a
   330g board, so it has to be a real cost.
   > ⚠️ **One `DrawableDeck`, built once.** Plan §7 is right and the reason is
   > load-bearing: `DeckCard.uid` is a per-deck index from 0, so a second
   > `buildDeck()` collides with the first — the exact bug `COMMUNITY_UID_BASE`
   > exists to paper over for Hold 'Em. uid is both the selection protocol and the
   > React key, so a collision drops cards silently and double-counts taps.
   > Rerolls draw from the persisted `deck`, never from a fresh build.
   > Capacity is fine: Safety is the smallest deck at 44 cards and the worst case
   > needs 15 + 9 = 24.
2. `rerollFinaleReels` — `{ reels: number[] }`, 1–3 distinct indices in 0–4.
   Refuses if `finaleRerolled` is already set. Respins **whole columns** — indices
   `reel`, `reel+5`, `reel+10` of the row-major board. Free.
3. `pickFinaleRow` — optional; the row choice can also ride on `lockFinaleResult`.
   Prefer carrying it on the lock: one fewer round trip, one fewer state to
   recover from, and the row is not meaningful until the keep set is known.
4. `foldFinaleBoard` — clears `board`/`deck`, increments
   `finalePlays/{uid}/folds`, and resets `startBy` to `now + 1h` exactly as
   `casinoFold` does (D2). Logs `event: 'fold'` so the finale appears in the casino
   log like every other table.

**Client (`src/casino/CasinoTable.tsx`):**

5. `Phase` gains `armed | spinning | reroll | rowpick | keep`; `LOCAL_PHASES` gains
   `spinning, reroll, rowpick, keep` (plan §8 — all four are local interaction).
6. The arm pull → `dealFinaleBoard` → **set the phase, then animate**. Plan §8
   quotes the rule the Hold 'Em play-on learned the hard way: nothing that can
   throw may sit between a committed server call and the phase advance. Here that
   means the reel animation is driven off state the server has already confirmed,
   and a reload mid-animation lands on a settled board rather than a stuck one.
7. Reels settle **one reel at a time, left to right** — 650ms then +260ms per reel
   (the mockup's timing; the user corrected an earlier per-row version). Wrap in
   `@media (prefers-reduced-motion: reduce)`.
8. Row pick with a fold affordance; the fold dialog **states the 50g rebuy**
   (decision 7) and that the finale can be entered once.
9. Keep/discard, floor of 1, enforced client-side and again in `lockFinaleResult`.
   The counter reads **"GAMES TO PLAY"** (plan §2) — the one piece of copy the plan
   singles out, because it is what makes discard legible.
10. Hide the pot: `PotDisplay` and `estimatedSeatShare` describe a pot the finale
    does not have.

**Visual reference:** the 7 artboards at
<https://claude.ai/artifact/2wFKTJL4ff2mY1itkkSbDD> cover Main, Reroll, PickRow,
FoldWarn, KeepDiscard, Manifest and Payout.

**Done when:** a player can spin, reroll three reels, fold, pay 50g, respin, take a
row and keep two cards — and a hard reload at every step lands somewhere coherent.

---

### WS-E — Lock-in and money

**Depends on:** B, D. **Touches the money path.**

1. `lockFinaleResult` — new callable, mirroring `lockCasinoResult`'s contract:
   validate the kept subset against the chosen row (not against the whole board —
   a client that sent cards from two rows must be refused), require a game per
   kept card, require the YAML object to exist, write `played`, `lockedCards`,
   `lockedCount`, `slots`, `goldSwing`, `finaleRow`, `finalePlays/{uid}/played`,
   clear the secret `deck`. **No gambit gate at all** (D1) — the finale offers no
   gambit, so `lockCasinoResult`'s `if (!seat.gambitPlayed) throw` is simply absent
   from this callable rather than conditionally skipped.
2. `goldSwing` via `seatGoldSwingFor` (§0.5), and **replace `seatGoldSwing` at all
   four call sites** with it.
3. The slot `details` line. `casinoSlotDetails` writes `"${name} · ${value}g"`;
   a finale card has stars, not a gold value. Write **`"${name} · ${stars}★"`**.
   This is safe: `handStakeFromSlots` is only ever a fallback behind
   `p.goldSwing ?? …` (three sites), and a finale seat always has `goldSwing`. Do
   not write a fake gold figure to keep the regex happy — it would be the only
   lying number in the record.
4. Settlement: **no fork needed** (§0.4). Verify instead, with a test, that a
   finale mission with `pot: 0` pays each seat exactly its `goldSwing` and nothing
   from `casinoTableSettlement`.
5. `resubmitCasinoYaml` — fork; **both paths stay** (D4). The config-only path
   works as-is. The **card re-pick** path reads the retained secret `hand`, which a
   finale seat does not have — it must re-select from the cards of **`finaleRow`
   only**, rejecting any uid from another row. The row itself is never re-pickable.
   `deployMission` clears only `deck`, so `board` survives deploy unaided and the
   in-progress deny path has something to re-select from.

**Done when:** a 3-card keep of 5★/5★/2★ on a Purist deck pays `applyDeckBoost(50 +
120) = 187`, the ledger shows it, and a claimed 5★ card pays its claimant exactly
50 with no base and no boost.

---

### WS-F — The deadline, the room, and the stragglers

**Depends on:** C.

1. `tickGuildmasterMissions` — a finale branch: when
   `state === 'forming' && now >= finaleClosesAt`, call `deployMission`. It stands
   in for `gmShouldDeploy`, which can never fire (WS-B).
   Order matters inside the tick: the startBy sweep runs first, so whatever §0.2
   decides is applied before the deadline close sees the roster.
2. `deployMission` — two finale guards. **Do not spawn a replacement** cohort
   (§0.7); also flip the season to `closing` before the deadline as the operational
   belt. And **skip `rollCasinoOdds`** — the host already chose the room's odds by
   hand (D1), so there is nothing left to roll.
3. Verify — do not build — the straggler machinery (plan §11): `seatOwesConfig`
   flags a spun-but-unlocked seat (no `yamlAt`, `played !== true`, slots not
   all-claimed ✓), `outstandingConfigsBlockRoom` turns the roster red once live,
   `missionPendingAction` returns `configs` and sorts the card to the top.
4. The two removals stay distinct (plan §11): a straggler is a **whole-seat**
   removal in the forming shape (`adminVoidCasinoSeat` — no claimable slot, no
   warning); a card off a locked-in seat is a normal in-progress kick that mints a
   claimable entry. Minting a claimable slot with no config behind it would block
   the room with something nobody can play.

**Done when:** a draft finale with a 10-minute deadline closes itself, shows a red
config roster for the one seat that never locked in, and voiding that seat leaves
the room generable.

---

### WS-G — Claims, kicks and mercs

**Depends on:** C.

1. `claimRefusal` (`src/lib/slotHelpers.ts`) — the finale carve-out from plan §12,
   placed **after** the kicked check so only the restricted arm is lifted.
   `world` gains `casinoGame?: string` in the signature.
2. **The inlined copy in `claimMissionSlot`** (`index.ts:1656`) — the same
   carve-out. ⚠️ Two lines, two files; doing one is the failure that offers a
   restricted player a button the server refuses.
3. The one-per-player cap needs **no work** — `claimMissionSlot` already enforces
   *one claimed slot each, whether or not they hold a seat here* via
   `claimedWeight(seat) > 0`.
4. `mercHireBlockers` — a `finale` reason, client (`src/lib/mercLogic.ts`) **and**
   the server mirror (`index.ts:1452`), plus `MERC_BLOCKER_TEXT`. It inherits the
   house behaviour: hard for players, soft for the admin (`details.mercWarnings` +
   *Hire anyway*) — **confirmed in D3**: the host keeps the right to hire one if
   something genuinely comes up.
   `MercControl` hides the hire affordance on a finale slot rather than offering one
   that fails.
5. `adminRemoveCasinoSlot` — `seatGoldSwingFor` (§0.5). The `casinoVoidedShare`
   increment is harmless with no pot but should be skipped for clarity.

**Done when:** a restricted player can claim a kicked finale card; the player it
was kicked from cannot; neither can merc it; and the owner's `goldSwing` drops by
exactly `10 × stars × deckBoost` while keeping the 50 base.

---

### WS-H — The Coat and its display sites

**Depends on:** B's type widening only. **Independent of everything else, and safe
during the live season** — it is strictly more generous and no current holder can
lose it (plan §6).

```ts
export const COAT_TABLE_TYPES = [...CASINO_GAME_ORDER, 'finale'] as const;
export const COAT_TYPES_REQUIRED = 4;
```

Then `COAT_TABLE_TYPES.filter(g => completed[g]).length >= COAT_TYPES_REQUIRED` at:

| Site | What it is |
|---|---|
| `src/firebase/db.ts:1617` | the grant itself (`hasAllFour`) |
| `CasinoShell.tsx:431` | `doneCount` — player-facing progress |
| `CasinoShell.tsx:307`, `:467` | the game chips / progress rail |
| `help/SectionCasino.tsx:65` | the games list |
| `admin/StatsPage.tsx:394` | "Casino Tables by Game Type" |

Keep the grant gated on `participant.played` — four claims must not buy the Coat.

**Done when:** a player with three game types plus the finale is granted the Coat,
and a player with all four games still is.

---

### WS-I — Landing and admin surfaces

**Depends on:** B, C.

1. The landing's finale card: no seat pips, a seated **count**, a live countdown to
   `finaleClosesAt`, "free · once · no claim used", and the fold rebuy stated
   before the player opens the table.
2. The admin card: seated count, the config roster, the stars snapshot readable
   somewhere (it is the audit trail for *"why was Sonic worth five"* — plan §3).
3. `help/SectionCasino.tsx` — the finale's rules, including that stars run
   **inverse** to how often the season picked a card. This is the one mechanic
   nobody will guess, and plan §2 asks for it to be said out loud on every surface.

---

### WS-J — Tests and the dress rehearsal

**Spans everything.** This is the finale; a rehearsal is cheaper than a repair.

1. **Unit** (`npm run test:unit`): the star partition and tiebreak (WS-A); the
   payout formula at both ends (60 and 300 before boost, 330 Purist / 270 Safety);
   `seatGoldSwingFor` for an own hand, a mixed seat, and a pure claimant; the
   board→column index mapping for the reroll (`reel`, `+5`, `+10`).
2. **Regression on the forks** (P2): each of the six shared functions gets a
   non-finale case alongside its finale one.
3. **`npm run econ`** — the finale injects gold with no ante against it. Its
   closed-form payout is outside the pot model the script covers, so it will not
   model it; the figure to compute by hand is **seats × expected payout**, which is
   the season's final money-in. Worth knowing before it happens.
4. **The dress rehearsal, in a draft season, end to end**: open a finale, seat
   four accounts including one restricted and one holding two other tables, have
   one fold and rebuy, one lock in with five cards, one spin and walk away, one
   never spin. Close the deadline. Void the straggler, kick a card off the
   five-card seat, claim it with the restricted account, generate a room, sync, and
   settle. Read the ledger. **Every decision in the plan is exercised by that one
   run** — and it is the only way to find the seventh thing this document also got
   wrong.

---

## 3. Shipping order

Functions before frontend, always (CLAUDE.md). Beyond that:

| When | What |
|---|---|
| **Now, season live** | WS-A, WS-B, WS-H. Invisible to players; H is strictly generous. |
| **Next** | WS-C, then D and E in parallel. |
| **Before the finale opens** | WS-F, G, I. |
| **Before the host touches it** | WS-J's rehearsal, in a draft season. |
| **Before the deadline fires** | season → `closing`, so no replacement cohort spawns (§0.7). |

---

## 4. Risk register

| Risk | Why it bites | Mitigation |
|---|---|---|
| `CasinoGame` widening | Every `Record<CasinoGame, …>` now wants a `finale` key; `CASINO_GAME_ORDER` must not get one | `npx tsc --noEmit` immediately after the widening, and read every site it names |
| uid collision on reroll | Silently drops cards and double-counts taps — no error | One `DrawableDeck`, built once, persisted (WS-D) |
| `seatGoldSwing` missed at one of four sites | A claimant or re-picking seat is paid the wrong number, and nothing complains | One `seatGoldSwingFor`, replace all four, test the mixed seat |
| Pot grows from rebuys | `casinoShareUnits` is banked at deploy, so a nonzero pot really is split (§0.4) | Keep `pot: 0`; never route the rebuy through `potContribution` (D5) |
| Rebuy made cheap or refundable | Payout tops out at 330g, so a free respin is a loop toward a windfall (D5) | The 50g is load-bearing; any change to it reopens the exploit |
| Stars frozen too early | Picks from tables still locking in are missing from the baseline | **Accepted** (D6) — one snapshot, no refresh. Read the printed table before creating the finale |
| Deadline deploy at 03:00 | Spawns a replacement cohort nobody is watching (§0.7) | Code guard **and** season → `closing` |
| A tie decides a 5★/4★ cut | 10g a card, decided by array order | Deterministic tiebreak (D6), and read the printed table before creating the finale |

---

## 5. Resolved decisions (2026-10-28)

All nine open questions are answered. Each entry records the **reason** as well as
the ruling, because three of them are the kind of decision that looks arbitrary a
month later and gets "simplified" back into a bug.

**Nothing in this document is open.**

### D1 — No gambit phase. Release / Collect / Hint are hand-picked.

`lockFinaleResult` simply omits the `gambitPlayed` gate (§0.3). No gambit is
offered, drawn or logged, so the 54-card shared deck is never touched and
`liveCasinoStats` has nothing to replay.

The host sets the room's three numbers **at creation**, on the Open the Finale
panel.

> **Hand-picked means the FINAL values, not the chances.** An ordinary table stores
> Release and Collect as *percentages* and `deployMission` rolls them to on/off
> against those odds (`rollCasinoOdds`). There is nothing to roll if the host has
> already chosen, so the finale writes `release: 'on' | 'off'`, `collect: 'on' |
> 'off'` and `hint: n` directly and **`deployMission` skips `rollCasinoOdds` for a
> finale**. Say so if you meant to pick the odds and still let them roll — it is a
> one-line difference, but it is the difference between choosing the room and
> gambling on it.

Knock-on effects, all of them simplifications:

- `casinoStats` still carries `xp: CASINO_XP_FLOOR`, inert in a casino shell.
- `casinoOpenStats` equals `casinoStats` forever, so `OddsTrio`'s drift display
  shows no drift. Correct — nothing can move them.
- `revertSeatGambitUpdates` on stand-down finds no gambit entries and no-ops.

### D1a — The finale and the final ordinary tables must not block each other

The host opens the finale at the **same moment new table creation stops**, so a
handful of ordinary tables will still be gathering their last players. Both
directions have to stay open:

- **Existing tables must not bar the finale** — the claim-capacity gate is skipped
  (D1, WS-C).
- **A finale seat must not bar those last tables.** This is `holdsMissionClaim(m)`
  (`casinoData.ts`, mirrored server-side): false for the finale, so
  `enlistInMission` writes no `players/{uid}/activeMissions/{id}` entry and a
  finale seat is **invisible to every claim count in the app**. Both mission-card
  callers derive their held count from that node, so nothing further is needed.

Claiming a vacated slot on a final table was already safe: casino claims consume no
claim, and the casino shell's `OpenSlots` rations them **per table** (`alreadyClaimed`
+ `claimRefusal`) with no capacity check at all.

> ⚠️ **One real hole this opened, now fixed: `weeklyGoldTopUp`.** It skips any
> player seated at an in-progress casino table, reading a live seat as evidence they
> are doing well enough not to need the floor. That is sound for a table you paid an
> ante to sit at — and false for the finale, which is free, costs no claim, invites
> everyone, and **runs to the end of the season**. Left alone it would have struck
> the 250g floor from every player who entered the finale, permanently, hitting
> hardest exactly the busted players the finale exists to welcome. The seat scan now
> excludes it.

### D2 — A finale seat keeps the one-hour clock (Q2 option **a**)

`enlistInMission` stamps `startBy: now + 1h` as it does for every casino seat, and
the sweep deletes an un-spun seat after an hour. `dealFinaleBoard` clears it on the
arm pull, so a player who has actually spun is never swept.
`foldFinaleBoard` resets it, exactly as `casinoFold` does.

A swept player may re-enlist free — no fold was recorded, so `finalePlays` is
untouched. That is intended: they never played.

### D3 — The merc block is soft for the admin (Q3)

The new `finale` reason in `mercHireBlockers` is **hard for players, soft for the
admin** — the house behaviour every other blocker already has. The host keeps the
right to hire a merc onto a finale slot if something genuinely comes up.
`MercControl` still hides the affordance from players rather than offering a button
that always fails.

### D4 — Both resubmit paths stay, scoped to the chosen row (Q4 option **a**)

A finale seat may re-pick which cards it commits while **forming**, and once
in-progress **only on a host deny** — the same rule as every other table, and the
only escape hatch for a player who cannot source a game for a 5★ card.

Implementation note, because the finale's pool is shaped differently:
`resubmitCasinoYaml` re-selects from the retained secret `hand`. The finale has no
`hand` — it has a 15-card `board` plus `finaleRow`. So its fork must re-select from
**the cards of `finaleRow` only**, and reject any uid from another row. The row
itself is never re-pickable; a re-pick is *"keep a different subset of the row you
took"*.

`deployMission` clears only `deck`, so `board` survives deploy on its own and the
in-progress deny path has something to re-select from — the same reason `hand` is
kept for the other games.

### D5 — The house keeps the rebuy (Q5 option **a**)

`pot` stays `0` and nothing is ever added to it. **The 50g is never routed through
`potContribution`.**

> **The reason is anti-abuse, not revenue, and it is why the figure must stay a
> real cost.** Payout tops out at 330g, so with a free or refunded rebuy a player
> would simply respin until a 250g+ board appeared. The 50g is the drag that makes
> folding a judgement call instead of a loop. Anything that recycles it back to the
> players — a bonus pot, a refund on locking in — removes the drag and restores the
> exploit.

It also keeps the entire weighted-pot pipeline dormant, which is what makes
settlement need no fork at all (§0.4).

### D6 — Tiebreak confirmed; stars freeze at creation, with no refresh (Q6)

The ranking is **ascending `index`, then `availability` descending, then `name`
ascending**. Among cards nobody committed, the one the deck offered more often was
more conspicuously passed over — the same logic the metric itself runs on.

**Frozen once, at creation. There is no Recompute action** — drop it from WS-B. The
host accepts that a handful of picks from tables still locking in at that moment
are missing from the baseline. One snapshot, one audit trail, nothing that can
change a player's payout after they have seen it.

### D7 — Wild stays at 1★ (Q7 option **a**)

> **Wild is nerfed on purpose, and this is the sentence to keep.** The star scale
> exists to reward playing games the season passed over. Wild hands the player a
> free choice, which they will spend on the game they are most comfortable with —
> most likely an over-picked one. It directly countermands the mechanic, so it pays
> the floor.

Pinned explicitly in `finaleStarTiers` rather than left to the ranking, which would
otherwise score it on a pick rate that measures something else entirely.

### D8 — Duplicate cards are fine as designed (Q8)

A 15-card board is dealt from a real deck — 3 copies of each Broad card, 2 of each
Platform, 5 Wilds — so the same card will often appear twice, sometimes in one row.
Keeping both means **playing two games in that category and scoring its stars
twice**: two kept 5★ Sonics is 100g and two Sonic games.

This matches every other table (a Blackjack hand can hold two 2D-platformer cards).
No distinct-name dealing, no de-duplication. Worth a line of help copy so nobody
reads it as a bug.

### D9 — The finale inherits everything, status incidents included (Q9)

A finale mission is `type: 'casino'`, and that is left alone: the status report, the
room-pace telemetry, the idle badges, the admin work queue, the `profiles/` casino
counters (plan §11) and the season money-in audit all treat it as a casino table.
**Do not special-case `'finale'` out of any of them.**

> **Status incidents stay on deliberately.** The finale will still be running after
> the season ends, and if someone causes it to drag on and on, the host wants that
> on the record like any other world. The ≥5 auto-warning applies as normal.
