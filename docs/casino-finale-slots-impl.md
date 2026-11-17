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
>    (Both have since been RENAMED to `finaleEntryClosed` / `gmFinaleEntryClosed`,
>    because the deadline turned out not to be the deploy trigger — see WS-F.)
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

### WS-D — The spin — ✅ DONE (except the hand-off to lock-in)

**Depends on:** B. **Largest stream, and almost entirely new code** — which is why
it is also the lowest-risk one.

> **Shipped:** three new server callables (`dealFinaleBoard`, `rerollFinaleReels`,
> `foldFinaleBoard`) behind a shared `mustFinaleSeat` guard; the `board` secret and
> its rule; `src/casino/FinaleBoard.tsx` + `finale.css` for all five phases; the
> `CasinoTable` phase machine, subscription and handlers. 628 tests pass and
> `vite build` is clean.
>
> ⚠️ **The flow is NOT yet end to end.** `onCommit` seeds the existing `manifest`
> phase with the kept cards and stops there — the manifest's submit still calls
> `lockCasinoResult`, which would reject a finale seat (it requires a gambit) and
> would price it off card gold rather than stars. **WS-E closes that**; until it
> lands the finale is playable up to "name your games" and no further. Nothing is
> committed or payable in the meantime, and the table cannot exist in a live season
> until a host opens it.
>
> **Deliberate departures and things worth knowing:**
>
> 1. **A separate component, not more of `CasinoTable`.** That file was already
>    ~1750 lines; the board, the reroll selection, the row pick and the keep set are
>    one visual object (the 3×5 machine) across five phases, so they are one
>    component with the phase as a prop. `CasinoTable` keeps the phase machine, the
>    subscription and every server call.
> 2. **`applyReelRespin` is extracted and tested** (`casinoData.ts`, mirrored
>    server-side). A row-major board makes "replace a reel" a **strided** write, and
>    the wrong stride respins a *row* — which would destroy the one mechanic the
>    reroll exists for while still looking plausible on screen. It also sorts the
>    reels so client and server map replacements identically however the player
>    tapped. Three tests pin the stride, the ordering and the length.
> 3. **`finaleRerolled` is per BOARD, not per seat.** `dealFinaleBoard` clears it,
>    so a rebought board gets a fresh reroll — otherwise folding would silently cost
>    the reroll as well as the 50g. It is also what `onSpinDone` reads to tell the
>    opening spin (→ reroll) from the post-reroll spin (→ row pick), so one settle
>    animation serves both.
> 4. **The deadline is re-checked in `dealFinaleBoard`.** A player sitting on the
>    page could otherwise pull the arm minutes after entry closed, in the window
>    before the tick flips the state.
> 5. **The rebuy is charged in a transaction *before* dealing**, so two tabs cannot
>    both get a board for one payment — and it is deliberately **not** routed through
>    `potContribution` (D5).
> 6. **Two React-rules fixes worth noting for the next component.** Resetting the
>    settle counter and clearing selections both had to move out of effects into the
>    render-time prop-derived-state pattern (as `Countdown` already uses), because
>    `react-hooks/set-state-in-effect` rejects the effect form — and doing it in an
>    effect would genuinely render one frame with the previous spin's state. The
>    board comparison is keyed on **card uids, not array identity**, since `board`
>    is a fresh `[]` whenever the secret has not loaded. A re-entrancy ref also had
>    to go: `react-hooks/refs` forbids writing one during render, and the effect
>    cleanup already makes a double hand-over impossible.

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

### WS-E — Lock-in and money — ✅ DONE

**Depends on:** B, D. **Touches the money path.**

> **Shipped:** `lockFinaleResult`; `seatGoldSwingFor` replacing `seatGoldSwing` at
> all three remaining writers; the star-based details line; the `resubmitCasinoYaml`
> fork; the client's manifest hand-off. 641 tests pass. **The finale is now playable
> end to end** — arm → spin → reroll → row → keep → name games → lock in.
>
> 1. **The payout composition is extracted and tested** as `finaleSeatGold`
>    (`finaleStars.ts`, mirrored in `casinoEngine.ts`, which is where `goldSwing` is
>    written). The plan's own risk register called this the thing that "pays the
>    wrong number and nothing complains", so leaving the arithmetic server-only
>    would have left the highest-risk line in the feature untestable. Six tests pin
>    it, including the two §4a cases that are easy to get wrong: a **pure claimant**
>    gets stars only (no base, no boost — a 5★ card is worth exactly the 50g its
>    abandoner forfeits), and a seat **keeps the base while it holds one own card**
>    and loses it when the last one is removed.
> 2. **Settlement confirmed to need no fork, and the inverse is now a test.**
>    `casinoPotShares` short-circuits on `pot <= 0`, so the whole weighted-split
>    pipeline runs and pays zero even with `casinoShareUnits` banked. A third test
>    asserts that a finale with a **non-zero** pot really would be divided — so the
>    reason `pot` must stay 0 is legible rather than folklore.
> 3. **`cardsToSlots` gained an optional details formatter** (both halves) rather
>    than having the finale overwrite lines afterwards. Its slots read `"Sonic ·
>    5★"`. That deliberately does not match `handStakeFromSlots`' regex, which is
>    safe because that function is only ever a fallback behind `p.goldSwing ?? …` —
>    and there is a test showing it reads 0 from a finale slot, so the reason is
>    recorded instead of discovered.
> 4. **`resubmitCasinoYaml`'s re-pick is scoped to `finaleRow`, not the board.** The
>    row is *not* re-pickable (D4): offering the other ten cards would let a denied
>    player quietly trade up to a better row. The same scoping went into the
>    client's `resubmitPool` / `canChangeCards`, and `startResubmit` restores the row
>    from the **seat record** — the local copy is gone after a reload.
> 5. **`lockFinaleResult` deliberately has NO deadline check.** `dealFinaleBoard`
>    has one — you may not *start* a board after entry closes — but a player holding
>    a board must be able to finish it in the window before the tick deploys the
>    table. Locking in is exactly what clears a straggler.
>
> **Known rough edge, and a DECIDED one:** reloading the page *during* the manifest
> step drops the player back to the row pick, because the row and keep set are
> local until lock-in. Nothing is half-written server-side (the config uploads at
> submit), so they simply re-pick.
>
> A small `pickFinaleRow` callable would stamp the row at pick-time and preserve
> the work. **It was raised and declined (D10): a new server callable is a poor
> trade for a nicety on a table that runs exactly once.** The cost is seconds of
> re-picking, against a permanent addition to the API surface, the rules and the
> mirror burden.
>
> It was also raised as a way to tell a seat that *spun and wandered off* apart
> from one that *has its games chosen and is stuck on its config* — the two are
> identical on the wire, since `lockFinaleResult` is the single write that records
> anything after the deal. Declined for the same reason plus a better one: the host
> treats them the same way regardless (one `NOT SUBMITTED` row per seat on the
> existing config roster, named by Discord handle, chased in Discord), exactly as
> on an ordinary table. There is no action the distinction would change.
>
> ⚠️ **The three-phase close made this cheaper, not dearer.** Under the original
> deadline-deploys design a reload cost the player their row *against a clock* —
> redo it too slowly and the table deployed without them. With the table now
> holding open until its last seat locks in, a reloaded player has as long as they
> need. The one argument for building it went away with the phase that created it.

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

