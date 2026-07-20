import { useState } from 'react';
import SectionOverview    from './help/SectionOverview';
import SectionMap         from './help/SectionMap';
import SectionAdventurers from './help/SectionAdventurers';
import SectionChallenges  from './help/SectionChallenges';
import SectionYaml        from './help/SectionYaml';
import SectionFeats       from './help/SectionFeats';
import SectionTraits      from './help/SectionTraits';
import SectionOrbs        from './help/SectionOrbs';
import SectionBoss        from './help/SectionBoss';
import SectionShop        from './help/SectionShop';
import SectionMissions    from './help/SectionMissions';
import SectionCasino     from './help/SectionCasino';
import './HelpModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which season shell is asking — a casino season has no map/orbs/feats to explain. */
  variant?: 'map' | 'casino';
}

type Section = 'overview' | 'map' | 'adventurers' | 'challenges' | 'yaml' | 'feats' | 'traits' | 'orbs' | 'boss' | 'shop' | 'missions' | 'casino';

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'overview',    label: 'What is RPelago?', icon: '⚔' },
  { id: 'map',         label: 'The Map',           icon: '🗺️' },
  { id: 'adventurers', label: 'Adventurers',       icon: '🧙' },
  { id: 'challenges',  label: 'Challenges',        icon: '🏆' },
  { id: 'yaml',        label: 'YAML Rules',        icon: '📜' },
  { id: 'feats',       label: 'Feats',             icon: '🏅' },
  { id: 'traits',      label: 'Traits & Items',    icon: '🔮' },
  { id: 'orbs',        label: 'Orbs',              icon: '✨' },
  { id: 'boss',        label: 'The Boss',          icon: '🐉' },
  { id: 'shop',        label: 'The Shop',          icon: '🏰' },
  { id: 'missions',    label: 'GM Missions',       icon: '⚜' },
  { id: 'casino',     label: 'Casino',            icon: '🂡' },
];

// A casino season has no map, adventurers, tiles, feats, orbs, boss or shop to
// explain — but players still need the casino game reference and the YAML rules
// in effect. Order follows SECTIONS.
const CASINO_SECTIONS: Section[] = ['overview', 'casino', 'yaml'];

export default function HelpModal({ open, onClose, variant = 'map' }: Props) {
  const [section, setSection] = useState<Section>('overview');

  const sections = variant === 'casino'
    ? SECTIONS.filter(s => CASINO_SECTIONS.includes(s.id))
    : SECTIONS;

  // Never leave a section selected that this shell doesn't offer.
  const active = sections.some(s => s.id === section) ? section : sections[0].id;

  return (
    <div
      className={`help-overlay ${open ? 'open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="help-modal">
        <button className="help-close" onClick={onClose} aria-label="Close help">✕</button>
        <div className="help-header">
          <span className="help-header-emblem">⚔</span>
          <h2 className="help-header-title">ADVENTURER'S GUIDE</h2>
        </div>
        <div className="help-body">
          <nav className="help-nav">
            {sections.map(s => (
              <button
                key={s.id}
                className={`help-nav-btn ${active === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <span className="help-nav-icon">{s.icon}</span>
                <span className="help-nav-label">{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="help-content">
            {active === 'overview'    && <SectionOverview variant={variant} />}
            {active === 'map'         && <SectionMap />}
            {active === 'adventurers' && <SectionAdventurers />}
            {active === 'challenges'  && <SectionChallenges />}
            {active === 'yaml'        && <SectionYaml variant={variant} />}
            {active === 'feats'       && <SectionFeats />}
            {active === 'traits'      && <SectionTraits />}
            {active === 'orbs'        && <SectionOrbs />}
            {active === 'boss'        && <SectionBoss />}
            {active === 'shop'        && <SectionShop />}
            {active === 'missions'    && <SectionMissions />}
            {active === 'casino'      && <SectionCasino variant={variant} />}
          </div>
        </div>
      </div>
    </div>
  );
}
