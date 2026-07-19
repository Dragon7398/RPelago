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
| `exchangeDiscordCode` | HTTP request | Discord OAuth code exchange → Firebase custom token |
| `purchaseShopItem` | Callable | Validates and deducts gold, adds item to inventory. Rejects disabled players. |
| `purchaseShopOrb` | Callable | Atomically claims orb, deducts gold. Rejects disabled players. |
| `onTileComplete` | DB write on `game/tiles/{coord}/state` | Fires when a tile reaches `complete`; updates `profiles/` with XP snapshot and game stats. |
| `onOrbAcquired` | DB create on `game/orbState/{orbId}` | Removes boss traits unlocked by the acquired orb. |
| `pruneActivityLog` | DB create on `game/activityLog/{entryId}` | Trims the activity log to the most recent 25 entries. |
| `enlistInMission` | Callable | Adds player to a forming mission; auto-deploys if now full. |
| `standDownFromMission` | Callable | Removes player from a forming mission (not allowed once deployed). |
| `setMissionParticipantStatusNote` | Callable | Updates a participant's status note. |
| `claimMissionSlot` | Callable | Atomically claims a claimable slot on a mission (parallel to tile claim logic). |
| `adminKickMissionParticipant` | Callable | Kicks a participant and creates a claimable slot. |
| `adminForceDeploy` | Callable | Admin-forces a forming mission into `inprogress`. |
| `onMissionComplete` | DB create on `game/missionsHistory/{missionId}` | Fires when a mission is completed; updates `profiles/` with XP snapshot and mission count. |
| `tickGuildmasterMissions` | Scheduled every 15 minutes | Auto-deploys any forming mission whose decay has reduced max slots to the current fill count. |

> DB triggers now watch the **season-scoped** paths (`seasons/{id}/…`), not the legacy top-level `game/…` shown above.

The **casino/season** functions (also in `index.ts`) are the money-and-secret-authoritative half — clients are never trusted with hands, decks, gold, or the pot. Key ones: `dealCasinoHand` / `dealHoldemHole` / `holdemPlayOn` / `holdemFold` / `casinoFold` (deal & seat lifecycle), `dealGambitOffer` + `playCasinoGambit` (server-authoritative shared gambit deck), `lockCasinoResult` (commit → slots + gold), `resubmitCasinoYaml` / `adminDenyCasinoYaml` / `adminGetCasinoYamls` (config workflow), `weeklyGoldTopUp` (Sat 06:00 America/Chicago floor top-up → `goldTopUpLog`), and `resolveWriteSeason` (the shared seasonId resolver every casino callable runs first). **Deploy functions before the frontend** so a new client never calls a callable the server lacks.

> **Disable is a two-part kill-switch.** `adminSetPlayerDisabled` (what `setPlayerDisabled` → the admin Players toggle calls) sets the per-season RTDB flag `players/{uid}/disabled` **and** disables the Firebase Auth account (+ `revokeRefreshTokens`). The RTDB flag alone can't stop the direct client→Storage YAML upload — Storage rules can't read RTDB — so the Auth disable is the only thing that gates uploads (an already-issued ID token lingers up to ~1h). It refuses to disable the caller's own account.

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

Mission state machine: `forming → inprogress → complete`. `player.activeMission` holds the current mission ID (or null); a player may only be in one mission at a time.

**Decay mechanic**: max slots reduce by 1 per 24h after the first participant joins (`currentMaxSlots()` in `missionLogic.ts`). `tickGuildmasterMissions` (scheduled every 15 min) auto-deploys any forming mission where fill count has reached the decayed max. Deployment also fires immediately on enlist if full.

`claimableSlots?: Record<string, AdvSlot[]>` on missions mirrors the tile claimable slot mechanic — created when a participant is kicked. `slotsLocked` prevents slot edits once locked by admin.

`seedInitialMissions()` in `db.ts` bootstraps the first Basic Training and Patrol cohorts; it is a no-op if missions already exist. The admin Missions page allows state transitions, slot editing, kicking, force-deploy, and slot lock.

### Activity log

Real-time event feed stored in `game/activityLog` in Firebase, automatically pruned to 25 entries by the `pruneActivityLog` Cloud Function trigger. Events are written on tile completions, in-progress state changes, tile availability changes, orb collection, item purchases, orb purchases, mission deploys, and mission completions. Each `ActivityEntry` has `id`, `timestamp`, `type` (`ActivityType`), `message`, and `icon`. The collapsible `ActivityFeed` component renders this in the UI.

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

