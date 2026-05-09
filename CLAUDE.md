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

Firebase Cloud Functions are in `functions/` and deploy separately via `firebase deploy --only functions`.

## Architecture

**RPelago** is a real-time collaborative metagame overlay for Archipelago randomizer sessions. Players log in via Discord, send adventurers to tiles on a grid map, and an admin controls tile progression. All state lives in Firebase Realtime Database.

### Data flow

```
Firebase RTDB (game/)
  └─ subscribeToGame() ─→ GameStateContext ─→ all components
```

`GameStateContext` is the single source of truth for UI. It subscribes to the full `game/` node via `onValue` and re-renders on any change. All mutations go through the context's exported callbacks, which call `db.ts` functions that write to Firebase.

### Key invariants

- **Admin identity**: `gameState.meta.adminId === currentUser.uid`. No token claims — just a plain field comparison in `AuthContext.isAdmin`.
- **Tile state machine**: `hidden → available → inprogress → complete`. The `available` set is always derived from adjacency to `complete` tiles. Any time a `complete` tile is un-completed, `computeRecalcUpdates()` in `GameStateContext` must re-derive all `available` states and write them atomically via `setTilesAvailability()`.
- **`adminOverride` flag**: When admin manually edits tile stats, `updateTileAdmin()` sets `adminOverride: true`. Regen Stats (`resetTileStats()`) clears it to `false` by re-applying seeded defaults.
- **Seeded map generation**: `gameState.meta.seed` drives everything in `tileGen.ts`. `initializeGrid(seed)` populates a module-level grid array used by `getTypeKey(r, c)`. This must be called before any type lookups; it's called automatically in `subscribeToGame` when the state first loads.

### Map grid

- Fixed **5 rows × 7 columns** (ROWS=5, COLS=7 in `constants.ts`).
- Coordinates are strings like `"2,3"` (row,col). Helpers: `coordFromRC(r,c)`, `rcFromCoord(coord)`.
- Tile types: `town_center` (always D3 = row 2, col 3), 3 `town`s, 5 `elite`s, 9 `puzzle`s, 1 `boss` (corner, seed-determined), rest `battle`.
- Town tiles are auto-completed and reveal adjacent tiles when a neighbor completes.

### Orb system

Nine elemental orbs (`ALL_ORBS` in `constants.ts`) are collected by completing specific tiles. `ELEMENTAL_ORB_TRAITS` maps each orb to boss traits it removes. When a new orb is collected, `GameStateContext`'s orb effect (`useEffect` on `gameState.orbState`) removes the corresponding traits from the boss tile, skipping soft traits if the boss is already `inprogress`.

### Auth

Discord OAuth → `exchangeDiscordCode` Cloud Function → Firebase custom token → `signInWithCustomToken`. After sign-in, `AuthContext` upserts the player record, then `GameStateContext` initializes the game (the first authenticated user becomes admin via the two-phase write in `initializeGameIfNeeded`).

### Shops and items

Shops are keyed by `shopId` on town tiles. Purchases go through Cloud Functions (`purchaseShopOrb`, `purchaseShopItem`) that use the admin SDK to bypass DB write rules for inventory updates. The "Coat of Many Colors" item gates the name color picker.

> **Dual-copy item costs**: `SHOP_ITEMS` in `src/lib/constants.ts` defines costs for the UI. `ITEM_COSTS` in `functions/src/index.ts` is a separate hardcoded copy used by the `purchaseShopItem` Cloud Function to enforce the price server-side. **Both must be updated together** whenever a price changes — the function comment says "mirrors src/lib/constants.ts SHOP_ITEMS".

### Public and claimable slots

Two distinct slot types exist on tiles:

- **`publicSlots?: AdvSlot[]`** — Admin-set open slots. Anyone can play them; they are never consumed or removed.
- **`claimableSlots?: Record<string, AdvSlot[]>`** — Created when an admin kicks a player from an **in-progress** tile. Any eligible player can claim one: the claim atomically deletes the slot entry and adds the player as a `TileAdventurer`. Keyed by Firebase push keys so individual entries are deletable.

The DB rule for `claimableSlots/$slotKey` allows any authenticated player to **delete** (claim) an existing entry but not create one. The `adventurers/$advId` validate rule uses a Firebase pre-write evaluation trick: during an atomic claim `update()`, the claimable slot still exists in `data`/`root` (pre-write state), so the rule `claimableSlots.exists()` passes even though the same update deletes it.

### In-progress join restriction

Once a tile is **in progress**, players cannot join it as a fresh adventurer — the Archipelago game is locked in at that point. The only entry path is claiming a claimable slot. This is enforced in two places:
1. **UI**: The "JOIN THE CHALLENGE" picker is absent from the in-progress lightbox section.
2. **DB rule**: The `adventurers/$advId` validate rule rejects non-admin writes to in-progress tiles unless `claimableSlots` exists on that tile.

### Player warnings

Players have a `warnings?: Record<string, PlayerWarning>` field (push-keyed for individual deletion). Warnings are:
- **Auto-generated** when an admin kicks a player from an in-progress tile (written atomically in the same `update()` call as the kick).
- **Manually added** by admin via the Players page in the Admin Dashboard.

The Players page shows a count badge (`⚑ N`) and an inline list with AUTO/ADMIN tags, dates, per-warning delete, and a "Clear all" button.

### Environment

All Firebase config is in `.env` as `VITE_FIREBASE_*` variables. The app degrades gracefully if `.env` is missing (`firebaseReady` guard in `config.ts`).

### File map

| Path | Role |
|------|------|
| `src/types/index.ts` | All TypeScript types for game entities |
| `src/lib/constants.ts` | Grid dims, tile types, orbs, traits, items, level thresholds |
| `src/lib/tileGen.ts` | Seeded RNG, grid layout, `generateTileStats`, `buildDefaultTileData` |
| `src/lib/gameLogic.ts` | XP/level math, adventurer reward calculation |
| `src/firebase/config.ts` | Firebase init, exports `db`, `auth`, `functions` |
| `src/firebase/db.ts` | All RTDB read/write functions |
| `src/contexts/AuthContext.tsx` | Discord OAuth, player upsert, `isAdmin` |
| `src/contexts/GameStateContext.tsx` | Game subscription, all action callbacks |
| `src/contexts/ToastContext.tsx` | Toast notification context |
| `src/components/admin/` | Admin dashboard tabs (Map, Challenges, Players, Shops, Orbs) |
| `src/components/AdminDashboard.tsx` | Admin dashboard shell; sets `document.title` to `RPelago — Admin` on mount |
| `functions/src/index.ts` | Cloud Functions — contains `ITEM_COSTS` table that must mirror `SHOP_ITEMS` in `constants.ts` |
| `database.rules.json` | Firebase security rules |
