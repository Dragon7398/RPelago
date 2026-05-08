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
| `functions/` | Cloud Functions (purchase handlers, Discord token exchange) |
| `database.rules.json` | Firebase security rules |