**Phase flow** (backend-owned; `CasinoTable.tsx` mirrors mission state into it): `deckselect → ante → play | (holdwait → holdplay) → gambit → manifest → locked → deployed`, with `folded` off `play`/`holdplay`. The game is pinned per-table in `mission.casinoGame` (no in-table game choice). A `resubmitting` flag reuses the `manifest` phase for post-lock config edits (see below).

Two card games are offered:
- **Poker** — player commits cards; reward = sum of committed card values (no combo multiplier).
- **Blackjack** — player draws until 6 cards, must drop one to lock; reward = sum of remaining card values.

After locking a hand, the player is dealt **gambit cards** that shift shared `casinoStats` (release %, collect %, hint cost) for the entire mission cohort. Bonus gambits cost gold; penalty gambits add XP and pot to the mission.

Locked cards are converted to mission `AdvSlot`s via `cardsToSlots()` (`casinoSlots.ts`): each card becomes a slot with blank `name`/`game` and the card's genre + gold value stamped into `details` (format: `"Genre · Ng"`).

**Config (YAML) submission workflow** — the manifest phase is the submission, gated end-to-end:
- **Required to lock in.** The `manifest` phase collects a game per committed card AND an attached Archipelago `.yaml` (uploaded owner-scoped to Storage). `lockCasinoResult` independently verifies both server-side.
- **Player resubmit** (`resubmitCasinoYaml`): reopens the `manifest` view seeded from the seat's `lockedCards` + slots, so the player can reorder games (↑/↓) or attach a new file. Allowed while **forming** (self-tweak) or whenever **denied** (even in-progress). Re-stamps only game/name onto existing slots.
- **Host deny** (`adminDenyCasinoYaml`): ⛔ in the admin Casino tab. Deletes the stored file and sets `participant.yamlDenied` (+ optional reason). The landing surfaces a resubmit notice; a badge marks the seat in admin.
- **Leave invalidates**: `deleteSeatYaml` runs on stand-down / kick / deny; `clearSeatSecrets` nulls the seat's secret hand/deck on those same paths (an orphaned secret would otherwise block re-sitting with *"Finish or fold your current hand first"*).
- **Admin download** (`adminGetCasinoYamls`, admin-only callable via Admin SDK): per-seat `.yaml` and a `.zip` of all seats (via `fflate`) — deliberately never a single combined file.

The table is opened with URL params `?missionId=<id>&mission=<label>`. Each seat corresponds to one `GMParticipant` in the mission. A participant's deadline (`startBy`) triggers a 15-minute countdown warning in the UI.

**Entry costs are per-variant and live in `CASINO_GAMES` (`casinoData.ts`)**, not in `constants.ts` — each game carries its own `ante` / `rerollCost` / `playOn`, summed for a seat by `seatSpend(game, { rerolled, playedOn })`. `CASINO_START_STATS`, `CASINO_MIN_ENLIST_GOLD`, `CASINO_START_GOLD`, `CASINO_GOLD_FLOOR`, and `CASINO_OPEN_TABLES` are in `constants.ts`. (`CASINO_ANTE` / `CASINO_REROLL_COST`, the old family-keyed model, are now dead — defined in `constants.ts` but referenced nowhere; remove once nothing imports them.)

> **Odds drift baselines against the table's OWN roll.** Each table rolls its own release/collect at creation (`rollTableSetup`), so `mission.casinoStats` is meaningless to diff against a fixed 60/30. `freshCasinoTable` / `gmFreshCasinoTable` bank a frozen `casinoOpenStats` copy of that roll; `ChallengePanel` diffs against it (via the `open` prop) and hides the XP/Reward row in a casino season (`showXp={shell !== 'casino'}`, since gambit XP is paid out as gold there). Both builders — client and functions — must set `casinoOpenStats`.

The economy is tuned as a whole — antes, card values, and the pot formula are balanced against each other so two average cards turn a modest profit. **Re-run `npm run econ` after touching any of them**; it models real tables from the live engine values.

> **Casino engine duplication**: `functions/src/casinoEngine.ts` is a single-file server-side consolidation of the four client casino modules (`casinoData.ts`, `casinoEngine.ts`, `casinoGambits.ts`, `casinoSlots.ts`), plus the server-only `CASINO_POT_CUT_PCT` constant. **Any change to casino card/gambit/slot logic or constants must be reflected in both the client files and `functions/src/casinoEngine.ts`.**

> **Pot is variable, banked at creation.** Casino tables roll their opening pot in `rollTableSetup` (`4×seats² + randInt(0,150−R−C) + 2×(120−R−C)`) — there is no flat pot seed. Both table builders (`freshCasinoTable` client / `gmFreshCasinoTable` server) bank it as `casinoOpenPot` alongside `casinoOpenStats`, because the pot then grows via ante cuts and the opening amount is never logged. The admin pot-check and the season money-in audit diff against `casinoOpenPot`. Non-casino missions still route through `freshMission`/`gmFreshMission` (which honour an optional flat `def.potSeed`); casino never does.

