# RPelago Season 2 — Leveled Enemy Traits

Companion document to [season-2-map-plan.md](season-2-map-plan.md) (see its
**§0.6**, which holds the cross-cutting hooks). Source: the design bundle
`RPelago Season 2 - Classes` — `README.md`, `traits-data.js`, `mock-player.jsx`,
`mock-admin.jsx`.

> The bundle also prototyped **class/adventurer abilities**. Those are a design
> dead-end, explicitly **out of scope**, and may be revisited for S3. Ignore all
> class material in that folder.

S2 upgrades enemy traits from binary on/off to a **leveled** model: ten traits
gain 3–5 levels, six stay binary. The roster is unchanged — the same 16 traits
as S1 — so this is a model change plus a rebalance, not new content. The point
of the exercise is the **framework**: adding traits and tuning difficulty
becomes data, not code.

---

## 0. Decisions locked

| # | Decision |
|---|----------|
| T1 | **Camouflage becomes additive** on the tile's `hint` cost — `hint 10` at Camouflage L1 (+10%) resolves to `20`. The S1 boolean gate (hints fully off until first goal) is **retired by intent**; a genuine hint blackout is now a bespoke per-tile rule an admin sets on specific challenges (typically puzzles), not a systemic trait. |
| T2 | **Orbs reduce a boss trait's level by one**, removing it at level 0 — they no longer strip the whole trait. *Which* traits the Sorcerer carries, at what levels, and how the nine orbs map onto them is an **open question** (§10). |
| T3 | Multi-target traits store **arrays** of rolled targets. **Thief is rolled by the system**, not hand-picked — explicitly so the admin cannot introduce bias, real or perceived. |
| T4 | **Elites and Puzzles keep hand-authored traits** (low counts, worth the care). **Battle traits are generated**, scaling with distance from the Castle → Dungeons → Tower. Generated traits remain hand-editable. |
| T5 | Trait difficulty **feeds XP and GP significantly**. Requires an internal per-trait **difficulty modifier** — an **open question** (§10). |
| T6 | **The current four passive items are deprecated.** The replacement equipment system works two ways: **partial/full immunity** (the player is still rolled, the effect fizzles — higher-tier gear improves the fizzle chance) and **per-player level reduction** (a player lowers Horde by 1–2 *for themselves*, leaving it intact for everyone else). Both are future designs, but the trait model must be built to accommodate them — see §4. |
| T7 | Data model + resolver land **with `season-2-map-plan.md` §0.5**; the three UI surfaces are a **later pass** (§11). |

---

## 1. Data model

### Today (S1) — `src/lib/constants.ts`

```ts
export interface TraitDef {
  id: string; name: string;
  description: string;   // "{value}" substituted with the numeric parameter
  hasValue: boolean;
  defaultValue: number;
}
```

Stored on a tile as `traits: Record<string, { value: number }>`; presence in the
map means "on", and `hasValue: false` traits store `{ value: 0 }`.

### S2 — leveled

```ts
export interface TraitDef {
  id:     string;
  name:   string;
  blurb:  string;                      // one-line codex summary
  max?:   number;                      // level count; absent ⇒ binary
  values?: number[];                   // per-level parameter, length === max
  describe: (level: number) => string; // player-facing text for that level
  multi?: {                            // stunning / taunt / thief only
    from: number;                      // first level at which multi-target applies
    min: number; max: number; def: number;
    noun: 'stunned' | 'taunted' | 'thieves';
  };
  /** Difficulty weight feeding XP/GP and generation. OPEN — see §10. */
  difficulty?: number[];
}
```

Stored on a tile as:

```ts
traits: Record<string, { level: number; count?: number }>
```

`count` applies only to `multi` traits at or above `multi.from`. Level 0 or
absent ⇒ off.

### Migration

**No data migration.** S1 is archived and read-only, so its `{ value }` records
stay as they are; the reader tolerates both shapes:

```ts
function traitLevel(entry: { level?: number; value?: number }, def: TraitDef): number {
  if (entry.level != null) return entry.level;
  // Legacy S1 record: map the stored value back onto the nearest level, or 1 for binary.
  if (def.values && entry.value != null) {
    const i = def.values.indexOf(entry.value);
    return i >= 0 ? i + 1 : 1;
  }
  return 1;
}
```

**Nothing is converted.** Every S2 tile is authored fresh — hand-authored for
elites and puzzles, generated for battles (§6) — so **no S2 tile ever carries an
S1-shaped entry.** The legacy-tolerant reader above exists solely to keep the
**archived S1 season** rendering, and can be deleted whenever that archive stops
being served. The only trait data still needing decisions is the Sorcerer's
loadout and the equipment interaction, both open (§10).

> **This matters because a straight L1 conversion would not have been neutral.**
> Several traits are *easier* at L1 than their S1 equivalents: Stunning L1 is
> "several of its locations excluded" vs S1's "all locations excluded"; Aerial L1
> accepts "Jump, Fly, or short+ range" vs S1's "Fly or Ranged Weapon"; Enduring
> L1 is 90% vs S1's 95. Agile, Sturdy and Horde L1 match their S1 defaults
> exactly. Authoring sets levels deliberately — there is no bulk default to 1.

---

## 2. The ten leveled traits

Descriptions are **verbatim** from the design bundle. `’` is the curly
apostrophe (U+2019) — preserve it.

### Aerial — max 5 — *Engagement requirement — mobility / range*

| Lv | Description |
|----|-------------|
| 1 | In order to engage this enemy, one of your games must feature the ability to Jump, Fly, or use a short+ range weapon. |
| 2 | In order to engage this enemy, one of your games must feature the ability to Fly or use a short+ range weapon. |
| 3 | In order to engage this enemy, one of your games must feature the ability to Fly or use a medium+ range weapon. |
| 4 | In order to engage this enemy, one of your games must feature the ability to Fly or use a long+ range weapon. |
| 5 | In order to engage this enemy, one of your games must feature the ability to attack with a ranged weapon while flying, or use an extreme range weapon. |

### Agile — max 5 — values `[250, 220, 180, 140, 100]` — *Caps total checks*
`Your slot may not have more than {value} checks.`

### Camouflage — max 3 — values `[10, 25, 50]` — *Raises hint cost until first goal*
`Hints are at +{value}% until at least one slot has goaled.`

**Additive on the tile's `hint`** (decision T1): a tile with `hint: 10` and
Camouflage L2 resolves to `35` until the first goal, then back to `10`.

### Cursed — max 3 — *Randomizes some YAML settings on submit*

Template: `After submitting your slot, one or more of your settings will be randomized. <SEVERITY> (This will not affect logic or ER settings. Please talk with the admin if there is a setting that should not be touched.)`

| Lv | `<SEVERITY>` |
|----|--------------|
| 1 | This will have a minor effect on the file’s settings. |
| 2 | This will have a moderate effect on the file’s settings. |
| 3 | This will have a strong effect on the file’s settings. |

### Enduring — max 4 — values `[90, 92, 94, 96]` — *Requires a % of all checks sent*
`Goaling all slots does not complete this challenge. In order to complete the challenge, {value}% of all checks must be sent.`

### Horde — max 3 — values `[2, 3, 4]` — *Minimum number of games per slot*
`Your slot must have at least {value} games.`

### Sturdy — max 5 — values `[150, 200, 250, 300, 400]` — *Minimum number of checks per slot*
`Your slot must have at least {value} checks.`

### Stunning — max 3 — multi from L3 (`min 1, max 5, def 2`, noun "stunned")

| Lv | Description |
|----|-------------|
| 1 | One slot will be chosen at random to be stunned. It will have several of its locations excluded. |
| 2 | One slot will be chosen at random to be stunned. It will have the majority of its locations excluded. |
| 3 | One or more slots will be chosen at random to be stunned. They will have the majority of their locations excluded. |