> **D10 / D11 (settled during the WS-F review).**
>
> - **D10 — no `pickFinaleRow`.** The row and keep set stay local until lock-in. A
>   new callable is not worth it for a one-off table; see the rough-edge note in
>   WS-D for the full reasoning.
> - **D11 — a straggler holds the closed table open INDEFINITELY.** No grace window,
>   no timed force-deploy. Nobody loses a completed spin to a clock; the host clears
>   it by chasing the player or ⊘ voiding the seat, with `adminForceDeploy` as the
>   override. This is what the three-phase close below implements.

### WS-F — The deadline, the room, and the stragglers — ✅ DONE

**Depends on:** C.

> **⚠️ REVISED after review — the deadline does not deploy the table.** The first
> shipped shape of WS-F took step 1 of this section literally: *deadline passed →
> call `deployMission`*. Reviewing it against the intended player experience found
> that wrong, and wrong in the way that costs a player their spin:
>
> **`lockFinaleResult` requires a `forming` table** (via `mustFinaleSeat`). Deploying
> at the deadline therefore slammed the door on everyone still mid-manifest — a
> player who had spun, chosen a row and was attaching their YAML got *"The finale
> has closed"* and could never submit, leaving the host no option but to ⊘ void a
> seat that had done everything but the last click. The window to finish was
> whatever was left of the 15-minute tick interval.
>
> The finale has **three phases**, not two:
>
> | Phase | State | Seat cap | What happens |
> |---|---|---|---|
> | **1 — open** | `forming` | `Infinity` | Anyone may enter and spin. Nothing deploys. |
> | **2 — closed** | `forming` | **seated count** | No new entries. The seats that spun finish choosing a row and submitting a config. A straggler holds the table here. |
> | **3 — deployed** | `inprogress` | — | Every seat locked in (or the stragglers voided). The room is generable. |
>
> **The whole of phase 2 is one line**: `currentMaxSlots` returns the seated count
> once `finaleEntryClosed`, instead of `Infinity` forever. Closing the cap makes the
> table read as FULL, and four pieces of existing machinery then do the rest with no
> finale branch at all —
>
> - `enlistInMission`'s existing `filled >= max` gate refuses a late entrant, so the
>   deadline is enforced **server-side** with no second copy of it. (Before this it
>   was enforced only by `computeMissionCard` — a client-side gate, which seated
>   anyone who called the callable directly and then left them a seat
>   `dealFinaleBoard` would refuse a board.)
> - `shouldDeploy` becomes reachable and already says the right thing: full **and**
>   `allSeatsPlayed`. So its unconditional `isFinale → false` came back out.
> - `outstandingConfigsBlockRoom` flips the host's config roster amber → **red at
>   the close**, which is exactly when chasing those players starts to matter.
>   Previously it could not go red while forming at all (`filled >= Infinity`).
> - `missionPendingAction` reaches its forming `configs` / `deploy` arms — the ones
>   §WS-F's first pass had to build an in-progress twin of.
>
> **A straggler holds the table open indefinitely**, and that is the decision, not a
> gap: nobody loses a completed spin to a timer. It clears when the player locks in,
> when the host ⊘ voids the seat (a whole-seat removal in the forming shape — no
> claimable slot), or via `adminForceDeploy`.
>
> Three knock-on changes fell out of it:
>
> 1. **`finaleDeadlinePassed` → `finaleEntryClosed`**, and it no longer tests
>    `state`. The old name asserted a deploy that no longer happens, and a
>    `state === 'forming'` term would now be invisible (phase 2 *is* forming) while
>    breaking the admin panel's wording once the table goes live.
> 2. **The tick lost its finale arm.** `gmShouldDeploy` covers the finale now, so
>    the deploy pass is back to one condition.
> 3. **`lockFinaleResult` re-reads and calls `gmShouldDeploy`**, like
>    `lockCasinoResult` does. It matters more here: a closed finale is waiting on
>    precisely these writes, so leaving it to the scheduled tick would sit the
>    entire table on its last player for up to 15 minutes.
>
> **Also checked, needs nothing:** folding during phase 2 is self-healing.
> `dealFinaleBoard` refuses a rebuy past the deadline, so the seat would sit
> boardless and hold the table — but `foldFinaleBoard` re-arms `startBy`, handing
> it to the idle sweep, which runs before the deploy pass in the same tick. Folding
> after close forfeits the entry and tidies itself up within the hour.
>
> ---
>
> **Shipped.** `gmFinaleEntryClosed` (the server mirror, now that it has a
> consumer and a different job), the three-phase close above, `deployMission`'s two
> finale guards, and the gap step 3's verification turned up. 659 tests, 24 files.

> **The verification found a real hole, and it is step 3's whole point.**
> `missionPendingAction`'s `configs` arm lives in the **forming** branch, behind
> `filled >= currentMaxSlots` — which for a finale is `>= Infinity` and therefore
> never true. So a finale that deployed with a straggler aboard fell through the
> in-progress branch to **`generate`**: the card told the host to go build the room,
> which is the one thing they cannot do until that seat is resolved. The fix is the
> in-progress twin of the arm that already exists, placed exactly where `denied`
> sits and for the identical reason the code gives there — *a seat with no config
> cannot be in the room, so generating now would just have to be done again.*
>
> It is **scoped to `m.type === 'casino'`**, mirroring the `denied` arm above it.
> That is not caution for its own sake: `seatOwesConfig` judges a non-casino seat on
> `yamlAt`, and every participant predating that marker carries none — so an
> unscoped arm would relabel every older in-progress Patrol as `configs` and bury
> the `generate` those cards actually need. Pinned as its own test.
>
> The finale is the **first** table that can reach `inprogress` holding a seat that
> never locked in (`gmShouldDeploy` demands `allSeatsPlayed`, so an ordinary cohort
> gets there only by force-deploy), which is why nothing had hit this before.

