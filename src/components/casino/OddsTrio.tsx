import type { CasinoStats } from '../../types';

// Release/Collect are the CHANCE each rolls On at deploy; Hint is the cost.
// Rolled per table at creation and shifted live by gambits, so they're the main
// thing that distinguishes one table from another — hues match the card table's
// ChallengePanel (release 200 · collect 295 · hint 30).
const ODDS: { key: 'release' | 'collect' | 'hint'; label: string; hue: number }[] = [
  { key: 'release', label: 'Release', hue: 200 },
  { key: 'collect', label: 'Collect', hue: 295 },
  { key: 'hint',    label: 'Hint',    hue: 30  },
];

/**
 * The rolled odds table, shown identically on a table card and in the phase panel.
 *
 * `open` is the table's OPENING roll (`mission.casinoOpenStats`). When present,
 * each value carries its gambit-driven drift from that opening roll (+N / −N) —
 * the same drift the card table's ChallengePanel shows. A drift of 0 renders
 * nothing (fresh tables stay clean); tables opened before `casinoOpenStats`
 * existed pass no `open` and simply show the values.
 */
export default function OddsTrio({ stats, open }: { stats: CasinoStats; open?: CasinoStats | null }) {
  return (
    <div className="rl-odds">
      {ODDS.map(o => {
        const v    = stats[o.key];
        const diff = open ? Math.round((v - (open[o.key] as number)) * 10) / 10 : 0;
        return (
          <div className="rl-odd" key={o.key} style={{ '--oh': o.hue } as React.CSSProperties}>
            <span className="rl-odd-lbl">{o.label}</span>
            <span className="rl-odd-val">
              {v}<small>%</small>
              {diff !== 0 && (
                <span className={`rl-odd-diff ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '+' : '−'}{Math.abs(diff)}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
