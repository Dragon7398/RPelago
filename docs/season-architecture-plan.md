# Multi-Season Architecture Plan

## Problem

Season 1 is wrapping up (last mission cohorts finishing), and we need to start
building Season 2 and an interstitial "offseason" (Season 1.5) *before* S1 is
fully closed out — without:

1. Leaking S2/offseason content (tiles, missions, challenges) to current
   players while it's still being drafted.
2. Disrupting S1 while it finishes.
3. Losing the player identity / cross-season history we already have
   (`profiles/`).

This document lays out a plan that avoids a full bucket-per-season split
(new Firebase project, or new top-level root swapped by hand), because that
approach cascades into every Cloud Function trigger and would need to be
redone from scratch for every future season and every offseason. Instead it
introduces one reusable "season" concept, paid for once.

## Current state (as of this writing)

- **`game/` is a single hardcoded root.** The literal string `'game/...'`
  appears as an inline path in ~30 places in [src/firebase/db.ts](../src/firebase/db.ts),
  ~10 more across [GameStateContext.tsx](../src/contexts/GameStateContext.tsx)
  and the casino components, and 40+ times in
  [functions/src/index.ts](../functions/src/index.ts) — including every DB
  trigger's path pattern (`onTileComplete`, `onOrbAcquired`,
  `pruneActivityLog`) and every callable (`purchaseShopItem`, `enlistInMission`,
  the casino callables, etc). There is no central constant or path builder.
- **`database.rules.json` grants `.read: true` on the entire `game` node**,
  unauthenticated. Anything written under `game/` — including a draft S2 map
  — is visible to anyone who opens devtools or hits the RTDB REST endpoint
  directly, regardless of what the UI shows. This is the actual spoiler risk,
  not just UI routing.
- **`profiles/`** is already a separate top-level root, world-readable, keyed
  by Discord-derived `uid`, and **already anticipates multiple seasons**:
  `onTileComplete` in functions/index.ts writes to
  `profiles/players/{uid}/events/rpelago_s1/{xp,tiles,games}` and sets
  `firstEvent: 'rpelago_s1'` the first time a player scores. `'rpelago_s1'`
  is a hardcoded string literal in one place — this is the natural precedent
  to formalize into a real season id.
- **Season boundaries are currently a hand-flipped boolean**,
  `MISSIONS_CLOSED_FOR_SEASON`, duplicated between
  [src/lib/constants.ts:335](../src/lib/constants.ts) and
  [functions/src/index.ts:672](../functions/src/index.ts) with a comment
  warning it must be kept in sync by hand. This works for a single on/off
  switch but doesn't generalize to "which season is this write for."
- **`initializeGameIfNeeded()`** ([src/firebase/db.ts:32](../src/firebase/db.ts))
  already contains the full "bootstrap a fresh game" routine (seed, tiles,
  players, orbs, shops, initial mission cohorts) — this becomes the season
  creation routine, just needs to target a season-scoped path.

## Proposed architecture

### Path layout

Replace the single `game/` root with:

```
seasons/
  {seasonId}/              "rpelago_s1", "casino_s1", "rpelago_s2"
    meta/                  (same shape as today's game/meta)
    tiles/                 (map seasons only — omitted for the casino season)
    players/
    orbState/              (map seasons only)
    orbConfig/             (map seasons only)
    shops/                 (map seasons only)
    missions/
    missionsHistory/
    activityLog/
    notifications/
  config/                      # PUBLIC unless noted
    adminId: "<uid>"                       # global admin, was game/meta/adminId
    activeSeasonId: "casino_s1"   # what the public site renders
    minClientVersion: <n>                  # version gate (forced reload)
    seasonList: {                          # PUBLIC — live/archived seasons ONLY
      rpelago_s1:          { label, shell: "map",    status: "archived" },
      casino_s1:  { label, shell: "casino", status: "active"   },
    }
    draftSeasons: {          # PRIVATE — admin + alpha read only
      rpelago_s2:          { label, shell: "map" },
    }
    alphaUsers: { "<uid>": true }          # PRIVATE — admin + alpha read only

seasonSecrets/               # NO read/write grant at any ancestor (see below)
  {seasonId}/missions/{missionId}/participants/{uid}/
    deck                     # .read: false        — nobody, not even the owner
    hand                     # .read: own uid only — session recovery

profiles/                  # unchanged — already season-agnostic, already
  players/{uid}/events/{seasonId}/...   # 'rpelago_s1' becomes the first seasonId
  handleIndex/
```

`seasonId` replaces the hardcoded `'rpelago_s1'` string and becomes a real,
enumerable value. Confirmed ids for the first three seasons:
`rpelago_s1` (archived), `casino_s1` (the interim Casino season),
`rpelago_s2`.

