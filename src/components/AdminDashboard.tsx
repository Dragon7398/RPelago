import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameState } from '../contexts/GameStateContext';
import { currentMaxSlots } from '../lib/missionLogic';
import ChallengesPage from './admin/ChallengesPage';
import PlayersPage from './admin/PlayersPage';
import ShopsPage from './admin/ShopsPage';
import OrbsPage from './admin/OrbsPage';
import MapPage from './admin/MapPage';
import MissionsPage from './admin/MissionsPage';
import KmkPage from './admin/kmk/KmkPage';

type DashPage = 'challenges' | 'players' | 'shops' | 'orbs' | 'map' | 'missions' | 'kmk';

const PAGES: { id: DashPage; label: string }[] = [
  { id: 'challenges', label: '⚔ Challenges' },
  { id: 'missions',   label: '⚜ Missions'   },
  { id: 'kmk',        label: '🗝 Keep'       },
  { id: 'map',        label: '🗺 Map'        },
  { id: 'players',    label: '👥 Players'    },
  { id: 'shops',      label: '🛒 Shops'      },
  { id: 'orbs',       label: '⚗ Orbs'       },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const { gameState, loading } = useGameState();
  const [page, setPage]         = useState<DashPage>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('coord') ? 'map' : 'challenges';
  });
  const [mapInitCoord, setMapInitCoord] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('coord') ?? undefined;
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const navigateToMap = (coord: string) => {
    setMapInitCoord(coord);
    setPage('map');
  };
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = !!user && !!gameState && user.id === gameState.meta?.adminId;

  const challengeWarnCount = gameState ? Object.values(gameState.tiles).filter(tile => {
    const advCount = Object.keys(tile.adventurers ?? {}).length;
    if (tile.state === 'available') return tile.required > 0 && advCount >= tile.required;
    if (tile.state === 'inprogress') {
      if (!tile.link) return true;
      const advs = Object.values(tile.adventurers ?? {});
      return advs.length > 0 && advs.every(adv => {
        const slots = adv.slots ?? [];
        return slots.length > 0 && slots.every(s => s.status === 'Done' || s.status === 'Goaled');
      });
    }
    return false;
  }).length : 0;

  const missionWarnCount = gameState ? Object.values(gameState.missions ?? {}).filter(m => {
    if (m.state === 'complete') return false;
    const filled = Object.keys(m.participants ?? {}).length;
    const max = currentMaxSlots(m, Date.now());
    if (m.state === 'forming') return filled > 0 && max > 0 && filled >= max;
    if (m.state === 'inprogress') {
      if (!m.link) return true;
      const parts = Object.values(m.participants ?? {});
      return parts.length > 0 && parts.every(p => {
        const slots = p.slots ?? [];
        return slots.length > 0 && slots.every(s => s.status === 'Done' || s.status === 'Goaled');
      });
    }
    return false;
  }).length : 0;

  useEffect(() => {
    const prev = document.title;
    document.title = 'RPelago — Admin';
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    document.body.classList.add('admin-active');
    return () => document.body.classList.remove('admin-active');
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
          {PAGES.map(p => {
            const badge = p.id === 'challenges' ? challengeWarnCount : p.id === 'missions' ? missionWarnCount : 0;
            return (
              <button
                key={p.id}
                className={`dash-tab${page === p.id ? ' active' : ''}`}
                onClick={() => { setPage(p.id); setMapInitCoord(undefined); }}
              >
                {p.label}
                {badge > 0 && <span className="dash-tab-badge">{badge}</span>}
              </button>
            );
          })}
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
                  onClick={() => { setPage(p.id); setMapInitCoord(undefined); setMenuOpen(false); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <main className="dash-main">
        {page === 'challenges' && <ChallengesPage navigateToMap={navigateToMap} />}
        {page === 'missions'   && <MissionsPage />}
        {page === 'kmk'        && <KmkPage />}
        {page === 'map'        && <MapPage initialCoord={mapInitCoord} />}
        {page === 'players'    && <PlayersPage />}
        {page === 'shops'      && <ShopsPage />}
        {page === 'orbs'       && <OrbsPage />}
      </main>
    </div>
  );
}
