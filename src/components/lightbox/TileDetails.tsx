import { TILE_TRAITS } from '../../lib/constants';
import { calcFeatBonuses, buildXpBonusTooltip, buildGoldBonusTooltip, calcSeekerHintReduction, buildSeekerHintTooltip } from '../../lib/gameLogic';
import { traitEffect } from './lbHelpers';
import type { Tile, Player, TileAdventurer, AuthUser, OrbAcquisition, OrbDef, TriState } from '../../types';

function TriStateChip({ label, value }: { label: string; value: string }) {
  return <span className={`lb-meta-chip ${value}`}>{label}: {value.toUpperCase()}</span>;
}

interface Props {
  tile: Tile;
  player: Player | null;
  user: AuthUser | null;
  advEntries: TileAdventurer[];
  players: Record<string, Player>;
  displayRelease: TriState;
  displayCollect: TriState;
  displayHint: number;
  eliteOrb: OrbDef | null;
  edgeOrb: OrbDef | null;
  orbState: Record<string, OrbAcquisition>;
}

export default function TileDetails({
  tile, player, user, advEntries, players,
  displayRelease, displayCollect, displayHint,
  eliteOrb, edgeOrb, orbState,
}: Props) {
  const tileOwnerIds = [...new Set(advEntries.map(e => e.owner))];
  const userInTile   = !!user && tileOwnerIds.includes(user.id);
  const seekerReduce = calcSeekerHintReduction(tileOwnerIds, players);
  const adjustedHint = Math.max(1, displayHint - seekerReduce);
  const seekerTip    = buildSeekerHintTooltip(seekerReduce);
  const xpTip        = userInTile ? buildXpBonusTooltip(user!.id,  tileOwnerIds, players) : null;
  const goldTip      = userInTile ? buildGoldBonusTooltip(user!.id, tileOwnerIds, players) : null;
  const { xpMultiplier, goldMultiplier } = userInTile
    ? calcFeatBonuses(user!.id, tileOwnerIds, players)
    : { xpMultiplier: 1, goldMultiplier: 1 };
  const adjXp   = Math.round((tile.xp   ?? 0) * xpMultiplier);
  const adjGold = Math.round((tile.gold ?? 0) * goldMultiplier);
  const inv     = player?.inventory ?? {};

  return (
    <>
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

      {eliteOrb && (
        <div className="lb-orb-reward" style={{ borderColor: eliteOrb.color }}>
          <span style={{ fontSize: '1.4rem' }}>{eliteOrb.icon}</span>
          <span>
            {orbState[eliteOrb.id]
              ? `${eliteOrb.label} Orb already gathered`
              : <>Drops: <strong>{eliteOrb.label} Orb</strong> upon defeat</>}
          </span>
        </div>
      )}

      {edgeOrb && orbState[edgeOrb.id] && (
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
              const value    = tile.traits![def.id].value;
              const effect   = traitEffect(def.id, value, inv);
              const negated  = effect.kind === 'negated';
              const modified = effect.kind === 'modified';
              const parts    = def.description.split('{value}');
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
    </>
  );
}
