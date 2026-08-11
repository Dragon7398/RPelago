# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (localhost:5173)
npm run build     # tsc -b then vite build → dist/
npm run lint      # ESLint check
npm run preview   # Preview production build
npx tsc --noEmit  # Type-check only (no emit)
```

The build is a **multi-page Vite app** with two HTML entry points (configured in `vite.config.ts`):
- `index.html` → main game app (`src/main.tsx`)
- `casino/table.html` → casino table mini-app (`src/casino/main.tsx`, served at `/casino/table.html`)

Firebase Cloud Functions are in `functions/` and deploy separately:

```bash
cd functions && npm run build   # tsc → functions/lib/
firebase deploy --only functions
```

### Deployment

- **Frontend (hosting)**: the site is hosted on **Netlify** and **auto-deploys on every commit pushed to GitHub** — there is no `firebase deploy --only hosting`. To ship a frontend change, commit and push; Netlify builds and publishes. (A launch step that bumps `minClientVersion` force-reloads clients, so the pushed build must be live on Netlify *before* that flip.)
- **Backend (functions / database rules / storage rules)**: deploy via the Firebase CLI — `firebase deploy --only functions,database,storage` (or a subset). **Deploy functions before the frontend push** so a new client never calls a callable the server lacks.

### Tests

```bash
npm run test:unit            # vitest run tests/casino tests/lib (pure logic — no emulator)
npm run test:rules           # database.rules.json against the RTDB emulator (demo-rpelago)
npm run econ                 # model casino table economics from live engine values
npx vitest run tests/casino/engine.test.ts          # single file
npx vitest run tests/casino -t "blackjack"          # single test by name
```

`test:unit` is the fast gate that runs everywhere; `test:rules` needs the Firebase
emulator (`firebase emulators:exec` wraps it). **Re-run `npm run econ` after touching
any casino ante / card value / pot formula** — the economy is balanced as a whole.

## Styling

When creating styling for new features, review the existing themes and ensure the style works for all themes, reusing or defining new theme-aware colors as necessary. This is particularly important for the color-blind friendly styles and the light-mode styles.

## Environment

This project runs on Windows: use PowerShell-compatible syntax in all scripts and hooks (no Unix-only commands), and assume the `claude` CLI may not be on PATH.

## Architecture

**RPelago** is a real-time collaborative metagame overlay for Archipelago randomizer sessions. Players log in via Discord, send adventurers to tiles on a grid map, and an admin controls tile progression. All state lives in Firebase Realtime Database.

### Season architecture (read this first)

The app is **multi-season**. All game data lives under `seasons/{seasonId}/…`, never at a top-level `game/` node. A season has a **shell** — `map` (the tile game described below) or `casino` (the casino-only interim season) — that drives which UI and admin tabs render.

- **Path helpers** ([src/firebase/season.ts](src/firebase/season.ts)): the active seasonId is held in module state (`setCurrentSeason`), so `db.ts` functions don't thread it. `sPath`/`sRef` resolve `seasons/{active}/…`; getters **throw** if no season is set. `whenSeasonReady()` awaits the first resolution for callers that may run pre-config (e.g. AuthContext).
- **`SeasonProvider` / `useSeason`** ([src/contexts/SeasonContext.tsx](src/contexts/SeasonContext.tsx)): resolves `config/` (`activeSeasonId`, `seasonList`, `draftSeasons`) into a `ResolvedSeason` and calls `setCurrentSeason`. Admin/alpha users can `previewSeason(draftId)` to playtest a draft that's invisible to everyone else. `season.writable` gates writes (archived = frozen).
- **Global admin**: admin is **`config/adminId`** (one global admin, NOT per-season). Client reads it via `useIsAdmin()`; Cloud Functions enforce it via `requireAdmin`. The old `gameState.meta.adminId` comparison is legacy.
- **Secrets tree**: RTDB read rules cascade downward, so anything secret **cannot** live under the world-readable `seasons/{id}/`. Secrets (casino hands/decks, gambit decks) live in a parallel `seasonSecrets/{seasonId}/…` tree — clients may read only their own hand; decks are server-only (`secretPath`/`secretRef` client-side, `secret()` in functions). See [docs/season-architecture-plan.md](docs/season-architecture-plan.md).
- **Firebase Storage**: casino config YAMLs live in the Storage bucket at `casino/{seasonId}/{missionId}/{uid}.yaml` (owner-scoped, see `storage.rules`) — not in RTDB.

### Data flow

```
Firebase RTDB (seasons/{active}/)
  └─ subscribeToGame() ─→ GameStateContext ─→ all components
