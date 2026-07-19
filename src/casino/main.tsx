import React from 'react';
import ReactDOM from 'react-dom/client';
import { CasinoTable } from './CasinoTable';
import './themes.css';  // casino token layer; must load before play.css/cards.css
import './cards.css';
import './play.css';

// The casino token layer is scoped to `.casino-scope` so it never bleeds into
// the map app. This standalone table document is always a casino context — and it
// has no SettingsPanel of its own, so it must mirror the player's shared site
// settings (same localStorage keys as SettingsPanel): the theme picker and the
// text-size slider. Without this the table is stuck on gilded/dark at 16px while
// the landing follows the player's choices.
document.body.classList.add('casino-scope');
try {
  const theme = localStorage.getItem('realm_theme');
  if (theme && theme !== 'gilded') document.body.classList.add(`theme-${theme}`);
  const scale = parseFloat(localStorage.getItem('realm_font_scale') ?? '1');
  if (scale > 0 && scale !== 1) document.documentElement.style.setProperty('--font-scale', String(scale));
} catch { /* settings are best-effort */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CasinoTable />
  </React.StrictMode>,
);