### Taunt — max 3 — multi from L3 (`min 1, max 5, def 2`, noun "taunted")

| Lv | Description |
|----|-------------|
| 1 | One slot will be chosen at random to be taunted. It will have several of its locations prioritized. |
| 2 | One slot will be chosen at random to be taunted. It will have the majority of its locations prioritized. |
| 3 | One or more slots will be chosen at random to be taunted. They will have the majority of their locations prioritized. |

### Thief — max 3 — multi from **L2** (`min 1, max 5, def 2`, noun "thieves")

| Lv | Description |
|----|-------------|
| 1 | One slot will be chosen at random to be a thief. It will steal one or more important items from the other slots. |
| 2 | One or two slots will be chosen at random to be thieves. They will steal one or more important items from the other non-thief slots. |
| 3 | One or two slots will be chosen at random to be thieves. They will steal several important items from the other non-thief slots. |

---

## 3. The six binary traits

Unchanged from S1 — no level, no meter. Admin renders a toggle; the player sees
name + description only.

| Trait | Description |
|-------|-------------|
| **Bifurcated** | This challenge will be split into two worlds that must both goal to complete this challenge. |
| **Confounding** | An additional Simon Tatham's Portable Puzzle Collection slot will be added to this challenge as a Public slot. |
| **Magic Resist** | In order to engage this enemy, your slot must not involve magic. (Subject to discussion with admins.) |
| **Physical Resist** | In order to engage this enemy, your slot must involve magic. (Subject to discussion with admins.) |
| **Puzzling** | An additional Jigsaw will be added to this challenge as a Public slot. |
| **Unbalanced** | Progression balancing will be set to 0 for this challenge. |

---

## 4. Resolution — and the per-player hook

A single resolver replaces the scattered `{value}` substitution:

```ts
export interface ResolvedTrait {
  def:    TraitDef;
  level:  number;          // effective level for this viewer
  base:   number;          // the tile's authored level, before player modifiers
  value:  number | null;   // def.values[level-1], or null
  count:  number | null;   // multi-target count, or null
  text:   string;          // fully substituted player-facing description
}

export function resolveTrait(
  traitId: string,
  entry:   { level?: number; value?: number; count?: number },
  // OPTIONAL player context. Unused at launch — this is the seam the future
  // equipment system plugs into (decision T6). Passing nothing yields the
  // tile's authored level, which is exactly today's behaviour.
  player?: Player,
): ResolvedTrait
```

**Why the seam exists.** The replacement equipment system (T6) works two ways,
and one of them makes trait level **per-player**:

- **Immunity, partial or full** — the player is still rolled as a target, but
  the effect *fizzles*, wasting the roll that would otherwise have hit someone
  else. Higher-tier gear improves the fizzle chance. (This is already how S1's
  Stunning text describes Ring of Resistance, so the concept is established.)
- **Per-player level reduction** — a player lowers Horde by 1–2 *for
  themselves*, leaving it at full strength for teammates with different gear.

That second mode means **there is no single "the level of this trait"** once
equipment lands. Every consumer must therefore go through `resolveTrait` with
the viewing player rather than reading `entry.level` directly — build it that
way now, even though `player` is ignored until the equipment design lands.

**The four current passive items are deprecated** (T6). `traitEffect()` in
[lbHelpers.tsx](../src/components/lightbox/lbHelpers.tsx) and `ITEM_TRAIT_REFS`
in `constants.ts` retire alongside the shop collapse
([map plan §1.8](season-2-map-plan.md)). Their IMMUNE/MODIFIED badge rendering is
worth keeping as a component — the new system will need exactly that display.

---

## 5. Lock-time target resolution

