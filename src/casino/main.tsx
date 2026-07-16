import React from 'react';
import ReactDOM from 'react-dom/client';
import { CasinoTable } from './CasinoTable';
import './themes.css';  // casino token layer; must load before play.css/cards.css
import './cards.css';
import './play.css';

// The casino token layer is scoped to `.casino-scope` so it never bleeds into
// the map app. This standalone table document is always a casino context.
document.body.classList.add('casino-scope');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CasinoTable />
  </React.StrictMode>,
);
