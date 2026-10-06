import { useState } from 'react';
import { AuthProvider } from './contexts/AuthProvider';
import { GameStateProvider } from './contexts/GameStateProvider';
import { ToastProvider } from './contexts/ToastProvider';
import { useAuth } from './contexts/AuthContext';
import { useGameState } from './contexts/GameStateContext';
import { SeasonProvider } from './contexts/SeasonProvider';
import { useIsAdmin, useSeason } from './contexts/SeasonContext';
import CasinoShell from './components/casino/CasinoShell';
import SettingsPanel from './components/SettingsPanel';
import { firebaseReady } from './firebase/config';
import Header from './components/Header';
import PlayerHUD from './components/PlayerHUD';
import OrbBar from './components/OrbBar';
import MapGrid from './components/MapGrid';
import TileLightbox from './components/TileLightbox';
import ProfileLightbox from './components/ProfileLightbox';
import LoginModal from './components/LoginModal';
import HelpModal from './components/HelpModal';
import PrivacyModal from './components/PrivacyModal';
import AdminDashboard from './components/AdminDashboard';
import ActivityFeed from './components/ActivityFeed';
import KmkBoard from './components/kmk/KmkBoard';
import { KmkProvider } from './contexts/KmkProvider';
import AgendaLauncher from './components/agenda/AgendaLauncher';
import AgendaDrawer from './components/agenda/AgendaDrawer';
import { deriveAgendaData } from './components/agenda/agendaHelpers';
import { currentMaxSlots } from './lib/missionLogic';
import { activeBoard } from './lib/board';
import DistrictWard from './components/districts/DistrictWard';
import TownHallPanel from './components/districts/TownHallPanel';
import ShopPanel from './components/districts/ShopPanel';
import BarnPanel from './components/districts/BarnPanel';
import CasinoDistrict from './components/districts/CasinoDistrict';
import type { DistrictKey } from './components/districts/districtData';

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-emblem">⚔</div>
      <div className="loading-title">RPELAGO</div>
      <div className="loading-subtitle">Charting the Archipelago…</div>
    </div>
  );
}

