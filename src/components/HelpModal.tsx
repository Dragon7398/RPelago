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
import './HelpModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Section = 'overview' | 'map' | 'adventurers' | 'challenges' | 'yaml' | 'feats' | 'traits' | 'orbs' | 'boss' | 'shop' | 'missions';

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
];

export default function HelpModal({ open, onClose }: Props) {
  const [section, setSection] = useState<Section>('overview');

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
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`help-nav-btn ${section === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <span className="help-nav-icon">{s.icon}</span>
                <span className="help-nav-label">{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="help-content">
            {section === 'overview'    && <SectionOverview />}
            {section === 'map'         && <SectionMap />}
            {section === 'adventurers' && <SectionAdventurers />}
            {section === 'challenges'  && <SectionChallenges />}
            {section === 'yaml'        && <SectionYaml />}
            {section === 'feats'       && <SectionFeats />}
            {section === 'traits'      && <SectionTraits />}
            {section === 'orbs'        && <SectionOrbs />}
            {section === 'boss'        && <SectionBoss />}
            {section === 'shop'        && <SectionShop />}
            {section === 'missions'    && <SectionMissions />}
          </div>
        </div>
      </div>
    </div>
  );
}
