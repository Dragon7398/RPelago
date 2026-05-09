import { useState } from 'react';
import { ADV_ICONS, ALL_ORBS, TILE_TRAITS, SHOP_ITEMS, FEATS } from '../lib/constants';
import { useGameState } from '../contexts/GameStateContext';
import { useAuth } from '../contexts/AuthContext';
import { getPlayerFeatIds } from '../lib/gameLogic';
import './HelpModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Section = 'overview' | 'map' | 'adventurers' | 'challenges' | 'yaml' | 'feats' | 'traits' | 'orbs' | 'boss' | 'shop';

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
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionOverview() {
  return (
    <div className="help-section">
      <h3>What is RPelago?</h3>
      <p>
        RPelago is a <strong>shared, collaborative metagame</strong> layered on top of
        the Archipelago randomizer. All players share a single persistent island — and
        every action you take affects the whole group.
      </p>
      <p>
        Your goal is to <strong>explore the archipelago</strong>, complete challenges
        together, collect Orbs, and ultimately defeat the Boss that guards the heart of
        the island. At least 5 Orbs are needed to face the Boss — and the more you gather,
        the weaker it becomes.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">⚔</span>
        <span>New here? Click <strong>ENTER RPelago</strong> to sign in with Discord, then click any glowing tile on the map to begin your first adventure.</span>
      </div>
      <h4>The Flow</h4>
      <ol className="help-list">
        <li>Sign in and meet your Adventurers.</li>
        <li>Click a glowing <strong>Available</strong> tile and deploy an Adventurer to a slot.</li>
        <li>Complete the Archipelago challenge that corresponds to your slot.</li>
        <li>Earn <strong>Gold</strong> and <strong>XP</strong> — use Gold at Town shops to buy useful items.</li>
        <li>Collect at least 5 Orbs to unlock the Boss — gather more to strip away its traits.</li>
        <li>Defeat the Boss together to claim victory for the island.</li>
      </ol>
    </div>
  );
}

function SectionMap() {
  return (
    <div className="help-section">
      <h3>The Map</h3>
      <p>
        The island is a <strong>7 × 5 grid</strong> of tiles. Most start hidden and
        are revealed as adjacent tiles are completed. The map is procedurally generated —
        each new season brings a fresh layout.
      </p>
      <h4>Tile Types</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">🏰</span>
          <div><strong>Town</strong> — Safe haven. Contains a shop where you can spend Gold on items and Orbs.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">⚔️</span>
          <div><strong>Battle</strong> — Standard encounter. The most common tile type.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">🧩</span>
          <div><strong>Puzzle</strong> — A tricky problem to solve. May have unusual challenge traits.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">💀</span>
          <div><strong>Elite</strong> — A powerful enemy. Higher difficulty with more slots needed. Always awards an Orb on first completion.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">🐉</span>
          <div><strong>Boss</strong> — The final challenge. Locked until at least 5 Orbs have been gathered.</div>
        </div>
      </div>
      <h4>Tile States</h4>
      <div className="help-states">
        <div className="help-state-row">
          <div className="help-swatch sw-hidden" />
          <div><strong>Hidden</strong> — Unknown territory. Revealed by completing adjacent tiles.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-available" />
          <div><strong>Available</strong> — Ready to enter. Click to assign Adventurers.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-inprogress" />
          <div><strong>In Progress</strong> — Adventurers deployed; the challenge is underway.</div>
        </div>
        <div className="help-state-row">
          <div className="help-swatch sw-complete" />
          <div><strong>Complete</strong> — Challenge finished. Click to review.</div>
        </div>
      </div>
    </div>
  );
}

