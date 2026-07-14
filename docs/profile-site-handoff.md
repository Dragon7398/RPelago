# Handoff: Profile Site — Multi-Season Support

**Audience:** whoever maintains the separate RPelago **profile site** (the site
that resolves `/p/<handle>` and renders a player's cross-season record).

**Why now:** RPelago is moving from a single game to **multiple seasons**
(`rpelago_s1` → `rpelago_casino_1_5` → `rpelago_s2`). The `profiles/` tree in
Firebase RTDB was *already* designed for this — it keys stats under
`events/{eventId}/` — but S1 hardcoded the single event id `'rpelago_s1'`. This
doc pins down what changes, what stays, and what the profile site must handle.

**Key point:** `profiles/` is **not** season-scoped and is **not** moving. It
stays a top-level node, world-readable, keyed by Discord-derived `uid`. The
season refactor happens entirely under a new `seasons/` tree; `profiles/` is
untouched except for the changes below.

---

## 1. Current schema (as S1 writes it today)

Written by the `onTileComplete` and `onMissionComplete` Cloud Functions, plus a
stub written at login by `exchangeDiscordCode`.

```
profiles/
  players/{uid}/
    id:            <uid>
    displayName:   string
    discordHandle: string | null
    avatarHash:    string | null
    joinedAt:      number | null       # epoch ms
    firstEvent:    string | null       # e.g. "rpelago_s1" — set ONCE, never overwritten
    events/
      rpelago_s1/
        xp:       number               # snapshot of the player's total at write time
        tiles:    number               # incremented per tile completed
        missions: number               # incremented per mission completed
        games:    { <encodedGameName>: true, ... }

  handleIndex/
    <discordHandle with "." → "_">: <uid>     # lets /p/<handle> resolve to a uid
```

Notes on the existing conventions (all of which are **preserved**):

- **`firstEvent`** is set only if not already claimed — it records which event a
  player first scored in, and must never be overwritten by a later event.
- **`games`** keys are `encodeURIComponent(normalizedGameName)`, where
  normalization is `trim()` + collapse internal whitespace. Stored as a
  keyed map (`name → true`) rather than an array so concurrent writes are
  atomic and can't stomp each other.
- **`handleIndex`** replaces `.` with `_` because `.` is an invalid Firebase key
  character.
- Identity fields (`displayName`, `discordHandle`, `avatarHash`, `joinedAt`) are
  refreshed on **every** completion write, so they stay current.

---

## 2. What changes

### 2a. `events/{eventId}` becomes genuinely multi-key

`'rpelago_s1'` stops being a hardcoded literal and becomes the **season id**,
supplied by the Cloud Function from its trigger path. A player who plays all
three seasons ends up with:

```
events/
  rpelago_s1/          { xp, tiles, missions, games }
  rpelago_casino_1_5/  { gold, handsPlayed, games }
  rpelago_s2/          { … S2 shape, TBD }
```

**The profile site must therefore render an arbitrary set of event keys, not a
fixed one** — and must tolerate events it has never seen before (S2's shape is
not finalized). Treat `events/` as a map to iterate, not a struct with known
fields.

### 2b. The Casino season has a different shape

Season 1.5 is casino-only: **no XP, no levels, no adventurers, no tiles, no
feats.** Its event record is deliberately minimal:

```
events/rpelago_casino_1_5/
  gold:        number    # player's FINAL gold balance for the season
  handsPlayed: number    # tables successfully completed (see semantics below)
  games:       { <encodedGameName>: true, ... }    # same encoding as S1
```

- **`gold`** — the headline stat for this season, in place of S1's `xp`.
- **`handsPlayed`** — this season's analogue of S1's `missions` counter.
  **Counts only tables the player successfully completed.** A **folded hand does
  not count**, nor does a timed-out or kicked seat, even though an ante was paid
  and cards were dealt. Since one seat = one hand per table, this is effectively
  "tables completed."
- **`games`** — unchanged encoding and semantics; these are the Archipelago
  games the player brought as slots.
- **Deliberately absent:** `xp`, `tiles`, `missions`, and also the originally
  proposed `biggestWin` / `seasonWinnings` / `tablesCompleted` (the last being
  redundant with `handsPlayed`). Don't build UI expecting them.

**Rendering implication:** the profile site needs a **casino-flavored event
card** that shows gold / hands played / games — and must **not** assume every
event card has XP or a level. An S1 card and an S1.5 card look materially
different.

### 2c. `firstEvent` may now be a casino season

A player whose first-ever scoring event is a casino table will get
`firstEvent: 'rpelago_casino_1_5'`. The site should render a "first event"
badge generically from whatever id is stored, not assume `rpelago_s1`.

### 2d. Draft seasons must never appear

Cloud Functions will **no-op all `profiles/` writes when the triggering season's
status is `draft`**. This is a hard requirement on the writer side (it protects
against alpha playtesting corrupting real player history — including a draft
season permanently claiming `firstEvent`).

**The profile site needs no logic for this** — draft data simply never reaches
`profiles/`. It's documented here only so nobody "helpfully" adds draft handling.

---

## 3. What does *not* change

- `profiles/` location, shape of the player stub, and world-readability.
- `handleIndex` and the `/p/<handle>` resolution flow.
- The `firstEvent`-set-once rule.
- The `games` map encoding.
- Identity-refresh-on-every-write behavior.
- S1's existing `rpelago_s1` records — they are **not migrated or rewritten**.
  Whatever is there stays exactly as-is.

---

## 4. Open items for the profile site

1. **Season ordering / labels.** The site needs a display name and sort order
   per event id (`rpelago_s1` → "Season 1", `rpelago_casino_1_5` → "The Casino
   (Midseason)", `rpelago_s2` → "Season 2"). Where should that mapping live —
   hardcoded on the profile site, or published in RTDB (e.g. reusing
   `config/seasonList/{id}/label`) so it stays in sync automatically?
   *Recommendation: read it from `config/seasonList`, so adding a season needs
   no profile-site deploy.*
2. **Unknown-event fallback.** What should the site render for an event id it
   has no card design for (i.e. S2 before its card is built)? A generic
   key/value card is the safe default.
3. **S2's event shape** is not yet defined — S2 reintroduces XP/levels/feats and
   an expanded item system, so its record will likely resemble S1's plus new
   fields. This doc should be revised when S2's shape is settled.

---

## 5. Cross-references

- [season-architecture-plan.md](season-architecture-plan.md) — the `seasons/`
  tree, season statuses, the draft-write guard.
- [casino-season-1_5-plan.md](casino-season-1_5-plan.md) — where `gold`,
  `handsPlayed`, and `games` are produced (the settle function), and the
  definition of "successfully completed a table."