### Keymaster's Keep

A co-op task-list system stored in `game/kmkLists/` in Firebase, separate from the tile map and missions. The active list ID is tracked in `gameState.meta.kmkActiveListId`.

**Data shape**: `KmkList` → `areas: Record<string, KmkArea>` → `tasks: Record<string, KmkTask>`. Tasks have a `status` (`KmkStatus`: `'Incomplete' | 'Pending' | 'Verifying' | 'Complete'`) and an optional claimed player.

**Player flow**: claim a trial (`Incomplete → Pending`), mark it done (`Pending → Verifying`), abandon (`Pending → Incomplete`), or resume (`Verifying → Pending`). Areas can be locked by admin to prevent claiming.

**Admin flow**: import a list from CSV rows (`{ area, trial, desc }`), set it as the active list, lock/unlock areas, override task status, override the assigned player, or delete a list.

State and callbacks live in `KmkContext` (subscribed to `game/kmkLists/`). All writes go through `db.ts` `kmk*` functions. The admin tab renders in `src/components/admin/kmk/KmkPage.tsx`.

### File map

| Path | Role |
|------|------|
| `src/types/index.ts` | All TypeScript types for game entities |
| `src/lib/constants.ts` | Grid dims, tile types, orbs, traits, items, feats, shops, level thresholds |
| `src/lib/tileGen.ts` | Seeded RNG, grid layout, `generateTileStats`, `buildDefaultTileData`, `getBossLiveStats` |
| `src/lib/gameLogic.ts` | XP/level math, feat bonuses, adventurer reward calculation, `computeRecalcUpdates`, `awardTileRewards` |
| `src/lib/missionLogic.ts` | Mission card computation, decay/deploy logic, `currentMaxSlots`, `computeMissionCard`, `freshMission` |
| `src/lib/slotHelpers.ts` | Slot normalization utilities (`normalizeSlots`, `slotsFromEntry`) |
| `src/firebase/config.ts` | Firebase init, exports `db`, `auth`, `functions`, `storage` |
| `src/firebase/season.ts` | Season path helpers (`sPath`/`sRef`/`secretPath`), `setCurrentSeason`, season resolution |
| `src/firebase/casinoYaml.ts` | `uploadCasinoYaml` → owner-scoped Storage |
| `src/firebase/db.ts` | All RTDB read/write functions (season-scoped via `season.ts`) |
| `src/contexts/AuthContext.tsx` | Discord OAuth, player upsert |
| `src/contexts/SeasonContext.tsx` / `SeasonProvider.tsx` | Season resolution, `useSeason`/`useIsAdmin`, draft preview |
| `src/contexts/GameStateContext.tsx` | Active-season subscription, all action callbacks |
| `src/contexts/KmkContext.tsx` | Keymaster's Keep subscription and action callbacks |
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
| `src/components/AdminDashboard.tsx` | Admin dashboard shell (tabs: challenges, missions, kmk, map, players, shops, orbs) |
| `src/components/admin/` | Admin dashboard tabs: ChallengesPage, PlayersPage, ShopsPage, OrbsPage, MapPage, MissionsPage |
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
| `src/components/casino/CasinoShell.tsx` | Casino-season landing shell (rendered when the season's shell is `casino`) |
| `src/components/casino/PhasePanel.tsx` | Current-table panel; phase is backend-owned (forming→Seated, inprogress→Board, complete→Ledger) |
| `src/components/casino/OddsTrio.tsx` | Rolled Release/Collect/Hint display, shared by table cards and the phase panel |
| `src/components/casino/useLastSettled.ts` | Finds the player's most recent settled table in `missionsHistory` (the Ledger's subject) |
| `src/casino/CasinoTable.tsx` | Casino table root component; owns the phase state machine (`deckselect → ante → play\|(holdwait→holdplay) → gambit → locked → deployed`) and Firebase subscription. Game is read from `mission.casinoGame`; costs from `CASINO_GAMES`/`seatSpend`. |
| `src/casino/CardFace.tsx` | Single playing card render |
| `src/casino/GambitCardFace.tsx` | Gambit card render |
| `src/casino/TableComponents.tsx` | PotDisplay, Seat, ChallengePanel, PokerReadout, BlackjackGauge, ResultRow |
| `src/casino/MissionBar.tsx` | Mission slot display strip shown below the table |
| `casino/table.html` | Casino table HTML entry point |
