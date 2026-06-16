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
import PrivacyModal from './components/PrivacyModal';
import AdminDashboard from './components/AdminDashboard';
import ActivityFeed from './components/ActivityFeed';
import KmkBoard from './components/kmk/KmkBoard';
import { KmkProvider } from './contexts/KmkContext';
import AgendaLauncher from './components/agenda/AgendaLauncher';
import AgendaDrawer from './components/agenda/AgendaDrawer';
import { deriveAgendaData } from './components/agenda/agendaHelpers';

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

const THEMES = [
  { id: 'gilded',    label: 'Gilded Hearth' },
  { id: 'moonlit',   label: 'Moonlit Codex' },
  { id: 'verdant',   label: 'Verdant Hollow' },
  { id: 'aether',    label: 'Aether Bloom' },
  { id: 'obsidian',  label: 'Obsidian Contrast' },
  { id: 'tidepool',  label: 'Tidepool Atlas' },
  { id: 'parchment', label: 'Parchment Day' },
  { id: 'sakura',    label: 'Sakura Scroll' },
  { id: 'mint',      label: 'Mint Library' },
  { id: 'lapis',     label: 'Dunes & Lapis' },
] as const;
type ThemeId = typeof THEMES[number]['id'];

function useStringSetting<T extends string>(key: string, def: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    const s = localStorage.getItem(key);
    return (s ?? def) as T;
  });
  const set = (v: T) => {
    setVal(v);
    localStorage.setItem(key, v);
  };
  return [val, set];
}

function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem('realm_tile_size');
    return saved ? parseInt(saved, 10) : 94;
  });
  const [fontScale, setFontScale] = useState(() => {
    const saved = localStorage.getItem('realm_font_scale');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [showLabels,    setShowLabels]    = useBoolSetting('realm_show_labels',     true);
  const [highlightAdvs, setHighlightAdvs] = useBoolSetting('realm_highlight_advs',  false);
  const [reduceMotion,  setReduceMotion]  = useBoolSetting('realm_reduce_motion',   false);
  const [theme,         setTheme]         = useStringSetting<ThemeId>('realm_theme', 'gilded');
  const [statePatterns, setStatePatterns] = useBoolSetting('realm_state_patterns',  false);

  type TileNameMode = 'off' | 'hover' | 'always';
  const [tileNames, setTileNames] = useStringSetting<TileNameMode>('realm_tile_names', 'hover');

  useEffect(() => {
    document.documentElement.style.setProperty('--tile-user-size', `${size}px`);
    localStorage.setItem('realm_tile_size', String(size));
  }, [size]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
    localStorage.setItem('realm_font_scale', String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle('no-tile-labels',    !showLabels);
  }, [showLabels]);

  useEffect(() => {
    document.documentElement.classList.toggle('highlight-my-advs', highlightAdvs);
  }, [highlightAdvs]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion',     reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    const body = document.body;
    THEMES.forEach(t => body.classList.remove(`theme-${t.id}`));
    if (theme !== 'gilded') body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('state-patterns', statePatterns);
  }, [statePatterns]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('tilenames-off',    tileNames === 'off');
    root.classList.toggle('tilenames-hover',  tileNames === 'hover');
    root.classList.toggle('tilenames-always', tileNames === 'always');
  }, [tileNames]);

  return (
    <>
      <div className={`settings-popout ${open ? 'open' : ''}`}>
        <div className="settings-title">⚙ SETTINGS</div>
        <div className="settings-theme-block">
          <span className="settings-label settings-section-label">THEME</span>
          <div className="settings-theme-options">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`settings-theme-btn ${theme === t.id ? 'selected' : ''}`}
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row settings-row--tile-size">
          <span className="settings-label">FONT SIZE</span>
          <input
            type="range" min={1.0} max={1.4} step={0.1}
            value={fontScale}
            onChange={e => setFontScale(parseFloat(e.target.value))}
            className="settings-slider"
          />
          <span className="settings-value">{Math.round(fontScale * 100)}%</span>
        </div>
        <div className="settings-row settings-row--tile-size">
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
        <label className="settings-row settings-check-row">
          <input type="checkbox" className="settings-check" checked={statePatterns} onChange={e => setStatePatterns(e.target.checked)} />
          <span className="settings-label">STATE PATTERNS</span>
        </label>
        <div className="settings-row settings-segmented-row">
          <span className="settings-label">TILE NAMES</span>
          <div className="settings-segmented">
            {(['off', 'hover', 'always'] as const).map(id => (
              <button
                key={id}
                className={`settings-seg-btn${tileNames === id ? ' selected' : ''}`}
                onClick={() => setTileNames(id)}
                aria-pressed={tileNames === id}
              >
                {id === 'off' ? 'Off' : id === 'hover' ? 'Hover' : 'Always'}
              </button>
            ))}
          </div>
        </div>
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
  const [activeTile,   setActiveTile]   = useState<string | null>(null);
  const [loginOpen,    setLoginOpen]    = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const [helpOpen,     setHelpOpen]     = useState(false);
  const [privacyOpen,  setPrivacyOpen]  = useState(() => window.location.hash === '#privacy');
  const [agendaOpen,   setAgendaOpen]   = useState(false);

  const { user }              = useAuth();
  const { gameState, loading } = useGameState();
  const isAdmin = !!user && !!gameState && user.id === gameState.meta?.adminId;

  if (window.location.hash === '#admin') return <AdminDashboard />;

  if (window.location.hash.startsWith('#keep/')) {
    const listId = window.location.hash.slice('#keep/'.length);
    return <KmkBoard listId={listId} />;
  }

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
      <div className="orb-activity-row">
        <OrbBar />
        <ActivityFeed />
      </div>
      <div className="rule"><span>⚔</span></div>
      <MapGrid onTileClick={coord => setActiveTile(coord)} />
      <div className="state-legend">
        <div className="state-legend-item"><div className="state-swatch sw-hidden" /><span>Hidden</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-available" /><span>Available</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-inprogress" /><span>In Progress</span></div>
        <div className="state-legend-item"><div className="state-swatch sw-complete" /><span>Complete</span></div>
      </div>

      <footer className="page-footer">
        <button className="page-footer-link" onClick={() => setPrivacyOpen(true)}>Privacy Policy</button>
      </footer>

      <SettingsPanel />

      {isAdmin && (
        <a className="admin-toggle" href="/#admin" target="_blank" rel="noreferrer">⚙ ADMIN</a>
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
  return (
    <AuthProvider>
      <ToastProvider>
        <GameStateProvider>
          <KmkProvider>
            <FirebaseBanner />
            <AppContent />
          </KmkProvider>
        </GameStateProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
