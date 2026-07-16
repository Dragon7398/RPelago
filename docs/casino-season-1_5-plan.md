# Season 1.5 — "The RPelago Casino" Implementation Plan

Interim season between RPelago S1 and S2. Casino-only: no map, no orbs, no
XP/level/adventurers/feats. Players join casino tables (missions), play a card
game to commit slots, watch the room run its Archipelago games, and settle up
for gold — then repeat. The RPG layer returns in S2.

- Season id: **`casino_s1`**  ·  shell: **`casino`**  ·  status flow:
  `draft → active → closing → archived`.
- Season architecture (per-season path layout, config-driven shell, admin
  identity, rules) is specified in [season-architecture-plan.md](season-architecture-plan.md);
  this doc covers only what's casino-specific.

## Design source of truth

The UX, copy, tokens, and rules live in the design bundle at
`D:\My Documents\Claude Designs\RPelago Casino Season\`:

- `README.md` — screens, layout, design tokens, interactions (high-fidelity).
- `casino-midseason-handoff.md` — **authoritative** for scoring, game
  definitions, server-authoritative rules, data contracts, scaffolding to strip.
- `Casino Landing.html` (primary), `Casino Slot Fill.html`, and two reference
  brainstorm HTMLs.
- `landing/` (new landing prototype code, `rl-`/`mp-`/`st-` scoped) and
  `casino/` (the S1 runtime the prototypes reuse).

The HTML files are **design prototypes, not shippable code** — recreate them in
the React/TS app using existing patterns and the theme handler. Reuse the S1
card engine/model; do not reinvent it.

## Locked decisions (this conversation)

- **Gold model (floor, not stipend):**
  - Start every player at **200 GP**.
  - **Weekly top-up:** any player **below 100 GP** is set **to** 100 GP.
    Players at/above 100 get nothing — so the economy does not inflate.
  - **S2 seed:** `max(final S1.5 balance, 100)`; a player with no S1.5 record
    seeds at 200.
  - A non-gambler never drops below 100, keeps 200, and carries 200 into S2 —
    so no "participant" definition and no season-length dependency is needed.
  - **Risk is real and bounded:** win → carry >200; lose → floor at 100, worse
    than never having played, but never below 100.
- **Retuned numbers are FINAL and canonical** (become S2's casino baseline;
  S2 feats will modify them from the player's side but this is the floor).
- **Slot Fill interface:** Manifest.
- **YAML:** stored server-side in a **Firebase Storage bucket**;
  replace-before-lock allowed.
- **Coat of Many Colors** carries from S1; a casino re-earn path is an open
  question.
- **Seats never decay out.** A seat that has been **dealt in (played) is never
  removed by decay** — decay only lowers the table's max-slot bar (existing
  `currentMaxSlots` behavior), it must never kick a player. A seat where the
  player **never draws cards** may time out (the existing `startBy` deadline)
  and free the seat; nothing is forfeit since no ante was paid. **Admin can
  still kick** a participant from the mission.
- **Multiple concurrent tables, one game type each.** **Six** open at once
  (tunable). Each table is pinned to exactly **one** game type. The S1 model
  (a single gestalt "casino" mission with an in-table game selector) is
  **retired** — players choose a *table* (which determines the game) and still
  choose their own *deck variant*. This matches the design bundle's "Tonight's
  Tables" grid.
- **Spawn policy:** a replacement table's game type is rolled at random from
  the type(s) with the **fewest open tables** — so a type that hits zero is
  guaranteed to be next, and starvation is impossible.
- **Mission series numbering restarts each season**, for *all* mission types —
  a general rule going forward, not casino-specific. For the casino it is
  scoped **per game type**, assigned when the table opens.
- **Hold 'Em is the only two-sitting game.** Blackjack, Seven Card Stud, and
  Five Card Draw all resolve in a single sitting.
- **Hold 'Em community draw** is a Cloud Function that fires once the table is
  **at max slots** *and* **every seated player has locked their hole cards**
  (so the table is inherently closed to new entrants at that point). After the
  reveal, seats either play on (pay 50g, finish selection + gambit, lock,
  submit YAML/slots) or **fold** (forfeit the ante). **Folded seats stay
  empty** — a Hold 'Em table may deploy under its cap. **If all seats fold,
  the table resets** (participants cleared, seats un-decayed) but **keeps its
  pot**.
- **The weekly floor allows unlimited repeat free rolls** — accepted, with the
  casino audit log as the abuse mitigation. **Top-ups must therefore be
  logged** (see server-authoritative section).
- **Leaving a seat always frees `activeMission` immediately** — whether by
  active fold, `startBy` timeout, or admin kick. The player can take a seat at
  another table right away.
- **Coat of Many Colors:** granted retroactively to S1 players who bought one
  *or* finished S1 with **≥750 GP** (i.e. could have afforded it); earnable in
  S1.5 for free by **successfully completing a table of all four game types**
  (draw → lock → play the Archipelago → settle). See its section below.
- **Profile stats for S1.5:** final **gold**, **hands played**, and the same
  **games-played map** S1 already writes. `handsPlayed` is this season's
  "missions completed" — **folded hands do not count**. (Dropped the design's
  suggested "biggest win" / "season winnings" / "tables completed".)

## New casino content (all canonical — carries to S2)

> **Critical:** every item here must be built in the shared modules
> (`src/lib/casino*.ts` **and** `functions/src/casinoEngine.ts`, kept in sync),
> **not** in S1.5-specific throwaway code, because it is S2's permanent casino.

### Table model — multiple concurrent single-game tables

**This replaces S1's structure.** In S1 there was one "A Night at the Casino"
mission at a time, and the player picked poker-vs-blackjack *inside* the table
via a game selector. In S1.5:

- **Several tables are open simultaneously**, each rendered as a card in the
  landing's "Tonight's Tables" grid.
- **Each table is pinned to exactly one game type** (Blackjack, Five Card Draw,
  Seven Card Stud, or Texas Hold 'Em). The **in-table game selector is
  removed** — choosing a table *is* choosing the game.
- Players still choose their own **deck variant** (Purist / Unconsoled /
  Indie) per seat; that is unchanged.
- Each table independently rolls its own seats (5–8), `R`/`C` chances, hint
  cost, and starting pot at creation.

**Data model impact:** the mission gains a game-type field (e.g.
`casinoGame: 'blackjack' | 'five_card_draw' | 'seven_card_stud' | 'holdem'`).
`MISSION_DEFS`' single `casino` entry becomes either four defs or one def
parameterized by game type — the latter is cleaner, since seats/pot/odds are
rolled per table anyway and only cost + deal/lock rules differ by game.
`entryCosts` on the mission is then derived from that game type.

#### How many tables, and what spawns next

- **Six tables open at once** (`CASINO_OPEN_TABLES = 6` — tunable).
  > Because **S2 also has a casino** (this engine is its baseline) but as one
  > mission type among many rather than the whole season, six will likely be
  > the wrong number there. Make this **per-season config**
  > (`config/seasonList/{seasonId}/casinoOpenTables`) rather than a hardcoded
  > constant, so S2 can dial it down without a code change.
- **Spawn policy — least-represented wins, random tiebreak.** When a table
  closes (deploys) and a replacement opens, pick its game type **at random from
  the type(s) with the fewest currently-open (i.e. `forming`) tables**.
  - If a type just dropped to **zero** open tables, it is the sole minimum and
    is therefore **guaranteed** to be the next table opened — it always picks
    up the slack.
  - Otherwise the roll is restricted to types sitting at the minimum count
    (e.g. with 6 tables across 4 types the steady state is 2/2/1/1, so a
    replacement rolls only among the types at 1, never one at 2).
  - **Why this matters:** it makes starvation of a game type **impossible**,
    which is a hard requirement now that completing **all four** game types is
    what earns the Coat of Many Colors. A naive uniform-random spawn could
    starve a type and make the Coat unearnable through no fault of the player.
  - Count only **`forming`** tables when computing the minimum — deployed and
    completed tables don't occupy a slot.
  - The **all-fold reset** does *not* close a table (it returns to `forming`
    with its pot intact), so it does not trigger a replacement spawn.
- **Initial seed:** open 6 tables using the same min-count rule, yielding a
  2/2/1/1 spread with the doubled types chosen at random.

#### Series numbering

**Per game type**, assigned at the moment the table **opens** (not when it
deploys): "Blackjack · Cohort III", "Hold 'Em · Cohort I". Restarts at I each
season.

> Implementation note: derive this from a **persisted per-type counter**
> incremented in a transaction (e.g. `seasons/{id}/casinoSeries/{gameType}`)
> rather than scanning for the max existing `series` — with six tables spawning
> concurrently, a scan-and-increment is racy and will hand out duplicate cohort
> numbers.

**Also affected:**
- `seedInitialMissions()` must open **six tables across the game types** rather
  than one casino cohort, and `deployMission`'s spawn-on-deploy path must open
  the replacement using the min-count policy above.
- The season must declare **which mission types it offers** — S1.5 has no
  Basic Training or Patrol at all, only casino tables. Suggest
  `config/seasonList/{seasonId}/missionTypes` so seeding is season-driven
  rather than hardcoded to basic+patrol+casino.

### Game variants

S1 shipped **Five Card Draw** (poker) and **Blackjack**. S1.5 adds two, and
each becomes its own table type:

| Game | Cost | Deal | Pick | Reroll | Notes |
|---|---|---|---|---|---|
| Five Card Draw | 60g (+30g reroll) | 5 | ≤5 | yes | existing |
| Seven Card Stud | 75g | 7 | ≤5 | no | new — bigger pool, no reroll |
| Texas Hold 'Em | 30g ante + 50g play-on (80g total) | 2 hole + 5 shared community | ≤5 | no | new — two-phase, cohort-synced |
| Blackjack | 40g | push-your-luck | keep ≤5 | — | existing |

Costs replace the current family-keyed `CASINO_ANTE` (poker/blackjack) with a
**per-variant** cost model, including Hold 'Em's split ante + play-on. Mirror in
the server engine.

### Scoring (unchanged rule, applied to new variants)

- Reward = **plain Σ of committed card values** (no combos, no bust — `COMBOS`
  mult table stays all-1s).
- Net (`goldSwing`) = reward − `spentThisRoom` (antes + rerolls + play-on).
- **Purist deck** = +10% to that seat's own reward, rounded once
  (`Math.round(reward * 1.10)`), before subtracting spend. Never touches the pot.
- Pot splits **evenly among winning seats** at settle (`Math.floor(pot/winners)`).
- **"Best possible" — a UI-only display aid, NOT an engine concept.** This is not
  a new `maxValue` benchmark to add to the engine or persist on the mission — it
  is the existing Blackjack gauge (`BlackjackGauge` in
  `src/casino/TableComponents.tsx`), which shows "keeping Xg of Yg possible" where
  `Y` = the top-5-by-value sum of the cards the seat can currently see
  (`sorted.slice(0,5)`). It is computed on render, client-side only, and touches
  no reward/pot/gold math and no server code — so there is nothing to "guard"
  against wiring in.
  - It is meaningful **only for games that pick a ≤5 subset from a pool larger
    than 5**: Blackjack (keep ≤5 of a drawn pool), **Seven Card Stud** (≤5 of 7
    dealt), and **Texas Hold 'Em** (≤5 of 2 hole + 5 community). For these two new
    variants, **reuse the existing gauge** — generalize `BlackjackGauge` into a
    shared subset-selection gauge; do not reinvent it.
  - It is **meaningless for Five Card Draw** (you hold exactly 5 and commit ≤5;
    the optimum is trivially "keep all 5"), which is why the existing
    `PokerReadout` shows no such benchmark. Leave it that way.

### Texas Hold 'Em — the genuinely new flow

This is the highest-risk item; S1's flow is fully per-seat with no mid-round
barrier. **Hold 'Em is the only game requiring two sittings** — Blackjack,
Seven Card Stud, and Five Card Draw all play in a single sitting (lock →
`played: true`, exactly as in S1).

The whole two-phase sequence happens **within `forming`**, before deploy —
`gmShouldDeploy` already gates casino deploy on every seat having
`played: true`, so the community phase must complete before a seat is `played`.

**Sitting 1 — hole cards**
1. Seats ante 30g, get 2 hole cards, and lock them (`holeLocked: true`).
2. Seats are never decayed/kicked out to force this; a player who never draws
   at all times out via `startBy`, freeing the seat with nothing forfeit.

**Community draw** (Cloud Function) — fires when **both** conditions hold:
- the table is **at max slots** (`filled === currentMaxSlots`, which accounts
  for decay), **and**
- **every seated player has locked their hole cards**.

Because the trigger requires a full table, the table is inherently **closed to
new entrants** at draw time — no late joiner can miss the hole-card phase.

The function draws 5 **shared community cards** from a Purist deck: **1 truly
random card, then one each of Broad / Narrow / Franchise / Platform — no
duplicates.** Community cards stay available to every seat regardless of who
"uses" them.

**Sitting 2 — after the reveal**, each seat chooses one of:
- **Play on:** pay the 50g play-on, finish selecting ≤5 cards from their 2 hole
  + 5 community (fewer/lower allowed), pick their gambit, lock in, and submit
  YAML + slots. Sets `played: true`.
- **Fold:** with a warning that they **forfeit their entry** (the 30g ante is
  simply not refunded — 40% already went to the pot, the rest was house take;
  no additional gold moves). The seat is then **left empty** — it is *not*
  reopened for claiming.

**Consequences of folding:**
- A Hold 'Em table can therefore **deploy with fewer players than its cap** if
  players dislike the draw. This is intended.
- **If *every* seat folds** (extremely unlikely), the table **resets to its
  beginning state**: clear all participants, **un-decay all seats**
  (`firstJoinAt → null`, so max slots return to `baseMax`), clear the community
  cards and per-seat hole/lock state — but **retain the pot** accumulated from
  the forfeited entries so far. The table re-opens richer than it started,
  which makes it more attractive on the next go-round.

**New state/logic required** (none of this exists in the S1 callables):
- per-seat `holeLocked` flag and stored hole cards;
- a cohort synchronization check (full + all `holeLocked` → draw community);
- the shared-community draw function (Purist, 1 random + 4 typed, no dupes);
- a second per-seat lock phase (play-on payment + final selection + gambit);
- a **fold-after-reveal** path that empties the seat without reopening it;
- an **all-fold table reset** that preserves the pot.

### Economy tuning (final)

- **40% of every fee feeds the pot** (unchanged ratio).
- **Seats per table:** 5–8 (random).

**`R` and `C` are the table's rolled Release % and Collect % *chances*** — not
the boolean on/off outcome. This is the key distinction: the *chances* are
rolled once at **table creation**, and both the hint cost and the pot bonus are
seeded from them. The actual On/Off is rolled **against** those chances later,
at **room creation** (the Seated → In-progress transition).

**At table creation:**

1. Roll `R` = Release chance, **40–70%** in 5% steps.
2. Roll `C` = Collect chance, **25–50%** in 5% steps.
3. **Hint cost** = `(R + C) / 10`, **rounded to nearest 0.5**, expressed as %.
   Range: 6.5% (40+25) → 12% (70+50).
   *Rationale: higher hint cost is harder, so tables with generous Release/
   Collect chances are made costlier to hint — a balancing push so high R/C
   isn't universally better.*
4. **Initial pot** = `10 + seats×10` (50–90) **+** difficulty bonus
   `randInt(0, 150 − R − C)`.
   Bonus range: `randInt(0, 85)` at the easiest odds (40+25) down to
   `randInt(0, 30)` at the most generous (70+50) — never negative.
   *Rationale: lower Release/Collect chances (a harder room) pay a bigger pot.*

This replaces the constant `CASINO_POT_SEED` — `gmFreshMission` must compute
the pot **dynamically at table creation** from the rolled seats + R + C, and
persist `R`/`C` on the mission so room creation can roll against them.

**At room creation (deploy):** roll Release On/Off against `R`, Collect On/Off
against `C`. Before that, the UI reads "to roll."

## Player-facing app (the new landing)

Rendered when `activeSeasonId`'s shell is `casino` (see architecture plan's
"Season shell type"). Recreate the design bundle's Landing faithfully.

- **Two persisted views:** Lounge (default, cozy) and Floor (sleek) — toggle to
  `localStorage`.
- **Current-table phase panel** (single panel, phase is backend-owned):
  - **Seated/forming** — locked hand/committed take (game-aware), on-the-table
    stake, rolled odds, seats filled/played, roster, Return to Table / Leave.
  - **In progress** — the **Board**: X/Y slots goaled + meter, room telemetry
    (Release/Collect On/Off, hint %, elapsed), your games in a gold-outlined
    section above the rest of the table, per-game status pills.
  - **Settled** — the **Ledger**: per-seat games (card-typed chips + goal
    ticks) and Hand / Pot / Entries / **Net**; your row + winner highlighted.
- **Table cards / mission log** — felt-topped cards; while Seated or In
  progress, all other tables' buttons disable ("Seated elsewhere") and dim.
- **Modals:** Profile (gold, won this season, hands played, biggest win, tables
  completed, name-color swatches, external profile link — no XP/adventurer),
  Settings (4-theme switcher), The Games (reference), Leave-seat confirm, Sit
  flash.
- **Activity feed:** kept as a feature, but **not always visible** — a small
  **icon in the top bar** opens it (alongside ♠ Games / ☺ Profile / ⚙ Settings).
  **No unread badge** for S1.5: players are far less affected by each other's
  activity in a casino season than on the shared map, so a badge would be noise.
  Backed by the existing per-season `activityLog` (still pruned to 25 by
  `pruneActivityLog`).
- **Slot Fill (Manifest):** post-lock step; Mission Manifest grid on top with
  **Attach config (.yaml)** that parses each world's `name`+`game` in-browser
  (via the reusable `parseApYaml`; weighted game → `Randomized`) and prefills
  slots in order; list rows below with category badge, optional slot name,
  required free-text game (`<datalist>` autocomplete). Surfaces broken-file and
  wrong-world-count warnings (see YAML section). Submit disabled until every card
  has a game.

Phase (`Seated → In progress → Settled`) maps to mission state
(`forming → inprogress → complete`). Existing `activeMission` on the player
already enforces one-table-at-a-time (server side of the seat lock).

## 🔴 Deck and hand must move out of the season tree

**Confirmed by the rules test suite:** the existing `.read: false` on
`participants/$p/deck` is an **inert no-op** — the ancestor `game` node grants
`.read: true`, and RTDB read rules cascade downward. **Anyone, unauthenticated,
can currently read the draw deck and every player's hand.**

For a season that *is* the casino, this is existential: knowing the remaining
deck lets a player engineer their hand and take the pot deterministically.

The fix relocates the secrets out of the publicly-readable season tree:

```
seasonSecrets/{seasonId}/missions/{missionId}/participants/{uid}/
  deck   → .read: false                  (Admin SDK bypasses rules)
  hand   → .read: "auth.uid === $uid"    (owner-only, session recovery)
