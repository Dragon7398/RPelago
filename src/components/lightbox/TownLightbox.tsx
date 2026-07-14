import { useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIsAdmin } from '../../contexts/SeasonContext';
import { useToast } from '../../contexts/ToastContext';
import { ALL_ORBS, SHOP_ITEMS, ORB_SHOP_COST, ITEM_TRAIT_REFS, CENTER_COORD } from '../../lib/constants';
import { renderTraitDesc } from './lbHelpers';
import GuildmasterMissions from './GuildmasterMissions';
import type { Tile } from '../../types';

interface Props {
  coord: string;
  tile: Tile;
  info: { icon: string; label: string };
  open: boolean;
  onClose: () => void;
  onLoginRequest: () => void;
}

export default function TownLightbox({ coord, tile, info, open, onClose, onLoginRequest }: Props) {
  const { gameState, purchaseOrb, purchaseItem } = useGameState();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [purchasing, setPurchasing] = useState(false);

  const player       = user && gameState ? gameState.players[user.id] : null;
  const orbState     = gameState?.orbState ?? {};
  const shop         = tile.shopId ? (gameState?.shops?.[tile.shopId] ?? null) : null;
  const shopOrbId    = shop?.orbId ?? null;
  const shopOrb      = shopOrbId ? ALL_ORBS.find(o => o.id === shopOrbId) : null;
  const orbAcq       = shopOrbId ? orbState[shopOrbId] : null;
  const alreadyOwned = !!orbAcq;
  const canAffordOrb = !!player && player.gold >= ORB_SHOP_COST;
  const shopItemIds  = shop?.itemIds ?? [];
  const shopItemDefs = shopItemIds
    .map((id: string) => SHOP_ITEMS.find(i => i.id === id))
    .filter(Boolean) as typeof SHOP_ITEMS[number][];
  const hasShopContent = shopOrb || shopItemDefs.length > 0;

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

  const isAdmin = useIsAdmin();

  return (
    <div className={`lightbox-overlay ${open ? 'open' : ''}`}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lightbox">
        <button className="lightbox-close" onClick={onClose}>✕</button>
        {isAdmin && (
          <a className="lb-admin-link" href={`/?coord=${coord}#admin`} target="_blank" rel="noreferrer" title="Open in Map Editor">🗺</a>
        )}
        <div className="lb-coord">Grid Position: {coord}</div>
        <div className="lb-icon">{info.icon}</div>
        <div className="lb-title town">{tile.name || info.label}</div>
        {coord === CENTER_COORD && <div className="lb-subtitle">The Capital · Guild Hall</div>}
        <div className="lb-divider" />
        {coord === CENTER_COORD && (
          <>
            <GuildmasterMissions />
            <div className="lb-divider wide" />
          </>
        )}
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
              const itemOwned    = !item.consumable && qty > 0;
              const canAfford    = !itemOwned && player.gold >= item.cost;
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
                      className={`lb-shop-item-btn${itemOwned ? ' owned' : !canAfford ? ' cant-afford' : ''}`}
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
                      disabled={!canAfford || itemOwned || purchasing}
                    >
                      {itemOwned ? '✓ OWNED' : canAfford ? 'BUY' : 'NOT ENOUGH GOLD'}
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