```

`GameStateContext` is the single source of truth for map/mission UI. It subscribes to the whole active-season node via `onValue` and re-renders on any change (so children like `goldTopUpLog` arrive for free even when untyped). All mutations go through the context's exported callbacks, which call `db.ts` functions that write via the season path helpers.

### Key invariants

- **Admin identity**: global `config/adminId` (see Season architecture). Client: `useIsAdmin()`; server: `requireAdmin`. `AuthUser` has no `isAdmin` field.
- **Tile state machine**: `hidden → available → inprogress → complete`. The `available` set is always derived from adjacency to `complete` tiles. Any time a `complete` tile is un-completed, `computeRecalcUpdates()` (in `gameLogic.ts`, imported into `GameStateContext`) re-derives all `available` states and writes them atomically via `setTilesAvailability()`.
- **`adminOverride` flag**: When admin manually edits tile stats, `updateTileAdmin()` sets `adminOverride: true`. Regen Stats (`resetTileStats()`) clears it to `false` by re-applying seeded defaults.
- **Seeded map generation**: `gameState.meta.seed` drives everything in `tileGen.ts`. `initializeGrid(seed)` populates a module-level grid array used by `getTypeKey(r, c)`. This must be called before any type lookups; it's called automatically in `subscribeToGame` when the state first loads.
- **Stun/taunt clearing**: `setTileState()` always writes `stunnedAdvId: null` and `tauntedAdvId: null` alongside the state, so any admin-driven transition away from `inprogress` resets these fields. They are only re-set by `setTileInProgress()` / `setTilesAvailability()` when transitioning into `inprogress`.

### Map grid

- Fixed **5 rows × 7 columns** (ROWS=5, COLS=7 in `constants.ts`).
- Coordinates are column-letter + row-number strings like `"D3"` (col D, row 3). Helpers: `coordFromRC(r,c)`, `rcFromCoord(coord)`.
- Tile types: `town_center` (always D3), 3 `town`s, 5 `elite`s, 9 `puzzle`s, 1 `boss` (corner, seed-determined), rest `battle`.
- Town tiles are auto-completed and reveal adjacent tiles when a neighbor completes.

### Orb system

Nine elemental orbs (`ALL_ORBS` in `constants.ts`): fire, water, earth, air, light, dark, metal, wood, soul. Orbs are collected from: 5 elite tile drops, 2 shop purchases, 1 edge battle, and 1 edge puzzle. Which orb goes where is configured in `orbConfig` (stored in Firebase).

`ELEMENTAL_ORB_TRAITS` maps four of the orbs to boss traits they keep locked:
- **fire** → cursed, stunning
- **air** → aerial, agile
- **water** → camouflage, taunt
- **earth** → enduring, sturdy

The boss starts with all eight of these traits applied. When an orb is written to `game/orbState/{orbId}`, the `onOrbAcquired` Cloud Function trigger removes the corresponding traits from the boss tile, skipping `BOSS_SOFT_TRAITS` (camouflage, enduring) if the boss is already `inprogress`.

`OrbAcquisition` records how each orb was obtained: `method` ('battle' | 'puzzle' | 'elite' | 'boss' | 'shop' | 'admin'), `tileCoord`, `tileName`, and `buyerName`.

### Trait system

16 traits defined in `TILE_TRAITS` (`constants.ts`). Traits with `hasValue: true` carry a numeric parameter (e.g. `agile: 250` means ≤250 checks):

| Trait | Value | Effect |
|-------|-------|--------|
| aerial | — | Slot needs Fly or Ranged Weapon |
| agile | checks | Slot may not exceed N checks |
| bifurcated | — | Challenge splits into Room 1 / Room 2 |
| camouflage | — | Hints off until one slot has goaled |
| confounding | — | Adds a Simon Tatham puzzle as a public slot |
| cursed | — | One or more YAML settings randomized after submit |
| enduring | % | Must send N% of all checks, not just goal |
| horde | count | Slot must have at least N games |
| magicresist | — | Slot must not involve magic |
| physresist | — | Slot must involve magic |
| puzzling | — | Adds a Jigsaw as a public slot |
| sturdy | checks | Slot must have at least N checks |
| stunning | — | Random slot gets all locations excluded |
| taunt | — | Random slot gets all locations prioritized |
| thief | — | One or more slots steal items from others |
| unbalanced | — | Progression balancing set to 0 |

Items can negate specific traits; `ITEM_TRAIT_REFS` maps item IDs to the trait IDs they counter, used to underline trait names in shop descriptions.

### Bifurcated tiles

When a tile has the `bifurcated` trait, `adminSetTileState()` splits it into Room 1 and Room 2 when transitioning to `inprogress`. Each `AdvSlot` and `TileAdventurer` has an optional `room?: 1 | 2` field for assignment. `InProgressState.tsx` renders the two rooms separately. Admin can assign public slots and claimable slots to a specific room.

The stunned/taunted adventurer IDs are tracked on the tile as `stunnedAdvId` and `tauntedAdvId`. Both are cleared whenever the tile leaves `inprogress` (handled automatically by `setTileState`).

### Auth

Discord OAuth → `exchangeDiscordCode` Cloud Function → Firebase custom token → `signInWithCustomToken`. After sign-in, `AuthContext` upserts the player record, then `GameStateContext` initializes the game (the first authenticated user becomes admin via the two-phase write in `initializeGameIfNeeded`).

### Cloud Functions

All in `functions/src/index.ts`:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `exchangeDiscordCode` | HTTP request | Discord OAuth code exchange → Firebase custom token. **Consults `config/bannedDiscordIds` first** (see Bans). |
| `adminBanDiscordId` / `adminUnbanDiscordId` | Callable | Add/remove a pre-emptive ban keyed on Discord snowflake; ban also sweeps `disabled` across all seasons + disables the Auth account. |
| `purchaseShopItem` | Callable | Validates and deducts gold, adds item to inventory. Rejects disabled players. |
| `purchaseShopOrb` | Callable | Atomically claims orb, deducts gold. Rejects disabled players. |
| `onTileComplete` | DB write on `game/tiles/{coord}/state` | Fires when a tile reaches `complete`; updates `profiles/` with XP snapshot and game stats. Also auto-warns players with ≥5 status incidents (see Status reports). |
| `onOrbAcquired` | DB create on `game/orbState/{orbId}` | Removes boss traits unlocked by the acquired orb. |
| `pruneActivityLog` | DB create on `game/activityLog/{entryId}` | Trims the activity log to the most recent 25 entries. |
| `fetchCheesetracker` / `fetchCheeseDetails` | Callable | Server-side proxies to cheesetrackers.theincrediblewheelofchee.se (no CORS from the browser). Used by the admin **Sync** buttons. |
| `tickSlotStatuses` | Scheduled every 15 minutes | Auto-syncs slot statuses + activity timestamps from Cheesetracker across live + draft seasons (see Archipelago / Cheesetracker sync). Also **auto-reclaims mission claims** — frees `activeMissions/{id}` when a participant's slots go all-terminal (mirrors its tile adventurer-free block). |
| `enlistInMission` | Callable | Adds player to a forming mission; auto-deploys if now full. Rejects `no-claims-free` when the player's held claims (`activeMissions`) meet `MISSION_CLAIM_CAPACITY`. |
| `standDownFromMission` | Callable | Removes player from a forming mission (not allowed once deployed); frees that mission's claim. |
| `setMissionParticipantStatusNote` | Callable | Updates a participant's status note. |
| `claimMissionSlot` | Callable | Atomically claims a claimable slot on a mission (parallel to tile claim logic). **Casino claims are free** — no gold, no mission claim consumed; see Casino: void vs kick. |
| `adminKickMissionParticipant` | Callable | Kicks a participant and creates a claimable slot — **one per card** for a casino seat. |
| `adminVoidCasinoSeat` | Callable | Removes a whole casino seat with no replacement; releases all its pot weight, writes no warning. |
| `adminReleaseClaimableSlot` | Callable | Withdraws an unclaimed open slot and returns its reserved pot weight to the table. |
| `adminForceDeploy` | Callable | Admin-forces a forming mission into `inprogress`. |
| `onMissionComplete` | DB create on `game/missionsHistory/{missionId}` | Fires when a mission is completed; updates `profiles/` with XP snapshot and mission count. Also auto-warns players with ≥5 status incidents. |
| `tickGuildmasterMissions` | Scheduled every 15 minutes | Auto-deploys any forming mission whose decay has reduced max slots to the current fill count. |

> DB triggers now watch the **season-scoped** paths (`seasons/{id}/…`), not the legacy top-level `game/…` shown above.

The **casino/season** functions (also in `index.ts`) are the money-and-secret-authoritative half — clients are never trusted with hands, decks, gold, or the pot. Key ones: `dealCasinoHand` / `dealHoldemHole` / `holdemPlayOn` / `holdemFold` / `casinoFold` (deal & seat lifecycle), `dealGambitOffer` + `playCasinoGambit` (server-authoritative shared gambit deck), `lockCasinoResult` (commit → slots + gold), `resubmitCasinoYaml` / `adminDenyCasinoYaml` / `adminGetCasinoYamls` (config workflow), `weeklyGoldTopUp` (Sat 06:00 America/Chicago floor top-up → `goldTopUpLog`; **skips any player seated at an `inprogress` table** — held or freed claim — since the floor is for players falling behind, not ones winning fast enough to hold several tables), and `resolveWriteSeason` (the shared seasonId resolver every casino callable runs first). **Deploy functions before the frontend** so a new client never calls a callable the server lacks.

> **Disable is a two-part kill-switch.** `adminSetPlayerDisabled` (what `setPlayerDisabled` → the admin Players toggle calls) sets the per-season RTDB flag `players/{uid}/disabled` **and** disables the Firebase Auth account (+ `revokeRefreshTokens`). The RTDB flag alone can't stop the direct client→Storage YAML upload — Storage rules can't read RTDB — so the Auth disable is the only thing that gates uploads (an already-issued ID token lingers up to ~1h). It refuses to disable the caller's own account.

### Bans (pre-emptive) vs Disable (reactive)

**Disable can only act on someone who already exists** — it needs a `players/{uid}` record and an Auth account. To keep someone out *before* they ever sign in, use the ban list.

- **`config/bannedDiscordIds/{discordSnowflake}`** — global (not season-scoped), `{ reason, ts, by, handle?, lastAttemptAt? }`. Keyed on the **immutable Discord snowflake, never the username** — handles are renameable, so a handle-keyed ban falls off the moment they rename.
- **The gate is in `exchangeDiscordCode`, deliberately placed BEFORE `createUser` / `createCustomToken` / the profile stub / `createSeasonPlayer`.** That is the only place a Discord login becomes a Firebase identity, so it is the only point where a ban can be pre-emptive. A banned ID gets a 403 (`{ error, banned: true }`) and leaves no trace anywhere in the tree. **Anything added to that function must stay below the ban check.**
- **Rules**: `.read` is **admin-only — not alpha** (it's a roster of banned IDs), and `.write` is **`false` for everyone including admin**. Both mutations go through `adminBanDiscordId` / `adminUnbanDiscordId`, because a raw client write would set the flag while leaving the Auth account live — a ban that doesn't ban. Pinned by tests in `tests/rules/seasons.rules.test.ts`.
- **Ban ⊃ disable**: `adminBanDiscordId` also sets `disabled` in every season **the player actually has a record in** (not just the active one) and disables the Auth account, so it works whether or not the person has ever played. ⚠️ It must probe `players/{uid}/id` before writing that flag — RTDB creates missing ancestors, so a blind write to `players/{uid}/disabled` in a season the player was never in **creates a phantom record** holding only that flag, which renders as a nameless RESTRICTED card on the admin Players page. Skipping absent seasons costs nothing: the sign-in gate stops them before `createSeasonPlayer` could ever run. The same call nulls any phantom it finds, and `PlayersPage` drops records with no `id` as a second line of defence. **Unban is deliberately asymmetric** — it clears the ban and re-enables Auth but leaves the per-season `disabled` flags alone, so "may sign in again" stays a separate decision from "season records reinstated".
- **Limitation**: this blocks a Discord *account*, not a person — a new account gets a new snowflake. An allowlist is the only structural answer.

> **Admin SDK pitfall**: When using `admin.database().ref(path).transaction()`, passing a child path (e.g. `profiles/{uid}/gold`) instead of the parent node can cause the transaction callback to receive `null` on the first invocation — even when data exists. Always verify the transaction ref resolves to a node that exists, and after fixing a null-transaction bug in one function, audit sibling functions (e.g. `purchaseShopItem` and `purchaseShopOrb`) for the same pattern.

### Shops and items

Four named shops (Centralia, Frostshear, Flamefell, Pinereach) are assigned to town tiles via seeded shuffle. Each shop has one optional orb slot (`orbId: string | null`) and an `itemIds` array. Default shop configs are in `DEFAULT_SHOPS` (`constants.ts`); the live config is stored in `game/shops` in Firebase and is admin-editable.

Purchases go through Cloud Functions (`purchaseShopOrb`, `purchaseShopItem`) that use the admin SDK to bypass DB write rules for inventory updates. Orb purchase costs `ORB_SHOP_COST` (1500 gold).

Eight shop items are defined in `SHOP_ITEMS` (`constants.ts`):

| Item | Cost | Type |
|------|------|------|
| Map | 250 | Consumable — request one hint |
| Scroll of Magnetism | 1000 | Consumable — enables Collect On |
| Scroll of Generosity | 1000 | Consumable — enables Release On |
| Coat of Many Colors | 750 | Cosmetic — unlocks name color picker |
| Wand of Piercing | 300 | Passive — ignore Magic/Physical Resist |
| Throwing Dagger | 400 | Passive — ignore Aerial; +25% checks on Agile |
| Ring of Resistance | 500 | Passive — immune to Cursed and Stunning |
| Warhammer | 600 | Passive — –1 game on Horde; –50% checks on Sturdy |

> **Dual-copy item costs**: `SHOP_ITEMS` in `src/lib/constants.ts` defines costs for the UI. `ITEM_COSTS` in `functions/src/index.ts` is a separate hardcoded copy used by the `purchaseShopItem` Cloud Function to enforce the price server-side. **Both must be updated together** whenever a price changes.

### Feats system

Players unlock one feat at each of levels 3, 5, and 7, stored in `player.feats` (`PlayerFeats` type). Feats are permanent and modify YAML submission limits and/or provide passive bonuses.

Level thresholds: `[0, 100, 300, 500, 800, 1150, 1500]` XP (index = level − 1). Level 3 requires 300 XP, level 5 requires 800 XP, level 7 requires 1500 XP.

**Level 3 feats** (pick one):
- **Knowledgeable** (📚) — +1 Starting Hint, +2 Hinted Locations per YAML
- **Picky** (🚫) — +4 Excluded Locations per YAML (max 6)
- **Helpful** (📌) — +2 Priority Locations per YAML (max 4)

**Level 5 feats** (pick one):
- **Mentor** (🎓) — teammates gain 5% bonus XP; you gain 1% per extra player
- **Treasurer** (💰) — teammates gain 10% bonus Gold; you gain 3% per extra player

**Level 7 feats** (pick one):
- **Seeker** (🔍) — challenges you join have 1% reduced hint cost (stacks, min 1%)
- **Prepared** (🎒) — +1 starting inventory item per YAML

Feats with `yamlEffect` affect the YAML limits displayed in the help modal (`SectionYaml.tsx`). Feat selection UI lives in `ProfileLightbox.tsx`. The DB rule for `feats/$slot` only enforces that the slot was previously empty (preventing re-selection) — level eligibility is enforced in the UI only via `pendingFeatSlot()` in `gameLogic.ts`.

### Public and claimable slots

Two distinct slot types exist on tiles:

- **`publicSlots?: AdvSlot[]`** — Admin-set open slots. Anyone can play them; they are never consumed or removed.
- **`claimableSlots?: Record<string, AdvSlot[]>`** — Created when an admin kicks a player from an **in-progress** tile, or when a **player reset** removes a player who is currently on an in-progress tile. Any eligible player can claim one: the claim atomically deletes the slot entry and adds the player as a `TileAdventurer`. Keyed by Firebase push keys so individual entries are deletable.

The DB rule for `claimableSlots/$slotKey` allows any authenticated player to **delete** (claim) an existing entry but not create one. The `adventurers/$advId` validate rule uses a Firebase pre-write evaluation trick: during an atomic claim `update()`, the claimable slot still exists in `data`/`root` (pre-write state), so the rule `claimableSlots.exists()` passes even though the same update deletes it.

`AdvSlot` supports `bonusXP` and `bonusGold` for extra rewards on specific slots, and `room?: 1 | 2` for bifurcated tiles.

### In-progress join restriction

Once a tile is **in progress**, players cannot join it as a fresh adventurer — the Archipelago game is locked in at that point. The only entry path is claiming a claimable slot. This is enforced in two places:
1. **UI**: The "JOIN THE CHALLENGE" picker is absent from the in-progress lightbox section.
2. **DB rule**: The `adventurers/$advId` validate rule rejects non-admin writes to in-progress tiles unless `claimableSlots` exists on that tile.

### Player warnings

Players have a `warnings?: Record<string, PlayerWarning>` field (push-keyed for individual deletion). Warnings are:
- **Auto-generated** when an admin kicks a player from an in-progress tile (written atomically in the same `update()` call as the kick).
- **Manually added** by admin via the Players page in the Admin Dashboard.

The Players page shows a count badge and an inline list with AUTO/ADMIN tags, dates, per-warning delete, and a "Clear all" button.

### Player reset

`playerReset()` in `db.ts` archives the player's XP, zeroes all stats, clears inventory and feats, and trims to one adventurer. It mirrors kick behavior for any tiles the player is currently on: tile adventurer entries are removed, and a claimable slot is created for any tile that is `inprogress`. All writes are atomic in a single multi-path `update()`.

### Guildmaster Missions

A parallel progression system independent of the tile map. Missions are stored in `game/missions/` and completed missions are moved to `game/missionsHistory/`. Three mission types are defined in `MISSION_DEFS` (`constants.ts`):

- **Basic Training** (`basic`) — one-time per player, requires 150-check sturdy slot, tracked via `player.basicTrainingDone`.
- **Patrol** (`patrol`) — repeatable, no traits, earns steady gold.
- **Casino** (`casino`) — repeatable; slots are chosen via the casino mini-app card game. Reward is variable (`variableReward: true`): XP floor is 50 + gambit XP settled at deploy; GP is drawn from a shared `pot`. `casinoStats` (release %, collect %, hint cost) are rolled at deploy from the cohort's shared odds table.

Mission state machine: `forming → inprogress → complete`.

**Pooled mission claims + early reclaim.** A player's mission "claim" (the guildmaster; S2 adds an advisor) is the mission analogue of a Challenge **adventurer**, and behaves the same way: it is **released early** the moment all the player's slots on a mission reach a terminal status (`100% | Goaled | Done`), letting them take another mission while the old one is still `inprogress` (they stay a participant and still pay out at settle). Held claims live in **`player.activeMissions: Record<string, true>`** (replaces the old scalar `player.activeMission`, which is gone). Capacity is a **per-player** helper `missionClaimCapacity(player)` in `gameLogic.ts` (base 1 — guildmaster; S2's advisor level-up bonus raises it to 2 *and* grants a second adventurer, both keyed off the same signal), NOT a season constant. Functions carry a server copy `MISSION_CLAIM_CAPACITY` + `heldClaimCount()`; enlist/claim reject with `no-claims-free` when `heldClaimCount >= capacity` (a **settling** table — slots done, claim already freed — does not count).

The reclaim is **auto, on status sync** (mirrors the tile adventurer-free path): both the scheduled `tickSlotStatuses` mission loop and the admin **Sync** on MissionsPage null `players/{uid}/activeMissions/{missionId}` when a participant's slots go all-terminal (client path via `freeMissionClaim` in `db.ts`). The completion predicate is the shared **`slotsAllFree`** in `slotHelpers.ts` (which also backs `hasUnfinishedSlots`/`hasUnfinishedTileSlots` via `countUnfinishedSets` — the two are now thin wrappers, not parallel impls). Server-side (functions) inline a copy of the terminal check, like `deriveStatus`.

**Decay mechanic**: max slots reduce by 1 per 24h after the first participant joins — 36h for casino tables (`currentMaxSlots()` in `missionLogic.ts`). `tickGuildmasterMissions` (scheduled every 15 min) auto-deploys any forming mission where fill count has reached the decayed max. Deployment also fires immediately on enlist if full.

> **Display seats with `seatTally`, never `currentMaxSlots`.** Decay lowers the cap but never evicts a seated player, and a casino cohort keeps decaying while it waits for every seat to lock in (`shouldDeploy` also demands `allSeatsPlayed`) — so the cap legitimately slides *below* the fill count and a raw `{filled}/{currentMaxSlots}` renders the nonsense **"7/6"**. `seatTally(m, now)` floors the shown max at the fill count and returns `{ filled, max, over, label, title }`, rendering **"7/7\*"** with an explanatory tooltip. Anything indexed by max seats (seat rails, pips, `SeatGrid`) must use it too, or an occupied seat gets drawn as closed — or dropped entirely. `GMMissionCard.seats` carries the tally for card consumers. Gameplay math (deploy, `takeable`, pot split at settle) keeps using `currentMaxSlots`.

`claimableSlots` on missions mirrors the tile claimable slot mechanic — created when a participant is kicked. `slotsLocked` prevents slot edits once locked by admin. Entries have **two shapes**: non-casino missions write a bare `AdvSlot[]` (one entry holding all the kicked player's slots, claiming costs a mission claim), while casino tables write a richer `ClaimableEntry` — see **Casino: void vs kick** below. Every reader goes through `normalizeClaimEntry` / `claimEntries` (`slotHelpers.ts`), so legacy bare arrays keep working.

`seedInitialMissions()` in `db.ts` bootstraps the first Basic Training and Patrol cohorts; it is a no-op if missions already exist. The admin Missions page allows state transitions, slot editing, kicking, force-deploy, and slot lock.

### Activity log

Real-time event feed stored in `game/activityLog` in Firebase, automatically pruned to 25 entries by the `pruneActivityLog` Cloud Function trigger. Events are written on tile completions, in-progress state changes, tile availability changes, orb collection, item purchases, orb purchases, mission deploys, and mission completions. Each `ActivityEntry` has `id`, `timestamp`, `type` (`ActivityType`), `message`, and `icon`. The collapsible `ActivityFeed` component renders this in the UI.

### Archipelago / Cheesetracker sync

Slot statuses (`SlotStatus`: `Unstarted | In-Progress | 100% | Goaled | Done`) are synced from the Cheesetracker API for both tile adventurer/public slots and mission participant slots. Two paths write the same data: the admin **Sync** button on ChallengesPage / MapPage / MissionsPage (via `fetchCheeseDetails`), and the scheduled `tickSlotStatuses` (every 15 min, across live + draft seasons). Both call **`deriveSlotStatus`** (`archipelagoApi.ts`, mirrored server-side in `functions/src/index.ts`) — the single source of truth for status derivation.

Two timestamps are stamped on **every** synced slot (ms epoch, or null): **`lastActivity`** and **`lastChecked`**. Their weights are the crux and easy to invert:

- **`lastActivity`** (Cheese `last_activity`) — **STRONG**: server-verified activity from the Archipelago server; the real "is actually playing / making progress" signal.
- **`lastChecked`** (Cheese `last_checked`) — **WEAK**: a manual self-report by the player (e.g. vouching they're stuck); may be inaccurate.

**`{NUMBER}` slot names.** A player may end a slot name with `{NUMBER}` so the room still generates through a name collision — Archipelago expands the token to nothing for the first such slot and to a digit for each one after (`jam_minit`, then `jam_minit2`). The stored name keeps the token, so it matches nothing on the tracker. Every sync path resolves it through **`resolveNumberedSlotName`** (`archipelagoApi.ts`, mirrored server-side in `tickSlotStatuses`) and **adopts the generated name permanently** — the client paths write it via `adminUpdate{Adv,Public,Participant}SlotName`, the tick folds it into its `updates` batch. Resolution is deliberately **only for the unambiguous case**: exactly one room name matching the base (bare or AP-numbered). Two or more real candidates return null, keep the token, and surface in the admin mismatch list — with two genuine `jam_minit` slots nothing in the name says whose is whose, so that mapping stays a manual call.

**`deriveSlotStatus` gates `In-Progress` on `last_activity` being present — NOT on `checks_done`** (`collect` mechanics inflate a slot's check count without the player ever launching the game) and **not on `last_checked`** (the weak signal). Terminal states (Done/Goaled/100%) still win. **Any change to derivation or the strong/weak roles must be made in both `archipelagoApi.ts` and the server `deriveStatus`.** `parseCheeseTs` (`archipelagoApi.ts`) normalizes ISO → ms.

### Status reports

Admin **Report** tab (`StatusReportPage.tsx`) surfaces in-progress missions and challenges that need attention, with all logic in the pure/tested **`statusReport.ts`**. `computeStatusReport` classifies each owned slot into **Problem** (red) or **Warning** (yellow), buckets each world as **Active** / **Too Early** (<48h elapsed) / **Recently Reported** (`lastReportAt` <24h). Elapsed clock origin mirrors the mission card: `linkedAt ?? deployedAt ?? firstJoinAt ?? createdAt` (tiles: `linkedAt` only, stamped on first room-link set). Slot thresholds are exported constants (`PROBLEM_STALE_HOURS`, `WARN_NO_ACTIVITY_HOURS`, `WARN_ALL_STALE_HOURS`); a **missing timestamp is "unknown", never "stale"** (`stale()` returns false on null — this prevents false "no activity in never" flags).

Running an **official report** (`runOfficialStatusReport` in `db.ts`) does one atomic update: +1 `statusIncidents[playerId]` on each Problem world (per-report, per-world), resets `lastReportAt = report.ts` on Problem worlds, stores the snapshot to `seasons/{id}/statusReports/{key}`, and prunes to the newest 10. `buildOfficialReport` + `renderProblemsMarkdown` / `renderWarningsMarkdown` produce the two copy-paste blocks (player-facing Problems; admin-facing Warnings). Marking a Warning world **handled** (`markStatusWarningHandled`) resets its timer to the report's `ts` but **never moves a newer `lastReportAt` backward**. At world completion, players with ≥5 `statusIncidents` get an auto `PlayerWarning` (see `onTileComplete` / `onMissionComplete`).

### Player customization

- **Name color**: 12 color options (`NAME_COLORS` in `constants.ts`). Requires owning the "Coat of Many Colors" item. Stored as `player.nameColor`.
- **Adventurer renaming**: Players can rename adventurers (12-char limit per name part) via `ProfileLightbox`.
- **XP history**: `player.xpHistory` archives XP totals from prior campaigns.

### Environment

All Firebase config is in `.env` as `VITE_FIREBASE_*` variables. The app degrades gracefully if `.env` is missing (`firebaseReady` guard in `config.ts`).

### Casino subsystem

A separate mini-app (`casino/table.html`) where players select their Guildmaster Mission game slots by playing card games. It is a standalone Vite entry point that shares Firebase auth and the same RTDB mission state but has its own CSS theming (`themes.css`, `cards.css`, `play.css`).

> **The table link MUST carry `?seasonId=`.** The mini-app has no `SeasonProvider`, so the URL is the only way it learns its season; without the param it falls back to `config/activeSeasonId` and looks for the mission in the wrong season, reporting "Mission not found or unavailable." Both link builders pass it: `PhasePanel.tableHref` and `GuildmasterMissions.CasinoTableLink`.

> **`lockCasinoResult` takes `keepUids` — the cards to COMMIT, not discards.** `selectCommitted` reads a missing/null `keepUids` as "commit the whole hand", so a wrong-shaped payload doesn't error, it silently overpays the seat.

> **`DeckCard.uid` is a per-deck INDEX, not a globally unique id** — `buildDeck` numbers it 0..N by position, fresh on every call. Hold 'Em is the only game whose pool spans **two** `buildDeck()` calls (the seat's hole deck + `drawCommunity`'s), so its halves would share a uid space. That is not cosmetic: uid is the selection protocol (`selectedUids` / `keepUids`) **and** the React key, so one uid meaning two cards makes `holdemPlayOn`'s `byUid` Map silently drop a card and makes one tap count as two commits (the commit button sticks at "Drop 1 to commit" with no way back to five). Community cards are therefore namespaced by **`COMMUNITY_UID_BASE`** at draw time. Tables dealt before that can still hold a collision, so **every** assembly of a Hold 'Em pool — the reveal, `holdemPlayOn`, `resubmitCasinoYaml` — goes through **`holdemPool(hole, community)`**, which de-duplicates on read (hole card keeps its uid; the community card moves). It is pure and deterministic so client and server resolve a tapped uid to the same card. Mirrored in `functions/src/casinoEngine.ts`.

> **The Hold 'Em play-on selection is RE-PICKABLE, and free.** The play-on buys the sitting, not one particular five, so a seat may swap which five of its seven it commits until it **locks in** — after which `resubmitCasinoYaml` owns card changes (forming self-tweak, or a host deny once live). `holdemPlayOn` charges and cuts the pot only on the **first** call (`rePick = seat.playedOn === true`); `mustCasinoSeat` already bounds it to a `forming` table and an unlocked seat. It re-reads the persisted **`hole`** rather than `seat.hand`, since a re-pick's `hand` has already been narrowed to the previous five. Client entry is "← Change my five" on the gambit step (`canRePick` / `startRePick`), and `rePicking` is what stops the derive effect pushing the seat forward while it sits on the reveal with `playedOn` already true.

> **Nothing that can throw may sit between a committed play-on and the phase advance.** `holdemPlayOn` debits and commits the moment it returns, so `doPlayOn` sets the phase immediately and leaves the gambit draw to the (idempotent) recovery effect. It used to `await dealGambit()` first: one failed draw left the seat on the reveal with its hand already narrowed to the five it just committed, every card captioned as a hole card, facing a play-on the server would now reject and a fold that would forfeit the ante — and `holdplay` being in `LOCAL_PHASES` meant the derive effect's early return never rescued it. That early return is now preceded by an un-stick branch for exactly this state.

**Phase flow** (backend-owned; `CasinoTable.tsx` mirrors mission state into it): `deckselect → ante → play | (holdwait → holdplay) → gambit → manifest → locked → deployed`, with `folded` off `play`/`holdplay`. The game is pinned per-table in `mission.casinoGame` (no in-table game choice). A `resubmitting` flag reuses the `manifest` phase for post-lock config edits (see below).

Two card games are offered:
- **Poker** — player commits cards; reward = sum of committed card values (no combo multiplier).
- **Blackjack** — player draws until 6 cards, must drop one to lock; reward = sum of remaining card values.

After locking a hand, the player is dealt **gambit cards** that shift shared `casinoStats` (release %, collect %, hint cost) for the entire mission cohort. Bonus gambits cost gold; penalty gambits add XP and pot to the mission.

Locked cards are converted to mission `AdvSlot`s via `cardsToSlots()` (`casinoSlots.ts`): each card becomes a slot with blank `name`/`game` and the card's genre + gold value stamped into `details` (format: `"Genre · Ng"`).

**Config (YAML) submission workflow** — the manifest phase is the submission, gated end-to-end:
- **Required to lock in.** The `manifest` phase collects a game per committed card AND an attached Archipelago `.yaml` (uploaded owner-scoped to Storage). `lockCasinoResult` independently verifies both server-side.
- **Player resubmit** (`resubmitCasinoYaml`): reopens the `manifest` view seeded from the seat's `lockedCards` + slots, so the player can reorder games (↑/↓) or attach a new file. Allowed while **forming** (self-tweak) or whenever **denied** (even in-progress). Re-stamps only game/name onto existing slots.
- **Card re-selection on resubmit** (`resubmitCasinoYaml` with `keepUids`): a locked player can also change *which* cards they commit (← Change cards → the `play` phase, no reroll/hit/fold) — while **forming** (self-tweak), or once **in progress** *only* on a host **deny**, since a denied player rebuilding their config may be unable to source a game for a card. The gambit is never re-openable. This is why `lockCasinoResult` **keeps the dealt hand** (clears only the draw deck) — the preserved hand is the re-selection pool. Hold 'Em's pool is a persisted `hole` secret (play-on overwrites `hand`) + the public `community`. The server recomputes `goldSwing`/`lockedCards`/`slots` from the new selection.
- **The re-selection pool outlives deploy.** `deployMission` clears only `deck` (no reroll/hit/redraw once live) and deliberately **keeps** `hand`/`hole` so the denied-in-progress path above has something to re-select from. The pool is purged at settlement by `onMissionComplete`, which drops `seasonSecrets/{seasonId}/missions/{missionId}` wholesale — client code *cannot* do this (every secret leaf is `.write: false`), so that purge is the only thing standing between a finished table and orphaned hands.
- **Host deny** (`adminDenyCasinoYaml`): ⛔ in the admin Casino tab. Deletes the stored file and sets `participant.yamlDenied` (+ optional reason). The landing surfaces a resubmit notice; a badge marks the seat in admin.
- **Leave invalidates**: `deleteSeatYaml` runs on stand-down / kick / deny; `clearSeatSecrets` nulls the seat's secret hand/deck/hole on those same paths (an orphaned secret would otherwise block re-sitting with *"Finish or fold your current hand first"*).
- **Admin download** (`adminGetCasinoYamls`, admin-only callable via Admin SDK): per-seat `.yaml` and a `.zip` of all seats (via `fflate`) — deliberately never a single combined file.

> **Never shorten a casino seat with `adminSetParticipantSlots`.** A casino seat is three fields that must agree: `slots`, the index-aligned `lockedCards` (the only surviving record of each card's gold value), and `goldSwing` (the stored number settlement pays — it is *not* re-derived from slots; `handStakeFromSlots` is a display fallback only). Dropping a slot through the generic row editor leaves the seat over-paying and mis-maps games to cards on the player's next resubmit. The admin Missions ⊘/✕ route casino seats through the callables below, which rewrite all three atomically, compact any pre-existing `null` hole, and refuse to empty a seat. Prefer letting the player re-pick via `resubmitCasinoYaml` whenever they can.

#### Casino: void vs kick, and the weighted pot

Removing a card or a seat comes in two flavours at two scopes (a **2×2**, all four confirmed in the admin UI), and the *only* difference is where the removed slot's share of the pot goes:

| Action | Callable | Claimable slot? | Pot weight | Warning |
|---|---|---|---|---|
| **Void card** ⊘ | `adminRemoveCasinoSlot` (`mode:'void'`, the default) | no | **released** to the table | no |
| **Void seat** ⊘⊘ | `adminVoidCasinoSeat` | no | all of it released | no |
| **Kick card** ✕ | `adminRemoveCasinoSlot` (`mode:'kick'`) | 1 entry | **reserved** on the entry | yes |
| **Kick seat** ✕✕ | `adminKickMissionParticipant` | **one per card** | reserved on each | yes |

All four are in-progress actions. A forming table offers only the void column — see the note below.

A **void** says the slot is dead — unplayable game, unfillable card — so nobody can take it over and its weight returns to the table. A **kick** says the Archipelago slot is fine but its player isn't, so it reopens for a replacement. Voids are no-fault and leave no mark; kicks write a `PlayerWarning`. `adminReleaseClaimableSlot` converts an unanswered kick into a void after the fact.

> **Void vs kick is an IN-PROGRESS-only distinction.** It only means anything once a room exists and a removed slot is something another player could actually pick up. On a **forming** casino table both collapse into a single no-fault removal: no claimable slot, no warning, no share bookkeeping — the forfeited ante is the entire penalty, and marking the player's record on top of it would punish them twice for a table that never ran. (Deny the YAML instead if the config is the problem.) This is enforced in three places that must agree: `adminRemoveCasinoSlot` refuses `mode:'kick'` unless the mission is `inprogress`; `adminKickMissionParticipant` skips the warning when `forming && type === 'casino'`; and `MissionsPage` shows one **⊘ Remove seat** button instead of the Void/Kick pair (`splitRemoval = isCasino && isLive`). Non-casino missions have no wager to forfeit, so they keep warning on any kick. Pre-deploy voids also skip the `casinoVoidedShare` increment — `casinoShareUnits` is banked *at deploy* from whoever is still seated, so a seat pulled beforehand was never in the denominator to be released from.

**The pot is measured in seat units.** `mission.casinoShareUnits` is banked at deploy (the number of seats that had `played`) because a removed seat is *deleted* from `participants` and cannot be counted later. `mission.casinoVoidedShare` accumulates every released fraction. Settlement then uses:

```
D = casinoShareUnits − casinoVoidedShare        (denominator)
U = pot / D                                      (one seat unit)
weight = ownRemainingCards / lockedCount  +  Σ claimed slots' claimedFraction
```

- **`lockedCount`** is stamped on the seat at lock and never moves, so repeated removals each carve a consistent `1/lockedCount` instead of a growing slice of a shrinking hand. `resubmitCasinoYaml`'s card re-pick restamps it.
- Unclaimed kick reserve is **never paid** — the pot deliberately underpays rather than rewarding the seats that happened to stay. Voids are the opposite: they raise every survivor's share.
- `casinoPotShares` / `casinoTableShares` / `seatPotWeight` / `casinoShareDenominator` live in `missionLogic.ts`. **Gold settlement is client-side only** (`completeMission` in `db.ts`; `onMissionComplete` merely snapshots profiles), so there is no server mirror of this math.

**Claimed slots.** A claim is only ever offered from an **in-progress** table, so the Archipelago room already exists and the claimant adopts a *live* slot — no ante, no deal, no config to submit, and `claimMissionSlot` charges nothing and does **not** consume a mission claim. Limits: one claimed slot per player per table (a player already seated there may take one extra). The claimed slot is appended to both `slots` and `lockedCards` so every existing consumer keeps working, and is marked on the slot itself with `claimed` / `claimedFraction` / `claimedFrom`. **The fraction lives on the slot, not on the participant** — it was carved off a *different* seat with a different `lockedCount`, so a seat-level total could not say which slot contributed what.

> **A claimed card pays FLAT — no deck boost.** `seatGoldSwing` boosts only the seat's own hand; the claimant never chose the deck. Anything that rebuilds `slots`/`lockedCards` must preserve claimed slots and re-derive `goldSwing` through it — `resubmitCasinoYaml` does both (its card re-pick re-appends them, and its config-only path skips them, since a claimed card came from another player's deck and is absent from this player's manifest). `completeMission` also gates the **Coat of Many Colors** credit on `played`, or four claims would buy the Coat without ever playing a hand.

The table is opened with URL params `?missionId=<id>&mission=<label>`. Each seat corresponds to one `GMParticipant` in the mission. A participant's deadline (`startBy`) triggers a 15-minute countdown warning in the UI.

**Entry costs are per-variant and live in `CASINO_GAMES` (`casinoData.ts`)**, not in `constants.ts` — each game carries its own `ante` / `rerollCost` / `playOn`, summed for a seat by `seatSpend(game, { rerolled, playedOn })`. `CASINO_START_STATS`, `CASINO_START_GOLD`, `CASINO_GOLD_FLOOR`, and `CASINO_OPEN_TABLES` are in `constants.ts`.

> **Enlist gold = the table's FULL finish cost, not a flat minimum.** Both the server (`enlistInMission`) and `computeMissionCard` gate on `seatSpend(game, { playedOn: true })` — Hold 'Em needs **200** (80 ante + 120 play-on), Blackjack 150, Five Card Draw 180, Seven Card Stud 210 — so a seat can never lock in and then be unable to finish (forced fold). There is no `CASINO_MIN_ENLIST_GOLD` constant; the old family-keyed `CASINO_ANTE` / `CASINO_REROLL_COST` and the static `MISSION_DEFS.casino.entryCosts` were removed — `CASINO_GAMES` is the sole cost source of truth.

> **Odds drift baselines against the table's OWN roll.** Each table rolls its own release/collect at creation (`rollTableSetup`), so `mission.casinoStats` is meaningless to diff against a fixed 60/30. `freshCasinoTable` / `gmFreshCasinoTable` bank a frozen `casinoOpenStats` copy of that roll; `ChallengePanel` diffs against it (via the `open` prop) and hides the XP/Reward row in a casino season (`showXp={shell !== 'casino'}`, since gambit XP is paid out as gold there). Both builders — client and functions — must set `casinoOpenStats`.

The economy is tuned as a whole — antes, card values, and the pot formula are balanced against each other so two average cards turn a modest profit. **Re-run `npm run econ` after touching any of them**; it models real tables from the live engine values.

> **Casino engine duplication**: `functions/src/casinoEngine.ts` is a single-file server-side consolidation of the four client casino modules (`casinoData.ts`, `casinoEngine.ts`, `casinoGambits.ts`, `casinoSlots.ts`), plus the server-only `CASINO_POT_CUT_PCT` constant. **Any change to casino card/gambit/slot logic or constants must be reflected in both the client files and `functions/src/casinoEngine.ts`.**

> **Pot is variable, banked at creation.** Casino tables roll their opening pot in `rollTableSetup` (`4×seats² + randInt(0,150−R−C) + 2×(120−R−C)`) — there is no flat pot seed. Both table builders (`freshCasinoTable` client / `gmFreshCasinoTable` server) bank it as `casinoOpenPot` alongside `casinoOpenStats`, because the pot then grows via ante cuts and the opening amount is never logged. The admin pot-check and the season money-in audit diff against `casinoOpenPot`. Non-casino missions still route through `freshMission`/`gmFreshMission` (which honour an optional flat `def.potSeed`); casino never does.

### Keymaster's Keep

A co-op task-list system stored at the **top-level `kmkEvents/`** node in Firebase, separate from the tile map and missions. **KMK is global — not season-scoped** (it survives the eventual `game/` deletion and renders under any season shell via a `#keep/{listId}` route hoisted above the Season/GameState providers in `App()`). Admin writes key off the global `config/adminId`, KMK's only tie into the rest of the system.

