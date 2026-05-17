import { ALL_ORBS } from '../../lib/constants';
import type { OrbAcquisition, OrbConfig } from '../../types';

interface Props {
  bossLocked: boolean;
  orbState: Record<string, OrbAcquisition>;
  orbConfig: OrbConfig | undefined;
  minOrbs: number;
  orbCount: number;
}

export default function BossSection({ bossLocked, orbState, orbConfig, minOrbs, orbCount }: Props) {
  return (
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
  );
}
