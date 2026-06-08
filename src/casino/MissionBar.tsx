import type { DeckCard } from '../lib/casinoData';

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
