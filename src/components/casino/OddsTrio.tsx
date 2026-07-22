import type { CasinoStats } from '../../types';

// Release/Collect are the CHANCE each rolls On at deploy; Hint is the cost.
// Rolled per table at creation and shifted live by gambits, so they're the main
// thing that distinguishes one table from another — hues match the card table's
// ChallengePanel (release 200 · collect 295 · hint 30).
// `betterDown`: this stat improves when it FALLS. Hint is a cost (% of checks
// needed to earn a hint), so a lower number is good — its drift colours invert
// relative to Release/Collect, where a higher chance is good.
const ODDS: { key: 'release' | 'collect' | 'hint'; label: string; hue: number; betterDown?: boolean }[] = [
  { key: 'release', label: 'Release', hue: 200 },
  { key: 'collect', label: 'Collect', hue: 295 },
  { key: 'hint',    label: 'Hint',    hue: 30, betterDown: true },
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
                // `up`/`down` colour by GOOD/bad (green/red), not literal direction;
                // the +/− sign still tracks the actual change. Hint inverts (betterDown).
                <span className={`rl-odd-diff ${(o.betterDown ? diff < 0 : diff > 0) ? 'up' : 'down'}`}>{diff > 0 ? '+' : '−'}{Math.abs(diff)}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