Each season entry carries a **`shell`** (`"map" | "casino"`) that tells the
client which root UI to render (see "Season shell type" below) and a
**`status`** that drives read access and mission behavior
(`"draft" | "active" | "closing" | "archived"`).

## 🔴 Secrets must live OUTSIDE the season tree

**Confirmed by the rules test suite (2026-07-13):** the casino's deck/hand
secrecy rules are **inert no-ops**, and the draw deck plus every player's hand
are readable **by anyone, without authentication**.

**Why.** `database.rules.json` sets `.read: false` on
`game/missions/$m/participants/$p/deck` (and owner-only on `hand`) — but the
ancestor `game` node sets `.read: true`. **Firebase RTDB read/write rules
cascade downward: a grant at a shallower node cannot be revoked by a deeper
one.** The child rules never take effect.

**Impact.** Any visitor can read the remaining draw deck, know exactly what the
next card will be, engineer their hand to maximize committed card values, and
take the pot deterministically — and can read opponents' hands. In S1 the casino
was one mission type; **in S1.5 it is the entire season**, so this is
existential and must be fixed before launch.

**The fix is architectural, not a rule tweak.** The season node *must* stay
world-readable (the game state is public), and **anything beneath a readable
node is readable**. Patching by granting `.read` field-by-field below
`participants` would be fragile — every new field would need a rule, and
forgetting one silently exposes it. Secrets therefore cannot live in the season
tree at all. Move them to a sibling top-level node with **no permissive
ancestor**:

```
seasonSecrets/{seasonId}/missions/{missionId}/participants/{uid}/
  deck: [...]     # .read: false — Cloud Functions use the Admin SDK, which
                  #   bypasses rules entirely, so they retain full access
  hand: [...]     # .read: "auth.uid === $uid" — owner-only, for session recovery
```

- `seasonSecrets` gets **no `.read`/`.write` at its root** — only the specific
  leaf grants above. Nothing above them ever grants read.
- **All writes stay server-side** (the casino callables already write these via
  the Admin SDK; no client ever writes a deck or hand).
- The client reads only its **own** `hand`, exactly as `CasinoTable.tsx` does
  today — just from the new path.
- Follow the same discipline for **any** future secret: if it must not be public,
  it cannot live under `seasons/{id}/`.

**Regression guard:** `tests/rules/database.rules.test.ts` holds three tests
that are **red on purpose** until this lands. They must go green — and the
existing "owner may read their own hand" test (which currently passes for the
*wrong* reason, because everyone can read it) must **stay** green.

> **Live-exposure question for S1:** the deck is nulled at deploy and cleared at
> lock, so the exposure window is a casino table that is **`forming` with hands
> already dealt**. If any such table is still live in S1 right now, it is
> exploitable today — worth checking before the season finishes.

### Read-access model (fixes the spoiler leak)

**Implemented** in `database.rules.json`, proven by
`tests/rules/seasons.rules.test.ts`.

The rule is: **a season is publicly readable if and only if it has an entry in
`config/seasonList`.** Draft seasons are deliberately *absent* from that public
list — they're described in the private `config/draftSeasons` instead. So a
player cannot even **discover** that an unlaunched season exists, let alone read
it. One rule covers all seasons; a launch is a single data write, not a rules
deploy.

| Season status | In public `seasonList`? | Read | Player writes |
|---|---|---|---|
| `draft` | **no** (in `draftSeasons`) | admin + alpha only | admin + alpha (playtest) |
| `active` | yes | public | yes |
| `closing` | yes | public | yes (in-flight missions finish) |
| `archived` | yes | public | **no** — frozen, admin only |

Concrete state at Casino-season launch: `rpelago_s1` → `archived`,
`casino_s1` → `active`, `rpelago_s2` → draft (unlisted). Launching S2
later is one write: add its `seasonList` entry and flip `activeSeasonId`.

**The `!initialized` bootstrap loophole is gone** in the new tree — there is no
path by which a non-admin can write `seasons/{id}/meta`, including for a season
that doesn't exist yet.

### Admin identity

Today, admin is `game/meta/adminId`, checked inline everywhere
(`root.child('game/meta/adminId').val() === auth.uid`). Per-season admin
would be awkward (who's admin of a season that doesn't exist yet?). Move
admin identity to `config/adminId` — a single global admin, independent of
season — and update every rule reference and every `gameState.meta.adminId`
comparison in the client accordingly. This is a small, mechanical, one-time
change but touches every rule block and any component that reads
`meta.adminId`.

**Seeding it, and closing the current loophole.** `config/adminId` is written
**once by the migration script** via the Admin SDK (which bypasses rules), so
there is no first-writer bootstrap. The rule is then simply "only the current
admin may change `config/adminId`."

