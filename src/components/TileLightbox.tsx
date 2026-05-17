import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { TILE_TYPES, ALL_ORBS, rcFromCoord } from '../lib/constants';
import { getTypeKey, getBossLiveStats, orbIdForElite, orbIdForEdgeTile } from '../lib/tileGen';
import { normalizeSlots } from '../lib/slotHelpers';
import TownLightbox    from './lightbox/TownLightbox';
import BossSection     from './lightbox/BossSection';
import TileDetails     from './lightbox/TileDetails';
import PublicSlotsList from './lightbox/PublicSlotsList';
import ClaimableSlots  from './lightbox/ClaimableSlots';
import AvailableState  from './lightbox/AvailableState';
import InProgressState from './lightbox/InProgressState';
import CompleteState   from './lightbox/CompleteState';
import type { TileAdventurer, AdvClass, AdvSlot } from '../types';

interface Props {
  coord: string | null;
  onClose: () => void;
  onLoginRequest: () => void;
}

export default function TileLightbox({ coord, onClose, onLoginRequest }: Props) {
  const { gameState, sendAdventurer, recallAdventurer, claimClaimableSlot } = useGameState();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [claimingSlotKey, setClaimingSlotKey] = useState<string | null>(null);

  const open = !!coord;

  if (!coord || !gameState) {
    return <div className={`lightbox-overlay ${open ? 'open' : ''}`} onClick={onClose} />;
  }

  const tile    = gameState.tiles[coord];
  const [r, c]  = rcFromCoord(coord);
  const typeKey = getTypeKey(r, c);
  const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
  const state   = tile?.state ?? 'hidden';

  if (state === 'hidden' || !tile) {
    return <div className={`lightbox-overlay ${open ? 'open' : ''}`} onClick={onClose} />;
  }

  const isTown    = typeKey === 'town' || typeKey === 'town_center';
  const player    = user ? gameState.players[user.id] : null;
  const orbState  = gameState.orbState ?? {};
  const orbConfig = gameState.orbConfig;
  const advEntries = Object.values(tile.adventurers ?? {});

  const handleSendAdventurer = async (advId: string) => {
    if (!user || !player) return;
    const adv = player.adventurers[advId];
    if (!adv) return;
    const entry: TileAdventurer = {
      advId, name: `${adv.firstName} ${adv.lastName}`,
      cls: adv.cls as AdvClass, owner: user.id, ownerName: user.displayName,
    };
    try {
      await sendAdventurer(coord, entry);
      addToast(`${adv.firstName} ${adv.lastName} dispatched to ${tile.name || coord}.`, 'success');
    } catch {
      addToast('Failed to send Adventurer. Please try again.', 'error');
    }
  };

  const handleClaimSlot = async (slotKey: string, slots: AdvSlot[], advId: string) => {
    if (!user || !player) return;
    const adv = player.adventurers[advId];
    if (!adv) return;
    const hasContent = slots.length > 0 && (slots[0].name || slots[0].game);
    const slotRoom   = slots[0]?.room;
    const entry: TileAdventurer = {
      advId, name: `${adv.firstName} ${adv.lastName}`,
      cls: adv.cls as AdvClass, owner: user.id, ownerName: user.displayName,
      ...(hasContent ? { slots } : {}),
      ...(slotRoom   ? { room: slotRoom } : {}),
    };
    try {
      await claimClaimableSlot(coord!, slotKey, entry);
      setClaimingSlotKey(null);
      addToast(`${adv.firstName} ${adv.lastName} claimed a slot at ${tile.name || coord}.`, 'success');
    } catch {
      addToast('Failed to claim slot. Please try again.', 'error');
    }
  };

  const handleRecall = async (advId: string) => {
    if (!user) return;
    try {
      await recallAdventurer(coord, advId, user.id);
      addToast('Adventurer recalled.', 'info');
    } catch {
      addToast('Failed to recall Adventurer. Please try again.', 'error');
    }
  };

  if (isTown) {
    return <TownLightbox coord={coord} tile={tile} info={info} open={open} onClose={onClose} onLoginRequest={onLoginRequest} />;
  }

  const orbCount   = Object.keys(orbState).length;
  const minOrbs    = orbConfig?.bossMinOrbs ?? 5;
  const bossLocked = typeKey === 'boss' && orbCount < minOrbs && state !== 'complete';

  let displayRelease = tile.release;
  let displayCollect = tile.collect;
  let displayHint    = tile.hint;
  if (typeKey === 'boss') {
    const live = getBossLiveStats(tile, orbState);
    displayRelease = live.release;
    displayCollect = live.collect;
    displayHint    = live.hint;
  }

  const eliteOrbId = typeKey === 'elite' ? orbIdForElite(r, c, orbConfig) : null;
  const edgeOrbId  = orbIdForEdgeTile(r, c, orbConfig);
  const eliteOrb   = eliteOrbId ? (ALL_ORBS.find(o => o.id === eliteOrbId) ?? null) : null;
  const edgeOrb    = edgeOrbId  ? (ALL_ORBS.find(o => o.id === edgeOrbId)  ?? null) : null;

  const freeAdvs    = player ? Object.values(player.adventurers).filter(a => !a.busy) : [];
  const alreadySent = player ? advEntries.some(e => e.owner === user!.id) : false;

  const isBifurcatedInProgress = tile.traits?.['bifurcated'] !== undefined && state === 'inprogress';
  const pubSlots         = normalizeSlots(tile.publicSlots as AdvSlot[] | Record<string, AdvSlot> | undefined);
  const claimableEntries = Object.entries(tile.claimableSlots ?? {}) as [string, AdvSlot[] | Record<string, AdvSlot>][];

  const stateBadgeText: Record<string, string> = {
    available: 'AVAILABLE', inprogress: 'IN PROGRESS', complete: 'COMPLETE',
  };

  return (
    <div className={`lightbox-overlay ${open ? 'open' : ''}`}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lightbox">
        <button className="lightbox-close" onClick={onClose}>✕</button>
        {state !== 'complete' && (
          <div className={`lb-state-badge ${state === 'inprogress' ? 'inprogress' : state}`}>
            {stateBadgeText[state]}
          </div>
        )}
        <div className="lb-coord">Grid Position: {coord}</div>
        <div className="lb-icon">{info.icon}</div>
        <div className={`lb-title ${typeKey}`}>{tile.name || info.label}</div>
        {tile.name && (
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '0.6rem', letterSpacing: '0.12em', color: 'var(--gold-dim)', marginTop: '0.1rem' }}>
            {info.label}
          </div>
        )}
        <div className="lb-divider" />

        {typeKey === 'boss' && (
          <BossSection bossLocked={bossLocked} orbState={orbState} orbConfig={orbConfig} minOrbs={minOrbs} orbCount={orbCount} />
        )}

        {!bossLocked && (
          <>
            <TileDetails
              tile={tile} player={player} user={user} advEntries={advEntries}
              players={gameState.players} displayRelease={displayRelease}
              displayCollect={displayCollect} displayHint={displayHint}
              eliteOrb={eliteOrb} edgeOrb={edgeOrb} orbState={orbState}
            />
            {!isBifurcatedInProgress && <PublicSlotsList slots={pubSlots} />}
            {!isBifurcatedInProgress && (
              <ClaimableSlots
                entries={claimableEntries} user={user} alreadySent={alreadySent}
                freeAdvs={freeAdvs} claimingSlotKey={claimingSlotKey}
                setClaimingSlotKey={setClaimingSlotKey} onClaimSlot={handleClaimSlot}
              />
            )}
            <div className="lb-divider" />
            {state === 'available' && (
              <AvailableState
                tile={tile} coord={coord} advEntries={advEntries} user={user}
                players={gameState.players} alreadySent={alreadySent} freeAdvs={freeAdvs}
                onSendAdventurer={handleSendAdventurer} onRecall={handleRecall}
                onLoginRequest={onLoginRequest} onClose={onClose}
              />
            )}
            {state === 'inprogress' && (
              <InProgressState
                tile={tile} coord={coord} advEntries={advEntries} user={user}
                players={gameState.players} alreadySent={alreadySent} freeAdvs={freeAdvs}
                claimingSlotKey={claimingSlotKey} setClaimingSlotKey={setClaimingSlotKey}
                onClaimSlot={handleClaimSlot}
              />
            )}
            {state === 'complete' && (
              <CompleteState tile={tile} coord={coord} advEntries={advEntries} players={gameState.players} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
