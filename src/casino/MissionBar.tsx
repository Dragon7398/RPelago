import type { DeckCard } from '../lib/casinoData';

interface MissionBarProps {
  missionLabel: string;
  cohortLabel: string;
  stake: number;           // committed card sum, 0 until locked
  pot: number;
  locked: boolean;
}

export function MissionBar({ missionLabel, cohortLabel, stake, pot, locked }: MissionBarProps) {
  return (
    <div className="cz-mission-bar">
      <span className="cz-mission-seal">🎲</span>
      <div className="cz-mission-id">
        <span className="cz-mission-kick">Guildmaster Mission</span>
        <span className="cz-mission-name">{missionLabel}{cohortLabel ? ` · Cohort ${cohortLabel}` : ''}</span>
      </div>
      <div className="cz-mission-stake">
        {locked ? (
          <>
            <span className="cz-mission-stake-lbl">Playing for</span>
            <span className="cz-mission-stake-val">{stake}g</span>
          </>
        ) : (
          <span className="cz-mission-stake-lbl idle">Lock a hand to commit your slots</span>
        )}
      </div>
      <div style={{ marginLeft: '0.75rem', textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '0.5rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-dim)' }}>Pot</div>
        <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--gold)' }}>{pot}g</div>
      </div>
    </div>
  );
}

interface MissionSlotsProps {
  hand: DeckCard[];
  missionLabel: string;
}

export function MissionSlots({ hand, missionLabel }: MissionSlotsProps) {
  if (hand.length === 0) return null;
  const stake = hand.reduce((s, c) => s + c.value, 0);
  return (
    <div className="cz-slots-panel">
      <div className="cz-slots-head">
        <span className="cz-slots-title">Your slots on {missionLabel}</span>
        <span className="cz-slots-sub">{hand.length} {hand.length === 1 ? 'card' : 'cards'} locked · {stake}g on the table</span>
      </div>
      <div className="cz-slots-note">
        These write straight back to your seat on the mission — slot name and game left empty,
        the card's genre dropped into Details.
      </div>
      <div className="cz-slots-list">
        {hand.map((c, i) => (
          <div className="cz-slot" key={i}>
            <span className="cz-slot-name">slot —</span>
            <span className="cz-slot-sep">·</span>
            <span className="cz-slot-game">game —</span>
            <span className="cz-slot-det">{c.name} <b>· {c.value}g</b></span>
            <span className="cz-slot-status">Unstarted</span>
          </div>
        ))}
      </div>
    </div>
  );
}
