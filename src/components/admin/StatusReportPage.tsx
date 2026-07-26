import { useEffect, useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { missionDisplayLabel } from '../../lib/missionLogic';
import { computeStatusReport, type ReportCandidate, type ReportPlayerFinding } from '../../lib/statusReport';

// ── One candidate (mission or challenge) card ────────────────────────────────

function PlayerBlock({ player }: { player: ReportPlayerFinding }) {
  return (
    <div className="sr-player">
      <div className="sr-player-handle">{player.handle}</div>
      <ul className="sr-slot-list">
        {player.findings.map((f, i) => (
          <li key={i} className={`sr-slot sr-slot-${f.tier}`}>
            <span className={`sr-badge sr-badge-${f.tier}`} title={f.tier === 'problem' ? 'Problem' : 'Warning'}>
              {f.tier === 'problem' ? '⛔' : '⚠'}
            </span>
            <span className="sr-slot-body">
              <span className="sr-slot-name">
                {f.slotName}<span className="sr-slot-game"> · {f.game}</span>
              </span>
              <span className="sr-slot-reasons">{f.reasons.join(' · ')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateCard({ c }: { c: ReportCandidate }) {
  const problems = c.players.reduce((n, p) => n + p.findings.filter(f => f.tier === 'problem').length, 0);
  const warnings = c.players.reduce((n, p) => n + p.findings.filter(f => f.tier === 'warning').length, 0);
  return (
    <div className="dash-tile-card sr-card">
      <div className="sr-card-header">
        <span className="sr-card-kind" title={c.kind === 'mission' ? 'Mission' : 'Challenge'}>
          {c.kind === 'mission' ? '⚜' : '⚔'}
        </span>
        <span className="dash-tile-name">{c.name}</span>
        <span className="sr-card-counts">
          {problems > 0 && <span className="sr-count sr-count-problem">{problems}⛔</span>}
          {warnings > 0 && <span className="sr-count sr-count-warning">{warnings}⚠</span>}
        </span>
      </div>
      {c.players.map(p => <PlayerBlock key={p.playerId} player={p} />)}
    </div>
  );
}

// ── Collapsible section (Too Early / Recently Reported) ──────────────────────

function CollapsibleSection({ title, list, defaultOpen = false }: {
  title: string; list: ReportCandidate[]; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sr-section">
      <div className="casino-log-toggle" onClick={() => setOpen(o => !o)}>
        <span>{title} ({list.length})</span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        list.length === 0
          ? <div className="dash-empty">None.</div>
          : list.map(c => <CandidateCard key={`${c.kind}-${c.id}`} c={c} />)
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StatusReportPage() {
  const { gameState } = useGameState();
  // Thresholds are in hours, but a live clock keeps the buckets honest across a long
  // session without a manual refresh; once a minute is ample.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const candidates = computeStatusReport(
    gameState?.missions ?? {},
    gameState?.tiles ?? {},
    gameState?.players ?? {},
    now,
    missionDisplayLabel,
  );

  const active           = candidates.filter(c => c.bucket === 'active');
  const tooEarly         = candidates.filter(c => c.bucket === 'tooEarly');
  const recentlyReported = candidates.filter(c => c.bucket === 'recentlyReported');

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">📋 Status Report</h2>

      <div className="sr-legend">
        <span><span className="sr-badge sr-badge-problem">⛔</span> Problem</span>
        <span><span className="sr-badge sr-badge-warning">⚠</span> Warning</span>
      </div>

      {active.length === 0
        ? <div className="dash-empty">No active report candidates — every in-progress mission and challenge is healthy.</div>
        : active.map(c => <CandidateCard key={`${c.kind}-${c.id}`} c={c} />)}

      <CollapsibleSection title="Too Early" list={tooEarly} />
      <CollapsibleSection title="Recently Reported" list={recentlyReported} />
    </div>
  );
}