function SectionAdventurers() {
  const classes = Object.entries(ADV_ICONS) as [string, string][];
  return (
    <div className="help-section">
      <h3>Adventurers</h3>
      <p>
        When you join RPelago you start with <strong>1 Adventurer</strong>, randomly named
        and classed. You earn more as you level up — a second at level 2, a third at level 4,
        and a fourth at level 6 (the maximum). They are your means of tackling challenges
        across the island.
      </p>
      <div className="help-callout">
        <span className="help-callout-icon">⚔</span>
        <span>Your Adventurers appear in the <strong>HUD bar</strong> at the top of the page — green when idle, red when deployed. Click a busy Adventurer chip to jump to their tile.</span>
      </div>
      <h4>Classes</h4>
      <p>Classes are <strong>decorative only</strong> — they have no mechanical effect on challenges.</p>
      <div className="help-class-grid">
        {classes.map(([cls, icon]) => (
          <div key={cls} className="help-class-row">
            <span className="help-class-icon">{icon}</span>
            <span className="help-class-name">{cls}</span>
          </div>
        ))}
      </div>
      <h4>Managing Your Party</h4>
      <ul className="help-list">
        <li>Open your <strong>Profile</strong> (click your name in the HUD) to rename Adventurers and view your inventory.</li>
        <li>An Adventurer can only be at <strong>one tile at a time</strong> — plan deployments wisely.</li>
        <li>Adventurers are freed once an admin marks their tile Complete.</li>
      </ul>
    </div>
  );
}

function SectionChallenges() {
  return (
    <div className="help-section">
      <h3>Challenges</h3>
      <p>
        Every non-town tile represents an <strong>Archipelago challenge</strong>: a
        multiplayer randomizer session your party must complete. Each slot in the challenge
        corresponds to one Adventurer's Archipelago world.
      </p>
      <h4>How It Works</h4>
      <ol className="help-list">
        <li>Click an <strong>Available</strong> tile and assign one of your idle Adventurers to an open slot.</li>
        <li>Submit your <strong>YAML</strong> to the game thread on Discord.</li>
        <li>Other players fill the remaining slots. Once all slots are full, an Admin will move the tile to <strong>In Progress</strong>.</li>
        <li>Each player plays their assigned Archipelago world (to goal or completion).</li>
        <li>An admin verifies and marks the tile <strong>Complete</strong>. Rewards are distributed.</li>
      </ol>
      <h4>Rewards</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">💰</span>
          <div><strong>Gold</strong> — Spend at town shops on items or Orbs.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">⭐</span>
          <div><strong>XP</strong> — Raises your level, shown in the HUD.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">✨</span>
          <div><strong>Orbs</strong> — Rare drops from certain tiles and shops.</div>
        </div>
      </div>
      <div className="help-callout">
        <span className="help-callout-icon">🧩</span>
        <span>Some tiles have <strong>public slots</strong> — extra Archipelago worlds open to anyone, not tied to a specific player.</span>
      </div>
    </div>
  );
}

function YamlVal({ base, bonus }: { base: number; bonus: number }) {
  if (bonus === 0) return <strong>{base}</strong>;
  return (
    <>
      <span className="help-yaml-struck">{base}</span>{' '}
      <strong className="help-yaml-new">{base + bonus}</strong>
    </>
  );
}

function SectionYaml() {
  const { user }      = useAuth();
  const { gameState } = useGameState();
  const player        = user && gameState ? gameState.players[user.id] : null;
  const featIds       = getPlayerFeatIds(player?.feats);

  const hasKnow = featIds.includes('knowledgeable');
  const hasPick = featIds.includes('picky');
  const hasHelp = featIds.includes('helpful');
  const hasPrep = featIds.includes('prepared');

  return (
    <div className="help-section">
      <h3>YAML Rules</h3>
      {player && featIds.some(id => ['knowledgeable','picky','helpful','prepared'].includes(id)) && (
        <div className="help-callout">
          <span className="help-callout-icon">🏅</span>
          <span>Feat bonuses appear as <span className="help-yaml-new">highlighted</span> values below.</span>
        </div>
      )}
      <p>
        New to Archipelago? Start with the{' '}
        <a href="https://archipelago.gg/tutorial/Archipelago/setup_en" target="_blank" rel="noopener noreferrer">official YAML setup guide</a>.
      </p>
      <ul className="help-list">
        <li>
          Submit <strong>1 YAML per slot</strong>. Your YAML may include up to <strong>5 games</strong>;
          duplicates are allowed. If submitting multiple games, combine them into one file using{' '}
          <code>---</code> between entries — do not submit separate files.
        </li>
        <li>
          <strong>Game eligibility:</strong> Unsupported games are allowed if they are listed as
          allowed for Async or Sync on{' '}
          <a href="https://docs.google.com/spreadsheets/d/1UR8D95P90cS7tpmAlKvT1giSJeNet2eOMhapK8xjNXE" target="_blank" rel="noopener noreferrer">Drago's list</a>.
          Manuals and Keymaster's Keep are not allowed.
        </li>
        <li>
          <strong>Meta games</strong> (such as AP Bingo and Autopelago) are allowed, but may be
          at most <strong>50%</strong> of your total checks. For example, a 5×5 Bingo board alone
          (25 checks) is not permitted, but pairing it with a Checksfinder (25 checks) is fine.
        </li>
        <li>
          <strong>Check limits:</strong> At least <strong>50 checks</strong> and no more than{' '}
          <strong>1,500 checks</strong> total, unless otherwise approved.
        </li>
        <li>
          <strong>YAML settings:</strong> Unless approved by a special challenge or feat, you are
          limited to <YamlVal base={0} bonus={hasPrep ? 1 : 0} /> starting inventory{' '}
          item{hasPrep ? 's' : ''}, <YamlVal base={2} bonus={hasHelp ? 2 : 0} /> priority
          locations, <YamlVal base={2} bonus={hasPick ? 4 : 0} /> excluded locations, and{' '}
          either <YamlVal base={0} bonus={hasKnow ? 1 : 0} /> starting hints and{' '}
          <YamlVal base={1} bonus={hasKnow ? 2 : 0} /> hint location{hasKnow ? 's' : ''}, or{' '}
          <YamlVal base={1} bonus={hasKnow ? 1 : 0} /> starting hint{hasKnow ? 's' : ''} and{' '}
          <YamlVal base={0} bonus={hasKnow ? 2 : 0} /> hint locations.
        </li>
      </ul>
    </div>
  );
}