This lets us **delete the client-side auto-init path entirely**
(`initializeGameIfNeeded()`, which runs on every client auth) along with the
DB rule loophole that currently allows *any* authenticated user to write
`game/meta` while `!initialized`. Season creation becomes an explicit admin
action, never something a client can trigger.

### Alpha users (draft-season playtesting)

`config/alphaUsers/{uid}: true` — an allowlist that can **read *and write*** a
draft season alongside the admin. The draft rule becomes "admin **or** alpha
user" rather than admin-only.

Alpha users **playtest**, not merely preview: joining and leaving missions, and
sometimes completing one, exercised as a *player* rather than as admin. Draft
data is expected to get dirty and is **wiped manually before launch**.

> ### ⚠️ Draft playtesting must not pollute `profiles/`
>
> This is the sharp edge of allowing alpha writes. Season data lives under
> `seasons/{id}/` and is easy to wipe — but the Cloud Functions triggered by
> those writes reach **outside** the season node:
> `onTileComplete` / `onMissionComplete` write
> `profiles/players/{uid}/events/{seasonId}/...` **and set `firstEvent`**.
>
> A test mission completion in draft S2 would therefore write real profile
> stats, and could permanently claim `firstEvent: 'rpelago_s2'` — a sticky,
> wrong value that a season-node wipe does **not** clean up.
>
> **Requirement:** every function that writes to `profiles/` must **no-op when
> the triggering season's `status` is `draft`.** Gate the profile write on
> season status, not just on the season existing. Without this, alpha
> playtesting silently corrupts real player history.

### Keymaster's Keep — global, fully decoupled

KMK is **not** season-scoped. Its lists are global content, its events may be
entirely unrelated to RPelago seasons, and it becomes **its own route,
independent of the active season's shell** — so it's reachable during the
casino season and every season after, with no shell coupling.

Note the current code does **not** match CLAUDE.md here: KMK lives at a
**top-level `kmkEvents/`** node (see `src/firebase/db.ts` and
`src/contexts/KmkContext.tsx`), not at `game/kmkLists/` as CLAUDE.md:257
claims. Only its *active-list pointer* sits in the game tree, at
`game/meta/kmkActiveListId`.

**The single active-list pointer is removed entirely.** Lists come and go, and
**multiple lists may be active at once** — so activation becomes a property of
each list rather than a global pointer:

- Add **`active: boolean`** to `KmkList`. Admin toggles a list active/inactive.
- **Delete** `game/meta/kmkActiveListId` and the `kmkActiveListId` field on
  `GameMeta` (`src/types/index.ts:136`).
- `KmkContext` stops subscribing to the pointer and instead derives the active
  set from the flag; the KMK UI must handle **several simultaneously-active
  lists** rather than "the" active one.
- `kmkSetActiveList(listId)` becomes `kmkSetListActive(listId, active)`.
- Rules: `active` is admin-writable only; `root.child('game/meta/adminId')` →
  `root.child('config/adminId')`.
- One-time migration: set `active: true` on whichever list the old
  `kmkActiveListId` pointed at, `false` on the rest.

**Net result:** after this, KMK has *zero* references into the game/season tree
— its only remaining tie to the rest of the system is the shared `config/adminId`.

### Cloud Functions: wildcard the season out of trigger paths

DB-triggered functions currently bind to a fixed path at deploy time:

```ts
onValueWritten('game/tiles/{coord}/state', ...)
onValueCreated('game/orbState/{orbId}', ...)
onValueCreated('game/activityLog/{entryId}', ...)
```

Change these once to:

```ts
onValueWritten('seasons/{seasonId}/tiles/{coord}/state', ...)
onValueCreated('seasons/{seasonId}/orbState/{orbId}', ...)
onValueCreated('seasons/{seasonId}/activityLog/{entryId}', ...)
```

and use `event.params.seasonId` inside the handler to build every subsequent
path (e.g. `onOrbAcquired` currently reads `game/meta` and
`game/tiles/{bossCoord}` — both become `seasons/${seasonId}/meta` and
`seasons/${seasonId}/tiles/${bossCoord}`). This is the key move that avoids
redeploying functions per season: one deployed trigger fires for writes to
*any* season, past or future, and simply operates on whichever season the
write happened in. `onTileComplete` additionally needs to write
`profiles/players/{uid}/events/{seasonId}/...` instead of the hardcoded
`rpelago_s1` — `seasonId` is now available from `event.params` for free.

Callable functions (`purchaseShopItem`, `purchaseShopOrb`, `enlistInMission`,
`standDownFromMission`, `claimMissionSlot`, all casino callables,
`adminForceDeploy`, `adminKickMissionParticipant`, etc.) aren't path-triggered,
so they need the client to pass `seasonId` explicitly in the request payload,
validated server-side against `config/activeSeasonId` (or the admin's
`draftSeasonId` for admin-only actions on a draft season) so a stale client
can't write into the wrong season.

