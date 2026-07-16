import { useState, useEffect } from 'react';

/**
 * The site settings popout — shared by every season shell.
 *
 * Theme, font size and reduced-motion are site-wide and apply in ANY shell
 * (`--font-scale` drives `html { font-size }`, so the whole casino scales with
 * it too). The tile-specific controls are only meaningful on the map, so a
 * casino season hides them rather than shipping a second settings UI.
 */

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

export default function SettingsPanel({ variant = 'map' }: { variant?: 'map' | 'casino' }) {
  const showMapOptions = variant === 'map';

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
        {showMapOptions && (
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
        )}
        {showMapOptions && (
          <label className="settings-row settings-check-row">
            <input type="checkbox" className="settings-check" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
            <span className="settings-label">SHOW TILE LABELS</span>
          </label>
        )}
        {showMapOptions && (
          <label className="settings-row settings-check-row">
            <input type="checkbox" className="settings-check" checked={highlightAdvs} onChange={e => setHighlightAdvs(e.target.checked)} />
            <span className="settings-label">HIGHLIGHT MY ADVENTURERS</span>
          </label>
        )}
        <label className="settings-row settings-check-row">
          <input type="checkbox" className="settings-check" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)} />
          <span className="settings-label">REDUCE ANIMATIONS</span>
        </label>
        {showMapOptions && (
          <label className="settings-row settings-check-row">
            <input type="checkbox" className="settings-check" checked={statePatterns} onChange={e => setStatePatterns(e.target.checked)} />
            <span className="settings-label">STATE PATTERNS</span>
          </label>
        )}
        {showMapOptions && (
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
        )}
      </div>
      <button className="settings-toggle" onClick={() => setOpen(o => !o)}>
        ⚙ SETTINGS
      </button>
    </>
  );
}
