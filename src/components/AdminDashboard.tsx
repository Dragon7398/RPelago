import { useState, useRef, useEffect } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { useIsAdmin, useSeason } from '../contexts/SeasonContext';
import { currentMaxSlots } from '../lib/missionLogic';
import ChallengesPage from './admin/ChallengesPage';
import PlayersPage from './admin/PlayersPage';
import ShopsPage from './admin/ShopsPage';
import OrbsPage from './admin/OrbsPage';
import MapPage from './admin/MapPage';
import MissionsPage from './admin/MissionsPage';
import KmkPage from './admin/kmk/KmkPage';
import SeasonSwitcher from './SeasonSwitcher';

type DashPage = 'challenges' | 'missions' | 'casino' | 'players' | 'shops' | 'orbs' | 'map' | 'kmk';
type Shell = 'map' | 'casino';

// The visible tab set is season-driven (see season-architecture-plan.md's tab
// matrix). Casino gets its own tab in EVERY season — the Casino/Missions split
// is permanent, not an S1.5 hack. A casino season hides the map-only tabs
// (Challenges/Missions/Map/Shops/Orbs); a map season shows everything plus Casino.
const ALL_PAGES: { id: DashPage; label: string; shells: Shell[] }[] = [
  { id: 'challenges', label: '⚔ Challenges', shells: ['map'] },
  { id: 'missions',   label: '⚜ Missions',   shells: ['map'] },
  { id: 'casino',     label: '🂡 Casino',     shells: ['map', 'casino'] },
  { id: 'kmk',        label: '🗝 Keep',       shells: ['map', 'casino'] },
  { id: 'map',        label: '🗺 Map',        shells: ['map'] },
  { id: 'players',    label: '👥 Players',    shells: ['map', 'casino'] },
  { id: 'shops',      label: '🛒 Shops',      shells: ['map'] },
  { id: 'orbs',       label: '⚗ Orbs',       shells: ['map'] },
];

export default function AdminDashboard() {
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
  // Captured once at mount rather than read during render (the decay it feeds
  // only shifts every 24h, so a live clock would just be an impure render read).
  const [now] = useState(() => Date.now());

  const navigateToMap = (coord: string) => {
    setMapInitCoord(coord);
    setPage('map');
  };
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = useIsAdmin();
  const shell: Shell = (useSeason().season?.shell ?? 'map') as Shell;
  const PAGES = ALL_PAGES.filter(p => p.shells.includes(shell));
  // If the stored page isn't available in this season's shell (a casino season
  // has no Challenges tab, etc.), fall back to the first visible tab.
  const activePage: DashPage = PAGES.some(p => p.id === page) ? page : (PAGES[0]?.id ?? 'players');

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

  // Missions needing admin attention, split by type so the Missions and Casino
  // tabs each carry their own badge.
  const warnMissions = gameState ? Object.values(gameState.missions ?? {}).filter(m => {
    if (m.state === 'complete') return false;
    const filled = Object.keys(m.participants ?? {}).length;
    const max = currentMaxSlots(m, now);
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
  }) : [];
  const missionWarnCount = warnMissions.filter(m => m.type !== 'casino').length;
  const casinoWarnCount  = warnMissions.filter(m => m.type === 'casino').length;

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
        <SeasonSwitcher />
        <nav className="dash-tabs">
          {PAGES.map(p => {
            const badge = p.id === 'challenges' ? challengeWarnCount
              : p.id === 'missions' ? missionWarnCount
              : p.id === 'casino' ? casinoWarnCount : 0;
            return (
              <button
                key={p.id}
                className={`dash-tab${activePage === p.id ? ' active' : ''}`}
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
                  className={`dash-menu-item${activePage === p.id ? ' active' : ''}`}
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
        {activePage === 'challenges' && <ChallengesPage navigateToMap={navigateToMap} />}
        {activePage === 'missions'   && <MissionsPage filter="noncasino" />}
        {activePage === 'casino'     && <MissionsPage filter="casino" />}
        {activePage === 'kmk'        && <KmkPage />}
        {activePage === 'map'        && <MapPage initialCoord={mapInitCoord} />}
        {activePage === 'players'    && <PlayersPage />}
        {activePage === 'shops'      && <ShopsPage />}
        {activePage === 'orbs'       && <OrbsPage />}
      </main>
    </div>
  );
}