### Client: a season-aware path builder

Introduce one helper, e.g. `src/firebase/season.ts`:

```ts
export function seasonRef(seasonId: string, path: string) {
  return ref(db!, `seasons/${seasonId}/${path}`);
}
```

and thread the active `seasonId` through `GameStateContext` (read once from
`config/activeSeasonId`, or from an admin toggle if the admin is previewing
the draft season). Every call site in `db.ts` that currently does
`ref(d, 'game/...')` gets rewritten to `seasonRef(seasonId, '...')`. This is
mechanical but touches every function in `db.ts` (~30 call sites) and the
handful of direct `ref(firebaseDb!, 'game/...')` calls in
`GameStateContext.tsx` and the casino components (`CasinoTable.tsx`,
`TableComponents.tsx`).

`subscribeToGame()` changes from a single `onValue(ref(d, 'game'), ...)` to:
first resolve `activeSeasonId` (and, for an admin viewing a draft, optionally
`draftSeasonId`), then subscribe to that season's node. The admin dashboard
gets a season switcher (view the live season / preview the draft season)
instead of always looking at "the" game.

### Season shell type (config-driven root UI)

Confirmed direction: the app's **root UI is chosen from the active season's
`shell` field**, not compiled in. Today `index.html → src/main.tsx` always
mounts the map game. Change `src/main.tsx` (or a thin `<SeasonShell>` it
renders) to branch:

- `shell: "map"` → the existing map/tile/orb/mission app (S1, S2).
- `shell: "casino"` → the new Casino landing app (S1.5) — no map, no orb bar,
  no XP/level/adventurer/feat UI; just the casino landing described in the
  Casino-season plan.

This keeps one deployed frontend serving every season and makes S2's return
to the map a data flip, not a redeploy. The existing casino **table**
mini-app (`casino/table.html`) stays a separate Vite entry and is reused
by both shells; only the *landing/root* differs. The admin dashboard is
shared but hides map/orb/shop tabs when the active season's shell is
`casino`.

> Because the casino season omits `tiles`/`orbState`/`orbConfig`/`shops`, the
> tile/orb Cloud Function triggers (`onTileComplete`, `onOrbAcquired`) simply
> never fire for it — there's nothing under those paths. They remain deployed
> and wildcarded, ready for S2, at no cost. No need to special-case them.

### Duplicated-constant cleanup

`MISSIONS_CLOSED_FOR_SEASON` and `ITEM_COSTS` are both existing instances of
"the same fact hand-duplicated between client and functions" (documented in
CLAUDE.md as known footguns). While touching this code anyway, replace
`MISSIONS_CLOSED_FOR_SEASON: boolean` with the active season's
`config/seasonList/{seasonId}/status` read from the DB. Status → mission
behavior:

- `draft` / `active` → missions spawn next cohorts on deploy (normal play).
- `closing` → no new cohorts spawn (what the current `true` flag does — used
  to wind a season down while in-flight cohorts finish).
- `archived` → season is read-only; nothing spawns or mutates.

This makes season wind-down a data change, not a code change + dual redeploy.
Note S1.5's casino tables *are* missions, so this status logic governs whether
new casino tables keep forming.

### Casino engine

`functions/src/casinoEngine.ts` mirrors four client `casino*.ts` files and
already needs manual sync per CLAUDE.md. Beyond the `seasonId`-in-path
treatment, the Casino season adds **substantial new canonical engine work**
(two new poker variants, retuned economy, dynamic pot seed) that **carries
forward as S2's permanent casino baseline** — so it must land in these shared
modules, not in S1.5-throwaway code. Details in the Casino-season plan
(`docs/casino-season-1_5-plan.md`).

## What carries over vs. what's fresh per season

Decisions locked for the S1 → S1.5 → S2 chain (see the Casino-season plan for
the gold specifics):

| Data | Carries? | Notes |
|---|---|---|
| Player identity, Discord link, display name | Yes | `profiles/`, unchanged |
| Cross-season history / games played / first-event badge | Yes | `profiles/players/{uid}/events/{seasonId}/...`; S1.5 event key = `casino_s1` |
| **Gold** | **Yes, S1.5 → S2** | Everyone starts S1.5 at **200 GP**. S2 seed = **`max(final S1.5 balance, 100)`**. S1 gold does **not** carry into S1.5. |
| Coat of Many Colors (name-color unlock) | **Yes, from S1** | Granted retroactively to anyone who bought one **or** finished S1 with **≥750 GP** (could have afforded it). Also earnable free in S1.5 by completing all four casino game types. Carries into S2. |
| Feats, inventory, adventurers, XP/level | No (and absent in S1.5) | S1.5 has no RPG layer at all; S2 reintroduces feats/adventurers fresh. |
| Tiles, orbs, shops | Fresh per map season | Omitted entirely from S1.5. |
| Missions | Fresh per season | See "Mission rules across seasons" below. |

