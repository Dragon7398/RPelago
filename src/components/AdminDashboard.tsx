import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import ChallengesPage from './admin/ChallengesPage';
import PlayersPage from './admin/PlayersPage';
import ShopsPage from './admin/ShopsPage';
import OrbsPage from './admin/OrbsPage';
import MapPage from './admin/MapPage';

type DashPage = 'challenges' | 'players' | 'shops' | 'orbs' | 'map';

const PAGES: { id: DashPage; label: string }[] = [
  { id: 'challenges', label: '⚔ Challenges' },
  { id: 'players',    label: '👥 Players'    },
  { id: 'shops',      label: '🛒 Shops'      },
  { id: 'orbs',       label: '⚗ Orbs'       },
  { id: 'map',        label: '🗺 Map'        },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const { gameState, loading } = useGameState();
  const [page, setPage]       = useState<DashPage>('challenges');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = !!user && !!gameState && user.id === gameState.meta?.adminId;

  useEffect(() => {
    const prev = document.title;
    document.title = 'RPelago — Admin';
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (loading) {
    return (
      <div className="dash-loading">
        <div className="loading-emblem">⚔</div>
        <div className="loading-title">RPELAGO</div>
        <div className="loading-subtitle">Loading Dashboard…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="dash-unauth">
        <div className="dash-unauth-icon">🔒</div>
        <div className="dash-unauth-msg">Admin access required.</div>
        <a className="dash-unauth-link" href="/">Return to site</a>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <header className="dash-header">
        <div className="dash-header-title">⚔ RPelago — Admin Dashboard</div>
        <nav className="dash-tabs">
          {PAGES.map(p => (
            <button
              key={p.id}
              className={`dash-tab${page === p.id ? ' active' : ''}`}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="dash-header-nav" ref={menuRef}>
          <button
            className={`dash-hamburger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Navigation menu"
          >
            <span /><span /><span />
          </button>
          {menuOpen && (
            <div className="dash-menu">
              {PAGES.map(p => (
                <button
                  key={p.id}
                  className={`dash-menu-item${page === p.id ? ' active' : ''}`}
                  onClick={() => { setPage(p.id); setMenuOpen(false); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="dash-main">
        {page === 'challenges' && <ChallengesPage />}
        {page === 'players'    && <PlayersPage />}
        {page === 'shops'      && <ShopsPage />}
        {page === 'orbs'       && <OrbsPage />}
        {page === 'map'        && <MapPage />}
      </main>
    </div>
  );
}
