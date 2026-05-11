import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { TILE_TYPES, ADV_ICONS, ALL_ORBS, SHOP_ITEMS, ORB_SHOP_COST, rcFromCoord, TILE_TRAITS, NAME_COLORS, ITEM_TRAIT_REFS, FEATS } from '../lib/constants';
import { getTypeKey, getBossLiveStats, orbIdForElite, orbIdForEdgeTile } from '../lib/tileGen';
import { getPlayerFeatIds, calcFeatBonuses, buildXpBonusTooltip, buildGoldBonusTooltip, calcSeekerHintReduction, buildSeekerHintTooltip } from '../lib/gameLogic';
import type { TileAdventurer, AdvClass, AdvSlot } from '../types';

function resolveNameColor(colorId: string | undefined): string | undefined {
  if (!colorId || colorId === 'default') return undefined;
  return NAME_COLORS.find(c => c.id === colorId)?.value;
}

type TraitEffect =
  | { kind: 'negated';  item: string }
  | { kind: 'modified'; item: string; newValue: number }
  | { kind: 'none' };

function traitEffect(traitId: string, value: number, inventory: Record<string, number>): TraitEffect {
  const has = (id: string) => (inventory[id] ?? 0) > 0;
  switch (traitId) {
    case 'magicresist': case 'physresist':
      if (has('wand_of_piercing'))    return { kind: 'negated',  item: 'Wand of Piercing' };
      break;
    case 'aerial':
      if (has('throwing_dagger'))     return { kind: 'negated',  item: 'Throwing Dagger' };
      break;
    case 'agile':
      if (has('throwing_dagger'))     return { kind: 'modified', item: 'Throwing Dagger', newValue: Math.round(value * 1.25) };
      break;
    case 'cursed': case 'stunning':
      if (has('ring_of_resistance'))  return { kind: 'negated',  item: 'Ring of Resistance' };
      break;
    case 'horde':
      if (has('warhammer'))           return { kind: 'modified', item: 'Warhammer', newValue: Math.max(1, value - 1) };
      break;
    case 'sturdy':
      if (has('warhammer'))           return { kind: 'modified', item: 'Warhammer', newValue: Math.round(value * 0.5) };
      break;
  }
  return { kind: 'none' };
}