**Gold model (S1.5 → S2).** A floor, not a stipend — this needs no restake
counting and no dependence on season length:

- **Start:** every S1.5 player begins at **200 GP**.
- **Weekly top-up:** any player **below 100 GP** is set **to** 100 GP. (Not
  additive — players at or above 100 receive nothing, so the economy doesn't
  inflate.)
- **S2 seed:** `max(final S1.5 balance, 100)`.
- **A player who never gambles** never drops below 100, so keeps 200 and enters
  S2 with **200** — no special-casing, no "participant" definition needed. A
  player who never even logs into S1.5 has no balance record; seed them at the
  same 200.
- **The risk is real and bounded:** gamble and win → carry more than 200;
  gamble and lose → floor out at 100, i.e. you can end up worse off than if
  you'd never played, but never below 100.

Net rule for the S2 seeding script: `s2Gold = max(s15Balance ?? 200, 100)`.

## Admin dashboard — season-driven tabs

The dashboard today has a fixed tab set: challenges, missions, kmk, map,
players, shops, orbs. Most are meaningless in a casino season, so **the visible
tab set becomes season-driven** (same config-driven principle as the shell).

**Tab evolution:**

| Tab | S1.5 (casino) | S2 (map) | Notes |
|---|---|---|---|
| **Casino** | **shown** (new) | shown | New variant of the Missions tab with casino details integrated. Casino missions live **entirely** here. |
| **Missions** | hidden | shown | After the split, holds **only non-casino** missions. |
| **Challenges** | hidden | shown | |
| **Map** | hidden | shown | |
| **Players** | shown | shown | |
| **Orbs** | hidden, **deprecated** | TBD | May or may not return in S2 — new functionality being brainstormed. |
| **Shops** | hidden, **deprecated** | **likely gone for good** | S2 replaces it with a vastly expanded item/equipment system whose logic lives **entirely in the backend** — no admin UI assigning items to shops. |
| **KMK** | shown | shown | Global, not season-scoped. |

**The Casino/Missions split is permanent, not an S1.5 hack.** Going forward the
casino gets its own tab in every season, and the Missions tab holds everything
else. Build the split now rather than special-casing S1.5.

> Consequence worth noting: **the Shops admin UI is on a path to deletion**, and
> the Orbs UI may follow. Don't invest in either while doing the season
> refactor — carry them across mechanically (or leave them bound to S1's
> archived data) and let S2 decide their fate.

## Player records per season

`exchangeDiscordCode` currently creates `game/players/{uid}` server-side at
login, hardcoded to the **map** shape (adventurers, xp, gold 0). That factory
becomes **season-aware**, keyed off the active season's `shell`.

**Fresh player record — casino shell (S1.5):**

```
seasons/casino_s1/players/{uid}
  id, displayName, discordHandle, avatarHash, joinedAt
  gold: 200
  xp:   0                  # kept at 0; harmless, keeps the record uniform
  # NOT present by default: activeMission, casinoGamesCompleted,
  # coat/nameColor unlock — a fresh login has no mission, no completions,
  # no Coat, and no custom name color. No adventurers, feats, or inventory.
```

**Fresh player record — map shell (S2):** the existing shape (adventurers, xp,
gold, inventory, feats).

### Bulk-seed at launch

S1.5 player records are **bulk-seeded at launch** rather than lazily created on
first login. The launch script walks the archived S1 players and writes each an
S1.5 record with `gold: 200` plus the **retroactive Coat grant** (bought one, or
finished S1 with ≥750 GP).

This is the simpler path: the Coat eligibility check runs **once** against S1
data instead of being recomputed at each player's first S1.5 login, and the
S2 gold carry (`max(s15Balance ?? 200, 100)`) reads a record that already
exists. Players brand-new to S1.5 (never played S1) still get a record created
at login with 200 GP and no Coat.

## Mission rules across seasons

Two rules established with the Casino season that apply to **every future
season**, not just S1.5:

1. **Series numbering restarts each season.** Cohort/series counters for all
   mission types begin again at I in a new season, rather than continuing
   across seasons. (`series` is already per-mission-record, so this is a
   seeding-time rule, not a schema change.)
2. **Each season declares which mission types it offers.** S1.5 has *no* Basic
   Training and *no* Patrol — only casino tables — while S2 brings the RPG
   missions back. `seedInitialMissions()` currently hardcodes
   basic + patrol + casino. Move that to season config, e.g.
   `config/seasonList/{seasonId}/missionTypes: [...]`, so seeding is
   data-driven and a casino-only or map-only season needs no code change.