function AppContent() {
  const [activeTile,   setActiveTile]   = useState<string | null>(null);
  const [loginOpen,    setLoginOpen]    = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const [helpOpen,     setHelpOpen]     = useState(false);
  const [privacyOpen,  setPrivacyOpen]  = useState(() => window.location.hash === '#privacy');
  const [agendaOpen,   setAgendaOpen]   = useState(false);
  // Which district the player is in, or null for the map. Three of the four open as
  // modals OVER the map; `casino` replaces the map view entirely (decision 18).
  const [districtView, setDistrictView] = useState<DistrictKey | null>(null);
  // Captured once at mount rather than read during render (the decay it feeds
  // only shifts every 24h, so a live clock would just be an impure render read).
  const [now] = useState(() => Date.now());

  const { user }              = useAuth();
  const { gameState, loading } = useGameState();
  const isAdmin = useIsAdmin();
  const { season } = useSeason();

  const adminWarnCount = isAdmin && gameState ? (() => {
    const tileWarn = Object.values(gameState.tiles ?? {}).filter(tile => {
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
    }).length;
    const missionWarn = Object.values(gameState.missions ?? {}).filter(m => {
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
    }).length;
    return tileWarn + missionWarn;
  })() : 0;

  if (window.location.hash === '#admin') return <AdminDashboard />;

  if (loading) return <LoadingScreen />;

  // Config-driven shell: a casino season renders the casino landing instead of
  // the map/tile app. Map seasons (S1, S2) fall through to the existing UI.
  if (season?.shell === 'casino') return <CasinoShell />;

  // The ward exists because the board has no town tiles to hang missions and the
  // shop off — which is precisely the condition, so it is the predicate rather
  // than a board id. S1 keeps its towns and never renders a ward.
  const hasDistricts = !activeBoard().hasTowns;
  const inCasinoDistrict = hasDistricts && districtView === 'casino';

  return (
    <div className="page-content">
      <Header />
      <PlayerHUD
        onLoginClick={() => setLoginOpen(true)}
        onProfileClick={() => setProfileOpen(true)}
        onTileClick={coord => setActiveTile(coord)}
        onHelpClick={() => setHelpOpen(true)}
        // The HUD's mission chips point at the start tile, which on S1 is the
        // guild hall. On S2 that tile is the Castle and holds no missions, so the
        // chips have to open the Town Hall instead or they lead nowhere.
        onMissionsClick={hasDistricts ? () => setDistrictView('questboard') : undefined}
      />
      <div className="orb-activity-row">
        <OrbBar />
        <ActivityFeed />
      </div>
      <div className="rule"><span>⚔</span></div>
      {inCasinoDistrict ? (
        <CasinoDistrict onBack={() => setDistrictView(null)} />
      ) : (
        <>
          <MapGrid onTileClick={coord => setActiveTile(coord)} />
          <div className="state-legend">
            <div className="state-legend-item"><div className="state-swatch sw-hidden" /><span>Hidden</span></div>
            <div className="state-legend-item"><div className="state-swatch sw-available" /><span>Available</span></div>
            <div className="state-legend-item"><div className="state-swatch sw-inprogress" /><span>In Progress</span></div>
            <div className="state-legend-item"><div className="state-swatch sw-complete" /><span>Complete</span></div>
          </div>
          {hasDistricts && (
            <DistrictWard loggedIn={!!user} onOpen={setDistrictView} />
          )}
        </>
      )}

      <footer className="page-footer">
        <button className="page-footer-link" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button>
      </footer>

      <SettingsPanel />

      {isAdmin && (
        <a className="admin-toggle" href="/#admin" target="_blank" rel="noreferrer">
          ⚙ ADMIN{adminWarnCount > 0 && <span className="admin-toggle-badge">{adminWarnCount}</span>}
        </a>
      )}

      {user && gameState && (
        <AgendaLauncher
          count={deriveAgendaData(gameState, user.id).activeCount}
          onClick={() => setAgendaOpen(true)}
        />
      )}
      <AgendaDrawer
        open={agendaOpen && !!user}
        onClose={() => setAgendaOpen(false)}
        onTileClick={coord => { setAgendaOpen(false); setActiveTile(coord); }}
      />

      <TileLightbox
        coord={activeTile}
        onClose={() => setActiveTile(null)}
        onLoginRequest={() => setLoginOpen(true)}
      />
      {/* Three of the four districts open OVER the map; the casino replaced it
          above. Mounted unconditionally so each panel keeps its own open/close
          transition, exactly as the tile lightboxes do. */}
      <TownHallPanel open={districtView === 'questboard'} onClose={() => setDistrictView(null)} />
      <ShopPanel     open={districtView === 'shop'}       onClose={() => setDistrictView(null)} />
      <BarnPanel     open={districtView === 'fields'}     onClose={() => setDistrictView(null)} />

      <ProfileLightbox open={profileOpen} onClose={() => setProfileOpen(false)} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onPrivacyClick={() => { setLoginOpen(false); setPrivacyOpen(true); }} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <PrivacyModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}

function FirebaseBanner() {
  if (firebaseReady) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'oklch(18% 0.08 25 / 0.95)', borderBottom: '1px solid oklch(50% 0.18 25)',
      padding: '0.6rem 1.2rem', textAlign: 'center',
      fontFamily: "'Cinzel', serif", fontSize: '0.68rem', letterSpacing: '0.1em',
      color: 'oklch(72% 0.16 25)',
    }}>
      ⚠ Firebase not configured — copy <code style={{ fontFamily: 'monospace', background: 'oklch(10% 0.03 75)', padding: '0.1rem 0.3rem', borderRadius: '2px' }}>.env.example</code> to <code style={{ fontFamily: 'monospace', background: 'oklch(10% 0.03 75)', padding: '0.1rem 0.3rem', borderRadius: '2px' }}>.env</code> and fill in your Firebase project values.
    </div>
  );
}

export default function App() {
  // Keymaster's Keep is GLOBAL and shell-independent — not season-scoped. It
  // renders on its own route above the Season/GameState providers so it works
  // under any season shell (map or casino) and even if the active season never
  // resolves. KmkProvider subscribes straight to `kmkEvents/`; it needs neither.
  if (window.location.hash.startsWith('#keep/')) {
    const listId = window.location.hash.slice('#keep/'.length);
    return (
      <AuthProvider>
        <ToastProvider>
          <KmkProvider>
            <FirebaseBanner />
            <KmkBoard listId={listId} />
          </KmkProvider>
        </ToastProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <ToastProvider>
        {/* SeasonProvider must sit ABOVE GameStateProvider: it resolves which
            season to read and publishes it to the db.ts path helpers, which
            throw until it has. */}
        <SeasonProvider>
          <GameStateProvider>
            <KmkProvider>
              <FirebaseBanner />
              <AppContent />
            </KmkProvider>
          </GameStateProvider>
        </SeasonProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
