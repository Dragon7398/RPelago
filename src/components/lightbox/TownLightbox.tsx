import { useGameState } from '../../contexts/GameStateContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIsAdmin } from '../../contexts/SeasonContext';
import { ALL_ORBS, ORB_SHOP_COST } from '../../lib/constants';
import { activeBoard } from '../../lib/board';
import GuildmasterMissions from './GuildmasterMissions';
import ShopItemList from '../shop/ShopItemList';
import type { Tile } from '../../types';

interface Props {
  coord: string;
  tile: Tile;
  info: { icon: string; label: string };
  open: boolean;
  onClose: () => void;
  onLoginRequest: () => void;
}

// S1 ONLY. Town tiles exist on no S2 board (§1.8 moves the shop to the Capital
// Ward), but S1 is archived rather than deleted and stays readable — so this is
// still the only renderer for its town tiles, orb slot and all.
export default function TownLightbox({ coord, tile, info, open, onClose, onLoginRequest }: Props) {
  const { gameState } = useGameState();
  const { user } = useAuth();

  const player       = user && gameState ? gameState.players[user.id] : null;
  const orbState     = gameState?.orbState ?? {};
  const shop         = tile.shopId ? (gameState?.shops?.[tile.shopId] ?? null) : null;
  const shopOrbId    = shop?.orbId ?? null;
  const shopOrb      = shopOrbId ? ALL_ORBS.find(o => o.id === shopOrbId) : null;
  const orbAcq       = shopOrbId ? orbState[shopOrbId] : null;
  const alreadyOwned = !!orbAcq;
  const shopItemIds  = shop?.itemIds ?? [];
  const hasShopContent = !!shopOrb || shopItemIds.length > 0;

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
        {coord === activeBoard().startCoord && <div className="lb-subtitle">The Capital · Guild Hall</div>}
        <div className="lb-divider" />
        {coord === activeBoard().startCoord && (
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
                {/* A RECORD, never a control. The orb slot is S1 history: the
                    purchase callable is gone (§1.8) and an archived season is
                    read-only anyway, so an unclaimed slot shows its price as the
                    thing it cost rather than a button that cannot work. */}
                <button className="lb-shop-orb-btn owned" disabled>
                  {alreadyOwned ? '✓ CLAIMED' : `UNCLAIMED · 🪙 ${ORB_SHOP_COST.toLocaleString()}`}
                </button>
              </div>
            )}
            <ShopItemList itemIds={shopItemIds} player={player} coord={coord} />
          </>
        )}
        {tile.details && <div className="lb-details">{tile.details}</div>}
      </div>
    </div>
  );
}