Related, and specified in the Casino-season plan: the casino moves from a
single gestalt mission to **multiple concurrent tables, each pinned to one game
type**, which is why mission-type availability and series scoping have to
become configurable rather than hardcoded.

## Testing & safety

Rules were historically edited **directly against production** with no
verification — and that gap is exactly what hid the casino secrecy bug above.

### Rules unit tests — DONE (baseline in place)

`@firebase/rules-unit-testing` + `vitest`, run against the Database emulator:

```bash
npm run test:rules          # firebase emulators:exec --only database → vitest run
npm run test:rules:watch
```

- `tests/rules/setup.ts` — offline `demo-` project (never touches production).
  Each test file uses its own `projectId` → its own emulator namespace, so
  files are isolated and parallel-safe.
- `tests/rules/database.rules.test.ts` — legacy `game/` tree invariants.
- `tests/rules/seasons.rules.test.ts` — the new `config/` + `seasons/` +
  `seasonSecrets/` tree: draft invisibility, alpha playtest, archived-frozen,
  secrets unreadable, config admin-owned.
- Requires **Java** (the RTDB emulator is a Java app) — Microsoft OpenJDK 21.

**Status: `72 passed | 3 expected fail (75)`.** The 3 expected-fails are the
legacy `game/` casino leak, pinned with `it.fails()` so the suite stays green
and honest; they are deleted along with the `game/` tree.

### Remaining pieces

1. **Emulator Suite** — dry-run the migration and bulk-seed scripts against an
   **export of production data** before they ever touch the real database.
2. **Alpha-user allowlist** — playtest a draft season as a player (see above).
   Complements the tests; not a substitute for them.

### Cutover: stale client bundles

The frontend (Netlify), rules, and functions all deploy independently, so at
cutover a user with the **old JS bundle already loaded** keeps rendering S1 and
writing to `game/`.

