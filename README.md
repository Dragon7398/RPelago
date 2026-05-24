# RPelago

A real-time collaborative metagame overlay for [Archipelago](https://archipelago.gg) randomizer sessions.

Players log in via Discord, send adventurers to tiles on a 5×7 grid map, and cooperatively unlock new areas by completing challenges. An admin controls tile progression, configures encounters, and manages the shop economy.

## Features

- **Grid map** — 5×7 board with tile progression: hidden → available → in progress → complete
- **Adventurer system** — XP, gold, levels (1–7), and feats that modify YAML submission rules
- **Orb system** — Nine elemental orbs collected across the map that strip traits from the final boss
- **16 tile traits** — Modifiers like Aerial, Cursed, Bifurcated, and Stunning that change challenge rules
- **Four shops** — Items and orb purchases using in-game gold, enforced server-side via Cloud Functions
- **Real-time activity feed** — Live event log for tile completions, orb collection, and purchases
- **Admin dashboard** — Full control over tiles, players, shops, orbs, and map configuration
- **Themes** — Multiple visual themes including colorblind-friendly options
- **Player profiles** — Adventurer customization, feat selection, name color, and XP history

## Tech Stack

- React 19 + TypeScript + Vite
- Firebase Realtime Database (all game state)
- Firebase Authentication with Discord OAuth (via custom token exchange)
- Firebase Cloud Functions (OAuth exchange, shop purchases)

## Setup

### Prerequisites

- Node.js 18+
- A [Firebase](https://firebase.google.com) project with Realtime Database and Authentication enabled
- A [Discord application](https://discord.com/developers/applications) for OAuth

### Running locally

```bash
npm install
npm run dev        # Dev server at localhost:5173
```

Edit `.env` with your own Firebase project config and Discord client ID before running.

### Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

### Other commands

```bash
npm run build      # Type-check and build to dist/
npm run lint       # ESLint
npm run preview    # Preview production build
npx tsc --noEmit   # Type-check only
```

## License

[GNU Affero General Public License v3.0](LICENSE) — forks that are deployed as a network service must also be open source.