```

**Applies to the new Hold 'Em work too:** hole cards are a secret and belong in
`seasonSecrets`. The **community cards are public** (they're shared by the whole
table) and stay on the mission in the season tree.

Full rationale, and the rule that "if it must not be public, it cannot live
under `seasons/{id}/`", is in the
[architecture plan](season-architecture-plan.md#-secrets-must-live-outside-the-season-tree).

## Server-authoritative work (must not trust the client)

- **Seat locking** — reject a join while the player has an `activeMission`
  (already the pattern; extend messaging).
- **Leave / forfeit** — NEW. Free stand-up if no cards dealt or folded; if
  dealt in (wager on the table), **forfeit the wager** (stays in pot). S1's
  `standDownFromMission` only works while forming and moves no gold — this is a
  new server transaction.
- **Per-seat settle ledger** — NEW. Compute `handValue`, `potShare`, `entries`,
  `net` per seat at completion; this is where gold actually moves. Must be
  idempotent (mission completion fires once). S1's `onMissionComplete` writes
  profile counters but no economic settlement.
- **Weekly gold floor top-up** — NEW. Scheduled function: set any player below
  100 GP **to** 100 GP; leave everyone else untouched. Like
  `tickGuildmasterMissions`, a scheduled function is **season-blind** (no
  `event.params.seasonId`) and must resolve the active season explicitly —
  and should no-op unless that season's shell is `casino`.
  - **The top-up must be written to the audit log.** Accepted design: a player
    parked at the 100 GP floor can lose a hand each week and be topped back up
    — a perpetual weekly free roll. That's the intended safety net, and the
    casino audit is the mitigation for anyone farming it to pump gold into the
    system. But today's `casinoLog` only records *intra-table* movement
    (`deal | reroll | gambit | lock | fold`); **the top-up is the only place
    gold enters the economy from outside, so if it isn't logged the audit
    cannot see the very thing it exists to catch.** Add a top-up event
    (uid, amount granted, resulting balance, timestamp) to the audit trail and
    surface it in the admin view.
- **Fold-after-reveal / all-fold reset** — NEW (Hold 'Em; see above). Folding
  forfeits the ante (no refund, no extra movement); an all-fold table resets
  and **keeps its pot**. Both are server-side transactions.
- **Leaving always frees the seat immediately.** Active fold, `startBy`
  timeout, and admin kick all clear `players/{uid}/activeMission` in the same
  atomic update, so the player may sit at another table at once. (Note this
  differs from S1's tile/mission kick, which created a *claimable slot*;
  folded casino seats are simply left empty and are **not** reopened.)
- **Seat timeout vs. decay** — a **played** seat is never removed by decay;
  decay only lowers the max-slot bar. Only a never-dealt seat times out (via
  `startBy`), freeing the seat with nothing forfeit. Admin kick remains
  available.
- Dealing, odds roll, community draw, reward/pot math — all server-side; client
  sends intent only.

## YAML upload — Firebase Storage bucket (decided)

Netlify hosts the static site only; it is **not** a writable upload store. YAML
goes to a **Firebase Storage bucket** (not currently set up — needs enabling).

- **Path:** `casino/{seasonId}/{missionId}/{uid}.yaml` — one object per seat,
  overwritten on replace.
- **Storage rules:** write restricted to the owning authenticated player, and
  only while their seat is unlocked (replace-before-lock); read restricted to
  admin + owner. **Not public.**
- **Size cap:** ≤64KB, enforced in the Storage rule (`request.resource.size`),
  not just client-side.
- **Content type:** accept text/YAML only; reject anything else at the rule.
- Client parses the YAML **in-browser** to prefill the Manifest slots via the
  **reusable `src/lib/apYaml.ts` parser** (`parseApYaml`), which is deliberately
  *not* casino-specific — S2 challenges/missions reuse it. It extracts `name` +
  `game` per world, splits multi-world files on `---`, and is tolerant of the
  messy formatting (incl. **duplicate keys**) real AP YAMLs carry: a broken
  document is skipped and reported, never fatal to the file. The upload is for
  *your* later download/clean/process-locally workflow, not for server-side
  parsing.

  > **Weighted game selection → `Randomized` (not highest-weight-wins).** When a
  > world's `game` is a weighted map, the parser resolves it to a single game
  > only if exactly **one** option has weight > 0; with **two or more** viable
  > options (or none) it sets the game name to the sentinel `RANDOMIZED_GAME`
  > (`"Randomized"`) and flags `randomized: true` + `candidates: [...]`. We can't
  > know which game AP will pick, and in a casino season a randomized pick can be
  > the difference between a valid and invalid YAML — so it must be surfaced, not
  > guessed. Detect via the `randomized` flag, not by string-matching the name.

- **Machine validity is intentionally minimal — everything else is manual.** Many
  validity rules need human judgment or an actual AP generation (e.g. how many
  checks a YAML produces), which is out of scope for the site. The site only
  flags files that look **outright broken** (parse errors / missing `game`, from
  `parseApYaml`'s `errors`) and a **wrong world count** (`checkWorldCount`):
  exact match to the seat's locked-card count for the casino; a 1–5 range for a
  typical non-casino challenge/mission. These are **warnings**, not hard blocks —
  the operator hand-verifies every file. Submit is gated only on every card
  having a game filled in.

YAML is inert text (never executed on our side) — the concern is storage
hygiene and access scoping, not code execution.

## Coat of Many Colors

The name-color unlock is the one cosmetic that spans seasons.

**Retroactive grant from S1** (one-time migration script, run against the
archived S1 season data):

> Grant the Coat to any S1 player who **either** purchased one, **or** finished
> S1 with **≥ 750 GP** — i.e. could have afforded it at the 750 GP shop price.

This runs once at migration time and writes the unlock onto the player's S1.5
record (and it carries on into S2).

**Earning it in S1.5** — free, by **successfully completing a table of all four
game types**: Blackjack + Five Card Draw + Seven Card Stud + Texas Hold 'Em.

"Successfully complete" = the full loop: **draw cards → lock in → play the
Archipelago that spawns from the table → the table settles.** Concretely, the
player must be a participant with `played: true` on a mission that reaches
`complete`. A folded seat does **not** count; neither does a timed-out or
kicked seat.

This requires tracking a **per-player set of completed game types** for the
season (e.g. `players/{uid}/casinoGamesCompleted: { blackjack: true, ... }`),
written at table settle. When the set reaches all four, grant the Coat.

The spawn policy above guarantees no game type can be starved, so this is
always achievable.

## Profile-site changes (needs its own handoff)

Confirmed shape — deliberately minimal, reusing what S1 already writes:

```
profiles/players/{uid}/events/casino_s1/
  gold:        <final gold balance at season end>
  handsPlayed: <count of tables successfully completed>
  games:       { <encodedGameName>: true, ... }   # same map S1 writes