> **Three departures from the sketch below:**
>
> 1. **`hint` and `xp` are still written at deploy for a finale; only the odds roll
>    is skipped.** Both already hold the host's values from creation, so the write
>    is a no-op — and leaving the two lines unforked keeps the diff to the one
>    thing that was actually wrong (`rollCasinoOdds` re-deciding a hand-picked
>    Release/Collect). `liveCasinoStats` above it is likewise left alone: with no
>    gambit log it replays `casinoOpenStats` to an identical value.
> 2. **`casinoShareUnits` is still banked at deploy for the finale.** It looks like
>    dead bookkeeping with no pot, and it is — but it is the *documented* dead
>    bookkeeping that §0.4 depends on, and `tests/lib/finaleTable.test.ts` pins
>    both directions of it. Skipping the bank would make the zero-pot
>    short-circuit the only thing holding settlement together, instead of the
>    second of two.
> 3. **Flipping the season to `closing` was verified safe, not just advised.**
>    `tickableSeasons` includes `closing`, so the tick keeps running and the finale
>    still deploys on its deadline — while `gmSpawnAllowed` stops replacements. Had
>    that list been `active`-only, the operational belt in step 2 would have
>    *disabled* the deadline it was meant to protect. Worth stating, because it is
>    the kind of interaction that is only ever discovered the night it matters.

1. ~~`tickGuildmasterMissions` — a finale branch: when
   `state === 'forming' && now >= finaleClosesAt`, call `deployMission`. It stands
   in for `gmShouldDeploy`, which can never fire (WS-B).~~ **Superseded — see the
   revision note above.** The deadline closes the seat cap instead, and
   `gmShouldDeploy` deploys the table once its last seat locks in.
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

### WS-G — Claims, kicks and mercs — ✅ DONE

**Depends on:** C.

> **Shipped.** Both copies of the `claimRefusal` carve-out, the `finale` merc
> blocker in both halves, and `MercControl` hiding the affordance. 7 new tests
> (666 total, 24 files).
>
> **The two-lines-two-files trap was real and both lines are in.** `claimRefusal`
> (`src/lib/slotHelpers.ts`) and the inlined copy in `claimMissionSlot` each gained
> the carve-out, both **below** the kicked check so only the `restricted` arm
> lifts. Each site carries a comment naming the other, and the test block says
> which half it covers — the failure mode is silent in both directions (client only
> ⇒ a button the server refuses; server only ⇒ a claim the UI never offers).
>
> `claimRefusal` uses **`isFinale(world)`**, not the `casinoGame === 'finale'`
> literal the plan sketched — the one named predicate is a CLAUDE.md invariant and
> what makes a grep find every fork. `casinoData.ts` imports only types, so there
> is no cycle. A tile has no `casinoGame`, so tiles are false for free with no
> world-type test.
>
> **Verified, not built:** all three claim surfaces (`PhasePanel`'s casino
> `OpenSlots`, `GuildmasterMissions`, the tile `InProgressState`) already pass the
> whole world object, so the carve-out reaches the casino panel with no plumbing.
> The one-per-player cap needed nothing (`claimedWeight(seat) > 0`), and all four
> `goldSwing` writers were already on `seatGoldSwingFor` from WS-E.
>
> **Three departures:**
>
> 1. **`mercHireBlockers` takes a 4th OPTIONAL `finale` parameter** rather than
>    reshaping `casino: boolean` into a game. Optional is the point: every
>    existing call site and all eight existing tests keep their exact behaviour
>    untouched, which is P1 applied to a function the live tables call. Pinned by
>    a test that the default is off.
> 2. **`MercControl` reads the finale off `gameState`**, not from a new prop. It
>    already derived `world` further down for the candidate limits, so hoisting
>    that keeps the rule out of all five surfaces that render the control. `finale`
>    joins `claimed` as a PERMANENT blocker — the owner is shown no button at all
>    rather than one that can only fail — while the admin still sees it with the
>    reason, which is D3's soft-for-the-host behaviour.
> 3. **`adminRemoveCasinoSlot` KEEPS its `casinoVoidedShare` increment for a
>    finale** — the sketch below says to skip it "for clarity". With a zero pot it
>    pays nothing either way, so skipping buys no behaviour; and because
>    `deployMission` banks `casinoShareUnits` for a finale *unforked*, suppressing
>    only the releases would leave units counted and their returns not. If anything
>    ever gives the finale a pot — §0.4's named risk — a consistent-but-inert
>    denominator still divides correctly where a half-kept one silently overpays.
>    Both or neither; this is both, and the reasoning is at the call site.

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

### WS-H — The Coat and its display sites — ✅ DONE

**Depends on:** B's type widening only. **Independent of everything else, and safe
during the live season** — it is strictly more generous and no current holder can
lose it (plan §6).

> **Shipped.** `COAT_TABLE_TYPES` / `COAT_TYPES_REQUIRED`, the grant, the
> player-facing rail, the help copy, and the Stats row label. 6 new tests (672
> total, 24 files).
>
> **Two of the five listed sites were deliberately NOT changed, and one that was
> not listed was.** The table below conflates two different questions — *what
> counts toward the Coat* and *what can I play tonight* — and only the first is
> WS-H's:
>
> | Site | Verdict |
> |---|---|
> | `db.ts` the grant | **changed** — `COAT_TABLE_TYPES.filter(...).length >= COAT_TYPES_REQUIRED` |
> | `CasinoShell.tsx:431` `doneCount` + the pip rail | **changed** — five pips against a requirement of four |
> | `help/SectionCasino.tsx` the Coat sentence | **changed** (not in the table) — it still said *"all four games"* |
> | `CasinoShell.tsx:307` the Games modal | **unchanged** — see below |
> | `help/SectionCasino.tsx` the games list | **unchanged** — see below |
> | `admin/StatsPage.tsx` | **label fix, not the array** — see below |
>
> The Games modal (*"Tonight's Tables"*) and the help games list both advertise
> **what a player can sit down at**, not what counts for the Coat. Putting the
> finale in either permanently would advertise a one-off table in every season,
> including seasons where it does not exist — and `SectionCasino`'s own WS-B
> comment already says it should render **conditionally on the table existing**,
> which is WS-I's job. So they keep iterating the rotation.
>
> **StatsPage needed no new array, only a label.** `buildRows` already has an
> `extra` pass that appends any key present in the counts but absent from the
> order — so *"Casino Tables by Game Type"* was always going to grow a finale row
> on its own, once a finale table exists. The only defect was that the extras pass
> ignored the caller's labeller and printed the raw key, so the row read `finale`
> instead of **The Finale**. It now asks the labeller first and falls back to the
> key (the signature returns `string | undefined` to make that honest, which also
> covers a retired value in the two tri-state tables). Giving it
> `COAT_TABLE_TYPES` as its order would have been worse: an empty **Slots** row
> drawn all season, where the extras pass grows one exactly when there is
> something to count.
>
> **The rail shows five pips against `{min(done, 4)}/4`.** Five routes and four
> needed means a player can have a spare, and an unclamped count would render
> `5/4`. The copy on both surfaces now reads *"any 4 of the 5 table types"* with
> the numbers interpolated from the constants, so it cannot drift from the rule.

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

### WS-I — Landing and admin surfaces — ✅ DONE

