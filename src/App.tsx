import { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { GameStateProvider } from './contexts/GameStateContext';
import { ToastProvider } from './contexts/ToastContext';
import { useAuth } from './contexts/AuthContext';
import { useGameState } from './contexts/GameStateContext';
import { firebaseReady } from './firebase/config';
import Header from './components/Header';
import PlayerHUD from './components/PlayerHUD';
import OrbBar from './components/OrbBar';
import MapGrid from './components/MapGrid';
import TileLightbox from './components/TileLightbox';
import ProfileLightbox from './components/ProfileLightbox';
import LoginModal from './components/LoginModal';
import HelpModal from './components/HelpModal';
import AdminDashboard from './components/AdminDashboard';
import ActivityFeed from './components/ActivityFeed';

function useBoolSetting(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState(() => {
    const s = localStorage.getItem(key);
    return s === null ? def : s === 'true';
  });
  const set = (v: boolean) => {
    setVal(v);
    localStorage.setItem(key, String(v));
  };
  return [val, set];
}

function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem('realm_tile_size');
    return saved ? parseInt(saved, 10) : 94;
  });
  const [showLabels,    setShowLabels]    = useBoolSetting('realm_show_labels',     true);
  const [highlightAdvs, setHighlightAdvs] = useBoolSetting('realm_highlight_advs',  false);
  const [reduceMotion,  setReduceMotion]  = useBoolSetting('realm_reduce_motion',   false);

  useEffect(() => {
    document.documentElement.style.setProperty('--tile-user-size', `${size}px`);
    localStorage.setItem('realm_tile_size', String(size));
  }, [size]);

  useEffect(() => {
    document.documentElement.classList.toggle('no-tile-labels',    !showLabels);
  }, [showLabels]);

  useEffect(() => {
    document.documentElement.classList.toggle('highlight-my-advs', highlightAdvs);
  }, [highlightAdvs]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion',     reduceMotion);
  }, [reduceMotion]);

  return (
    <>
      <div className={`settings-popout ${open ? 'open' : ''}`}>
        <div className="settings-title">⚙ SETTINGS</div>
        <div className="settings-row">
          <span className="settings-label">TILE SIZE</span>
          <input
            type="range" min={64} max={120} step={4}
            value={size}
            onChange={e => setSize(parseInt(e.target.value, 10))}
            className="settings-slider"
          />
          <span className="settings-value">{size}px</span>
        </div>
        <label className="settings-row settings-check-row">
          <input type="checkbox" className="settings-check" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
          <span className="settings-label">SHOW TILE LABELS</span>
        </label>
        <label className="settings-row settings-check-row">
          <input type="checkbox" className="settings-check" checked={highlightAdvs} onChange={e => setHighlightAdvs(e.target.checked)} />
          <span className="settings-label">HIGHLIGHT MY ADVENTURERS</span>
        </label>
        <label className="settings-row settings-check-row">
          <input type="checkbox" className="settings-check" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)} />
          <span className="settings-label">REDUCE ANIMATIONS</span>
        </label>
      </div>
      <button className="settings-toggle" onClick={() => setOpen(o => !o)}>
        ⚙ SETTINGS
      </button>
    </>
  );
}

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
  const [activeTile,  setActiveTile]  = useState<string | null>(null);
  const [loginOpen,   setLoginOpen]   = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen,    setHelpOpen]    = useState(false);

  const { user }              = useAuth();
  const { gameState, loading } = useGameState();
  const isAdmin = !!user && !!gameState && user.id === gameState.meta?.adminId;

  if (window.location.hash === '#admin') return <AdminDashboard />;

  if (loading) return <LoadingScreen />;

  return (
    <div className="page-content">
      <Header />
      <PlayerHUD
        onLoginClick={() => setLoginOpen(true)}
        onProfileClick={() => setProfileOpen(true)}
        onTileClick={coord => setActiveTile(coord)}
        onHelpClick={() => setHelpOpen(true)}
      />
      <OrbBar />
      <ActivityFeed />
      <div className="rule"><span>⚔</span></div>
      <MapGrid onTileClick={coord => setActiveTile(coord)} />
      <div className="state-legend">
        <div className="state-legend-item"><div className="state-swatch sw-hidden" /><span>Hidden</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-available" /><span>Available</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-inprogress" /><span>In Progress</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-complete" /><span>Complete</span></div>
      </div>

      <SettingsPanel />

      {isAdmin && (
        <a className="admin-toggle" href="/#admin" target="_blank" rel="noreferrer">⚙ ADMIN</a>
      )}

      <TileLightbox
        coord={activeTile}
        onClose={() => setActiveTile(null)}
        onLoginRequest={() => setLoginOpen(true)}
      />
      <ProfileLightbox open={profileOpen} onClose={() => setProfileOpen(false)} />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
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
  return (
    <AuthProvider>
      <GameStateProvider>
        <ToastProvider>
          <FirebaseBanner />
          <AppContent />
        </ToastProvider>
      </GameStateProvider>
    </AuthProvider>
  );
}
