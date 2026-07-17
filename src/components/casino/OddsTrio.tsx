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

/** The rolled odds table, shown identically on a table card and in the phase panel. */
export default function OddsTrio({ stats }: { stats: CasinoStats }) {
  return (
    <div className="rl-odds">
      {ODDS.map(o => (
        <div className="rl-odd" key={o.key} style={{ '--oh': o.hue } as React.CSSProperties}>
          <span className="rl-odd-lbl">{o.label}</span>
          <span className="rl-odd-val">{stats[o.key]}<small>%</small></span>
        </div>
      ))}
    </div>
  );
}
