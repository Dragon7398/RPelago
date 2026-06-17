import { useState } from 'react';
import { FEATS } from '../../lib/constants';
import { getPlayerFeatIds } from '../../lib/gameLogic';
import { slotsFromEntry } from '../../lib/slotHelpers';
import type { TileAdventurer, Player } from '../../types';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      className="copy-btn"
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export function AdvStatusIcons({ advId, tile, inventory }: {
  advId: string;
  tile: { stunnedAdvId?: string; tauntedAdvId?: string };
  inventory: Record<string, number>;
}) {
  const isStunned = tile.stunnedAdvId === advId;
  const isTaunted = tile.tauntedAdvId === advId;
  if (!isStunned && !isTaunted) return null;
  const resisted = isStunned && (inventory['ring_of_resistance'] ?? 0) > 0;
  return (
    <span className="lb-adv-status-icons">
      {isStunned && (
        resisted
          ? <span className="lb-adv-status-icon" title="Resisted Stun!">🛡️</span>
          : <span className="lb-adv-status-icon" title="Stunned!">💫</span>
      )}
      {isTaunted && <span className="lb-adv-status-icon" title="Taunted!">😤</span>}
    </span>
  );
}

export function AdvFeatIcons({ playerId, players }: {
  playerId: string;
  players: Record<string, Player>;
}) {
  const featIds = getPlayerFeatIds(players[playerId]?.feats);
  if (featIds.length === 0) return null;
  return (
    <span className="lb-adv-feat-icons">
      {featIds.map(id => {
        const def = FEATS.find(f => f.id === id);
        if (!def) return null;
        return (
          <span key={id} className="lb-adv-feat-icon trait-ref" data-tooltip={def.name + ': ' + def.description}>
            {def.icon}
          </span>
        );
      })}
    </span>
  );
}

export function SlotBonusPills({ bonusXP, bonusGold }: { bonusXP?: number; bonusGold?: number }) {
  if (!bonusXP && !bonusGold) return null;
  return (
    <div className="lb-slot-bonus">
      {bonusXP   ? <span className="lb-slot-bonus-xp">+{bonusXP} XP</span>     : null}
      {bonusGold ? <span className="lb-slot-bonus-gold">+{bonusGold} Gold</span> : null}
    </div>
  );
}

export function AdvSlotBlock({ entry, tile, coord, isOwner, showPrompt = true }: {
  entry: TileAdventurer; tile: { name: string }; coord: string;
  isOwner: boolean; showPrompt?: boolean;
}) {
  const slots = slotsFromEntry(entry);
  if (slots.length > 0) {
    const totalBonusXP   = slots.reduce((n, s) => n + (s.bonusXP   ?? 0), 0);
    const totalBonusGold = slots.reduce((n, s) => n + (s.bonusGold ?? 0), 0);
    return (
      <div className="lb-adv-slots">
        {slots.map((s, i) => (
          <div key={i} className="lb-slot-row">
            <span className="lb-slot-name">{s.name}</span>
            <span className="lb-slot-sep">—</span>
            <span className="lb-slot-game">{s.game}</span>
            {s.details && <span className="lb-slot-details">{s.details}</span>}
            {s.status && <span className={`lb-slot-status ss-${s.status.replace('%', 'pct').replace('-', '')}`}>{s.status}</span>}
          </div>
        ))}
        <SlotBonusPills bonusXP={totalBonusXP || undefined} bonusGold={totalBonusGold || undefined} />
      </div>
    );
  }
  if (!showPrompt) return null;
  return (
    <div className="lb-slot-prompt">
      No game currently set for this challenge.{isOwner && (
        <>{' '}Please create a YAML for this challenge.
        In the RPelago thread, please send it with the following message:{' '}
        <span className="lb-slot-prompt-msg-wrap">
          <span className="lb-slot-prompt-msg">
            Game YAML for {tile.name || coord} at RPelago-{coord}.
          </span>
          <CopyButton text={`Game YAML for ${tile.name || coord} at RPelago-${coord}.`} />
        </span></>
      )}
    </div>
  );
}