**Data shape**: `KmkList` → `areas: Record<string, KmkArea>` → `tasks: Record<string, KmkTask>`. Tasks have a `status` (`KmkStatus`: `'Incomplete' | 'Pending' | 'Verifying' | 'Complete'`) and an optional claimed player.

**Active lists**: there is **no single active-list pointer** — the old `gameState.meta.kmkActiveListId` was removed. Each `KmkList` carries its own **`active: boolean`** flag, so **multiple lists may be active at once**. `KmkProvider` derives `activeListIds` from the flags; the UI handles several simultaneously-active lists.

**Player flow**: claim a trial (`Incomplete → Pending`), mark it done (`Pending → Verifying`), abandon (`Pending → Incomplete`), or resume (`Verifying → Pending`). Areas can be locked by admin to prevent claiming.

**Admin flow**: import a list from CSV rows (`{ area, trial, desc }`), toggle a list active/inactive (`kmkSetListActive`), lock/unlock areas, override task status, override the assigned player, or delete a list.

State and callbacks live in `KmkProvider` / `KmkContext` (subscribed to `kmkEvents/`, exposing `activeListIds`). All writes go through `db.ts` `kmk*` functions. The admin tab renders in `src/components/admin/kmk/KmkPage.tsx`.

### File map

| Path | Role |
|------|------|
| `src/types/index.ts` | All TypeScript types for game entities |
| `src/lib/constants.ts` | Grid dims, tile types, orbs, traits, items, feats, shops, level thresholds |
| `src/lib/tileGen.ts` | Seeded RNG, grid layout, `generateTileStats`, `buildDefaultTileData`, `getBossLiveStats` |
| `src/lib/gameLogic.ts` | XP/level math, feat bonuses, adventurer reward calculation, `computeRecalcUpdates`, `awardTileRewards`, `adventurerCountForLevel`, `missionClaimCapacity` |
| `src/lib/missionLogic.ts` | Mission card computation, decay/deploy logic, `currentMaxSlots`, `seatTally` (display seat count), `computeMissionCard`, `freshMission`, and the weighted casino pot split (`casinoPotShares`, `casinoTableShares`, `seatPotWeight`, `casinoShareDenominator`) |
| `src/lib/slotHelpers.ts` | Slot normalization (`normalizeSlots`, `slotsFromEntry`, `normalizeClaimEntry`, `claimEntries`, `claimableCount`) + shared slot-completion core (`slotsAllFree`, `countUnfinishedSets`) used by both Challenge adventurer-release and Mission claim-reclaim |
| `src/lib/archipelagoApi.ts` | Cheesetracker/AP helpers: `deriveSlotStatus`, `parseCheeseTs`, `extractApSlotName`, `resolveNumberedSlotName`, `fetchRoomStatus` |
| `src/lib/statusReport.ts` | Status-report classification + official-report builder/markdown (`computeStatusReport`, `buildOfficialReport`) |
| `src/firebase/config.ts` | Firebase init, exports `db`, `auth`, `functions`, `storage` |
| `src/firebase/season.ts` | Season path helpers (`sPath`/`sRef`/`secretPath`), `setCurrentSeason`, season resolution |
| `src/firebase/casinoYaml.ts` | `uploadCasinoYaml` → owner-scoped Storage |
| `src/firebase/db.ts` | All RTDB read/write functions (season-scoped via `season.ts`) |
| `src/contexts/AuthContext.tsx` | Discord OAuth, player upsert |
| `src/contexts/SeasonContext.tsx` / `SeasonProvider.tsx` | Season resolution, `useSeason`/`useIsAdmin`, draft preview |
| `src/contexts/GameStateContext.tsx` | Active-season subscription, all action callbacks |
| `src/contexts/KmkContext.tsx` / `KmkProvider.tsx` | Keymaster's Keep context + `kmkEvents/` subscription (derives `activeListIds`) and action callbacks |
| `src/contexts/ToastContext.tsx` | Toast notification context |
| `src/components/Header.tsx` | Site header with nav/branding |
| `src/components/PlayerHUD.tsx` | Player XP/gold/level status bar |
| `src/components/LoginModal.tsx` | Discord login prompt |
| `src/components/PrivacyModal.tsx` | Privacy policy / terms modal |
| `src/components/MapGrid.tsx` | Renders the 5×7 tile grid |
| `src/components/Tile.tsx` | Individual tile cell |
| `src/components/TileLightbox.tsx` | Lightbox for non-town tiles |
| `src/components/ProfileLightbox.tsx` | Player profile, adventurers, feat selection, name color |
| `src/components/ActivityFeed.tsx` | Collapsible real-time event feed |
| `src/components/OrbBar.tsx` | Orb collection display |
| `src/components/HelpModal.tsx` | Help modal shell |
| `src/components/help/` | Help section components (11 sections: Overview, Map, Adventurers, Feats, Traits, Boss, Challenges, Shop, Orbs, Yaml, Missions) |
| `src/components/lightbox/` | Lightbox sub-components (AvailableState, InProgressState, CompleteState, TownLightbox, BossSection, AdvRow, PublicSlotsList, ClaimableSlots, TileDetails, lbHelpers, GuildmasterMissions) |
| `src/components/AdminDashboard.tsx` | Admin dashboard shell (tabs: challenges, missions, casino, report, kmk, map, players, shops, orbs) |
| `src/components/admin/` | Admin dashboard tabs: ChallengesPage, PlayersPage, ShopsPage, OrbsPage, MapPage, MissionsPage, StatusReportPage |
| `src/components/admin/kmk/` | KmkPage (tab shell), KmkImport (CSV import form), KmkLedger (task list UI) |
| `src/components/admin/mapPage/` | Map page sub-editors: MapGridPanel, AdvSlotEditor, PublicSlotEditor, ClaimableBonusEditor, TraitEditor |
| `src/components/admin/playersPage/` | PlayerCard sub-component |
| `functions/src/index.ts` | Cloud Functions — contains `ITEM_COSTS` table that must mirror `SHOP_ITEMS` in `constants.ts` |
| `functions/src/casinoEngine.ts` | Server-side casino engine — consolidates all four `src/lib/casino*.ts` files; must stay in sync with them |
| `database.rules.json` | Firebase security rules |
| `src/lib/casinoData.ts` | Deck definition, card types, `buildDeck`, `shuffle` |
| `src/lib/casinoEngine.ts` | Pure hand evaluation: `evaluatePoker`, `evaluateBlackjack`, `DrawableDeck` |
| `src/lib/casinoGambits.ts` | Gambit deck definitions, `makeGambitDeck`, `applyGambit` |
| `src/lib/casinoSlots.ts` | `cardsToSlots`, `handStake`, `handStakeFromSlots` — card→AdvSlot bridge |
| `src/components/casino/CasinoShell.tsx` | Casino-season landing shell (rendered when the season's shell is `casino`). Renders **one `PhasePanel` per table the player is seated at** (`myTables`) — pooled claims let a player hold several at once; **held (active) claims sort above freed (settling) ones**, and every table shows until it completes. Falls back to a single Ledger/empty panel when they hold none. |
| `src/components/casino/PhasePanel.tsx` | Per-table panel; phase is backend-owned (forming→Seated, inprogress→Board, complete→Ledger). One instance per seat; `mission=null` renders the Ledger (last settled) or empty prompt. |
| `src/components/casino/OddsTrio.tsx` | Rolled Release/Collect/Hint display, shared by table cards and the phase panel |
| `src/components/casino/useLastSettled.ts` | Finds the player's most recent settled table in `missionsHistory` (the Ledger's subject) |
| `src/casino/CasinoTable.tsx` | Casino table root component; owns the phase state machine (`deckselect → ante → play\|(holdwait→holdplay) → gambit → locked → deployed`) and Firebase subscription. Game is read from `mission.casinoGame`; costs from `CASINO_GAMES`/`seatSpend`. |
| `src/casino/CardFace.tsx` | Single playing card render |
| `src/casino/GambitCardFace.tsx` | Gambit card render |
| `src/casino/TableComponents.tsx` | PotDisplay, Seat, ChallengePanel, PokerReadout, BlackjackGauge, ResultRow |
| `src/casino/MissionBar.tsx` | Mission slot display strip shown below the table |
| `casino/table.html` | Casino table HTML entry point |