```

**`handsPlayed` is this season's analogue of S1's "missions completed."** It
counts only tables the player **successfully completed** — a **folded hand does
not count** (nor does a timed-out or kicked seat), even though an ante was paid
and cards were dealt. Since one seat = one hand per table, `handsPlayed` is
effectively "tables completed," incremented once at settle for each participant
with `played: true`.

That makes it the **same trigger and same predicate** as the Coat's
`casinoGamesCompleted` tracking — both are written by the settle function on
mission `complete`, for exactly the participants who played. Implement them
together.

Dropped from the design's suggestions: `biggestWin`, `seasonWinnings`,
`tablesCompleted` (the last being redundant with `handsPlayed`). The `games`
map reuses S1's existing normalization + `encodeURIComponent` keying, and
`firstEvent` follows the existing "only set if not already claimed" rule.

The settle function writes these; the separate profile site must render a
casino-flavored event card (no XP/level/adventurers). **Action:** produce a
dedicated profile-changes handoff doc covering this event shape before wiring
the settle function, so both sides agree.

## Prototype scaffolding to strip (do not ship)

Per the handoff: in-browser Babel + `window`-global wiring, concept/phase
switcher pill bars, the Tweaks panel, all mock data (`landing/*data*.js`),
unused `TableRow`. Keep and translate: the `rl-`/`mp-`/`st-` CSS, component
structure, copy/tone, theming hooks, and interaction rules.

## Suggested build order

1. Season architecture migration (arch plan steps 1–4) — path builder, config,
   rules, admin identity. Prereq for everything.
2. Canonical casino engine additions in `src/lib/casino*.ts` +
   `functions/src/casinoEngine.ts`: per-variant costs, Seven Card Stud, dynamic
   pot seed, retuned odds. Unit-verify scoring. (No "best possible" work here —
   it's a UI-only gauge handled with the table UI in step 5, see Scoring.)
3. Texas Hold 'Em cohort sync + shared community-draw function (highest risk;
   do while engine context is fresh).
4. Server-authoritative leave/forfeit + per-seat settle ledger + weekly gold
   floor top-up.
5. Casino landing shell (config-driven root), phase panel, table cards.
6. Slot Fill (Manifest) + YAML storage.
7. Profile settle writes + profile-site handoff.
8. Launch flip (arch plan step 7).

## Admin: the Casino tab

A **new variant of the existing Missions tab** with casino details integrated —
open tables, pot sizes, seat rosters, per-seat state, and the audit trail
(including the new **gold top-up events**, without which the audit can't see
money entering the economy).

- **For S1.5:** the Casino tab is shown; the generic **Missions tab is hidden**
  (there are no non-casino missions). Map / Orbs / Shops tabs are hidden too.
- **Going forward this split is permanent:** S2 gets **Challenges · Missions ·
  Casino** as separate tabs, with casino missions living **entirely** in the
  Casino tab and all other missions in the Missions tab. Build the split now
  rather than special-casing S1.5.

Full tab-visibility matrix, plus the deprecation status of Orbs and Shops, is in
the [architecture plan](season-architecture-plan.md#admin-dashboard--season-driven-tabs).

## Season wind-down

S1.5 follows the **same wind-down S1 used** — no cancel/refund logic:

1. Season set to `closing` → **no new tables spawn**.
2. Existing tables with players **still fill and deploy** (decay lowers max
   slots until it meets the fill count, so any table with ≥1 participant
   auto-deploys). Tables with **zero** participants are simply deleted.
3. All deployed tables **play out and settle**. The season is not `archived`
   until every one has completed.
4. Only then does S2 open.

So **no ante is ever refunded** — a player who paid always gets their table
played out. Hold 'Em is safe too: its community draw fires against *decayed*
max slots, so a partly-filled table still reaches its draw as decay closes the
gap. The **S2 gold bulk-seed must run only after S1.5 fully settles.**

## Open questions (casino-specific)

The casino design is **fully specified** and there are **no open questions
remaining**. The profile-site handoff is written:
[profile-site-handoff.md](profile-site-handoff.md).

- ✅ **Weekly top-up cron anchor** — resolved: **Saturdays 06:00
  `America/Chicago`**. Implemented in `weeklyGoldTopUp`
  (`onSchedule({ schedule: '0 6 * * 6', timeZone: 'America/Chicago' })`).