**Severity is lower than it first looks:** `game/` and `seasons/` are separate
nodes, so an old bundle **cannot corrupt S1.5 data** — its writes land on a
dead node nobody reads. This is a **UX problem** (a player staring at a stale
S1 map believing they're playing), not a data-safety one.

**Decision: version gate + forced reload.** Client ships a build-time version
constant, subscribes to `config/minClientVersion`, and forces a reload when its
version is lower.

> **Bootstrap caveat:** the gate only protects clients that *already have the
> gate*. It must ship in a release **before** the cutover and be given time to
> propagate. Pre-gate bundles fall back to the harmless-dead-node behavior above.

Reusable beyond this cutover as a general forced-update lever (S2, hotfixes).

### Rollback / point of no return

`game/` is **copied, never moved** — it stays fully intact through the
migration and launch. Deleting it is a **separate, later step**, taken only
after S1.5 is verified live. Until then, rollback is: point
`config/activeSeasonId` back, redeploy the previous frontend bundle.

## Migration & rollout steps

> **STATUS (2026-07-15): Phase 1 executed against PRODUCTION.** The data
> migration has run: `config/`, `seasons/rpelago_s1/` (archived), the casino
> draft skeleton, and KMK `active` flags all now exist in prod. **`game/` is
> intact and the live site is unchanged** — it's still serving the old bundle,
> which reads `game/`. Nothing player-visible has changed. The new rules,
> functions, and frontend are **built but not yet deployed** (that's Phase 2).

Progress: **all code ✅ (steps 0–2, 4, 5) · migration run in prod 🟢**.
Remaining: **Phase 2 deploy** (rules + functions + frontend → read-only S1),
the KMK rules repoint (cleanup, non-blocking), and the **casino gameplay build**
(the real critical path — multi-table, new variants, landing UI; tracked in the
casino plan).

### Deploy phases (how the built code reaches production)

- **Phase 1 — Prepare (data only): ✅ DONE in prod.** Ran the migration
  commands via the Admin SDK. Additive/new nodes only; invisible to the live
  old bundle.
- **Phase 2 — Cut over to new code (deploy):** deploy rules + functions, then
  the new frontend. Flips the live site to **read-only archived S1** (the
  correct between-seasons state). Do when ready; safe regardless of casino build
  status (the casino shell isn't rendered until `activeSeasonId` flips at
  launch). Note this means an *extra* frontend deploy now vs. one at launch.
- **Phase 3 — Launch S1.5:** after the casino gameplay is built + playtested +
  the draft wiped: bump `CLIENT_VERSION`, deploy the casino frontend, then
  `bulk-seed-players` + `launch-casino` (flips `activeSeasonId` → casino, bumps
  `minClientVersion` to force stale reloads).

Because S1 is ending (not running alongside S1.5), the migration and the
Casino-season launch happen close together. Ordered:

0. ✅ **Rules unit tests** stood up against the current rules (`npm run test:rules`).
1. ✅ **New rule tree** added to `database.rules.json` alongside the legacy
   `game` block: `config/` (adminId, activeSeasonId, minClientVersion, public
   `seasonList`, private `draftSeasons` + `alphaUsers`), `seasons/$seasonId/`
   (status-driven read), and `seasonSecrets/` (default-deny). The
   `!initialized` bootstrap loophole is **gone**. Proven by
   `tests/rules/seasons.rules.test.ts`.
2. ✅ **Cloud Functions season-aware** (`functions/src/index.ts` +
   `functions/src/seasonPaths.ts`). Since S1 already ended, no dual-trigger
   period was needed — a clean cutover. Done: all 4 DB triggers wildcarded on
   `{seasonId}`; every callable takes an optional `seasonId` (defaults to the
   active season, validated by `resolveWriteSeason` so a client can't write a
   season it shouldn't); deck/hand moved to `seasonSecrets/`; the player-record
   factory in `exchangeDiscordCode` is shell-aware (casino → 200 GP, no RPG
   record); `profiles/` writes no-op on draft seasons; `requireAdmin` reads
   `config/adminId`; `tickGuildmasterMissions` + `tickSlotStatuses` fan out over
   live + draft seasons; the **weekly gold floor top-up** (`weeklyGoldTopUp`,
   active casino seasons only) is added and **writes an audit entry per grant**.
   Client callables pass the resolved season (main app via `getCurrentSeason()`,
   casino table via its `?seasonId=` param).
3. ✅ **Migration/launch script written, emulator-verified, and the prepare
   commands RUN IN PRODUCTION**
   (`functions/scripts/season-migrate.mjs`, harness
   `functions/scripts/verify-migrate.mjs` + `emulator-import.mjs`). Discrete
   idempotent commands, `--dry-run` + `--force`, emulator or prod via env:
   `archive-s1` (copy `game/*` → `seasons/rpelago_s1/*`, drop adminId from meta,
   **leaves `game/` intact**), `seed-config` (adminId from `game/meta`,
   activeSeasonId held at S1, S1 archived, casino+S2 as drafts, alphaUsers),
   `create-casino-draft`, `kmk-migrate` (pointer → per-list `active`) — **all
   four run in prod (2026-07-15)**. The launch-time commands
   `bulk-seed-players` (200 GP + retroactive Coat: owned or ≥750 GP) and
   `launch-casino` (flip active + bump minClientVersion) are held for Phase 3.
4. 🟡 **Client season-awareness — DONE.** `src/firebase/season.ts` (path
   helpers + `resolveSeason`), `src/contexts/SeasonContext.tsx` (config
   subscription, global admin, alpha, draft preview, version gate),
   `src/lib/version.ts`. All ~140 `game/…` paths in `db.ts` repointed;
   `initializeGameIfNeeded` deleted; `setAdminId` writes `config/adminId`;
   the casino table resolves its season from a `?seasonId=` param and reads its
   hand from `seasonSecrets/`.
   **Still to do:** season/shell-aware player-record factory, and gating
   `profiles/` writes on status ≠ `draft` (both live in Cloud Functions → step 2).
5. ✅ **KMK decoupling — DONE.** `KmkList.active` flag replaces
   `kmkActiveListId` (deleted); `KmkContext` exposes `activeListIds` and the
   admin UI toggles lists on/off. The one-time migration (`kmk-migrate`, setting
   `active` from the old pointer) ran in prod at Phase 1. KMK rules now key off
   `config/adminId` (not `game/meta/adminId`), so KMK survives the eventual
   `game/` deletion; proven by new positive/negative admin tests in
   `database.rules.test.ts`. The `#keep/{listId}` route is hoisted to the
   top-level `App()`, above the Season/GameState providers, so it renders under
   any shell (map or casino) with no season dependency. **KMK now has zero
   references into the game/season tree — its only tie to the rest of the system
   is the shared `config/adminId`.**
6. Build the Casino season (`casino_s1`) as `status:"draft"` while
   finishing it; **alpha users playtest it** (join/leave/complete missions).
7. Create `seasons/rpelago_s2` as `status:"draft"` too; S2 content authoring
   starts here directly as a proper draft season.
8. **Wipe draft playtest data** from `casino_s1` (manual Firebase
   wipe of the season node), then **bulk-seed S1.5 player records** from
   archived S1 players (200 GP + retroactive Coat grant). Order matters — seed
   *after* the wipe.
9. Launch: ship the frontend with the **version gate**, then flip
   `config/activeSeasonId = "casino_s1"` and its status to `active`.
   Old bundles force-reload. S1 remains archived/read-only; S2 stays
   draft/hidden.
10. **Later, only after S1.5 is verified live:** remove the old `game/...`
    trigger bindings and the `game` rules block, then delete `game/`. Keep
    `profiles/` untouched throughout.

### Season wind-down (the S1 pattern, repeated)

S1 established the wind-down sequence and **S1.5 follows it exactly**. There is
**no cancel/refund logic** — every started mission is played to completion
before the next season begins:

1. Set the season `closing` — **no new missions/tables spawn** (this is what
   the `MISSIONS_CLOSED_FOR_SEASON` flag did in S1; now it's a status).
2. **All existing tables with players still fill and deploy.** Decay keeps
   lowering `currentMaxSlots` until it meets the fill count, so any table with
   ≥1 participant auto-deploys on its own. Tables with **zero** participants
   never deploy — just delete them at wind-down (no antes paid, nobody
   affected).
3. **All deployed tables play out and settle.** Do **not** set `archived` until
   every `inprogress` table has completed — archiving early would strand
   running Archipelago games.
4. Only then: `archived`, and the next season opens.

Consequences:

- No ante refunds are ever needed — a player who paid an ante always gets their
  table played out.
- **The next season's gold bulk-seed must run after the previous season fully
  settles**, since a table settling during `closing` still moves gold and must
  count toward `max(final balance, 100)`.
- Hold 'Em is safe here too: its community draw fires on *decayed* max slots, so
  a partially-filled Hold 'Em table still reaches its draw as decay closes the
  gap.
- Same wipe-then-seed ordering as above for the incoming season's draft
  playtest data.

## Sequencing recommendation

Do the `game/` → `seasons/` migration (steps 1–4) *before* building the Casino
landing, so S1.5 and S2 are authored directly as draft seasons on the new
path instead of being staged somewhere ad hoc and migrated twice.

## Open questions for sign-off

Resolved in conversation: S1.5 is casino-only/no-map (shell = `casino`); the
gold floor model (200 start / 100 weekly floor / `max(final, 100)` into S2);
Coat of Many Colors retroactive grant + casino earn path; single global admin
(`config/adminId`) seeded by the migration script; client auto-init deleted;
S1 archived + S1.5 active + S2 draft at launch; config-driven shell; YAML in a
Firebase Storage bucket; per-season series restart and per-season mission-type
declaration; multi-table casino; **KMK stays global** with its pointer moved to
`config/`; **version gate + forced reload** at cutover; **bulk-seed** S1.5
player records; alpha-user allowlist for draft preview.

Also resolved: KMK is global with a per-list `active` flag (no pointer) on its
own route; alpha users may **write** (playtest) in draft seasons, with a manual
wipe before launch, **contingent on profile writes being gated on
status ≠ draft**.

Also resolved: scheduled functions — `tickGuildmasterMissions` processes
`draft` **and** `active` seasons (so alphas can playtest deploy), while the
weekly gold top-up runs for `active` only. **No player state carries from S1**
(there are no `warnings` and no `disabled` players to migrate). Season-driven
admin tabs, with a permanent Casino/Missions split. Season wind-down plays every
started mission to completion — no refunds, no cancellation.

Also resolved: **version gate = Option A** (RTDB `config/minClientVersion`,
shipped one release ahead of cutover). The **profile-site handoff** is written:
[profile-site-handoff.md](profile-site-handoff.md).

**Timeline is not an open question.** The rollout is **event-driven, not
date-driven**: S1's last cohorts settle → archive/migrate → launch S1.5. The
gold *floor* model was chosen partly because it removed the season-duration
dependency that would otherwise have needed calendar math.

**Weekly top-up cron anchor — resolved.** The "week" rolls over **Saturdays
06:00 `America/Chicago`**. Implemented in `weeklyGoldTopUp`
(`onSchedule({ schedule: '0 6 * * 6', timeZone: 'America/Chicago' })`), which
tops any active-casino-season player below 100 GP up to 100 and logs each grant
to the audit trail.

**No architecture open questions remain.** The two prerequisites that are setup,
not decisions — enabling the **Firebase Storage bucket** for casino YAML uploads,
and the **KMK rules repoint** to `config/adminId` — are tracked as build tasks
below, not blockers on starting the casino engine.

## Housekeeping uncovered during planning

- **CLAUDE.md:257 is wrong** — it documents KMK as living at `game/kmkLists/`;
  the code uses a top-level `kmkEvents/` node. Fix during the refactor.
- **CLAUDE.md needs a full update pass** once this lands — it documents `game/`
  as the root throughout, plus the `MISSIONS_CLOSED_FOR_SEASON` flag and the
  single-casino-mission model, all of which this plan replaces.
- **Firebase Storage bucket** is net-new setup (not currently enabled) — needed
  for casino YAML uploads.

Casino-specific open items live in
[casino-season-1_5-plan.md](casino-season-1_5-plan.md).