function renderTraitDesc(description: string, traitIds: readonly string[]): React.ReactNode {
  if (traitIds.length === 0) return description;
  const refs = TILE_TRAITS.filter(t => traitIds.includes(t.id));
  if (refs.length === 0) return description;
  const pattern = new RegExp(
    `(${refs.map(t => t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'g',
  );
  const parts = description.split(pattern);
  return (
    <>
      {parts.map((part, i) => {
        const trait = refs.find(t => t.name === part);
        if (trait) {
          const tip = trait.description.replace('{value}', String(trait.defaultValue));
          return <span key={i} className="trait-ref" data-tooltip={tip}>{part}</span>;
        }
        return part;
      })}
    </>
  );
}

function AdvStatusIcons({ advId, tile, inventory }: {
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

function AdvFeatIcons({ playerId, players }: {
  playerId: string;
  players: Record<string, import('../types').Player>;
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

function slotsFromEntry(entry: TileAdventurer): AdvSlot[] {
  if (!entry.slots) return [];
  // Firebase may return a dense array or an object with numeric keys
  return Array.isArray(entry.slots)
    ? entry.slots
    : Object.values(entry.slots as Record<string, AdvSlot>);
}

function AdvSlotBlock({ entry, tile, coord, isOwner, showPrompt = true }: {
  entry: TileAdventurer; tile: { name: string }; coord: string;
  isOwner: boolean; showPrompt?: boolean;
}) {
  const slots = slotsFromEntry(entry);
  if (slots.length > 0) {
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
      </div>
    );
  }
  if (!showPrompt) return null;
  return (
    <div className="lb-slot-prompt">
      No game currently set for this challenge.{isOwner && (
        <>{' '}Please create a YAML for this challenge.
        In the RPelago thread, please send it with the following message:{' '}
        <span className="lb-slot-prompt-msg">
          Game YAML for {tile.name || coord} at RPelago-{coord}.
        </span></>
      )}
    </div>
  );
}

interface Props {
  coord: string | null;
  onClose: () => void;
  onLoginRequest: () => void;
}

function TriStateChip({ label, value }: { label: string; value: string }) {
  return (
    <span className={`lb-meta-chip ${value}`}>
      {label}: {value.toUpperCase()}
    </span>
  );
}

export default function TileLightbox({ coord, onClose, onLoginRequest }: Props) {
  const { gameState, sendAdventurer, recallAdventurer, purchaseOrb, purchaseItem, claimClaimableSlot } = useGameState();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [purchasing, setPurchasing] = useState(false);
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
      advId,
      name:      `${adv.firstName} ${adv.lastName}`,
      cls:       adv.cls as AdvClass,
      owner:     user.id,
      ownerName: user.displayName,
    };
    try {
      await sendAdventurer(coord, entry);
      addToast(`${adv.firstName} ${adv.lastName} dispatched to ${tile.name || coord}.`, 'success');
    } catch {
      addToast('Failed to send adventurer. Please try again.', 'error');
    }
  };

  const handleClaimSlot = async (slotKey: string, slots: AdvSlot[], advId: string) => {
    if (!user || !player) return;
    const adv = player.adventurers[advId];
    if (!adv) return;
    const hasContent = slots.length > 0 && (slots[0].name || slots[0].game);
    const slotRoom   = slots[0]?.room;
    const entry: TileAdventurer = {
      advId,
      name:      `${adv.firstName} ${adv.lastName}`,
      cls:       adv.cls as AdvClass,
      owner:     user.id,
      ownerName: user.displayName,
      ...(hasContent ? { slots } : {}),
      ...(slotRoom ? { room: slotRoom } : {}),
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
      addToast('Failed to recall adventurer. Please try again.', 'error');
    }
  };

  const handlePurchaseOrb = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      await purchaseOrb(coord);
      addToast('Orb claimed!', 'success');
      onClose();
    } catch {
      addToast('Purchase failed. Please try again.', 'error');
    } finally {
      setPurchasing(false);
    }
  };

  // ── Town lightbox ─────────────────────────────────────────────────────────
  if (isTown) {
    const shop          = tile.shopId ? (gameState.shops?.[tile.shopId] ?? null) : null;
    const shopOrbId     = shop?.orbId ?? null;
    const shopOrb       = shopOrbId ? ALL_ORBS.find(o => o.id === shopOrbId) : null;
    const orbAcq        = shopOrbId ? orbState[shopOrbId] : null;
    const alreadyOwned  = !!orbAcq;
    const canAffordOrb  = !!player && player.gold >= ORB_SHOP_COST;
    const shopItemIds   = shop?.itemIds ?? [];
    const shopItemDefs  = shopItemIds
      .map((id: string) => SHOP_ITEMS.find(i => i.id === id))
      .filter(Boolean) as typeof SHOP_ITEMS[number][];
    const hasShopContent = shopOrb || shopItemDefs.length > 0;

    return (
      <div className={`lightbox-overlay ${open ? 'open' : ''}`}
           onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lightbox">
          <button className="lightbox-close" onClick={onClose}>✕</button>
          <div className="lb-coord">Grid Position: {coord}</div>
          <div className="lb-icon">{info.icon}</div>
          <div className={`lb-title town`}>{tile.name || info.label}</div>
          <div className="lb-divider" />
          <div className="lb-shop-banner">🛒 {shop?.name ? `${shop.name.toUpperCase()} SHOP` : 'TOWN SHOP'}</div>
          {!player ? (
            <div className="lb-login-prompt">
              Log in to browse the shop.{' '}
              <a onClick={() => { onClose(); onLoginRequest(); }}>Enter RPelago →</a>
            </div>
          ) : !hasShopContent ? (
            <div className="lb-shop-note">The shop will be available soon. Check back after your next adventure.</div>
          ) : (
            <>
              {shopOrb && (
                <div className="lb-shop-orb-item">
                  <div className="lb-shop-orb-icon">{shopOrb.icon}</div>
                  <div className="lb-shop-orb-info">
                    <div className="lb-shop-orb-name">{shopOrb.label} Orb</div>
                    <div className="lb-shop-orb-desc">A rare sigil orb — weakens the Dragon's power.</div>
                    {alreadyOwned && orbAcq?.buyerName && (
                      <div className="lb-shop-orb-buyer">Claimed by {orbAcq.buyerName}</div>
                    )}
                  </div>
                  {alreadyOwned ? (
                    <button className="lb-shop-orb-btn owned" disabled>✓ CLAIMED</button>
                  ) : (
                    <button
                      className={`lb-shop-orb-btn${!canAffordOrb ? ' cant-afford' : ''}`}
                      onClick={canAffordOrb && !purchasing ? handlePurchaseOrb : undefined}
                      disabled={!canAffordOrb || purchasing}
                    >
                      {purchasing ? '…' : canAffordOrb ? `⚗ OBTAIN · 🪙 ${ORB_SHOP_COST.toLocaleString()}` : `NOT ENOUGH GOLD · 🪙 ${ORB_SHOP_COST.toLocaleString()}`}
                    </button>
                  )}
                </div>
              )}
              {shopItemDefs.map(item => {
                const qty          = player.inventory?.[item.id] ?? 0;
                const alreadyOwned = !item.consumable && qty > 0;
                const canAfford    = !alreadyOwned && player.gold >= item.cost;
                return (
                  <div key={item.id} className="lb-shop-item">
                    <div className="lb-shop-item-info">
                      <div className="lb-shop-item-name">{item.name}</div>
                      <div className="lb-shop-item-desc">{renderTraitDesc(item.description, ITEM_TRAIT_REFS[item.id] ?? [])}</div>
                      {item.consumable && qty > 0 && <div className="lb-shop-item-owned">Owned: {qty}</div>}
                    </div>
                    <div className="lb-shop-item-right">
                      <div className="lb-shop-item-cost">🪙 {item.cost}</div>
                      <button
                        className={`lb-shop-item-btn${alreadyOwned ? ' owned' : !canAfford ? ' cant-afford' : ''}`}
                        onClick={canAfford && !purchasing ? async () => {
                          setPurchasing(true);
                          try {
                            await purchaseItem(item.id, coord);
                            addToast(`${item.name} purchased.`, 'success');
                          } catch {
                            addToast('Purchase failed. Please try again.', 'error');
                          } finally {
                            setPurchasing(false);
                          }
                        } : undefined}
                        disabled={!canAfford || alreadyOwned || purchasing}
                      >
                        {alreadyOwned ? '✓ OWNED' : canAfford ? 'BUY' : 'NOT ENOUGH GOLD'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {tile.details && <div className="lb-details">{tile.details}</div>}
        </div>
      </div>
    );
  }

  // ── Boss lock check ───────────────────────────────────────────────────────
  const orbCount = Object.keys(orbState).length;
  const minOrbs  = orbConfig?.bossMinOrbs ?? 5;
  const bossLocked = typeKey === 'boss' && orbCount < minOrbs && state !== 'complete';

  // Live boss stats
  let displayRelease = tile.release;
  let displayCollect = tile.collect;
  let displayHint    = tile.hint;
  if (typeKey === 'boss') {
    const live = getBossLiveStats(tile, orbState);
    displayRelease = live.release;
    displayCollect = live.collect;
    displayHint    = live.hint;
  }

  // Orb reward info
  const eliteOrbId = typeKey === 'elite' ? orbIdForElite(r, c, orbConfig) : null;
  const edgeOrbId  = orbIdForEdgeTile(r, c, orbConfig);
  const eliteOrb   = eliteOrbId ? ALL_ORBS.find(o => o.id === eliteOrbId) : null;
  const edgeOrb    = edgeOrbId  ? ALL_ORBS.find(o => o.id === edgeOrbId)  : null;

  const myAdvsSent  = player ? advEntries.filter(e => e.owner === user!.id) : [];
  const freeAdvs    = player ? Object.values(player.adventurers).filter(a => !a.busy) : [];
  const alreadySent = myAdvsSent.length > 0;

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

        {/* Boss lock */}
        {typeKey === 'boss' && (
          <div className="lb-boss-lock">
            <div className="lb-boss-lock-title">🔒 THE DRAGON STIRS</div>
            {bossLocked ? (
              <div style={{ fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: '0.82rem', color: 'oklch(55% 0.14 25)', marginBottom: '0.4rem' }}>
                Gather <strong>{minOrbs - orbCount}</strong> more orb{minOrbs - orbCount !== 1 ? 's' : ''} to challenge the Dragon.
              </div>
            ) : (
              <div style={{ fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: '0.82rem', color: 'oklch(62% 0.14 145)', marginBottom: '0.4rem' }}>
                The seals are broken — the Dragon may be challenged!
              </div>
            )}
            {/* Active orb effects */}
            {(['wood', 'soul', 'light', 'dark'] as const).some(id => !!orbState[id]) && (
              <>
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: '0.55rem', letterSpacing: '0.1em', color: 'var(--gold-dim)', margin: '0.3rem 0 0.2rem' }}>ORB EFFECTS ACTIVE</div>
                <div className="lb-boss-neg-effects">
                  {!!orbState['wood']  && <div className="lb-boss-neg-effect"><span style={{ color: 'var(--gold)' }}>🌿 Wood Orb: Release → On</span></div>}
                  {!!orbState['soul']  && <div className="lb-boss-neg-effect"><span style={{ color: 'var(--gold)' }}>✨ Soul Orb: Collect → On</span></div>}
                  {!!orbState['light'] && <div className="lb-boss-neg-effect"><span style={{ color: 'var(--gold)' }}>☀️ Light Orb: Hint −10%</span></div>}
                  {!!orbState['dark']  && <div className="lb-boss-neg-effect"><span style={{ color: 'var(--gold)' }}>🌑 Dark Orb: Hint −10%</span></div>}
                </div>
              </>
            )}
            {/* Active curses */}
            {ALL_ORBS.filter(o => !orbState[o.id]).length > 0 && (
              <>
                <div className="lb-boss-lock-title" style={{ fontSize: '0.6rem', marginTop: '0.4rem', marginBottom: '0.3rem' }}>ACTIVE CURSES</div>
                <div className="lb-boss-neg-effects">
                  {ALL_ORBS.filter(o => !orbState[o.id]).map(orb => (
                    <div key={orb.id} className="lb-boss-neg-effect">
                      <span>{orb.icon}</span>
                      <span>{orbConfig?.bossNegEffects?.[orb.id] ?? `The ${orb.label} curse is active.`}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {bossLocked && <>{/* stop rendering rest of content when boss is locked */}</>}
        {!bossLocked && (
          <>
            {/* Compute feat-adjusted values once */}
            {(() => {
              const tileOwnerIds = [...new Set(advEntries.map(e => e.owner))];
              const userInTile   = !!user && tileOwnerIds.includes(user.id);
              const seekerReduce = calcSeekerHintReduction(tileOwnerIds, gameState.players);
              const adjustedHint = Math.max(1, displayHint - seekerReduce);
              const seekerTip    = buildSeekerHintTooltip(seekerReduce);
              const xpTip  = userInTile ? buildXpBonusTooltip(user!.id,  tileOwnerIds, gameState.players) : null;
              const goldTip = userInTile ? buildGoldBonusTooltip(user!.id, tileOwnerIds, gameState.players) : null;
              const { xpMultiplier, goldMultiplier } = userInTile
                ? calcFeatBonuses(user!.id, tileOwnerIds, gameState.players)
                : { xpMultiplier: 1, goldMultiplier: 1 };
              const adjXp   = Math.round((tile.xp   ?? 0) * xpMultiplier);
              const adjGold = Math.round((tile.gold ?? 0) * goldMultiplier);

              return (
                <>
                  {/* Meta chips */}
                  <div className="lb-meta-row">
                    <TriStateChip label="RELEASE" value={displayRelease} />
                    <TriStateChip label="COLLECT" value={displayCollect} />
                    {seekerReduce > 0 ? (
                      <span className="lb-meta-chip hint trait-ref" data-tooltip={seekerTip ?? undefined}>
                        HINT: <span className="lb-val-struck">{displayHint}%</span>{' '}
                        <span className="lb-val-new">{adjustedHint}%</span> *
                      </span>
                    ) : (
                      <span className="lb-meta-chip hint">HINT: {displayHint}%</span>
                    )}
                  </div>

                  {/* Rewards */}
                  {(tile.gold > 0 || tile.xp > 0) && (
                    <div className="lb-rewards">
                      {tile.gold > 0 && (
                        goldTip ? (
                          <span className="lb-reward-chip gold trait-ref" data-tooltip={goldTip}>
                            🪙 <span className="lb-val-struck">{tile.gold}</span>{' '}
                            <span className="lb-val-new">{adjGold}</span> Gold *
                          </span>
                        ) : (
                          <span className="lb-reward-chip gold">🪙 {tile.gold} Gold</span>
                        )
                      )}
                      {tile.xp > 0 && (
                        xpTip ? (
                          <span className="lb-reward-chip xp trait-ref" data-tooltip={xpTip}>
                            ✨ <span className="lb-val-struck">{tile.xp}</span>{' '}
                            <span className="lb-val-new">{adjXp}</span> XP *
                          </span>
                        ) : (
                          <span className="lb-reward-chip xp">✨ {tile.xp} XP</span>
                        )
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Elite orb drop */}
            {eliteOrb && (
              <div className="lb-orb-reward" style={{ borderColor: eliteOrb.color }}>
                <span style={{ fontSize: '1.4rem' }}>{eliteOrb.icon}</span>
                <span>
                  {!!orbState[eliteOrb.id]
                    ? `${eliteOrb.label} Orb already gathered`
                    : <>Drops: <strong>{eliteOrb.label} Orb</strong> upon defeat</>}
                </span>
              </div>
            )}

            {/* Edge orb hint */}
            {edgeOrb && !!orbState[edgeOrb.id] && (
              <div className="lb-orb-reward" style={{ borderColor: edgeOrb.color }}>
                <span style={{ fontSize: '1.2rem' }}>{edgeOrb.icon}</span>
                <span>{edgeOrb.label} Orb gathered from here</span>
              </div>
            )}

            {tile.details && <div className="lb-details">{tile.details}</div>}
            {tile.traits && Object.keys(tile.traits).length > 0 && (
              <div className="lb-traits">
                <div className="lb-traits-header">TRAITS</div>
                {TILE_TRAITS
                  .filter(def => tile.traits![def.id] !== undefined)
                  .map(def => {
                    const value  = tile.traits![def.id].value;
                    const inv    = player?.inventory ?? {};
                    const effect = traitEffect(def.id, value, inv);
                    const negated  = effect.kind === 'negated';
                    const modified = effect.kind === 'modified';
                    const parts  = def.description.split('{value}');
                    return (
                      <div key={def.id} className={`lb-trait${negated ? ' lb-trait-negated' : ''}`}>
                        <div className="lb-trait-top-row">
                          <span className={`lb-trait-name${negated ? ' lb-trait-struck' : ''}`}>{def.name}</span>
                          {(negated || modified) && (
                            <span className="lb-trait-item-badge">
                              {negated ? '✦ IMMUNE' : '✦ MODIFIED'} · {effect.item}
                            </span>
                          )}
                        </div>
                        <span className={`lb-trait-desc${negated ? ' lb-trait-struck' : ''}`}>
                          {modified && parts.length === 2 ? (
                            <>
                              {parts[0]}
                              <span className="lb-trait-val-struck">{value}</span>
                              {' '}
                              <span className="lb-trait-val-new">{(effect as { kind: 'modified'; newValue: number; item: string }).newValue}</span>
                              {parts[1]}
                            </>
                          ) : (
                            def.description.replace('{value}', String(value))
                          )}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
            {tile.rules && (
              <div className="lb-rules">
                <div className="lb-rules-label">RULES</div>
                {tile.rules}
              </div>
            )}
            {(() => {
              // For bifurcated in-progress tiles, pub/claimable slots render inside each room section below.
              const isBifurcatedInProgress = tile.traits?.['bifurcated'] !== undefined && state === 'inprogress';
              if (isBifurcatedInProgress) return null;
              const pubSlots = tile.publicSlots
                ? (Array.isArray(tile.publicSlots)
                    ? tile.publicSlots
                    : Object.values(tile.publicSlots as Record<string, AdvSlot>))
                : [];
              if (pubSlots.length === 0) return null;
              return (
                <div className="lb-public-slots">
                  <div className="lb-public-slots-header">PUBLIC SLOTS</div>
                  {pubSlots.map((s, i) => (
                    <div key={i} className="lb-slot-row">
                      <span className="lb-slot-name">{s.name}</span>
                      <span className="lb-slot-sep">—</span>
                      <span className="lb-slot-game">{s.game}</span>
                      {s.details && <span className="lb-slot-details">{s.details}</span>}
                      {s.status && <span className={`lb-slot-status ss-${s.status.replace('%', 'pct').replace('-', '')}`}>{s.status}</span>}
                    </div>
                  ))}
                </div>
              );
            })()}
            {(() => {
              const isBifurcatedInProgress = tile.traits?.['bifurcated'] !== undefined && state === 'inprogress';
              if (isBifurcatedInProgress) return null;
              const claimable = tile.claimableSlots ?? {};
              const entries = Object.entries(claimable);
              if (entries.length === 0) return null;
              const canClaim = !!user && !alreadySent && freeAdvs.length > 0;
              return (
                <div className="lb-claimable-slots">
                  <div className="lb-claimable-header">CLAIMABLE SLOTS</div>
                  <div className="lb-claimable-note">A player has vacated this challenge. You can take over their game slot.</div>
                  {entries.map(([slotKey, slotVal]) => {
                    const slotArr: AdvSlot[] = Array.isArray(slotVal) ? slotVal : Object.values(slotVal as Record<string, AdvSlot>);
                    const isClaiming = claimingSlotKey === slotKey;
                    const hasContent = slotArr.some(s => s.name || s.game);
                    return (
                      <div key={slotKey} className="lb-claimable-slot">
                        {hasContent && (
                          <div className="lb-claimable-slot-games">
                            {slotArr.map((s, i) => (
                              <div key={i} className="lb-slot-row">
                                {s.name && <span className="lb-slot-name">{s.name}</span>}
                                {s.name && s.game && <span className="lb-slot-sep">—</span>}
                                {s.game && <span className="lb-slot-game">{s.game}</span>}
                                {s.details && <span className="lb-slot-details">{s.details}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {!user && <div className="lb-claimable-login">Log in to claim this slot.</div>}
                        {canClaim && !isClaiming && (
                          <button className="lb-claim-btn" onClick={() => setClaimingSlotKey(slotKey)}>CLAIM</button>
                        )}
                        {canClaim && isClaiming && (
                          <div className="lb-claim-picker">
                            <div className="lb-send-label">SEND AN ADVENTURER</div>
                            <div className="lb-adv-picker">
                              {freeAdvs.map(adv => (
                                <button key={adv.id} className="lb-adv-pick-btn" onClick={() => handleClaimSlot(slotKey, slotArr, adv.id)}>
                                  <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
                                  <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
                                  <span className="btn-adv-class">{adv.cls}</span>
                                </button>
                              ))}
                            </div>
                            <button className="lb-cancel-claim-btn" onClick={() => setClaimingSlotKey(null)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="lb-divider" />

            {/* ── Available ── */}
            {state === 'available' && (
              <>
                <div className="lb-progress-wrap">
                  <div className="lb-progress-label">ADVENTURERS: {advEntries.length} / {tile.required}</div>
                  <div className="lb-progress-bar-bg">
                    <div
                      className={`lb-progress-bar-fill${advEntries.length >= tile.required ? ' full' : ''}`}
                      style={{ width: `${tile.required > 0 ? Math.round((advEntries.length / tile.required) * 100) : 100}%` }}
                    />
                  </div>
                </div>
                {advEntries.length > 0 && (
                  <>
                    <div className="lb-adv-list">
                      {advEntries.map(entry => (
                        <div key={entry.advId} className="lb-adv-entry">
                          <div className="lb-adv-row">
                            <span className="lb-adv-owner" style={{ color: resolveNameColor(gameState.players[entry.owner]?.nameColor) }}>{entry.ownerName}</span>
                            <AdvFeatIcons playerId={entry.owner} players={gameState.players} />
                            <AdvStatusIcons advId={entry.advId} tile={tile} inventory={gameState.players[entry.owner]?.inventory ?? {}} />
                            <span className="lb-adv-secondary">
                              <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                              <span className="lb-adv-name">{entry.name}</span>
                              <span className="lb-adv-class">{entry.cls}</span>
                            </span>
                            {user && entry.owner === user.id && (
                              <button className="lb-recall-btn" onClick={() => handleRecall(entry.advId)}>
                                RECALL
                              </button>
                            )}
                          </div>
                          <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
                        </div>
                      ))}
                    </div>
                    <div className="lb-divider" />
                  </>
                )}
                {!user ? (
                  <div className="lb-login-prompt">
                    Log in to send an Adventurer to this challenge.{' '}
                    <a onClick={() => { onClose(); onLoginRequest(); }}>Enter RPelago →</a>
                  </div>
                ) : alreadySent ? (
                  <div className="lb-no-adv">Your adventurer is already assigned here. Recall them above if you change your mind.</div>
                ) : (
                  <div className="lb-send-section">
                    <div className="lb-send-label">SEND AN ADVENTURER ({tile.required} required)</div>
                    {freeAdvs.length === 0 ? (
                      <div className="lb-no-adv">All your adventurers are currently on missions.</div>
                    ) : (
                      <div className="lb-adv-picker">
                        {freeAdvs.map(adv => (
                          <button key={adv.id} className="lb-adv-pick-btn" onClick={() => handleSendAdventurer(adv.id)}>
                            <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
                            <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
                            <span className="btn-adv-class">{adv.cls}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── In-Progress ── */}
            {state === 'inprogress' && (() => {
              const isBifurcated = tile.traits?.['bifurcated'] !== undefined;
              if (!isBifurcated) {
                return (
                  <>
                    {tile.link && (
                      <div className="lb-archipelago-link">
                        <a href={tile.link} target="_blank" rel="noopener noreferrer">
                          🗺 Open Archipelago Game →
                        </a>
                      </div>
                    )}
                    {advEntries.length > 0 && (
                      <div className="lb-adv-list">
                        {advEntries.map(entry => (
                          <div key={entry.advId} className="lb-adv-entry">
                            <div className="lb-adv-row">
                              <span className="lb-adv-owner" style={{ color: resolveNameColor(gameState.players[entry.owner]?.nameColor) }}>{entry.ownerName}</span>
                              <AdvStatusIcons advId={entry.advId} tile={tile} inventory={gameState.players[entry.owner]?.inventory ?? {}} />
                              <span className="lb-adv-secondary">
                                <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                                <span className="lb-adv-name">{entry.name}</span>
                                <span className="lb-adv-class">{entry.cls}</span>
                              </span>
                            </div>
                            <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              }

              // ── Bifurcated in-progress ──
              const allPubSlots: AdvSlot[] = tile.publicSlots
                ? (Array.isArray(tile.publicSlots) ? tile.publicSlots : Object.values(tile.publicSlots as Record<string, AdvSlot>))
                : [];
              const claimableEntries = Object.entries(tile.claimableSlots ?? {}) as [string, AdvSlot[] | Record<string, AdvSlot>][];
              const canClaim = !!user && !alreadySent && freeAdvs.length > 0;

              const renderClaimableEntry = (slotKey: string, rawVal: AdvSlot[] | Record<string, AdvSlot>) => {
                const slotArr: AdvSlot[] = Array.isArray(rawVal) ? rawVal : Object.values(rawVal);
                const isClaiming = claimingSlotKey === slotKey;
                const hasContent = slotArr.some(s => s.name || s.game);
                return (
                  <div key={slotKey} className="lb-claimable-slot">
                    {hasContent && (
                      <div className="lb-claimable-slot-games">
                        {slotArr.map((s, i) => (
                          <div key={i} className="lb-slot-row">
                            {s.name && <span className="lb-slot-name">{s.name}</span>}
                            {s.name && s.game && <span className="lb-slot-sep">—</span>}
                            {s.game && <span className="lb-slot-game">{s.game}</span>}
                            {s.details && <span className="lb-slot-details">{s.details}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {!user && <div className="lb-claimable-login">Log in to claim this slot.</div>}
                    {canClaim && !isClaiming && (
                      <button className="lb-claim-btn" onClick={() => setClaimingSlotKey(slotKey)}>CLAIM</button>
                    )}
                    {canClaim && isClaiming && (
                      <div className="lb-claim-picker">
                        <div className="lb-send-label">SEND AN ADVENTURER</div>
                        <div className="lb-adv-picker">
                          {freeAdvs.map(adv => (
                            <button key={adv.id} className="lb-adv-pick-btn" onClick={() => handleClaimSlot(slotKey, slotArr, adv.id)}>
                              <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
                              <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
                              <span className="btn-adv-class">{adv.cls}</span>
                            </button>
                          ))}
                        </div>
                        <button className="lb-cancel-claim-btn" onClick={() => setClaimingSlotKey(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                );
              };

              const renderRoom = (
                roomNum: 1 | 2,
                label: string,
                link: string | undefined,
              ) => {
                const roomAdvs    = advEntries.filter(e => (e.room ?? 1) === roomNum);
                const roomPub     = allPubSlots.filter(s => (s.room ?? 1) === roomNum);
                const roomClaim   = claimableEntries.filter(([, rawVal]) => {
                  const arr: AdvSlot[] = Array.isArray(rawVal) ? rawVal : Object.values(rawVal);
                  return (arr[0]?.room ?? 1) === roomNum;
                });
                return (
                  <div className="lb-bifurcated-room">
                    <div className="lb-room-header">{label}</div>
                    {link && (
                      <div className="lb-archipelago-link">
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          🗺 Open Archipelago Game →
                        </a>
                      </div>
                    )}
                    {roomAdvs.length > 0 && (
                      <div className="lb-adv-list">
                        {roomAdvs.map(entry => (
                          <div key={entry.advId} className="lb-adv-entry">
                            <div className="lb-adv-row">
                              <span className="lb-adv-owner" style={{ color: resolveNameColor(gameState.players[entry.owner]?.nameColor) }}>{entry.ownerName}</span>
                              <AdvStatusIcons advId={entry.advId} tile={tile} inventory={gameState.players[entry.owner]?.inventory ?? {}} />
                              <span className="lb-adv-secondary">
                                <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                                <span className="lb-adv-name">{entry.name}</span>
                                <span className="lb-adv-class">{entry.cls}</span>
                              </span>
                            </div>
                            <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={entry.owner === user?.id} />
                          </div>
                        ))}
                      </div>
                    )}
                    {roomPub.length > 0 && (
                      <div className="lb-public-slots">
                        <div className="lb-public-slots-header">PUBLIC SLOTS</div>
                        {roomPub.map((s, i) => (
                          <div key={i} className="lb-slot-row">
                            <span className="lb-slot-name">{s.name}</span>
                            <span className="lb-slot-sep">—</span>
                            <span className="lb-slot-game">{s.game}</span>
                            {s.details && <span className="lb-slot-details">{s.details}</span>}
                            {s.status && <span className={`lb-slot-status ss-${s.status.replace('%', 'pct').replace('-', '')}`}>{s.status}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {roomClaim.length > 0 && (
                      <div className="lb-claimable-slots">
                        <div className="lb-claimable-header">CLAIMABLE SLOTS</div>
                        <div className="lb-claimable-note">A player has vacated this challenge. You can take over their game slot.</div>
                        {roomClaim.map(([slotKey, rawVal]) => renderClaimableEntry(slotKey, rawVal))}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {renderRoom(1, 'Room 1', tile.link || undefined)}
                  {renderRoom(2, 'Room 2', tile.link2 || undefined)}
                </>
              );
            })()}

            {/* ── Complete ── */}
            {state === 'complete' && (
              <>
                <div className="lb-complete-banner">✦ CHALLENGE CLEARED ✦</div>
                {advEntries.length > 0 && (
                  <div className="lb-adv-list">
                    {advEntries.map(entry => (
                      <div key={entry.advId} className="lb-adv-entry">
                        <div className="lb-adv-row">
                          <span className="lb-adv-owner" style={{ color: resolveNameColor(gameState.players[entry.owner]?.nameColor) }}>{entry.ownerName}</span>
                          <AdvStatusIcons advId={entry.advId} tile={tile} inventory={gameState.players[entry.owner]?.inventory ?? {}} />
                          <span className="lb-adv-secondary">
                            <span className="lb-adv-icon">{ADV_ICONS[entry.cls as AdvClass] ?? '⚔️'}</span>
                            <span className="lb-adv-name">{entry.name}</span>
                            <span className="lb-adv-class">{entry.cls}</span>
                          </span>
                        </div>
                        <AdvSlotBlock entry={entry} tile={tile} coord={coord} isOwner={false} showPrompt={false} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
