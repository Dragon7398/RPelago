# RPelago Season 2 — Map, Districts, Companions & Dungeons

Implementation plan for the S2 map season ("Capital Ward"). Sources: the hi-fi
map bundle (`README.md`, `COMPANIONS.md`, `RPelago Season 2 Map.dc.html`,
`Companion Roster.dc.html`), the dungeon bundle (`Season 2 Handoff.md`,
`maze.jsx`, `app.jsx`, `dungeon-view.jsx`, `tile-lightbox.jsx`), plus the
decisions recorded below.

> **The map design wins over the dungeon design wherever they conflict.** The
> dungeon bundle is older and disagrees on board size, start tile, towns, elite
> placement, orb counts and win conditions. Every deviation is catalogued in
> §3.0 with its resolution — read that before touching `maze.jsx`-derived logic.

S2 is authored as a **draft season** (`rpelago_s2`) per
[season-architecture-plan.md](season-architecture-plan.md) — nothing here is
visible to players until the season is launched, so all of it can land
incrementally on `main` behind the draft flag.

---

## 0. Decisions locked

These came out of the design review and supersede anything in the handoff docs
that contradicts them.

| # | Decision |
|---|----------|
| 1 | **Board geometry is per-season.** Archived S1 must keep rendering as a 5×7 board with its boss/towns. S2's surface is **6 rows × 7 cols**. |
| 2 | **No `town` tiles in S2.** Castle (**D6**, bottom-middle) is the only auto-revealed start tile. |
| 3 | **Placement is seeded**, honouring the distance bands. Elites: Manhattan ≥3 from the Castle, **not on an edge**, not adjacent to each other. |
| 4 | XP curve / level thresholds / adventurer grants are **not retuned here** — S2 gets a much higher max level and a new feat set in a later design pass. |
| 5 | Dungeons and the Tower are **real sub-maps** built in Phase 3 — enterable mazes of Archipelago challenges, not placeholders. |
| 6 | **Dungeons and the Tower cascade like S1 towns** on the surface: revealing one immediately reveals its neighbours. They are never auto-completed. |
| 7 | **9 orbs, one per elite** — **3 surface elites + 2 per dungeon**. No shop orbs, no edge-tile orbs, no orb purchasing. |
| 8 | Orb→boss-trait machinery is **kept and re-pointed at the Floor 3 Sorcerer**. |
| 9 | Tower gating: **3 orbs → Floor 1, 5 → Floor 2, 7 → Floor 3.** |
| 10 | **All current feats retire.** The four YAML feats are replaced by companions; Mentor / Treasurer / Seeker are retired pending rework. **Advisor** (mission claim capacity 2) becomes an S2 level-up reward, mirroring S1's adventurer grants. "+1 companion party slot" becomes a future feat. |
| 11 | Companion party is a **per-mission snapshot**, locked when the tile/mission goes `inprogress`. |
| 12 | Battle/Puzzle typing for companion effects: **elite counts as Battle**; missions are untyped; dungeon/tower interiors carry their own battle/puzzle/elite tiles and type normally when they ship. |
| 13 | **Field Work is a real Guildmaster Mission** (an actual Archipelago), rethemed as *exploring the fields* for companions. The two-creature choice is the completion reward. |
| 14 | Companions earn XP from **both** tile Challenges and Guildmaster Missions. |
| 15 | `Math.round`; companion percentages stack **additively** with every other bonus. |
| 16 | **Check Count** raises **both** the global 2,000-check YAML ceiling **and** the `agile` trait cap. It does **not** affect `sturdy`. |
| 17 | Shops collapse to **one global shop**; the expanded equipment/consumable system is a future design. |
| 18 | The **Casino district swaps the landing view** to a casino landing (like the S1.5 landing) where players pick a table — it is not a modal. |
| 19 | Town Hall holds the normal missions; **Casino and Field Work missions live in their own districts**. Districts are **visible but not clickable** when logged out. |
| 20 | Companion sprites keep their **numeric ids** as the stable DB key; files may be renamed to slugs on disk. |
| 21 | **Three phases**: Phase 1 = board + districts; Phase 2 = companions + Field Work; Phase 3 = dungeons + Tower. All inside the same draft season. |
| 22 | The S2 gold-seed migration is **deferred** — it lands with the rest of the S2 launch checklist, not here. |
| 23 | **Tower reuses the S1 boss color** (it holds the season's goal tile). **Castle inherits the vacated town rung.** **Dungeon is the only new color token** — Arcane Violet, tuned per theme (§1.2a). |
| 24 | **Tower distance band is 8, not 9.** On a 6×7 board the maximum Manhattan distance from D6 is 8 — solving `\|r−5\|+\|c−3\| = 8` yields exactly **A1 and G1**, preserving the "seeded pick of two top corners" structure. |
| 25 | **Puzzles are fixed counts, not a ratio** — battles are the remainder. Surface: **12 puzzles / 22 battles** of 34 fillers. Dungeon: **5 puzzles each**. Tower: **4 puzzles per floor**. Plus the 2 Mimics (which convert to Puzzles) = **41 puzzles season-wide**. |
| 26 | Dungeons are **5×7 perfect mazes** with **two** true paths (one Elite each, ≥8 moves, shared prefix ≤3 cells). Tower floors are **5×5** with **one** true path (min 8). |
| 27 | **Only cells on a designated path are challenges**; everything else is impassable rock. Plus **decoy stubs** (1–2 cells, terminating in nothing): 2 per dungeon, 1 per Tower floor. |
| 28 | Every dungeon and every Tower floor has **two treasure dead-ends** ending in a **Chest** (≥6 moves, pairwise overlap ≤2 cells, ≤3 against either true path). |
| 29 | **Two Mimics**: one among the 6 dungeon chests, one among the 4 chests on Tower Floors 1–2. Disguised as ordinary Chests until their timer fires, then revealed as a **Puzzle challenge authored in advance**. |
| 30 | Tower portals: **Floor 1 = bottom-middle**; Floors 2 and 3 open at the **same cell as the stairs from the floor below**, so floors must generate **sequentially**. Players may freely **ascend and descend**. |
| 31 | **Win condition**: the Sorcerer falls on Floor 3 → the surface Tower tile flips to *Conquered*. **No automatic season state change** — the admin winds down manually so in-flight challenges can finish. |
| 32 | **Every challenge and mission collects a YAML at join** (§0.5). Joining becomes one step — *declare slots, attach config* — enforced server-side. Tile joins move from client RTDB writes to **callables**. |
| 33 | **Traits become leveled** (§0.6, full spec in [season-2-traits-plan.md](season-2-traits-plan.md)). The data model lands with §0.5; generation and UI are later passes, two of them blocked on open design questions. |

### Decisions made while planning (flagging for confirmation)

- **`players/{uid}/party` survives as a *default* party** that pre-fills each new
  join; the authoritative per-challenge value is the snapshot on the
  `TileAdventurer` / `GMParticipant`. This reconciles the two conflicting
  statements in `COMPANIONS.md` (per-mission parties vs. a single stored party)
  without forcing the player to re-pick from scratch every time.
- **Companion XP grants normalize to the floor first**, then add:
  `newXp = max(stored, floor(playerXP / 25)) + gain`. Without this, a duplicate
  catch or a mission win on a pet sitting at the floor would award XP that
  vanishes into `max()`.
- **`typeKey` is persisted onto each tile record** in S2. Today the type is
  derived from the seed at runtime, which means the DB rules can't see it —
  and the "no joining a dungeon" restriction needs server-side enforcement.
- **Field Work's 500 GP is charged at enlist and refunded on stand-down**,
  matching casino ante semantics.

---

## 0.5 Universal YAML-at-join (cross-cutting)

**Every** S2 challenge and mission collects an Archipelago config at join. This
is the biggest process win from S1.5 and it generalises to the whole season.
Specced once here because all three phases depend on it: Phase 1 (surface tile
joins), Phase 2 (Field Work enlist), Phase 3 (dungeon/Tower interior joins).

**Casino timing is unchanged.** Casino collects at the `manifest` phase, not at
enlist, because the games depend on which cards were committed. Nothing in this
section alters that flow — it generalises the *pattern* to everything else.

### 0.5.1 The join step

Joining becomes one action: **declare your slots, attach your config.**

- The player declares **1–5 slots**, each with a `name` and `game`, populating
  `AdvSlot.name` / `AdvSlot.game` immediately rather than being filled in later.
- Slot count is the player's free choice in that range. **Traits can raise the
  floor but not the ceiling** — Horde requires at least `values[level − 1]`
  games (∈ {2, 3, 4}, resolved via `resolveTrait` — see §0.6). Constraints that
  bound *checks* rather than slot count (Agile, Sturdy) and companion
  `checkCount` are shown at join as guidance, not enforced by the form.
- One YAML per **(player, container)**. A bifurcated tile still takes one config
  per player, not one per room — room assignment happens at deploy.
- **Public slots are exempt** — they have no player owner; the admin supplies
  those configs.

### 0.5.2 Tile joins become callables

This is the structural change. `assignAdventurer` and `claimClaimableSlot` are
direct client RTDB writes today, and **a database rule cannot see a Storage
object**, so the requirement is unenforceable on that path. Both move to Cloud
Functions:

| Callable | Replaces | Verifies |
|----------|----------|----------|
| `joinChallenge` | `assignAdventurer` (client write) | YAML object exists at the container path; tile is `available`; adventurer is free and owned by caller; player not already on the tile; `filled < required`; slot count within 1–5 and any `horde` floor |
| `claimChallengeSlot` | `claimClaimableSlot` (client write) | tile is `inprogress`; adventurer free and owned by caller; player not already on the tile; the claimable slot still exists — atomically consuming it. **No YAML check** — see §0.5.8 |

Consequences:

- The `adventurers/$advId` write rule tightens to **admin/server only**. Player
  joins no longer touch RTDB directly.
- **The Firebase pre-write trick disappears.** The current claimable-slot rule
  relies on `claimableSlots.exists()` evaluating against pre-write state during
  the atomic `update()` — one of the subtlest things in `database.rules.json`.
  A callable consuming the slot under the Admin SDK removes the need for it
  entirely. Net simplification of the rules file.
- Mission joins need far less: `enlistInMission` and `claimMissionSlot` are
  already callables, so each gains a YAML-existence check and slot validation.

### 0.5.3 Storage

```
yaml/{seasonId}/{kind}/{containerId}/{uid}.yaml     // kind: challenge | mission
```

| Container | `containerId` |
|-----------|---------------|
| Surface tile | tile coord — `D4` |
| Dungeon / Tower interior tile | `{surfaceCoord}__{r}_{c}` — `G1__2_3`, `tower1__0_2` |
| Mission (any type) | `missionId` |

- `storage.rules` gains a `yaml/{seasonId}/{kind}/{containerId}/{fileName}` block
  mirroring the casino one exactly: owner-scoped read/write/delete
  (`fileName == request.auth.uid + '.yaml'`), 1 MB cap, same contentType match.
- **The existing `casino/**` block stays** as the S1.5 archive — no migration.
- `src/firebase/casinoYaml.ts` generalises to `src/firebase/yamlUpload.ts`
  (`uploadYaml(seasonId, kind, containerId, uid, text)`), with `uploadCasinoYaml`
  kept as a thin wrapper over the legacy path. `MAX_YAML_BYTES` must still mirror
  the rule's cap.

> **The upload gate remains Auth-only.** Storage rules cannot read RTDB, so the
> per-season `players/{uid}/disabled` flag can't stop a direct client→Storage
> upload — only disabling the Firebase Auth account can (see `CLAUDE.md` on
> `adminSetPlayerDisabled`). Widening from one `casino/**` path to a general
> `yaml/**` tree doesn't change that mechanism, but it does widen what it
> covers, making `adminSetPlayerDisabled` more load-bearing than it was.

### 0.5.4 Deny / resubmit / cleanup

Generalised from the casino equivalents, which keep working unchanged:

| Function | Generalises | Notes |
|----------|-------------|-------|
| `adminDenyYaml({ kind, containerId, uid, reason? })` | `adminDenyCasinoYaml` | Deletes the stored file, sets the denied flags |
| `resubmitYaml({ kind, containerId, slots?, ... })` | `resubmitCasinoYaml` | **Without** the card re-selection branch — that is casino-only |
| `deleteYaml(...)` | `deleteSeatYaml` | Runs on self-recall / stand-down / deny. **Not** on kick — see §0.5.7 |
| `adminGetYamls({ kind, containerId })` | `adminGetCasinoYamls` | Per-file `.yaml` + a `.zip` of **every historical participant** (§0.5.8) via `fflate` — deliberately **never** a single combined file |

`TileAdventurer` gains `yamlDenied` / `yamlDeniedReason` / `yamlDeniedAt`, which
`GMParticipant` already carries. The admin ⛔ becomes available on any challenge
or mission, not just casino seats.

### 0.5.8 Claimable slots are exempt — they are live worlds

**Claiming a slot never involves a YAML upload.** Claimable slots exist *only*
on already-generated containers:

- Tile claimable slots are created solely by kick-from-`inprogress` or
  player-reset-from-`inprogress`.
- `claimMissionSlot` rejects unless `mission.state === 'inprogress'`
  ([functions/src/index.ts:1238](../functions/src/index.ts#L1238)).

So the multiworld is already running. The claimer **adopts the departed
player's existing slot and its live world** — a new config is not merely
unnecessary, it is impossible to honour. The claim UI therefore shows *what you
are taking over* (inherited `name` / `game` / `details`) instead of the
declare-slots-and-attach form from §0.5.1.

**The departed player's YAML is retained, not deleted** (§0.5.4). That file
describes a world that is *still in play*, and it is the host's only record of
what is running in that slot. `adminGetYamls({ kind, containerId })` therefore
returns configs for **every historical participant** of the container, not just
the current roster — labelled with the owning uid so the host can see the
succession. This is why `deleteYaml` runs on self-recall / stand-down / deny but
**not** on kick: those three mean "this config was never used", whereas a kick
leaves a live world behind.

**Rewards follow the slot, not the person.** At completion the claimer receives
the full reward and the departed player receives nothing — this is already the
behaviour and needs no work: `awardTileRewards` iterates `tile.adventurers` and
`completeMission` iterates `mission.participants`, and the kick removed the
departed player from both. The claimer also inherits any `bonusXP` / `bonusGold`
carried on the slot.

> One consequence worth being aware of rather than fixing: a claimer can inherit
> a **nearly-finished** world and collect the full reward. That is the intended
> incentive — it is the compensation for taking over someone else's abandoned
> commitment, and it is what makes claiming attractive at all.

**A kick clears the departed player's `statusIncidents` on that world.** The two
mechanisms are deliberately different in weight and must not compound:

- **Status incidents** are a *soft* counter — "this person is being nagged a lot
  to finish their slots." They accumulate quietly and roll up into the
  ≥5-incident auto-warning at completion.
- **A kick** is *rare and hard* — a warning on the account that flags someone as
  possibly not right for the community.

Once the hard consequence lands, the soft counter has done its job and should
not fire again for the same abandonment. Without this, a kicked player would be
warned twice for one incident: once by the kick, and again at completion of a
world they no longer occupy.

Implementation: null `statusIncidents/{playerId}` on the container in the **same
atomic update** as the removal, in all three paths —

| Path | Clears |
|------|--------|
| `adminKickAdventurer` (new callable, §0.5.7) | `tiles/{coord}/statusIncidents/{playerId}` |
| `adminKickMissionParticipant` (existing callable) | `missions/{missionId}/statusIncidents/{playerId}` |
| `playerReset` (new callable, §0.5.7) | the entry on **every** container it removes the player from |

### 0.5.7 Kick and reset must become callables

Two admin paths that remove a player currently write RTDB **from the client**:

| Path | Today | Must become |
|------|-------|-------------|
| `adminKickAdventurer` ([db.ts:423](../src/firebase/db.ts#L423)) | client multi-path `update()` | **callable** |
| `playerReset` ([db.ts:765](../src/firebase/db.ts#L765)) | client multi-path `update()`; also mints claimable slots for in-progress tiles ([db.ts:807](../src/firebase/db.ts#L807)) | **callable** |

The reason is the Storage rule, not the RTDB rule: `yaml/**` is owner-scoped
(`fileName == request.auth.uid + '.yaml'`), so **an admin cannot touch another
player's config file** — only the Admin SDK can. Any cleanup path where the
actor is not the file's owner has to run server-side.
`adminKickMissionParticipant` is already a callable and needs only the added
YAML handling; these two need converting.

Both must keep their current atomicity: the kick's auto-warning and the reset's
whole archive/zero/trim/claimable-slot bundle are single multi-path updates
today, and must stay single updates inside the callable.

### 0.5.5 Deploy gate

Join-time enforcement is the primary gate; the deploy check is the backstop for
everything that only resolves later (bifurcated room assignment, admin-added
slots, a denied config that was never resubmitted).

`adminSetTileState(coord, 'inprogress')` and mission deploy show a
**per-participant YAML checklist** and warn on gaps, following the existing
`completeMission` pattern — return `{ warned, missingYamls }` without acting,
let the caller confirm, then re-call. Not a hard block: an admin sometimes needs
to deploy anyway.

### 0.5.6 Tests

- `joinChallenge` rejects when no Storage object exists; accepts when it does;
  rejects slot counts outside 1–5; enforces a `horde` floor.
- `claimChallengeSlot` **succeeds with no YAML present** (§0.5.8) and copies the
  inherited slot onto the new adventurer verbatim.
- `claimChallengeSlot` consumes the slot atomically — two concurrent claims,
  exactly one wins.
- Deny deletes the file and sets the flags; resubmit re-uploads and clears them.
- Self-recall / stand-down / deny delete the file; **kick and player-reset
  retain it**, and it still appears in `adminGetYamls`.
- Reward succession: after kick-then-claim, completion pays the claimer in full
  (including inherited `bonusXP`/`bonusGold`) and pays the departed player
  nothing — for both a tile and a mission.
- A kick clears the departed player's `statusIncidents` on that container, so a
  player sitting at 4 incidents who is then kicked does **not** also receive the
  ≥5-incident auto-warning at completion. Covers tile kick, mission kick, and
  player reset across multiple containers.
- Rules: `adventurers/$advId` rejects direct player writes; the new Storage path
  is owner-scoped and enforces the 1 MB cap.
- Deploy gate reports missing YAMLs without acting, then proceeds when confirmed.

---

## 0.6 Leveled traits (cross-cutting)

Full spec: **[season-2-traits-plan.md](season-2-traits-plan.md)**. Only the parts
that entangle with this plan are repeated here.

S2 upgrades enemy traits from binary on/off to **leveled** — ten traits gain 3–5
levels, six stay binary. Same 16 traits as S1, so it is a model change plus a
rebalance, not new content.

**What this plan depends on:**

- **Tile trait entries change shape** — `{ value: number }` → `{ level: number;
  count?: number }`. No data migration; the reader tolerates the S1 shape for the
  archive.
- **All trait reads go through `resolveTrait(traitId, entry, player?)`.** The
  `player` argument is ignored at launch but must be threaded from the start: the
  replacement equipment system lets a player **reduce a trait's level for
  themselves only**, so "the level of this trait" stops being a single value.
  Reading `entry.level` directly anywhere is a future bug.
- **§0.5 — `joinChallenge` validates the Horde floor** from `values[level − 1]`
  ∈ {2, 3, 4}, not a fixed 2. This is why the trait model must land **with**
  §0.5, not after it.
- **§2.3 — companion Check Count** raises the level-resolved **Agile** cap
  (still not Sturdy).
- **Phase 3** — dungeon and Tower tiles carry traits like any challenge, and sit
  at the top of the generated difficulty scale.
- **`Tile` gains `stunnedAdvIds` / `tauntedAdvIds` / `thiefAdvIds` arrays**,
  replacing the two scalars. **Thief is system-rolled**, never admin-picked.
  The `setTileState` clearing invariant (`CLAUDE.md`) now spans three arrays.
- **The four passive shop items are deprecated**, retiring with the shop
  collapse (§1.8) — `traitEffect()` and `ITEM_TRAIT_REFS` go with them.

**Sequencing:** the model lands with §0.5; trait *generation* and the *UI*
(level meters, admin pip editor, codex) are later passes. Two of those passes are
blocked on open design questions — trait difficulty weights, and the Sorcerer's
trait loadout / orb interaction — catalogued in the traits plan §10.

---

## Phase 1 — Board, districts, shop, orbs

### 1.1 Per-season board geometry

New module **`src/lib/board.ts`** (no dependencies — it is the bottom of the
import graph):

```ts
export type BoardId = 's1' | 's2';

export interface BoardSpec {
  id:         BoardId;
  rows:       number;
  cols:       number;
  colChars:   string;
  startCoord: string;       // s1: 'D3' (r2,c3) · s2: 'D6' (r5,c3)
  startType:  TileTypeKey;  // 'town_center' | 'castle'
  hasTowns:   boolean;
  hasBoss:    boolean;
  hasShopTiles: boolean;
}

export const BOARD_SPECS: Record<BoardId, BoardSpec> = { … };

// Module state, mirroring src/firebase/season.ts's setCurrentSeason pattern:
// callers don't thread the board through every signature.
export function setActiveBoard(id: BoardId): void;
export function activeBoard(): BoardSpec;   // throws if unset

// Geometry helpers move here from constants.ts and read activeBoard():
export function coordFromRC(r: number, c: number): string;
export function rcFromCoord(coord: string): [number, number];
export function getAdjRC(r: number, c: number): [number, number][];
export function getAdjCoords(coord: string): string[];
export function isEdgeTile(r: number, c: number): boolean;
export function manhattan(a: string, b: string): number;
```

Changes:

- **`src/lib/constants.ts`** — delete `ROWS`, `COLS`, `COL_CHARS`,
  `CENTER_COORD` and the five geometry helpers; re-export the helpers from
  `board.ts` so existing import sites keep compiling, then migrate them.
- **`src/types/index.ts`** — `SeasonListEntry` / `DraftSeasonEntry` gain
  `board?: BoardId` (absent ⇒ `'s1'`, so every existing config entry keeps
  working). `ResolvedSeason` gains `board: BoardSpec`.
- **`src/contexts/SeasonProvider.tsx`** — resolve the board alongside the season
  and call `setActiveBoard(spec.id)` in the same effect that calls
  `setCurrentSeason`. This must happen **before** `GameStateProvider` subscribes,
  exactly like the season path helpers.
- **`src/components/MapGrid.tsx`**, **`src/components/admin/mapPage/MapGridPanel.tsx`**
  — read `activeBoard()` instead of the constants.
- **`src/components/PlayerHUD.tsx`** — the two `onTileClick(CENTER_COORD)` calls
  become "open Town Hall" on an S2 board.
- **`functions/src/index.ts`** — mirror `BOARD_SPECS` (it already keeps a private
  `ROWS`/`COLS`/`bossCoordFromSeed` copy for `onOrbAcquired`). Add this to the
  dual-copy list in `CLAUDE.md`.

> **Invariant to preserve:** `initializeGrid(seed)` must be called before any
> `getTypeKey` lookup. Now it also depends on the board, so `subscribeToGame`
> must resolve the board first. Persisting `typeKey` on the tile (§1.3) makes
> this progressively less load-bearing.

### 1.2 S2 tile types

- **`TileTypeKey`** gains `'dungeon' | 'tower' | 'castle'`. `'town'`,
  `'town_center'`, `'boss'` stay in the union for the S1 archive.
- **`TILE_TYPES`** gains:

  | key | label | icon | cls |
  |-----|-------|------|-----|
  | dungeon | Dungeon | 🗝️ | `tile-dungeon` |
  | tower | Tower | 🏯 | `tile-tower` |
  | castle | Castle | 🏰 | `tile-castle` |

- Castle tile keeps its 🏰 icon when `complete` (the generic complete-state ✅
  swap in `Tile.tsx` must exempt `castle`, as it already exempts towns).
- New tile progress text: dungeon → `Locked`, tower → `Sealed`, castle → `Start`.
- `.tile-dungeon` / `.tile-tower` / `.tile-castle` rules mirroring the existing
  per-type blocks (background gradient, hover border, `.tile-label` and
  `.tile-name` accents), plus `.lb-title.dungeon|tower|castle` and the
  `.ag-tile-name-*` / `.ag-tile-badge-*` agenda variants.

### 1.2a Theme tokens — the color plan

RPelago ships **ten themes**: `:root`, moonlit, verdant, aether (dark);
parchment, sakura, mint, lapis (light); obsidian, tidepool (dark). Four are
explicitly accessibility-designed — **moonlit** (CUD-safe), **lapis**
(deutan/protan light), **obsidian** (max accessibility), **tidepool**
(deutan/protan dark) — and they encode tile type on a **lightness ladder**, not
by hue. Any new type token has to earn a rung on that ladder.

**S2 adds exactly one new color.** Two of the three new types alias tokens that
are already hand-tuned in all ten themes:

```css
/* Tower holds the season's goal tile — it IS the S1 boss, visually. */
--tower-fg: var(--boss-fg);  --tower-bg-1: var(--boss-bg-1);  --tower-bg-2: var(--boss-bg-2);
/* S2 has no towns, so the town rung is vacant and already balanced everywhere. */
--castle-fg: var(--town-fg); --castle-bg-1: var(--town-bg-1); --castle-bg-2: var(--town-bg-2);
```

Aliasing (rather than copying values) means both stay correct if a theme is ever
retuned. The design bundle wanted a gold castle at hue 78; gold is rejected
because it collides with tower/boss (hue 40–95 depending on theme), and the
castle is a single permanently-complete tile at a fixed coordinate that never
needs to be distinguished at a glance.

**Dungeon — Arcane Violet, tuned per theme.** Two constraints ruled out the
simpler options:

- The blue-violet gap is only free in the *default* theme. **`puzzle` drifts to
  hue 230–250 in six of ten themes** (moonlit 230, parchment 230, mint 240,
  sakura 250, lapis 250, tidepool 230) — every light theme and all four
  accessibility themes. A flat indigo would sit 15–35° from puzzle exactly where
  that hurts most.
- The low-chroma and dark bands belong to **fog**. `--hidden-*` is chroma ~0.02
  at 8–12% L in dark themes and **72–78% L in light themes, darker than the
  tiles' 84–90%**. So "desaturated stone" and "dungeon is the dark tile" both
  read as *unrevealed*, not *underground*.

So dungeon takes a hue rung where the theme has room and a **lightness rung**
where it doesn't. Chroma is held **below elite's** in every theme, so the two
separate on two axes rather than one:

| Theme | `--dungeon-fg` | `--dungeon-bg-1` | `--dungeon-bg-2` | Separation |
|-------|----------------|------------------|------------------|------------|
| `:root` | `oklch(66% 0.14 270)` | `oklch(13% 0.06 270)` | `oklch(17% 0.05 270)` | hue |
| moonlit | `oklch(70% 0.10 290)` | `oklch(18% 0.05 290)` | `oklch(22% 0.04 290)` | L-rung 70 (66→75 gap) |
| verdant | `oklch(66% 0.12 255)` | `oklch(17% 0.06 255)` | `oklch(21% 0.05 255)` | hue |
| aether | `oklch(65% 0.13 275)` | `oklch(16% 0.06 275)` | `oklch(20% 0.05 275)` | hue |
| parchment | `oklch(36% 0.17 275)` | `oklch(82% 0.05 275)` | `oklch(86% 0.04 275)` | hue |
| sakura | `oklch(33% 0.16 288)` | `oklch(86% 0.05 288)` | `oklch(90% 0.04 288)` | hue + darkest |
| mint | `oklch(30% 0.16 278)` | `oklch(84% 0.05 278)` | `oklch(88% 0.04 278)` | hue + darkest |
| lapis | `oklch(28% 0.14 300)` | `oklch(84% 0.06 300)` | `oklch(88% 0.05 300)` | **L-rung 28** (darkest) |
| obsidian | `oklch(86% 0.12 270)` | `oklch(20% 0.07 270)` | `oklch(24% 0.06 270)` | **L-rung 86** (80→92 gap) |
| tidepool | `oklch(69% 0.11 280)` | `oklch(17% 0.06 280)` | `oklch(21% 0.05 280)` | **L-rung 69** (64→74 gap) |

Resulting ladders in the four accessibility themes (fg lightness, ascending):

- **moonlit** — battle 58 · elite 62 · castle 66 · **dungeon 70** · puzzle 75 · tower 86
- **tidepool** — battle 58 · elite 64 · **dungeon 69** · puzzle 74 · castle 80 · tower 90
- **obsidian** — battle 72 · elite 74 · castle 78 · puzzle 80 · **dungeon 86** · tower 92
- **lapis** — **dungeon 28** · puzzle 36 · elite 38 · battle 40 · castle 46 · tower 54

**Redundant, non-color channels.** Color is not the sole carrier here — every
tile already renders a distinct emoji (⚔️ 🧩 💀 🗝️ 🏯 🏰) *and* a text label, so
type survives full monochrome regardless. `.state-patterns` currently encodes
tile **state**; extend it with a type cue for the two sealed types (a corner
glyph on dungeon/tower), since those are the tiles a player must not mistake for
a joinable challenge.

**Verification pass (required before Phase 1 ships).** Check `--dungeon-fg`,
`--tower-fg` and `--castle-fg` against their own `bg-1`/`bg-2` in all four light
themes (parchment, sakura, mint, lapis) for AA contrast on the `.tile-label` and
`.tile-name` text, and simulate deutan/protan/tritan on moonlit, lapis, obsidian
and tidepool. The light-theme dungeon values above are deliberately dark
(28–36% L) and are the most likely to need a nudge.

### 1.3 S2 generator (`src/lib/tileGen.ts`)

Split the type-grid builder by board: `buildTypeGridS1` (today's function,
unchanged) and **`buildTypeGridS2(seed)`**:

The S2 surface is **6 rows × 7 cols = 42 cells**, cols A–G, rows 1–6.

1. Castle at **D6** (`r=5, c=3`), type `castle`.
2. **Tower** at Manhattan distance exactly **8** from the Castle. Solving
   `|r−5| + |c−3| = 8` on this board yields exactly **A1** and **G1** — a seeded
   pick of the two. (8 is the board's maximum distance; the design's 9 is
   unreachable at 6 rows — see decision 24.)
3. **Dungeons ×3**, one each at distance **3**, **5**, **7**; every
   dungeon/dungeon and dungeon/tower pair ≥3 apart. Seeded pick per band with
   backtracking when a band's candidate set is exhausted. The d=7 band is the
   tight one — with the Tower at A1, both A2 (d 1) and B1 (d 1) are excluded,
   leaving F1 and G2; the backtracker must be able to re-pick the Tower corner.
4. **Elites ×3** — interior cells only (`1 ≤ r ≤ 4`, `1 ≤ c ≤ 5`), Manhattan ≥3
   from the Castle, not adjacent to another elite, not on an occupied cell.
   That admits **16 candidate cells**: all of rows 1–2 (c 1–5), row 3 at
   c ∈ {1,2,4,5}, and row 4 at c ∈ {1,5}.
5. Remaining **34** cells: seeded shuffle → **12 puzzle**, **22 battle**.
   Puzzles are a **fixed count**, not a ratio (decision 25) — battles are simply
   whatever is left, which keeps the generator contract exact.

Also in `tileGen.ts`:

- `generateTileStats` — `castle` returns `{}` like towns; `dungeon`/`tower`
  return `required: 0` and no release/collect/hint/XP (the *surface* tile is a
  doorway, not a challenge — the challenges live inside, see Phase 3). Remove
  the `boss` branch from the S2 surface path (kept for S1; the S2 boss is a
  Tower Floor 3 tile).
- `buildDefaultTileData` — Castle written `complete`, `required: 0`, name
  "The Castle"; reveal cascade seeded from D6 using the pass-through rule
  (§1.4). No town auto-completion. **Persist `typeKey` on every tile record.**
- `computeTownShopIds` / `NON_CENTER_SHOP_IDS` / `tile.shopId` — retired for S2
  (kept behind `spec.hasShopTiles` for the S1 archive).
- `getBossPosition` / `isInBossCornerRegion` / `getBossLiveStats` — S1-only.
- `orbIdForEdgeTile` returns `null` on an S2 board.

### 1.4 Availability cascade — dungeon/tower pass-through

`computeRecalcUpdates` in `src/lib/gameLogic.ts` currently derives `available`
purely from neighbours of `complete` tiles. S2 adds: **a revealed dungeon or
tower also reveals its neighbours, without itself being complete.**

```ts
export function computeRecalcUpdates(
  tiles: Record<string, Tile>,
  coord: string,
  newState: TileState,
  // Injected so the function stays pure and unit-testable; defaults to the
  // tileGen lookup in production.
  isPassThrough: (coord: string) => boolean = defaultPassThrough,
): Record<string, TileState>
```

Algorithm: seed `available` from `complete` neighbours as today, then **iterate
to a fixpoint** — any tile that is `available`/`inprogress`/`complete` **and**
pass-through reveals its hidden neighbours. (Dungeons are ≥3 apart so chains
can't occur today, but the fixpoint loop costs nothing and survives future
layout changes.)

The same rule applies in `buildDefaultTileData`'s initial reveal.

### 1.5 Dungeon / Tower / Castle panels

`src/components/TileLightbox.tsx` currently branches `isTown → TownLightbox`,
`typeKey === 'boss' → BossSection`. New branches:

- **`castle`** → `CastlePanel` (ornamental: `D6 · STARTING HOLD`, dashed
  `ORNAMENTAL FOR NOW` placeholder block, the design's blurb).
- **`dungeon`** → `DungeonSection` — Phase 1 ships the sealed blurb; Phase 3
  turns it into the **Enter** door (§3.6).
- **`tower`** → `TowerSection` — replaces `BossSection`. Shows collected orbs
  and floor progress against `TOWER_FLOOR_ORBS = [3, 5, 7]`; Phase 3 adds the
  per-floor **Enter** buttons.

The *surface* dungeon/tower/castle tiles are never joinable challenges in any
phase — their content lives inside (Phase 3). Blocked in **two** places,
mirroring the existing in-progress restriction:

1. **UI** — no adventurer picker on dungeon/tower/castle tiles.
2. **DB rule** — `seasons/$seasonId/tiles/$coord/adventurers/$advId` gains
   `newData.parent().parent().child('typeKey').val() !== 'dungeon' && … !== 'tower' && … !== 'castle'`
   for non-admin writes. This is why `typeKey` is persisted (§1.3).

**Surface progress glyphs** (Phase 3 fills these in; the slot is the one that
shows `{filled}/{required} ⚔` on ordinary tiles):

- **Dungeon** — **two orb silhouettes**, each lighting up when that dungeon's
  corresponding Elite is felled and its orb taken. Both glyphs disappear once
  the dungeon is fully `complete`.
- **Tower** — **three floor pips**, lighting as each floor's terminal clears.

### 1.6 Orbs

- `OrbConfig` for S2: `eliteDrops: number[]` of length **9** — indices 0–2 are
  the three surface elites, 3–8 are the six dungeon elites (2 per dungeon, in
  dungeon order). `shopOrbs`, `battleOrb`, `puzzleOrb`, `bossMinOrbs` become
  optional and are S1-only.
- `orbIdForElite` unchanged for the surface; Phase 3 adds `orbIdForDungeonElite`.
- `purchaseShopOrb` callable, `ORB_SHOP_COST`, and the shop-orb UI in
  `TownLightbox` retire.
- `onOrbAcquired` (functions) re-points at the **Floor 3 Sorcerer** instead of an
  S1 corner boss (decision 8). Trait stripping behaves exactly as S1 —
  `ELEMENTAL_ORB_TRAITS` minus `BOSS_SOFT_TRAITS` while the boss is
  `inprogress`. In practice players hold 7+ orbs by the time Floor 3 opens, so
  most traits are already gone — which is the intended payoff.
- Admin **Orbs** tab: nine elite-drop selectors (3 surface + 6 dungeon),
  shop/edge selectors removed.

### 1.7 Districts

New `src/components/districts/`:

| File | Role |
|------|------|
| `DistrictWard.tsx` | The bordered "Capital Ward" card + 4 district cards, rendered below `MapGrid` |
| `DistrictCard.tsx` | One card (sprite, name, sample line, disabled state) |
| `TownHallPanel.tsx` | Modal — hosts `GuildmasterMissions` (basic/patrol only) |
| `ShopPanel.tsx` | Modal — the global shop (§1.8) |
| `CastlePanel.tsx` | Modal — ornamental start-tile panel |
| `BarnPanel.tsx` | Modal — Phase 2 (stub in Phase 1) |

- Keys stay `questboard` / `shop` / `casino` / `fields`; **labels** are Town Hall
  / Shop / Casino / Barn.
- Sprites → `src/assets/districts/{town-hall,general-store,casino,barn}.png`,
  imported through a Vite glob so they're hashed and bundled;
  `image-rendering: pixelated`, `object-fit: contain`.
- **Logged out:** cards render at reduced opacity with `pointer-events: none`
  and no click handler (decision 19). No login prompt inside the panels is
  needed because they can't be opened.
- `App.tsx` gains `districtView: 'questboard' | 'shop' | 'fields' | 'casino' | null`.
  The first three render as modals over the map; **`'casino'` replaces the map
  view entirely** (decision 18).
- `PlayerHUD`'s mission shortcuts open the Town Hall instead of the D3 lightbox.

### 1.8 Shop collapse

- RTDB: `seasons/{id}/shop = { itemIds: string[] }` (replaces
  `seasons/{id}/shops/{shopId}`).
- `DEFAULT_SHOPS` retires; a `DEFAULT_S2_SHOP_ITEM_IDS` constant seeds the node.
- `purchaseShopItem` (callable): `coord` becomes optional; when the season's
  board has no shop tiles the server validates against the global shop node
  instead of a town tile. `ITEM_COSTS` in `functions/src/index.ts` is unchanged
  — **it still must mirror `SHOP_ITEMS`.**
- Admin **Shops** tab → a single item-list editor.
- `TownLightbox.tsx` is deleted; its shop markup moves to `ShopPanel.tsx`.

### 1.9 Casino district

`src/components/casino/CasinoShell.tsx` is currently the casino-season root.
Extract its body into **`CasinoLanding.tsx`** with an optional `onBack` prop:

- `CasinoShell` (casino season) → `<CasinoLanding />`, no back button.
- S2 map season, `districtView === 'casino'` → `<CasinoLanding onBack={…} />`
  rendered in place of `MapGrid` + ward.

`CasinoLanding` already reads missions from `GameStateContext`, which is
season-scoped, so it works unchanged in a map season. Two things to verify
during implementation: the table links must carry `?seasonId=` (they already do
via `PhasePanel.tableHref`), and `ChallengePanel`'s `showXp` should now be
**true** in S2 (`shell !== 'casino'`), since a map season pays gambit XP as XP.

**The casino carries over unchanged.** Same variable slot counts, same
**6 semi-rotating tables** (`CASINO_OPEN_TABLES`, no S2 override), same **36h**
decay window, same antes/card values/pot formula. S1.5's retuned numbers are
canonical and are S2's casino baseline — nothing in this plan retunes them, and
`npm run econ` stays the gate for any change that does.

### 1.10 Feat retirement

- Move `FEATS`, `FeatDef`, `getAvailableFeatsForSlot`, `pendingFeatSlot`,
  `getPlayerFeatIds` into **`src/lib/legacyFeats.ts`**, used only by the
  archived-S1 display path and `getFeatWarnings` in the admin Players tab.
- **Keep `calcFeatBonuses` / `buildXpBonusTooltip` / `buildGoldBonusTooltip` /
  `calcSeekerHintReduction` where they are.** They no-op when a player has no
  `feats` field, which is exactly the S2 case — so archived S1 tile panels keep
  rendering their historical multipliers instead of silently losing them. They
  come out when the S2 feat design lands.
- Remove: the feat picker in `ProfileLightbox.tsx`, `SectionFeats.tsx` from the
  help modal, feat-driven values in `SectionYaml.tsx` (replaced by companion
  values in Phase 2), the `feats/$slot` rule in `database.rules.json`.
- **Advisor**: add `advisorCountForLevel(level)` next to
  `adventurerCountForLevel` in `gameLogic.ts`, and make
  `missionClaimCapacity(player)` return `1 + advisorCountForLevel(calcLevel(player.xp))`.
  The threshold is a named placeholder constant (`ADVISOR_LEVELS = [/* TBD */]`)
  pending the S2 level-curve pass — the function shape is what matters now, and
  `functions/src/index.ts`'s `MISSION_CLAIM_CAPACITY` / `heldClaimCount()` copy
  must be updated in lockstep.

### 1.11 Admin & help

- **MapPage / MapGridPanel** — board-driven dimensions; tile-type editor gains
  dungeon/tower/castle; the boss-trait editor is S1-only.
- **Help modal** — `SectionMap` rewritten (6×7, Castle start, dungeons, Tower);
  `SectionBoss` → `SectionTower`; `SectionShop` updated; new `SectionDistricts`;
  `SectionFeats` removed.
- **`seedInitialMissions`** — seeds Basic Training + Patrol + the casino tables
  for S2; Field Work joins in Phase 2.

---

## Phase 2 — Companions

### 2.1 Data model

```
seasons/{id}/players/{uid}/companions/{baseId}  : { xp: number }   // own earned XP
seasons/{id}/players/{uid}/party                : number[]          // DEFAULT party (pre-fills joins)
seasons/{id}/players/{uid}/companionOffers/{missionId} : { pair: [number, number], ts: number }
```

Per-challenge snapshots (the authoritative party for rewards):

```ts
interface TileAdventurer { …; party?: number[]; }
interface GMParticipant  { …; party?: number[]; }
```

Slots are **derived, not stored**: `companionSlots(player)` =
`COMPANION_BASE_SLOTS` (2) + future feat bonuses, capped at
`COMPANION_MAX_SLOTS` (5). No `petSlots` field — a stored number would be one
more thing to keep in sync with the (not yet designed) feats.

### 2.2 `src/lib/companions.ts` (pure, fully unit-tested)

```ts
export const COMPANION_LEVEL_XP      = [0, 250, 750, 1500, 2500]; // tunable
export const COMPANION_EVOLVE_LEVEL  = 3;
export const COMPANION_MAX_LEVEL     = 5;
export const COMPANION_XP_FLOOR_DIV  = 25;
export const COMPANION_BASE_SLOTS    = 2;
export const COMPANION_MAX_SLOTS     = 5;

export type CompanionEffectId =
  | 'priorityLocations' | 'excludedLocations' | 'hintLocations'
  | 'startingHints'     | 'startingInventory' | 'checkCount'
  | 'battleGp' | 'battleXp' | 'puzzleGp' | 'puzzleXp';

export interface CompanionDef {
  baseId: number; evoId: number;      // sprite ids; baseId is the DB key
  name: string;   evoName: string;
  hue: number;
  effect: CompanionEffectId;
  kind: 'flat' | 'pct';
  values: [number, number, number, number, number];  // per level 1–5
}

export const COMPANIONS: readonly CompanionDef[];   // the ten from COMPANIONS.md

export function companionXpFloor(playerXP: number): number;
export function companionEffectiveXP(stored: number | undefined, playerXP: number): number;
export function companionLevel(effectiveXP: number): number;
export function grantCompanionXP(stored: number | undefined, playerXP: number, gain: number): number;
export function companionBonuses(
  party: number[], companions: Record<string, { xp: number }>, playerXP: number,
): CompanionBonuses;
```

`CompanionBonuses` is the summed, additive bundle:
`{ priorityLocations, excludedLocations, hintLocations, startingHints, startingInventory, checkCountPct, battleGpPct, battleXpPct, puzzleGpPct, puzzleXpPct }`.

The ten companions, their effects, and the five-step value tables come verbatim
from `COMPANIONS.md`. Evolution is **cosmetic** — the sprite switches at level 3,
the numbers come from the level, not the form.

### 2.3 Where the effects apply

| Effect | Applied where |
|--------|---------------|
| Priority / Excluded / Hint Locations, Starting Hints, Starting Inventory | **YAML allowances** — shown in `SectionYaml` and on the join/enlist panel, since the party is per-challenge |
| Check Count % | Raises the global **2,000-check ceiling** *and* the **Agile** cap — level-resolved via `resolveTrait` (§0.6), so it scales against `[250, 220, 180, 140, 100]` rather than a fixed 250. Not Sturdy. Surfaced in `SectionYaml` and the trait display |
| Battle/Puzzle XP % and GP % | Reward math in `awardTileRewards` (tiles) — elite counts as **battle**. Missions are untyped: no % effect, but pets still earn XP |

Reward formula: `Math.round(base * (1 + featBonus + companionPct))` — additive,
per decision 15. With feats retired, `featBonus` is 0 in S2.

### 2.4 Pet XP on completion

Both `awardTileRewards` (`gameLogic.ts`) and `completeMission` (`db.ts`) grant
each pet in the **snapshot party** the same XP the player earned, via
`grantCompanionXP` (which normalizes to the floor before adding). Writes go into
the same atomic multi-path `update()` that already writes player XP/gold — no
second round-trip, no partial state.

### 2.5 Party selection UI

- **Barn** edits the *default* party (`players/{uid}/party`).
- **Tile join** (`AvailableState`) and **mission enlist** (`GuildmasterMissions`)
  show a compact picker pre-filled from the default party, editable until the
  tile/mission goes `inprogress`.
- Once `inprogress`, the snapshot is frozen; the panel shows it read-only with
  each pet's live contribution.

### 2.6 Field Work mission

`MISSION_DEFS.fields` — a normal Guildmaster Mission with an Archipelago:

```
type: 'fields', label: 'Into the Fields', icon: '🌾'
baseMax: 6, xp: 60, gp: 60, traits: null, decayHours: 30
release: 'on', collect: 'off', hint: 10
special: false, repeatable: true
entryCosts: [{ label: 'Provisions', gold: 500 }]
companionReward: true
```

`baseMax 6` / `decayHours 30` — a faster decay than Casino's 36h on a comparable
cohort, so Field Work rolls over quickly and the ten runs a full collection needs
stay reachable (§Economy notes).

> **`decayHours` is dead code today — this needs plumbing first.** Both
> `decayWindowMs` ([src/lib/missionLogic.ts:28](../src/lib/missionLogic.ts#L28))
> and its server mirror `gmDecayWindowMs`
> ([functions/src/index.ts:849](../functions/src/index.ts#L849)) are hardcoded
> ternaries — `m.type === 'casino' ? 36h : 24h`. **Nothing reads
> `MISSION_DEFS.*.decayHours`**, which is why all three defs say `24` while the
> casino actually decays at 36h. Writing `decayHours: 30` into the `fields` def
> would silently do nothing and Field Work would decay at 24h.
>
> Fix: **stamp `decayHours` onto the mission record** in `gmFreshMission` /
> `freshMission` (add it to `GMMission`, which doesn't carry it today) and have
> both decay functions read `m.decayHours ?? 24`. Stamping beats looking the def
> up because in-flight cohorts keep the decay they were created with when a def
> is retuned mid-season, and it avoids adding another client/server mirrored
> table. The two decay functions are already an undocumented dual copy — add
> them to the `CLAUDE.md` mirror list while touching them.

- `GMMissionType` gains `'fields'`.
- **YAML at enlist** per §0.5 — `enlistInMission` is already a callable, so this
  is a Storage-existence check plus slot validation alongside the 500 GP gate.
- **One cohort open at a time, respawning on deploy — inherited, not built.**
  `deployMission` already spawns a same-type replacement at `series + 1` for
  every non-casino type (only casino takes the special least-represented-game
  path). Field Work gets Patrol's exact lifecycle for free; the only work is
  seeding the first cohort in `seedInitialMissions`.
- `enlistInMission` (callable) validates ≥500 GP and deducts it; refunded by
  `standDownFromMission`. Same shape as the casino ante gate.
- **`onMissionComplete`** (existing trigger) rolls the offer per participant —
  server-side, since the client must not pick its own creature:
  - `c1` — uniform over all ten base ids.
  - `c2` — never `c1`; prefers an id the player doesn't own; falls back to any
    non-`c1` id when they own everything else.
  - Writes `players/{uid}/companionOffers/{missionId}`.
- **`claimCompanionOffer`** (new callable) — validates the offer exists and the
  chosen id is one of the pair; then:
  - new companion → `companions/{id} = { xp: grantCompanionXP(undefined, playerXP, 0) }`
    (i.e. it starts at the floor);
  - duplicate → `xp = grantCompanionXP(stored, playerXP, missionXP)`, per
    `COMPANIONS.md`'s "choosing the dup levels an existing companion";
  - deletes the offer.
- The Barn surfaces a pending offer as a two-card choice on open.

### 2.7 Barn / Petdex UI

`src/components/districts/barn/`:

| File | Role |
|------|------|
| `BarnPanel.tsx` | View switch: `main` \| `detail` \| `offer` |
| `PetdexGrid.tsx` | Ten base slots, three display states (unowned silhouette + "???", base-only, evolved) |
| `PetdexDetail.tsx` | Level + XP bar, floor note, effect + current value, evolution status, default-party toggle |
| `PartyBar.tsx` | Default party with each pet's live contribution, Hero XP, floor, slot usage |
| `CompanionOffer.tsx` | The two-creature choice |
| `FieldWorkSection.tsx` | Field Work mission cards (enlist / status) |

Sprites → `src/assets/companions/{id}.png` (numeric ids preserved as the DB key),
Vite glob import, `image-rendering: pixelated`; silhouettes via
`filter: brightness(0); opacity: 0.5`. Ten base + ten evolutions = 20 files
copied from the design bundle's `uploads/`.

Theme note: each companion carries a `hue`, so the detail/roster cards must be
checked in light mode and the color-blind themes — ten hues at
`oklch(84% 0.08 <hue>)` will not all clear contrast on a light background. Unlike
the tile types (§1.2a), companion hue is **decorative only**: the sprite and name
identify the creature, so these need a contrast fix, not a distinguishability
one. Simplest approach is to derive card text from the theme's own
`--parchment`/`--text-muted` and let the hue live only in the border and
background wash, clamped via `oklch(from … )` against `--bg-card`.

### 2.7a Mission throughput — already general, with two gaps

S2 leans on pooled claims as a load-bearing design element ("missions should be
meaningful, not something on the side"), so this was verified against the code
rather than assumed. **Early claim reclaim already applies to every mission
type** — there is no casino gate anywhere:

- `tickSlotStatuses` (`functions/src/index.ts`) loops all `inprogress` missions
  regardless of `mission.type` and nulls `players/{pid}/activeMissions/{id}` once
  a participant's slots are all terminal.
- `enlistInMission` / `claimMissionSlot` gate on `heldClaimCount >= MISSION_CLAIM_CAPACITY`,
  type-agnostically.
- `completeMission` clears the claim for everyone at settle.

So **no new work is required** for Patrol / Basic Training / Field Work to pool
claims the way casino tables do. Two real gaps to close, though, now that this is
depended upon rather than incidental:

1. **Reclaim requires a Cheesetracker link.** The loop starts
   `if (mission.state !== 'inprogress' || !mission.cheese) continue;` — a cohort
   with no `cheese` link never syncs and therefore **never auto-reclaims**, so
   its claims stick until settle. **Fix: change the admin warn from "no room
   link" to "no cheese link."** The cheese link is set immediately after the
   room, so it's the strictly stronger signal — and it's the one the sync
   actually depends on.
2. **No self-heal.** `if (!hasActiveSlots(allSlots)) continue;` skips a mission
   whose stored statuses are *already* all terminal, so reclaim only fires on the
   tick where the last slot flips. A claim that survives that tick — admin
   manually set statuses, or a claim re-added afterwards — is never reclaimed.
   Fix: run the reclaim check **before** the `hasActiveSlots` bail.

> **Both gaps apply identically to tile Challenges.** The tile loop in
> `tickSlotStatuses` ([functions/src/index.ts:2785](../functions/src/index.ts#L2785),
> [:2792](../functions/src/index.ts#L2792)) has the same `!cheeseId` and
> `!hasActiveSlots` bails wrapping the **adventurer-free** block — so an
> adventurer can stay stuck `busy` on a tile for exactly the same two reasons.
> Apply both fixes symmetrically to the tile and mission loops; the tile version
> keys off `tile.cheese` / `tile.cheese2` per room.

**Admin warn-count change** (`App.tsx`, `adminWarnCount`): both the tile branch
(`if (!tile.link) return true;`) and the mission branch (`if (!m.link) return true;`)
switch from `link` to `cheese` — and the tile branch must check `cheese2` as well
when the tile is bifurcated, since room 2 syncs independently.

**Capacity interaction.** With reclaim general, `MISSION_CLAIM_CAPACITY` 1 means
"one *unfinished* mission at a time, plus any number settling" — a player starts
their next cohort as soon as their own slots go terminal, not at settle. If ten
Field Work runs still proves tight in playtest, the lever is the **Advisor**
level-up (capacity → 2, decision 10), not the 500 GP price.

### 2.8 Rules & functions

`database.rules.json`, under `seasons/$seasonId/players/$playerId`:

| Path | Write |
|------|-------|
| `party` | owner or admin; validate: array of numbers, length ≤ `COMPANION_MAX_SLOTS` |
| `companions/$baseId/xp` | **admin only** (tile completion is an admin action; Field Work goes through the Admin SDK) |
| `companionOffers` | **`.write: false`** — Cloud Functions only |

New/changed functions:

- `claimCompanionOffer` — new callable.
- `onMissionComplete` — rolls Field Work offers.
- `enlistInMission` / `standDownFromMission` — Field Work gold gate + refund.
- `functions/src/companions.ts` — server mirror of the level thresholds, floor
  math and the ten defs. **Add to the dual-copy list in `CLAUDE.md`** alongside
  `ITEM_COSTS` and `casinoEngine.ts`.

### 2.9 Help

New `SectionCompanions` (catching, levelling, the floor, evolution, party slots,
the effect table). `SectionYaml` gains companion-driven values in place of the
retired feat values, including the Check Count interaction with the 2,000-check
ceiling and `agile`.

---

## Phase 3 — Dungeons & the Tower

### 3.0 Deviations from the dungeon design bundle

The dungeon bundle predates the map design and disagrees with it in seventeen
places. **The map design wins in every case.** Catalogued so nothing is
silently inherited from `maze.jsx` / `app.jsx`:

| # | Dungeon bundle says | Resolution (authoritative) |
|---|---------------------|----------------------------|
| D1 | Surface is 5×7, start is Town Center **D3** | **6 rows × 7 cols**, start is Castle **D6** |
| D2 | Four **Towns** at B2/D1/G4/C5 | **No towns in S2** |
| D3 | Dungeons hardcoded G1/A4/E5, Tower G5 | **Seeded**; dungeons at distance 3/5/7, Tower at 8 |
| D4 | ≥3 from start, ≥4 between dungeons, **Tower exempt** | Exact bands, **≥3 spacing including the Tower** |
| D5 | *"No Elites live on the surface anymore"* | **3 surface elites** (interior, ≥3 from Castle, non-adjacent) |
| D6 | **1 orb per dungeon, 3 total** | **9 orbs**: 3 surface + **2 per dungeon** |
| D7 | Tower sealed until 3/3, then **all floors open** | **3 → F1, 5 → F2, 7 → F3** |
| D8 | Orbs Sunfire / Tideglass / Emberheart | The **nine elemental orbs** |
| D9 | **One** true path, Elite at BFS-farthest cell | **Two** true paths in dungeons, one Elite each |
| D10 | `minPathLength` 10 | **≥8** per true path |
| D11 | Floor 3 penultimate is a regular tile | **Elites gate F1 and F2**; F3's terminal is the boss alone |
| D12 | No treasure paths or chests | **2 treasure dead-ends** per dungeon and per floor |
| D13 | Hardcoded stats (battle 4/60/75, elite 8/200/240, boss 12/600/800) | **Seeded `generateTileStats`** |
| D14 | Boss is "The Sorcerer" 🧙 | **Kept** — S2 fights the Sorcerer |
| D15 | Dungeons 4×6, floors 5×5 | **Dungeons 5×7**, floors 5×5 |
| D16 | Portal side is a global tweak | Dungeons: seeded non-corner edge. Tower F1: **bottom-middle**; F2/F3: **the stairs cell below** |
| D17 | State resets when the seed changes | **Firebase-persisted**; layout frozen once any tile leaves `hidden` |

Two mechanics from the bundle are **kept as-is** — they conflict with nothing:

- **Wall-respecting cascade.** Completing a tile reveals neighbours only through
  *open* edges. This is a different adjacency rule from the surface's
  `getAdjCoords` and is the core of the whole feature.
- **Progressive wall reveal.** Walls render only adjacent to already-revealed
  tiles, so the maze is discovered rather than displayed. This is what makes the
  two-true-paths choice meaningful — players cannot see which branch holds which
  Elite, or which dead-end holds a Chest.

### 3.1 Maze generation (`src/lib/mazeGen.ts`)

Ported from `maze.jsx` (recursive-backtracking carve + BFS), then extended for
the multi-path constraints. All layout is **derived from the season seed**, never
stored — only the seed and the freeze flag persist.

**Dungeon — 5 rows × 7 cols (35 cells):**

1. Carve a perfect maze (spanning tree; every cell reachable, no loops).
2. **Portal** — seeded pick among non-corner edge cells.
3. BFS from the portal → depth + parent for every cell.
4. **Two Elite terminals**: both must be **leaves**, each ≥**8** moves from the
   portal, and their root paths must share a prefix of ≤**3 cells** (including
   the portal — so they diverge by the 4th cell at the latest).
5. **Two Chest terminals**: both **leaves**, each ≥**6** moves, pairwise shared
   prefix ≤**2 cells**, and ≤**3 cells** shared with *either* true path.
6. **Two decoy stubs**: 1–2 cells branching off any path, terminating in nothing.
7. Every cell not on a path and not a stub becomes **impassable rock**.
8. **Assign types** to the challenge cells: the two true-path terminals are
   Elites; **5 cells are Puzzles** (seeded pick among the remaining challenge
   cells); everything else is a Battle (decision 25).
9. Reject and reseed if any constraint fails (bounded attempt loop, as the
   bundle's `generateDungeon` already does).

**Tower floor — 5 rows × 5 cols (25 cells):** same, but **one** true path
(min **8**), one Elite terminal (F1/F2) or the **Sorcerer** (F3), two Chest
terminals, **one** decoy stub, and **4 Puzzles** per floor.

> Because a perfect maze is a tree, "overlap" between two root paths is exactly
> their shared prefix — so every constraint above reduces to a lowest-common-
> ancestor depth check. Constraint 4 is `depth(LCA(e1,e2)) ≤ 2`; constraint 5 is
> `depth(LCA(t1,t2)) ≤ 1` and `depth(LCA(tᵢ,eⱼ)) ≤ 2`. Implement it that way —
> it's O(1) per pair and far clearer than set intersection.

**Tower floors generate sequentially.** Floor 1's portal is bottom-middle;
Floor 2's portal is *the cell where Floor 1's stairs sit*, and likewise F2→F3.
Interior portals are why the true-path minimum drops to 8 (decision 26) — a
centre start has a shorter maximum depth than an edge start.

### 3.2 Content volume

With decision 27 (only path cells are challenges) and the fixed puzzle counts of
decision 25:

| Area | Cells | Elite | Puzzle | Battle | Challenges |
|------|-------|-------|--------|--------|-----------|
| Surface | 42 | 3 | 12 | 22 | **37** |
| Dungeon ×3 | 35 each | 2 each = 6 | 5 each = 15 | ~15 each = ~45 | ~**66** |
| Tower F1 / F2 | 25 each | 1 each = 2 | 4 each = 8 | ~9 each = ~18 | ~**28** |
| Tower F3 | 25 | boss | 4 | ~10 | ~**15** |
| Mimics | — | — | 2 | — | **2** |
| **Total** | | **11** | **41** | **~95** | **~148** |

Against S1's 35. The surface was shrunk from 7×7 to 6×7 specifically to absorb
this. Portals and un-triggered chests are **not** challenges and are excluded;
the two Mimics are counted as Puzzles because that is what they become
(§3.5).

**Hand-authored: 52 tiles** — the 11 elites and all 41 puzzles (§6 of the
[traits plan](season-2-traits-plan.md)). The ~95 battles are generated. For
scale, S1 hand-authored 31 (16 battles + 9 puzzles + 5 elites + boss), so this
is ~1.7× S1's authoring load — heavier per tile, since puzzles and elites carry
more design thought than battles do.

### 3.3 Data shape

```
seasons/{id}/dungeons/{surfaceCoord}/
  meta:   { seed, name, portal: "r_c", frozen: boolean }
  tiles/{r_c}:   Tile              // identical shape to a surface tile
  chests/{r_c}:  DungeonChest
seasons/{id}/tower/{floor}/          // floor = 1 | 2 | 3
  meta:   { seed, name, portal: "r_c", stairs: "r_c", frozen: boolean }
  tiles/{r_c}:   Tile
  chests/{r_c}:  DungeonChest
```

Keyed by `surfaceCoord` (not a dungeon slug) so the surface tile and its interior
share an identity. Kept **out of** the top-level `tiles` map deliberately: every
existing `Object.entries(gameState.tiles)` loop — status report, agenda, admin
warn counts, `computeRecalcUpdates` — would otherwise start seeing 108 extra
tiles. Consumers opt in explicitly.

```ts
interface DungeonChest {
  pathId:      't1' | 't2';
  pathTiles:   number;        // challenge cells on this treasure path (excl. portal & chest)
  revealedAt:  number | null; // stamped when the preceding challenge completes
  opensAt:     number | null; // revealedAt + 24h
  isMimic:     boolean;
  mimicRevealedAt?: number;   // when the disguise dropped and the Puzzle went live
  settledAt?:  number;
  payouts?:    Record<string, { tier: ChestTier; gold: number }>;
}
type ChestTier = 'high' | 'medium' | 'low' | 'none';
```

Challenges inside behave **identically** to surface challenges (decision /
Q4): adventurers from the same pool, slots, YAML, traits, claimable slots,
Cheesetracker sync, status reports, companion parties (battle/puzzle typing
applies normally; elite counts as battle).

Interior joins go through the same `joinChallenge` / `claimChallengeSlot`
callables as the surface (§0.5.2), with the composite `containerId`
(`G1__2_3`, `tower1__0_2`) selecting the Storage path. The callables need a
`dungeonRef` argument so they can resolve the interior tile path; everything
else — YAML verification, slot validation, capacity checks — is shared.

### 3.4 Wall-aware cascade

`computeRecalcUpdates` (§1.4) takes a pluggable adjacency. Phase 3 adds a second
implementation:

```ts
// Surface: orthogonal neighbours, dungeon/tower tiles are pass-through.
// Interior: only neighbours through an OPEN edge; rock is never revealed.
type Adjacency = (coord: string) => string[];
```

Interior rules: rock cells never leave `hidden`; the portal starts `complete`;
its open-edge neighbours start `available`. Chest cells are revealed by the
cascade but are not challenges — reaching `available` is what stamps
`revealedAt` and starts the 24-hour clock.

### 3.5 Chests, tiers and Mimics

**Timer.** A chest's predecessor completing → chest becomes `available` →
`revealedAt` stamped → `opensAt = revealedAt + 24h`.

**Tiering** is evaluated **at settle time**, not at reveal — the 24-hour window
is a deliberate last call, and joining or finishing during it improves a
player's tier.

| Tier | Condition | Gold per path tile |
|------|-----------|--------------------|
| **high** | completed ≥1 challenge **on this chest's treasure path** | `randInt(15, 25)` |
| **medium** | completed ≥1 challenge elsewhere in this dungeon/floor | `randInt(10, 15)` |
| **low** | ≥1 challenge **in progress** here, none completed | `randInt(5, 10)` |
| **none** | no participation | — |

Payout is **summed per tile**, not one roll times the length:
`gold = Σᵢ₌₁..pathTiles randInt(lo, hi)` — smoother distribution, less swingy.
`pathTiles` counts the **challenge cells** on that treasure path (excludes the
portal and the chest itself), so a minimum 6-move path pays 5 tiles: high
75–125 GP, medium 50–75, low 25–50.

**Gold only.** No XP, no companion or feat multipliers — this is a participation
payout, not a challenge reward (decision / Q12).

Tiers are **per chest**, so a player can be `high` on one chest and `medium` on
the other in the same dungeon. That is the point: it rewards exploring the branch
that turned out not to be the "real" path.

**Mimics.** Two, both seeded: one among the **6 dungeon chests**, one among the
**4 chests on Tower Floors 1–2**. A Mimic is **indistinguishable from an ordinary
Chest** to players until its timer fires. At `opensAt` it does *not* settle —
instead it flips to a live **Puzzle challenge**.

- The Mimic's challenge content (name, room link, tracker, slot roster) is
  **authored in advance** by the admin and hidden until reveal, so the flip can
  happen at any hour without blocking players.
- On defeat: normal challenge rewards to its participants, **plus** the chest
  payout to everyone, tiered **at defeat time**.
- Because fighting the Mimic is itself "a challenge on this treasure path",
  every Mimic participant lands in **`high`** — including players who had no
  prior involvement with that dungeon.
- `adminForceSettleChest` is the escape hatch if a Mimic is never defeated.

### 3.6 Navigation & views

Mirrors the Casino district's view swap (§1.9) rather than a modal — a dungeon
is a full board, not a panel.

- `App.tsx` gains `interiorView: { kind: 'dungeon', coord } | { kind: 'tower', floor } | null`.
  When set, the surface `MapGrid` + district ward are replaced by `MazeView`.
- **`MazeView.tsx`** — renders one maze: wall layer (SVG, progressive reveal),
  tile layer, top bar with **← Return to Surface**, and a floor-pip HUD in the
  Tower.
- **Entering** — the surface dungeon tile is enterable as soon as it is revealed
  (no orb requirement). Tower floor N requires `TOWER_FLOOR_ORBS[N-1]` orbs.
- **Portal tile** — clicking it returns to the surface (Floor 1) or descends a
  floor (F2/F3). Players may **freely ascend and descend**.
- **Stairs tile** (F1/F2 terminal) — climbs to the next floor. It sits behind
  that floor's Elite on the true path, so the Elite genuinely gates the climb.
- **Interior tile lightbox** reuses the surface `TileLightbox` wholesale
  (challenges are identical); it gains `portal`, `stairs`, `chest` and `boss`
  branches.

**Dungeon completion** requires **both Elites felled *and* both Chests settled**
(a Mimic counts as settled once defeated). Only then does the surface tile go
`complete` and drop its two orb glyphs.

**Season end.** The Sorcerer falling on Floor 3 flips the surface Tower tile to a
**Conquered** state with a crown. **No automatic season-status change** — forming
challenges and missions are left to finish, and the admin moves the season to
`closing` by hand (decision 31).

### 3.7 Cloud Functions

Chests move gold, so they are server-authoritative:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `tickDungeonChests` | Scheduled, every 15 min | Settle chests past `opensAt`; for a Mimic, flip its tile to `available` and stamp `mimicRevealedAt` instead |
| `onInteriorTileComplete` | DB write on the interior tile `state` | Interior analogue of `onTileComplete` — profile snapshots, orb grants on Elite kills, and settling a Mimic's chest on defeat |
| `adminForceSettleChest` | Callable (admin) | Escape hatch for an undefeated Mimic or a stuck chest |

Rules: `dungeons/**/chests` and `tower/**/chests` are **`.write: false`** —
functions only. Interior `tiles` mirror the surface tile rules, plus a guard that
rock and chest cells reject adventurer writes.

### 3.8 Admin

- **Map** tab gains a dungeon/Tower selector that renders the interior grid with
  the same tile editor as the surface.
- Mimic authoring: the chosen Mimic cells surface in the admin UI (marked) so
  their Puzzle content can be filled in before reveal.
- Layout **freeze**: once any interior tile leaves `hidden`, regeneration is
  refused. Regenerating Tower Floor 1 invalidates Floors 2 and 3 (their portals
  derive from it) — the admin action must refuse or cascade explicitly.

---

## Testing

Extends `npm run test:unit` (`tests/lib`, `tests/casino`) and `npm run test:rules`.

**Phase 1**

- `tests/lib/board.test.ts` — both specs; coord round-trips; `getAdjRC` edges on
  5×7 and 6×7; `isEdgeTile`.
- `tests/lib/tileGenS2.test.ts` — **property test over ≥500 seeds**: exactly
  1 castle / 1 tower / 3 dungeons / 3 elites / 22 battle / 12 puzzle; tower at
  distance **8** (⇒ A1 or G1); dungeons at 3/5/7; all dungeon+tower pairs ≥3
  apart; every elite interior, ≥3 from the Castle, non-adjacent to another
  elite; every cell reachable from D6 under the pass-through cascade. Assert the
  generator **never fails to find a layout** — the d=7 band is tight enough that
  a naive non-backtracking pick would.
- `tests/lib/cascade.test.ts` — dungeon/tower pass-through reveal; fixpoint
  termination; S1 behaviour unchanged.
- Rules: adventurer writes rejected on dungeon/tower/castle tiles; global shop
  node read/write.
- **Theme audit** (manual, checklist in §1.2a): dungeon/tower/castle fg-on-bg
  contrast in the four light themes; deutan/protan/tritan simulation of the
  four accessibility themes; a monochrome pass confirming the lightness ladders
  above hold with six types instead of five.

**Phase 2**

- `tests/lib/companions.test.ts` — level boundaries (249/250, 749/750, …);
  floor behaviour as player XP rises; `grantCompanionXP` normalization;
  additive stacking of two same-effect pets; evolution at level 3;
  `companionSlots` cap.
- `tests/lib/companionRewards.test.ts` — battle vs puzzle typing (elite→battle,
  missions untyped); `Math.round` at the boundary; pets in the snapshot party
  earn exactly the player's XP; pets left behind earn nothing beyond the floor.
- `tests/lib/missionDecay.test.ts` — `decayWindowMs` reads the mission's stamped
  `decayHours`: casino still 36h, Field Work 30h, Patrol/Basic 24h, and an
  unstamped legacy record falls back to 24h. Guard against the regression this
  replaces (a hardcoded `type === 'casino'` ternary silently ignoring the def).
- Rules: `companionOffers` unwritable by clients; `companions/{id}/xp`
  unwritable by the owning player; `party` length cap.

**Phase 3**

- `tests/lib/mazeGen.test.ts` — **property test over ≥500 seeds per maze kind.**
  Dungeon: carve is a spanning tree (every cell reachable, no loops); both Elite
  terminals are leaves at ≥8 moves with `depth(LCA) ≤ 2`; both Chest terminals
  are leaves at ≥6 moves with `depth(LCA(t1,t2)) ≤ 1` and
  `depth(LCA(tᵢ,eⱼ)) ≤ 2`; exactly 2 decoy stubs of 1–2 cells; every non-path
  cell is rock; **exactly 5 Puzzles** among the challenge cells (4 per Tower
  floor), everything else Battle. Tower floor: same with one true path and one
  stub. **Assert the
  attempt loop always converges** — these constraints are tight in 35 and 25
  cells, and a silent `null` return would ship an empty dungeon.
- `tests/lib/towerChain.test.ts` — floors generate sequentially; F2's portal is
  F1's stairs cell, F3's is F2's; the chain is deterministic for a given seed;
  an interior portal still yields a ≥8 true path.
- `tests/lib/mazeCascade.test.ts` — reveal passes only through open edges; rock
  never leaves `hidden`; a chest is revealed by its predecessor completing;
  descending/re-entering preserves state.
- `tests/lib/chests.test.ts` — tier classification across all four tiers,
  including the boundary cases (in-progress-only ⇒ `low`; a completed challenge
  on the *other* treasure path ⇒ `medium`, not `high`); payout ranges per tier
  for a 5-tile path; per-tile summation, not one roll × length; tiering
  evaluated at settle time, so a completion during the 24h window promotes.
- `tests/lib/mimic.test.ts` — exactly 2 Mimics, one from the 6 dungeon chests
  and one from the 4 chests on Floors 1–2; selection is seed-deterministic; a
  Mimic does **not** settle at `opensAt` but goes live; on defeat every
  participant tiers `high`.
- Rules: chest nodes unwritable by clients; adventurer writes rejected on rock
  and chest cells; interior tiles otherwise accept the same writes as surface.

Regression check: load an archived S1 season and confirm the 5×7 board, towns,
boss tile, shop tiles, and historical feat multipliers all still render.

---

## Deploy order

Per `CLAUDE.md`, **functions before frontend**, and S2 stays a draft season
throughout so nothing is player-visible until launch.

1. `cd functions && npm run build` →
   `firebase deploy --only functions,database,storage` (new callables + RTDB
   rules + the `yaml/**` Storage rules must all exist before any client can
   upload a config or call a join callable).
2. Commit + push → Netlify builds and publishes the frontend.
3. Playtest as admin/alpha via `previewSeason('rpelago_s2')`.
4. Launch (`activeSeasonId` flip + `minClientVersion` bump) only after the S2
   gold-seed migration runs — deferred per decision 22, tracked on the launch
   checklist rather than here.

---

## Economy notes (inputs to the deferred balance pass)

Not a balance pass — just the S2 gold picture assembled in one place, since the
inflows and sinks are being designed in three separate phases and no single
document currently sees all of them.

**S2 runs hotter than S1 by design.** Three independent changes push gold up:

- **Casino payouts carry forward.** The S1.5 numbers are canonical and become
  S2's casino baseline (per [casino-season-1_5-plan.md](casino-season-1_5-plan.md)),
  but they were tuned for a season where the casino was the *entire* game. In S2
  it is one district of four, so the same per-table economics land on top of tile
  rewards, mission rewards and chests rather than replacing them. Players
  carrying a large S1.5 balance start ahead as well (`max(final, 250)`).
- **Chests** add roughly **1,200 GP** to a thorough player across the 12 chests
  (§3.5) — a brand-new source with no S1 equivalent.
- **Companions** are the largest new sink: **4,400 GP net** for the full set.

**Collecting all ten companions costs exactly 10 Field Work runs.** The offer
algorithm draws `c2` from *unowned ids other than `c1`*, falling back only when
that set is empty — so an unowned creature is always on offer, including at 9/10
owned. There is no duplicate tax and no variance: 10 × 500 GP out, 10 × 60 GP
back, plus 600 XP.

> **The binding constraint on a full companion set is mission throughput, not
> gold.** Field Work is a real GM Mission (§2.6), so ten runs means ten cohorts.
> Pooled claims soften this considerably — a claim frees the moment a player's
> own slots go terminal, not at settle (§2.7a), so the practical limit is "one
> unfinished mission at a time" rather than "one mission at a time". Field Work's
> `baseMax 6` / `decayHours 30` keeps cohorts rolling over faster than Casino.
> If ten runs still proves unreachable in playtest, the levers are the **Advisor**
> capacity bump and Field Work's decay — **not** the 500 GP price.

**`npm run econ` does not cover this.** It models a casino table in isolation
from live engine values, which is still the right gate for ante/card/pot
changes. It cannot see tile rewards, chest payouts or companion costs, so the
season-level balance pass needs its own model. Worth building alongside the
XP/GP retune rather than stretching `econ` to do both.

---

## Deferred (future designs)

- **S2 feats** — new level curve, higher max level, the Advisor threshold, and
  the "+1 companion party slot" feat.
- **Equipment & consumables** — the expanded backend-driven shop; chest rewards
  become item drops rather than gold-only.
- **XP/GP retune** for a ~145-challenge season.
- **S2 seed migration** — gold carry from S1.5 (`max(final, 250)`), fresh player
  records.
- **Multi-phase Sorcerer encounter** — the dungeon bundle flagged that a
  single-tile boss may want a staged fight; S2 ships it as one Elite-shaped tile.
