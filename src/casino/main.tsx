import React from 'react';
import ReactDOM from 'react-dom/client';
import { CasinoTable } from './CasinoTable';
import './themes.css';  // casino token layer; must load before play.css/cards.css
import './cards.css';
import './play.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CasinoTable />
  </React.StrictMode>,
);