`adminSetTileState(coord, 'inprogress')` in
[GameStateProvider.tsx:177](../src/contexts/GameStateProvider.tsx#L177) currently
rolls **one** adventurer each for Stunning and Taunt, and **nothing** for Thief.
S2 needs all three, multi-target, system-rolled.

**Type change** — `Tile` gains arrays, replacing the two scalars:

```ts
stunnedAdvIds?: string[];
tauntedAdvIds?: string[];
thiefAdvIds?:   string[];   // new — no equivalent today
```

Rules:

- Roll `count` **distinct** targets, clamped to the number of available
  adventurers. Below `multi.from`, `count` is implicitly 1.
- **Thief is always system-rolled** (T3). The admin never picks thieves — the
  point is to remove any possibility of bias, real or perceived, in a mechanic
  that materially disadvantages whoever is chosen.
- The **`setTileState` clearing invariant must cover all three arrays.** Today
  `setTileState` always writes `stunnedAdvId: null` / `tauntedAdvId: null`
  alongside the state so any transition away from `inprogress` resets them (see
  `CLAUDE.md`). That invariant now spans three array fields — miss one and a
  stale thief roll survives a state bounce.
- Rolls are written in the same atomic `update()` as the state transition, as
  today.

---

## 6. Trait authoring — hand vs generated

| Tile kind | Traits |
|-----------|--------|
| **Elite** | Hand-authored. **11 total** — 3 surface + 6 dungeon (2 per dungeon) + **2 Tower** (F1 and F2, each gating that floor's stairs). |
| **Puzzle** | Hand-authored. **41 total** — 12 surface + 5 per dungeon (15) + 4 per Tower floor (12) + the **2 Mimics**, which become Puzzles when they reveal. |
| **Battle** | **Generated** (~95), then hand-editable. |
| **Boss (Sorcerer)** | Hand-authored + orb interaction — **open, see §10**. |

**Hand-authored total: 52 tiles** (11 elites + 41 puzzles); the ~95 battles are
generated. Puzzle counts are **fixed per area**, not a ratio — battles are the
remainder (map-plan decision 25), which makes the generator contract exact:
place the specials, place N puzzles, everything else is a battle.

> For scale: S1 hand-authored **31** tiles (16 battles + 9 puzzles + 5 elites +
> boss). S2 is ~1.7× that, and heavier per tile — puzzles and elites carry more
> design thought than battles. This is a deliberate, accepted cost; generation
> is what keeps it from being ~145.

Generated battle traits scale with position:

- **Surface** — fewer and lower-level traits near the Castle, rising with
  Manhattan distance from D6.
- **Dungeons** — a step above surface battles.
- **Tower** — a step above dungeons, rising per floor.

Generation reuses the existing override convention: `adminOverride: true` marks
a hand-tuned tile, and Regen Stats clears it back to seeded defaults — exactly
how tile stats already behave. Generated traits are seeded from
`gameState.meta.seed`, so a given seed always produces the same board.

> This is what makes the leveled system usable at ~145 challenges. Without
> generation, battles would in practice ship traitless and the model would only
> ever appear on hand-authored tiles.

---

## 7. UI surfaces

Three surfaces, all reusing existing classes (`lb-trait-*`, `admin-trait-*`)
rather than introducing new tokens.

### 7.1 Player — tile lightbox ([TileDetails.tsx](../src/components/lightbox/TileDetails.tsx))

Existing `.lb-traits` block. Each leveled trait becomes a card: name left,
**level meter** right, description below. Binary traits render exactly as today.

**Level meter — "segmented bar"** (the chosen treatment; two alternates were
prototyped and rejected):

- `max` segments of `13 × 7px`, `border-radius: 1px`, `gap: 2px`, followed by a
  `level / max` numeral (Cinzel `0.6rem`, `--gold-dim`, the `/` at `opacity: 0.5`).
- Filled segments ramp green → red: `oklch(64% 0.165 H)` where
  `H = 145 − (i / (max − 1)) · 122`, plus `box-shadow: 0 0 6px <same colour>`.
  Unfilled: `oklch(24% 0.02 40)`.

> **Theme requirement.** A green→red hue ramp is the canonical deuteranopia
> failure. Here it is *decorative reinforcement, not the data* — the
> filled-segment **count** and the `level / max` **numeral** each carry the value
> independently, so the meter stays readable in monochrome. That is not licence
> to ship a hue ramp everywhere:
>
> - In the four accessibility themes (moonlit, lapis, obsidian, tidepool — see
>   [map plan §1.2a](season-2-map-plan.md)) the ramp **must** become a
>   **lightness** ramp at fixed hue, so filled and unfilled stay distinguishable.
> - The four light themes (parchment, sakura, mint, lapis) need the **unfilled**
>   colour inverted — `oklch(24% 0.02 40)` is near-black and would read as
>   *filled* against a cream tile.
> - Both the admin pip selector (§7.3) and the codex meter (§7.2) use the same
>   ramp and need the same treatment — three surfaces, one shared helper.

### 7.2 Player — trait codex ([SectionTraits.tsx](../src/components/help/SectionTraits.tsx))

Extend the existing section from a few featured traits to the full leveled
scale. Per trait: name (gold) + italic blurb + a meter; then one row per level
with a `LV n` tag and that level's description. The row matching the tile's
current level is highlighted (`.sel` — brighter text, battle-red tag).

### 7.3 Admin — tile editor ([TraitEditor.tsx](../src/components/admin/mapPage/TraitEditor.tsx))

Replaces the current checkbox + number-input row.

- **Leveled row** — `max` clickable pips (13px circles, `gap: 5px`) plus a
  `level / max` or `OFF` label. Pip click math:
  `onClick(i) → setLevel(level === i + 1 ? i : i + 1)`, clamped at 0. So clicking
  the current top pip turns it down one, and clicking pip 1 at level 1 turns the
  trait off. Same threat ramp as the player meter; hover `scale(1.18)`.
- **Preview box** when level > 0 — `LV n · PLAYERS SEE` with the resolved
  description, left gold accent border.
- **Target stepper** (Stunning / Taunt / Thief) — appears **only** at or above
  `multi.from`. Dashed box labelled `TARGETS ON LOCK`, −/＋ stepper clamped to
  `multi.min..multi.max`, defaulting to `multi.def` when the trait first reaches
  `multi.from`. Caption: *"roll **N** player(s) at random to be `<noun>` when the
  tile locks."* Persists as `count`.
- **Binary row** — 30×17 ON/OFF pill + name + `FIXED` tag; description shows
  when on.

Transitions ~0.12–0.15s on knob and pip fills; no other animation.

---

## 8. Downstream references

| File | Change |
|------|--------|
| [constants.ts](../src/lib/constants.ts) | `TraitDef`, `TILE_TRAITS`; `BOSS_ELEMENTAL_TRAIT_VALUES` → levels; `ELEMENTAL_ORB_TRAITS`, `BOSS_SOFT_TRAITS` |
| [types/index.ts](../src/types/index.ts) | `Tile.traits` entry shape; `stunnedAdvId`/`tauntedAdvId` → three arrays; same on `GMMission` |
| [lbHelpers.tsx](../src/components/lightbox/lbHelpers.tsx) | `traitEffect()` retires with the items (T6); keep the badge component |
| [TileDetails.tsx](../src/components/lightbox/TileDetails.tsx) | Trait render + meter; `{value}` substitution moves into `resolveTrait` |
| [TraitEditor.tsx](../src/components/admin/mapPage/TraitEditor.tsx) | Replaced wholesale (§7.3) |
| [GameStateProvider.tsx](../src/contexts/GameStateProvider.tsx) | Multi-target + thief roll (§5) |
| [SectionTraits.tsx](../src/components/help/SectionTraits.tsx) | Full codex (§7.2) |
| [tileGen.ts](../src/lib/tileGen.ts) | Seeded battle-trait generation (§6) |
| `OrbsPage.tsx`, `agendaHelpers.ts`, `GuildmasterMissions.tsx` | Read trait values/names — verify they resolve through `resolveTrait` |
| `functions/src/index.ts` | Server copy of the trait table wherever join validation needs it (map plan §0.5) |

---

## 9. Cross-cutting hooks into the map plan

Recorded here and in [map plan §0.6](season-2-map-plan.md):

- **§0.5 — YAML at join.** `joinChallenge` validates the **Horde floor**, now
  `values[level − 1]` ∈ {2, 3, 4} rather than a fixed 2. It must resolve through
  `resolveTrait`, and once equipment lands, through the *player's* effective
  level (§4).
- **§2.3 — Companions.** Check Count raises the **Agile** cap, now
  level-resolved; it still does not affect Sturdy.
- **Phase 3 — Dungeons and Tower.** Interior tiles carry traits like any
  challenge, and are the top end of the generated difficulty scale (§6).

---

## 10. Open questions — require a design pass

These are deliberately unresolved. **Do not guess at implementation time** —
each needs a decision first.

1. **Trait difficulty modifiers (T5).** Every trait/level needs an internal
   difficulty weight. Two consumers: seeded battle-trait generation (§6) needs
   a budget to spend, and XP/GP are to be modified *significantly* by the total.
   Blocks: generated traits, and the reward retune.
2. **The Sorcerer's trait loadout (T2).** Which traits, at which levels, and how
   the nine orbs map onto reducing them. S1's `BOSS_ELEMENTAL_TRAIT_VALUES` maps
   four orbs to eight traits; S2 has nine orbs and a leveled model, so the
   mapping is genuinely open. Blocks: `onOrbAcquired` and the Floor 3 boss tile.
3. **Equipment ↔ traits (T6).** The fizzle-chance mechanic and per-player level
   reduction both need specifying before `resolveTrait`'s `player` argument does
   anything. The *seam* ships now; the behaviour does not.

> **Resolved — the hint blackout stays retired.** Hints-fully-off is gone as a
> systemic trait effect, intentionally. Where a specific challenge genuinely
> needs one (a puzzle, typically), the admin applies it as a **bespoke per-tile
> rule** rather than through Camouflage. Camouflage is now purely the additive
> hint-cost trait described in §2. A general "admin-authored one-off trait"
> capability would be a natural future extension of this framework, but is not
> built here.

---

## 11. Sequencing & testing

**Phase A — model (lands with [map plan §0.5](season-2-map-plan.md)).** The join
callable cannot validate a Horde floor without the level resolver, so this is a
hard prerequisite.

- `TraitDef` + the 16 definitions with level tables
- `resolveTrait` including the ignored `player` seam
- Tile trait entry shape + the legacy-tolerant reader
- Multi-target arrays + system-rolled thief (§5)

**Phase B — authoring.** Seeded battle-trait generation (§6). *Blocked on open
question 1.*

**Phase C — UI.** Level meter, codex, admin pip editor (§7).

### Tests

- `resolveTrait` — every trait at every level produces the exact verbatim text;
  `{value}` substitution matches the `values` arrays; binary traits return no
  meter data; curly apostrophes survive.
- Legacy reader — an S1 `{ value: 250 }` Agile entry resolves to L1;
  `{ value: 0 }` binary entries resolve to on; unknown values fall back to L1.
- Camouflage — additive on `hint`, and reverts once a slot goals.
- Multi-target — rolls exactly `count` **distinct** targets; clamps to the
  adventurer count when `count` exceeds it; `count` is ignored below
  `multi.from`; thief rolls without any admin input.
- `setTileState` clears **all three** target arrays on every transition away
  from `inprogress` (the invariant most likely to be missed).
- Horde floor at L2/L3 rejects a 2-game join in `joinChallenge` (map plan §0.5).

**Theme audit** (manual, per §7.1): the level meter, admin pip selector and codex
meter all render legibly in the four light themes and the four accessibility
themes — lightness ramp substituted for the hue ramp in the latter, unfilled
colour inverted in the former — plus a monochrome pass confirming segment count
and numeral carry the value without colour.