function SectionFeats() {
  const { user }      = useAuth();
  const { gameState } = useGameState();
  const player        = user && gameState ? gameState.players[user.id] : null;
  const featIds       = getPlayerFeatIds(player?.feats);

  const level3Feats = FEATS.filter(f => f.availableAt === 3);
  const level5Feats = FEATS.filter(f => f.availableAt === 5);
  const level7Feats = FEATS.filter(f => f.availableAt === 7);

  return (
    <div className="help-section">
      <h3>Feats</h3>
      <p>
        As you level up, you unlock <strong>Feats</strong> — permanent abilities that enhance
        your capabilities. You choose one feat at levels 3, 5, and 7. Higher-level selections
        also let you pick from lower tiers you haven't chosen yet.
      </p>
      <p>
        Select your feat from your <strong>Profile</strong> once you reach the unlock level.
      </p>

      {[
        { label: 'Level 3', feats: level3Feats },
        { label: 'Level 5', feats: level5Feats, note: '(or any unchosen Level 3 feat)' },
        { label: 'Level 7', feats: level7Feats, note: '(or any unchosen Level 3 or Level 5 feat)' },
      ].map(({ label, feats, note }) => (
        <div key={label}>
          <h4>{label}{note && <span className="help-feat-note"> {note}</span>}</h4>
          <div className="help-feats">
            {feats.map(feat => {
              const owned = featIds.includes(feat.id);
              return (
                <div key={feat.id} className={`help-feat-row${owned ? ' owned' : ''}`}>
                  <span className="help-feat-icon">{feat.icon}</span>
                  <div>
                    <span className="help-feat-name">{feat.name}</span>
                    {owned && <span className="help-feat-owned-badge">✦ YOURS</span>}
                    <p className="help-feat-desc">{feat.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTraits() {
  const featuredTraits = TILE_TRAITS.filter(t =>
    ['horde', 'agile', 'sturdy', 'stunning', 'cursed', 'aerial'].includes(t.id)
  );
  return (
    <div className="help-section">
      <h3>Traits & Items</h3>
      <p>
        Some tiles carry <strong>Traits</strong> — special rules that change how you must
        configure your Archipelago slot. Traits are shown in the tile detail panel when
        you click a tile.
      </p>
      <h4>Common Traits</h4>
      <div className="help-traits">
        {featuredTraits.map(t => (
          <div key={t.id} className="help-trait-row">
            <span className="help-trait-name">{t.name}</span>
            <span className="help-trait-desc">
              {t.description.replace('{value}', String(t.defaultValue))}
            </span>
          </div>
        ))}
      </div>
      <h4>Passive Items</h4>
      <p>Buy these at Town shops to permanently ignore certain traits:</p>
      <div className="help-items">
        {SHOP_ITEMS.filter(i => i.description.startsWith('Passive:')).map(item => (
          <div key={item.id} className="help-item-row">
            <span className="help-item-name">{item.name}</span>
            <span className="help-item-desc">{item.description.replace('Passive: ', '')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionOrbs() {
  return (
    <div className="help-section">
      <h3>Orbs</h3>
      <p>
        There are <strong>9 Orbs</strong> hidden across the archipelago.
        Gathering at least 5 unlocks the Boss tile — collect more to strip away its most punishing traits.
      </p>
      <h4>The 9 Orbs</h4>
      <div className="help-orb-grid">
        {ALL_ORBS.map(orb => (
          <div key={orb.id} className="help-orb-row">
            <span className="help-orb-icon" style={{ color: orb.color }}>{orb.icon}</span>
            <span className="help-orb-label">{orb.label}</span>
          </div>
        ))}
      </div>
      <h4>Where to Find Them</h4>
      <ul className="help-list">
        <li><strong>Elite tiles 💀</strong> — Every Elite encounter awards an Orb on first completion.</li>
        <li><strong>Town shops 🏰</strong> — Some shops sell a specific Orb for 1,500 Gold.</li>
        <li>Keep your eyes open — Orbs can turn up in unexpected places.</li>
      </ul>
      <div className="help-callout">
        <span className="help-callout-icon">✨</span>
        <span>The <strong>Orb Bar</strong> below the HUD tracks how many Orbs have been found island-wide. Watch it fill!</span>
      </div>
    </div>
  );
}

function SectionBoss() {
  return (
    <div className="help-section">
      <h3>The Boss</h3>
      <p>
        Somewhere on the island lurks the <strong>final Boss 🐉</strong>.
        It starts locked — gathering at least 5 Orbs awakens it. The four elemental Orbs
        are especially potent: each one strips two of its traits, making it easier to defeat.
      </p>
      <h4>Orb Traits</h4>
      <p>
        While certain Orbs are missing, the Boss gains extra traits that make it harder.
        Each of the four <strong>elemental Orbs</strong> suppresses two boss traits:
      </p>
      <div className="help-boss-traits">
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(62% 0.22 35)' }}>🔥 Fire</span>
          <span>removes <em>Cursed</em> + <em>Stunning</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(72% 0.10 200)' }}>🌪️ Air</span>
          <span>removes <em>Aerial</em> + <em>Agile</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(60% 0.18 220)' }}>💧 Water</span>
          <span>removes <em>Camouflage</em> + <em>Taunt</em></span>
        </div>
        <div className="help-boss-trait-row">
          <span className="help-boss-orb" style={{ color: 'oklch(58% 0.15 130)' }}>🪨 Earth</span>
          <span>removes <em>Enduring</em> + <em>Sturdy</em></span>
        </div>
      </div>
      <div className="help-callout">
        <span className="help-callout-icon">🐉</span>
        <span>The Boss uses the <strong>highest hint%</strong> (fewest hints to players) and <strong>highest complexity</strong> settings of any challenge. Coordinate with everyone before diving in.</span>
      </div>
    </div>
  );
}

function SectionShop() {
  return (
    <div className="help-section">
      <h3>The Shop</h3>
      <p>
        Town tiles (🏰) contain shops where you can spend your hard-earned <strong>Gold</strong>.
        There are four towns on the island, each stocking a different selection of goods.
      </p>
      <h4>All Items</h4>
      <div className="help-items">
        {SHOP_ITEMS.map(item => (
          <div key={item.id} className="help-item-row">
            <div className="help-item-header">
              <span className="help-item-name">{item.name}</span>
              <span className="help-item-cost">{item.cost.toLocaleString()} Gold</span>
              <span className={`help-item-badge ${item.consumable ? 'consumable' : 'passive'}`}>
                {item.consumable ? 'Consumable' : 'Passive'}
              </span>
            </div>
            <span className="help-item-desc">
              {item.description.replace(/^(Consumable|Passive|Cosmetic): /, '')}
            </span>
          </div>
        ))}
      </div>
      <div className="help-callout">
        <span className="help-callout-icon">🏰</span>
        <span>Shops also sell specific <strong>Orbs</strong> for 1,500 Gold each. If the group is close to unlocking the Boss, saving gold for an Orb can be worth it.</span>
      </div>
    </div>
  );
}
