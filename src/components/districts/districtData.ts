// ── The Capital Ward's districts (map plan §1.7) ──────────────────────────────
//
// S2 has no town tiles, so the things S1 hung off them — Guildmaster Missions on
// the centre tile, a shop per town — have nowhere to live. The ward is where they
// go: a card per district below the map, each opening its own panel.
//
// The KEYS are the S1 names (`questboard` / `shop` / `casino` / `fields`) and the
// LABELS are S2's (Town Hall / Shop / Casino / Barn). That split is deliberate —
// the keys reach RTDB and analytics, so renaming them to match the new prose
// would be a wire change for a copy edit.

export type DistrictKey = 'questboard' | 'shop' | 'casino' | 'fields';

export interface DistrictDef {
  key:    DistrictKey;
  label:  string;
  /** Shown when no sprite is present — see SPRITES below. */
  glyph:  string;
  /** Sprite basename under src/assets/districts/, without the extension. */
  sprite: string;
  /** One line of flavour on the card face. */
  line:   string;
}

export const DISTRICTS: readonly DistrictDef[] = [
  {
    key: 'questboard', label: 'Town Hall', glyph: '⚜', sprite: 'town-hall',
    line: 'Commissions from the Guildmaster.',
  },
  {
    key: 'shop', label: 'Shop', glyph: '🛒', sprite: 'general-store',
    line: 'Supplies for the road ahead.',
  },
  {
    key: 'casino', label: 'Casino', glyph: '🎰', sprite: 'casino',
    line: 'Let the cards choose your fate.',
  },
  {
    key: 'fields', label: 'Barn', glyph: '🌾', sprite: 'barn',
    line: 'Work the fields beyond the wall.',
  },
];

// Sprites are resolved through a Vite glob rather than named imports, so the art
// can land later without touching this file — and, more importantly, so its
// ABSENCE is not a build error. A named import of a missing PNG fails the build;
// an empty glob just leaves every card on its glyph.
const SPRITES = import.meta.glob<string>('../../assets/districts/*.png', {
  eager: true,
  import: 'default',
});

/** The sprite URL for a district, or null when the art isn't in the repo yet. */
export function districtSprite(def: DistrictDef): string | null {
  const hit = Object.entries(SPRITES).find(([path]) => {
    const base = path.split('/').pop() ?? '';
    return base === `${def.sprite}.png`;
  });
  return hit ? hit[1] : null;
}