**Depends on:** B, C.

> **Shipped.** The landing's finale card and seat panel, the frozen star
> snapshot on the admin panel, and the help section — plus the two surfaces WS-H
> deliberately deferred here (the Games modal and the help games list), both now
> rendering the finale **conditionally on `findFinale`**. 8 new tests (678 total,
> 24 files).
>
> **Most of the card was already right, and the reason is worth keeping.**
> `seatTally` has a finale branch (`"N seated"`, no `over` state), `msToNextDecay`
> returns null, `SeatPips` draws nothing off `baseMax: 0`, and `casinoEntryCosts`
> already returns `Entry · Rebuy after fold` — so the **rebuy was already stated
> before the player opens the table**, which is one of the three things this
> workstream asked for. What was left was the handful of places where an ordinary
> table's instrument is not merely redundant but *says something false*:
>
> | Surface | Was | Now |
> |---|---|---|
> | the pot figure | `0g pot · ≈0g ea` | `50g + 10g a ★ · 60–300g a board` |
> | the cohort line | `Cohort I` | `The season closer · free · once · no claim` |
> | the full badge | `Table full` | `Entry closed` |
> | the odds | `OddsTrio` → `Release 100%` | `RollFlags` → `Release On` |
> | the ante mini | `Ante 0g` | `Entry Free` |
> | `SeatPips` + `DecayNote` | an empty rail, no note | `FinaleEntryNote` — a live countdown |
> | the seat button | `Take a seat` | `Enter the finale` / `Entry closed` / *You've played the finale* |
> | `DeployBar` (seat panel) | green **Ready to deploy** | `FinaleWait` while entry is open |
> | `seatStanding` (seat panel) | `Hand in progress` | `No row taken yet` / `Row locked` |
> | the leave warning | *"the pot keeps it"* | one play each; nothing was paid in |
>
> **Three of those were bugs, not wording.**
>
> 1. **`Release 100%`.** `freshFinaleTable` pins the chances to 100/0 so the roll
>    would reproduce the host's pick if it ever ran — which means `OddsTrio`
>    advertised a *100% chance* of something already decided. `RollFlags` (the
>    in-progress card's component) reads `m.release`/`m.collect` directly and was
>    already the right instrument.
> 2. **`DeployBar` turning green.** Its `filled >= max` is trivially true for a
>    table whose cap *is* its fill count, so the bar read **Ready to deploy** the
>    moment the currently-seated players had all played — while the table was
>    waiting on a deadline days off and on players who had not entered. Scoped to
>    the OPEN phase, not to the finale: once entry closes the bar is truthful
>    again (every seat that will ever exist is in) and takes over.
> 3. **A button that could only fail.** `enlistInMission` refuses
>    `finale-already-played`, and *nothing else on the card can tell* — the seat is
>    gone, the table is free, and no claim is held. Hence `TableCard`'s `spent`
>    prop, read off `mission.finalePlays`.
>
> **Departures from the three bullets:**
>
> - **The admin card needed nothing** — the config roster (`seatsAwaitingConfig`)
>   and the seated count were already there from WS-F, and the ⚠→⛔ severity flip
>   at the close was already wired. What was missing was the **stars snapshot**,
>   which is now a toggle on the Finale panel, grouped by tier with each tier's
>   gold and card count. It also reports **how many cards the live recompute has
>   already drifted on**, because that is the actual trap in the audit trail: the
>   Stats tab's ★ column keeps moving as tables settle, so a host answering *"why
>   was Sonic worth five"* from that column will eventually answer it wrong.
> - **`fmtDur` moved** from `CasinoShell` into `missionLogic`, beside `fmtDayClock`.
>   `PhasePanel` needs it for the countdown and is imported *by* the landing, so
>   exporting it from there would be a cycle. Pinned by tests so the move changed
>   nothing — including that a passed deadline renders `0m`, never a negative.
> - **`FINALE_MIN_GOLD` / `FINALE_MAX_GOLD`** are new, derived, display-only
>   constants in `finaleStars.ts`. Three surfaces advertise the 60–300 range and a
>   hand-typed figure in any of them is a promise the formula stops keeping the
>   moment a constant moves. Tested against `finaleOwnGold` at both ends, plus the
>   330 Purist / 270 Safety figures §WS-J asks for.
> - **Two stale comments fixed**: `GMMission.finaleClosesAt`'s doc still said the
>   deadline deploys the table and stands in for `shouldDeploy` (the pre-WS-F
>   model), and `SectionCasino`'s WS-B note still said the finale "is not rendered
>   yet". Both now describe what the code does. `FinaleBoard`'s fold warning also
>   had a hardcoded `50` beside the constant it was meant to read.

1. The landing's finale card: no seat pips, a seated **count**, a live countdown to
   `finaleClosesAt`, "free · once · no claim used", and the fold rebuy stated
   before the player opens the table.
2. The admin card: seated count, the config roster, the stars snapshot readable
   somewhere (it is the audit trail for *"why was Sonic worth five"* — plan §3).
3. `help/SectionCasino.tsx` — the finale's rules, including that stars run
   **inverse** to how often the season picked a card. This is the one mechanic
   nobody will guess, and plan §2 asks for it to be said out loud on every surface.

---

### WS-I½ — The pre-rehearsal audit — ✅ DONE

An adversarial read of the finished code, before the rehearsal rather than after.
It found **five ways to walk around the design** and two pieces of copy that
promise the opposite of what the server does. All are fixed. The entries worth
keeping are the ones where the finale inherits an ordinary table's machinery and
the inheritance is wrong.

**1. `mustCasinoSeat` accepted a finale seat, and that was the big one.** The
finale is a `casino` mission in `forming` state, so it satisfies every check in
the guard the other ten casino callables share — and `isFinale` appeared nowhere
in it. A player could therefore call `dealCasinoHand` (ante 0, deal size 15: a
**free fifteen-card hand**), `casinoFold` as often as they liked with no fold
recorded against the rebuy, `dealGambitOffer` / `playCasinoGambit` (shifting the
odds the host HAND-PICKED and adding to a pot that must stay at zero, which would
switch the weighted split back on), and finally `lockCasinoResult` — committing
the best five of those fifteen, **priced off card gold rather than stars**, with
no row limit and no `finalePlays.played` stamp. That chain walks around rows,
stars, the rebuy, D1 and D5 together. The guard now refuses the finale, with one
opt-in: `setCasinoDeckChoice`, which the finale genuinely shares.

**2. The deck could be swapped after seeing the board.** `setCasinoDeckChoice`
froze the choice on `seat.hand`, and a finale seat has no hand — its pool is the
`board`. Since `lockFinaleResult` reads `deckChoiceOf(seat)` at LOCK, a player
could spin a Safety board (−10%) and lock the same cards in as Purist (+10%). The
board is the hand here, and now freezes the deck exactly as a hand does.

**3. Re-enlisting was an unlimited free respin.** `enlistInMission` never checked
whether the caller was already seated: it writes the participant record wholesale
and runs `clearSeatSecrets`, so re-entering wiped the board without paying — or
counting — a fold. `finalePlays.folds` lives on the mission and only
`foldFinaleBoard` increments it, so the next board was free again. **This is also
a bug on every other table**, where a re-enlist destroys a LOCKED seat (`played`,
`slots`, `lockedCards`, `goldSwing`) for an ante already spent. Now refused with
`already-seated`; leaving a table is `standDownFromMission`.

**4. The deadline refused the FIRST board, not just the rebuy — the correction
that matters most.** §11's reading was that a seat past the close must not buy a
fresh board, and the check was written as a flat deadline test. But **the deadline
closes ENTRY, and enlisting is entry**: `enlistInMission` is the gate (through
`gmCurrentMaxSlots`, which is why there is no second copy of the deadline there),
so anyone reaching `dealFinaleBoard` was already let in. A player who enlisted
minutes before the close was shown a live *Pull the arm* that the server rejected,
until the idle sweep removed them having never spun — the entry taken away from
them silently. It now gates on `cost > 0`: **first board always, rebuy never.**
That is the same distinction `lockFinaleResult` already drew by carrying no
deadline check at all, and folding past the close stays self-healing, because
`foldFinaleBoard` re-arms `startBy` and hands the seat to the sweep.

**5. The fold dialog promised a rebuy that no longer existed.** It read *"a fresh
one costs 50g"* and *"this is the last board you will pay for"* — the first false
once entry has closed (folding then forfeits the finale outright), the second
false always (folding is unlimited, at 50g each). `FinaleBoard` now takes
`entryClosed` and forks all three places that depend on it: the fold warning, its
danger-button label, and the arm screen, which blocks only when entry has closed
**and** this would be a rebuy — and otherwise tells a straggler the table is
waiting on them.

**Also fixed, same pass:**

- **A double-charged rebuy.** `dealFinaleBoard`'s "you already have a board" check
  sat outside the gold transaction, so two tabs could both pay 50g and the second
  board overwrite the first. The board write is now a transaction of its own and
  is what decides the race; the loser is refunded by `increment`.
- **The server still said "Cohort I".** `missionDisplayLabel` had the finale
  branch; `gmMissionLabel` did not — and the server copy is the one players see
  most (the deploy notification, the activity log, the slot-removal warning, the
  status-incident warning). Mirrored.
- **A struck card could be re-picked.** `adminRemoveCasinoSlot` rewrites
  `slots` / `lockedCards` / `goldSwing` but cannot touch the seat's dealt POOL,
  which is what `resubmitCasinoYaml` re-selects from — so a denied player could
  re-pick the card the host had just taken off them. After a KICK that card is
  live as someone else's claimable slot, so the room would hold two slots for one
  card and the pot would pay weight for both; after a VOID its weight is already
  released, so re-picking over-pays against a shrunken denominator. Struck OWN
  cards are now recorded in `GMParticipant.removedCardUids` and filtered out of
  the pool on both sides. Claimed cards are deliberately not recorded — their uid
  belongs to another player's deck. **Not finale-specific**, but the deny path is
  exercised by the rehearsal.
- **`startResubmit` pre-selected by uid across both uid spaces.** It seeded the
  selection and the manifest from the whole of `lockedCards`, claimed cards
  included — and a claimed card's uid is a per-deck index from another player's
  deck, so it can coincide with an own card's. The result pre-selects the wrong
  card and stamps the claimed card's game onto an own one. Now paired by index and
  filtered to own cards, matching `splitSeatCards` server-side. **Also not
  finale-specific.**
- **Voiding a locked finale seat ends that player's finale**, because
  `finalePlays.played` lives on the mission precisely so it outlives the seat.
  Everywhere else a void is no-fault and leaves no mark. The ⊘ confirm now says
  which of the two cases the host is looking at — locked in (cannot re-enter) or
  never locked in (may re-enter, rebuy still applies).
- **Two stale comments**: `doFinaleCommit` still said the manifest submits through
  `lockCasinoResult` (it routes to `lockFinaleResult`), and `clearSeatSecrets`
  said an orphaned board trips `mustCasinoSeat` (it never read `board`, and now
  refuses the finale outright anyway).

> **The pattern worth carrying into the rehearsal.** Four of these five are the
> same mistake: the finale is a `casino` mission, so it *inherits* every path
> written for an ordinary table, and inheritance is silent. The rehearsal drives
> the UI, and the UI never offers any of them — so **none of 1–3 can be found by
> playing**. They need a client calling the callables directly, which is why WS-J
> step 0 below exists.

---

### WS-I¾ — The second audit (the money paths) + the key-space fix — ✅ DONE

A review of the WS-I½ diff itself, which found six more. Where the first audit was
about the finale **inheriting** ordinary-table callables, this one is about the
opposite: paths the finale's own fixes had moved, raced, or described wrongly. Four
are server bugs and two are copy that states something false.

1. **A card re-pick restored the seat's full pot weight** (`resubmitCasinoYaml`).
   `lockedCount` was restamped to the new hand size, so a seat that had a card
   **voided** (its `1/lockedCount` released to the table via `casinoVoidedShare`)
   or **kicked** (reserved on the claim entry) went back to a *whole unit* while
   that fraction was still carved out elsewhere — the table paying out more than
   its pot. This is the same over-pay `repickPool` was added to stop, arriving by
   the other door, and the pool filter structurally cannot catch it: weight is
   computed from the new COUNT, not from which cards were picked. Now
   **`repickLockedCount`** (`casinoSlots.ts` ↔ `casinoEngine.ts`), which holds
   struck cards in the denominator on a LIVE table and leaves a forming seat at one
   whole unit (nothing is banked pre-deploy). Residual, deliberately: a card struck
   while forming and re-picked after deploy underpays by one card's share, which is
   the direction this pot errs in by design.
2. **Stand-down was a free respin** (`standDownFromMission`). The new
   `already-seated` guard closes re-enlisting *over* a seat, but stand-down deletes
   the seat first — so pull the arm, dislike the board, stand down, re-enter, and
   `dealFinaleBoard` charges 0 because `finalePlays.folds` never moved. D5 bypassed
   entirely, repeatable. **Leaving with a board in front of you is now a fold**,
   logged as one. A player who never spun still pays nothing, which is also why the
   `startBy` sweep counts none.
3. **The deck could still be swapped behind the deal** (`setCasinoDeckChoice`). Its
   board check is a read and a write in two steps, so a client firing it alongside
   `dealFinaleBoard` lands the change after the deal read the old value — spin on
   Safety (−10%, small deck), lock the same cards in at Purist (+10%). The guard
   made it unlikely, not impossible. The deal now **stamps** `finaleDeck` with the
   variant it used and `deckChoiceOf` prefers the stamp, so all four `goldSwing`
   writers and the client's own quote price off the board that was actually dealt.
   A fold nulls the stamp. Ordinary tables never write it, so nothing else moves.
4. **The deal's pre-clear could wipe the winner's reroll flag** (`dealFinaleBoard`)
   — a bug WS-I½ introduced while fixing the board race. Two tabs pass the fast
   path; the winner's board lands; the player spends their reroll; the **loser's**
   pre-clear then nulls `finaleRerolled` on its way to losing, handing back a second
   free reroll. The comment claiming those nulls cost the winner nothing was simply
   wrong. The deal now clears **nothing** — `foldFinaleBoard` already nulls both
   per-board flags atomically with the board, and a fresh seat is written wholesale
   — so a loser writes nothing at all.
5. **The seat-removal confirm promised a rebuy that would not be charged**
   (`MissionsPage`). It told the host the fold count carries over "so a fresh board
   still costs them the rebuy" for *every* unlocked seat, including one that had
   never folded — whose next board is free. The host voids the seat believing they
   have cost the player something and hands them a free respin. It now reads
   `mission.finalePlays[uid].folds` and says which case it is.
6. **The blocked-arm copy narrated a fold it cannot see** (`FinaleBoard`). It said
   entry closed *while that board was in front of you* and that folding it *ended
   your finale* — true in one path, false when the fold happened days before the
   deadline, or on a seat that was swept and re-entered. It now says only what
   `finaleBoardRefusal` established: entry is closed, and a board after a fold is a
   rebuy.

**Tests**: 11 new, all mutation-verified — reverting #1 fails 3 and reverting #3 on
the client alone fails 2, including the `engine.test.ts` parity guard catching the
mirror drift by itself. Both new rules are named, pure and mirrored rather than
inline, for the reason the last round established.

7. **The snapshot could not be written at all** — found the moment the first real
   finale was opened on the rehearsal season, so it never reached a player.
   `mission.finaleStars` is keyed by CARD NAME, and **twelve of the 36 names carry
   a `/`** (`Exploration / open world`, `NES / Famicom`, …). RTDB rejects `.`, `#`,
   `$`, `/`, `[` and `]` in a key, and one bad key fails the ENTIRE multi-path
   `update()` — so `createFinaleTable` simply errored and no finale existed. Fixed
   with **`cardKey` / `cardNameFromKey` / `starsFor` / `finaleStarsToWire`**
   (`finaleStars.ts` ↔ `casinoEngine.ts`), encoding at the write in
   `createFinaleTable` and reading only through `starsFor`. The in-memory
   `finaleStarTiers` ranking stays raw-named, which is what `StatsPage` and
   `econFinale` want.

   > **The quiet half is worse than the loud half.** The write failing is
   > self-announcing. But every reader indexed the stored map as
   > `stars[card.name]`, which compiles, returns undefined for a third of the deck,
   > and scores those cards **0** — so a seat holding genre cards would have been
   > paid the 50g base and nothing else, with no error anywhere. The regression
   > test asserts over the REAL `CARD_DEFS` rather than a fixture, plus a second
   > test that the deck still contains names needing encoding, so it cannot go
   > vacuously green if the cards are ever renamed.

8. **Picking a deck dropped the player on the ordinary ante screen** — found at the
   rehearsal table, one click after #7. `chooseDeck` hardcoded `setPhase('ante')`
   while the derive effect forked on the finale, so the seat landed on the buy-in
   step with a live *"Ante 0g · Deal me in"* wired to `dealCasinoHand`.
   `mustCasinoSeat` refused it — the WS-I½ guard doing exactly its job — but the
   player's experience was a dead button and a red error. Whether it self-corrected
   was a RACE: the local `setPhase` is only overwritten if the mission tick carrying
   the new `deckChoice` happens to land after it. Now **`openingPhase(game)`**, read
   by both sites.

   > **The server guard is a backstop, not the experience.** WS-I½ made ten shared
   > callables refuse a finale seat, and that is what turned this into an error
   > message instead of a free fifteen-card hand. But refusing is not routing: the
   > client has its own copy of "what does this table do next", and that copy had
   > the same inheritance bug the callables did. The finale's reachable phases are
   > `deckselect → armed → spinning → reroll → rowpick → keep → manifest → locked`,
   > and an audit of the other four exits (`play`, `holdplay`, `folded`, `gambit` —
   > each holding a control with no finale meaning) found them all unreachable:
   > `backToCards` routes to `play` but renders only within `gambit`.

9. **The live-table card had none of the finale forks** (`ProgressCard`,
   `CasinoShell`). `TableCard` — the one a player sits down from — forks on
   `isFinale` for the pot, the cohort line, the seat count and the leave warning.
   Its read-only twin, shown for a table in progress that the viewer holds no seat
   at, had no fork at all: `0g pot` and `Cohort I`, both explicitly ruled out
   everywhere else. Also reworded its awaiting-room line, which says *"seats are
   locked in"* — an event that never happens at a finale, where entry closes on a
   deadline rather than filling up.

   > Found while chasing a different copy report, which is the useful part: the
   > card is invisible until the table is already running, so neither the design
   > pass nor the rehearsal's early steps would surface it. **A finale fork in
   > `TableCard` should be followed by a look at `ProgressCard` in the same pass.**

10. **The cards themselves still showed gold** (`CardFace`). `card.value` is the
    gold an ordinary table pays for that card; the finale prices the same deck in
    stars. So every card in front of a finale player carried a number that is real,
    looks authoritative, and is not what the seat will be paid. `CardFace` now takes
    an optional `stars` that replaces the figure and drops the coin glyph with it
    (a gold disc beside a star count is the same mixed message in less space).
    Threaded at all four finale-reachable sites: the board, the landing's locked
    hand, and the deck preview's two grids.

    > The audit mattered more than the fix here. Of seven `CardFace` renders, three
    > are in `play` / `holdwait` / `holdplay` — unreachable for a finale seat, per
    > #8's phase set — so they were correctly left alone. Fixing only the board,
    > which is what the report pointed at, would have left the same wrong number on
    > the landing and in the deck picker.

11. **← Back from the manifest walked a finale seat into two dead ends**
    (`CasinoTable`). The button was a flat `setPhase('gambit')`. The finale has no
    gambit step — the host hand-picks the odds — so it landed on a screen whose
    only forward action calls `dealGambitOffer`, which refuses the seat; and THAT
    screen's own "← Back to cards" then dropped them on `play`: the ordinary commit
    screen, cards priced in card gold rather than stars, with a Fold wired to
    `casinoFold`. Two unrecoverable screens, reached by pressing Back twice.

    > **This is the audit from #8 having been wrong.** That pass checked
    > `backToCards` — correctly concluding it renders only inside `gambit` — and
    > never asked how the MANIFEST goes back. Worse, the fork already existed
    > twelve lines away: the resubmit branch reads
    > `game === 'finale' ? 'keep' : 'play'` while the first-submit branch did not.
    > Checking a few suspicious call sites is not an audit; **enumerating every
    > `setPhase` and asking which are reachable from the finale's phases is**, and
    > that is what was done this time (the deck badge, ← Change deck and ← Back to
    > config all turned out to be gated on `ante` / `play`, so the set is closed).

    The rule is now **`backFromManifest(game)`**, beside `openingPhase`. It exposed
    a second defect underneath: `FinaleBoard` is mounted only for
    `armed | spinning | reroll | rowpick | keep`, so the manifest UNMOUNTS it and
    takes `row` / `dropped` with it — a step back to `keep` would have rendered an
    inert board with no row taken. The parent already holds both facts
    (`finaleRow`, and the `keep` set it built from the chosen row), so it seeds
    them back through `initialRow` / `initialDropped`, read once at mount.

> **The pattern this time.** Three of the six (#1, #3, #4) are **two-step
> read-then-write** sequences that a single client can interleave, and one (#4) was
> introduced by the previous fix. The finale is the only table where the money and
> the pool both live behind one button a player can press twice, so *"who wins the
> race, and what does the loser still write?"* is the question to ask of every
> write on these paths. The other two are copy asserting a cause the code never
> checked — the same failure as a stale comment, but pointed at a player.

---

### WS-J — Tests and the dress rehearsal

**Spans everything.** This is the finale; a rehearsal is cheaper than a repair.

#### The rehearsal season — standing one up

Everything below wants a **throwaway draft season**: absent from the public
`seasonList`, readable only by admin + alpha, and on its own `seasons/{id}` /
`seasonSecrets/{id}` subtrees, so nothing it does touches the live season's data.
There is **no creation UI** — `SeasonSwitcher` only switches — so it is made from
the ops script.

1. **Create it**, from `functions/` (see that script's header for the
   `DATABASE_URL` / credential setup; `--dry-run` first):

   ```
   node scripts/season-migrate.mjs create-draft \
     --id finale_test --label "Finale Rehearsal" --tables 2 \
     --alpha <uid>,<uid>,<uid>
   ```

   It writes `config/draftSeasons/finale_test` and `seasons/finale_test/meta`, adds
   the alpha grants as **per-uid leaf writes** (so whoever can already preview other
   drafts keeps that), and refuses outright to touch any season in the public
   `seasonList`. `--shell map --board s2` for a map season instead; re-running needs
   `--force`.

2. ⚠️ **The `--alpha` list is the step that will bite if you skip it.** Every casino
   callable runs `resolveWriteSeason` first, and it refuses a `draft` season with
   `permission-denied` / *"Season not available"* for anyone who is neither admin
   nor alpha. The admin account is in for free; the others are not — and the same
   pair gates the `draftSeasons` **read**, so an un-listed account cannot even see
   the season in the switcher to pick it. The script warns when the total would be
   zero, but it cannot know which accounts you mean to test with.

3. **Each account switches via the `SeasonSwitcher`** on the admin dashboard. The
   choice is `localStorage`, hence per browser profile — which is also how four
   accounts sit at one table at once.

4. **Player records need no setup.** `ensureSeasonPlayer` is idempotent, runs on
   every load, and exists for exactly this case (its comment names draft
   preview). A `casino` shell starts each account at `CASINO_START_GOLD` — ample,
   since the finale antes nothing and a rebuy is `FINALE_REBUY_GOLD`.

5. ⚠️ **Seed the ordinary tables BEFORE opening the finale.**
   `seedInitialMissions` counts every `type: 'casino' && state: 'forming'`
   mission toward `casinoOpenTables` — **the finale among them** — so with the
   finale already open it will seed one table short. This can never bite live,
   because the finale opens during `closing` where seeding is a no-op; a draft is
   `status: 'draft'`, where `gmSpawnAllowed` is true and tables spawn freely, so
   it bites there. The dress rehearsal needs two ordinary tables anyway, for the
   account holding two.

6. **The star snapshot will be synthetic, and that is fine for everything but the
   numbers.** A fresh draft has no settled tables, so `cardStatsCorpus` is empty
   and every card is ranked on baseline presence alone. The tier *sizes* are
   fixed (8/7/7/7/8) regardless, so the partition, the payouts and every path
   checked here exercise correctly — but the values will not resemble what the live
   season freezes. To rehearse the star table a player will actually read, copy
   the live season's `missionsHistory` into the draft before opening the finale.
   Optional; nothing in the mechanics depends on it.

   Then: admin **Casino** tab → **✦ The Finale** (`canOpen` already admits
   `draft`). Set the close 20–30 minutes out, so one sitting covers
   open → closed → deployed.

7. **What needs no setup — and one of them is load-bearing.**
   `tickableSeasons` defaults to `includeDraft = true`, so the 15-minute job runs
   in the draft: it is what closes the cap, sweeps the account that never spun,
   and deploys the table. **None of the three phases works without it**, and it
   costs nothing to have. Likewise the mini-app reads
   `config/draftSeasons/{sid}/shell` directly and all three link builders pass
   `?seasonId=`, and the YAML Storage trees are keyed by season id, so
   owner-scoped uploads just work.

8. **One minimal valid `.yaml` per account.** Screening at `manifest` is real:
   `checkWorldCount` must match the declared slots, and `checkBlanketTargets`
   blocks unconditionally.

> ⚠️ **The draft isolates the DATA, not the FUNCTIONS.** All of this needs
> `firebase deploy --only functions`, which is global. Two items in this diff
> change **live** behaviour rather than only adding finale paths:
> `enlistInMission` now refuses `already-seated` (a re-enlist used to silently
> reset a locked seat — the fix is right, but it is a live change), and
> `adminRemoveCasinoSlot` now stamps `removedCardUids` (additive). Everything
> else — `mustCasinoSeat`'s finale refusal, the `gmMissionLabel` branch,
> `repickPool` — no-ops for an ordinary table. Low risk, not zero; know it before
> deploying rather than after.

**Tear-down**: `node scripts/season-migrate.mjs drop-draft --id finale_test --force`
clears the config entry, `seasons/{id}`, `seasonSecrets/{id}` and
`roomTelemetry/{id}`. It deliberately leaves `config/alphaUsers` alone (the grants
are per-person, and the next draft will want them) and it cannot touch **Storage**,
which is a separate service — delete `yaml/finale_test/` and `casino/finale_test/`
by hand. It refuses any season in the public `seasonList`, so it cannot be pointed
at a live one by mistake.

#### The checks

0. **The callables, called directly** — the step the rehearsal cannot cover. Sit a
   test account at the draft finale and call `dealCasinoHand`, `casinoDraw`,
   `casinoFold`, `dealGambitOffer`, `playCasinoGambit` and `lockCasinoResult`
   against it from the console; each must come back *"The finale is played at its
   own machine."* Then: `setCasinoDeckChoice` **after** pulling the arm (refused —
   the board freezes the deck), and `enlistInMission` while already seated
   (`already-seated`). These are the WS-I½ fixes, and **every one of them is
   invisible through the UI**, which offers none of these paths. A regression here
   would not surface until someone went looking.
0a. **The WS-I¾ money paths, also console-only.** Same sitting, same reason:
   - **Stand-down is not a free respin.** Pull the arm, then
     `standDownFromMission`, then `enlistInMission` again. The next
     `dealFinaleBoard` must charge **50g** (`finalePlays/{uid}/folds` is 1 and a
     `fold` entry is in the `casinoLog`). Standing down *without* a board must
     charge nothing — that distinction is the whole fix.
   - **The deck stamp exists and is what prices the board.** After the arm,
     `participants/{uid}/finaleDeck` must hold the variant the board was dealt
     from, `setCasinoDeckChoice` must refuse, and the `lock` log entry's
     `deckChoice` must equal the stamp — not a `deckChoice` changed since. (Firing
     the two calls concurrently to lose the race on purpose is optional; the stamp
     is what makes the outcome correct either way.)
   - **A fold releases the stamp**: `finaleDeck` is null after `foldFinaleBoard`,
     so the next board prices off the next pick rather than the last one's deck.
   - **A re-pick does not restore pot weight.** Void one card off a locked
     five-card seat on a LIVE table, deny the config, re-pick the remaining four:
     `lockedCount` must still read **5**, not 4. This one is reachable through the
     UI and belongs in item 4's run as well — it is listed here because the number
     to check is on the participant record, not on any screen.
1. **Unit** (`npm run test:unit`) — ✅ **DONE**. The star partition and tiebreak,
   the payout formula at both ends (60/300 before boost, 330 Purist / 270 Safety),
   `finaleSeatGold` for an own hand / a mixed seat / a pure claimant (the pure
   delegate every `seatGoldSwingFor` writer goes through), and the board→column
   reroll mapping were all already covered by A–I. What was **not** covered was
   WS-I½'s own fixes, which is where this pass went — see item 1a.
1a. **The two rules WS-I½ introduced are now named, mirrored and pinned.** Both
   arrived as inline logic duplicated across the callable and the screen it
   drives, which is the drift this codebase keeps paying for, so each became one
   function with a server mirror:
   - **`finaleBoardRefusal(play, closesAt, now)`** (`finaleStars.ts` ↔
     `casinoEngine.ts`) — the rebuy-vs-first-board rule, read by `dealFinaleBoard`
     and by the arm screen's `armBlocked`. Pinned across the close, a missing
     deadline, and the deadline instant itself.
   - **`repickPool(pool, seat)`** (`casinoSlots.ts` ↔ `casinoEngine.ts`) — the
     struck-card filter, read by `resubmitCasinoYaml` and `CasinoTable`'s
     `resubmitPool`. Pinned including the holes RTDB puts in a sparse array.
   > **Verified by mutation, not just by green.** Re-introducing the original flat
   > deadline test failed three tests: the named regression, the
   > cost/refusal-agreement check, and — usefully — the client/server parity guard
   > in `engine.test.ts`, which caught the mirror drifting on its own.
2. **Regression on the forks** (P2) — ✅ **DONE**, and mostly already was. All six
   are server callables, so each is covered through its pure delegate:
   `enlistInMission` → `holdsMissionClaim` / `currentMaxSlots` (`finaleEntry`'s
   *"ordinary tables are unchanged"*, 5 cases); `claimMissionSlot` → `claimRefusal`
   (`mercLogic`, finale carve-out **and** the kicked/restricted cases it must not
   lift); `adminRemoveCasinoSlot` / `resubmitCasinoYaml` → `finaleSeatGold` and
   `cardsToSlots` (*"leaves the ordinary gold line untouched by default"*) plus the
   new `repickPool` (*"leaves an ordinary seat's pool untouched"*);
   `tickGuildmasterMissions` → `shouldDeploy` / `finaleEntryClosed` (*"never claims
   an ordinary table has closed"*); `deployMission` → `pickNextCasinoGame`.
3. **The economy** — ✅ **DONE**. `npm run econ` is clean and, as predicted, does
   not model the finale: it iterates `CASINO_GAME_ORDER`, and its whole model is
   ante-in / pot-out, while the finale antes nothing, has no pot and pays a closed
   form off stars. Rather than compute the figure by hand once, it is now
   **`npm run econ:finale`** (`scripts/econFinale.ts`), 40k sittings a cell off the
   live engine — best of three rows, three weakest reels respun:

   | cards kept | Purist | Unconsoled | Indie | Safety |
   |---|---|---|---|---|
   | 1 | 110g | 100g | 100g | 90g |
   | 2 | 165g | 150g | 150g | 135g |
   | 3 | 217g | 199g | 199g | 180g |
   | 4 | 261g | 242g | 242g | 223g |
   | 5 | 291g | 266g | 276g | 254g |

   **Season money-in = seats × expected payout**, and at 20 seats that is roughly
   **2,000g** if everyone keeps one card, **~4,000g** at three, **~5,800g** if
   every seat keeps all five on the best deck. The rebuy is the only money-out and
   is deliberately not modelled — a fold is a judgement call, not a rate, and
   assuming one would understate the exposure.

   > **The ceiling is set by the floor's appetite for Archipelago, not by the
   > code.** Keeping a card *is* agreeing to play it, so the keep-count column is
   > the real variable and nothing in the system caps it. Note also that keep-1
   > pays a flat 110g on Purist: across 15 cards, best-of-three-rows, a 5★ is
   > essentially always available, so the floor of the advertised 60–300g range is
   > reachable in theory and almost never in practice.
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
| **Before the finale opens** | ~~WS-F~~ ✅, ~~G~~ ✅, ~~I~~ ✅. (~~H~~ ✅ — shippable any time.) **All code is in; WS-J's rehearsal is what is left.** |
| **Before the host touches it** | WS-J's rehearsal, in a draft season — WS-J's *rehearsal season* block is how one is stood up, including the two ordering traps (alpha-list the accounts; seed the ordinary tables first). |
| **Before the deadline fires** | season → `closing`, so no replacement cohort spawns (§0.7). |
| **After the deadline, until the finale SETTLES** | season stays `closing` — **do not archive it**. Per D9 the finale runs past the season's end, and an archived season is frozen (`season.writable`), so archiving first would lock the host out of generating the room, running Sync, and settling the table. It also means the finale's **Coat of Many Colors credit only lands at that settle**, since `completeMission` is what grants it. `tickableSeasons` includes `closing`, so everything keeps running meanwhile. |

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
