import { useEffect, useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { missionDisplayLabel } from '../../lib/missionLogic';
import {
  computeStatusReport, buildOfficialReport, renderProblemsMarkdown, renderWarningsMarkdown, warnItemText,
  type ReportCandidate, type ReportPlayerFinding,
} from '../../lib/statusReport';
import { runOfficialStatusReport, markStatusWarningHandled } from '../../firebase/db';
import type { OfficialReport, OfficialWarnWorld } from '../../types';

const HOUR = 3_600_000;
const RECENT_RUN_HOURS = 36;

// RTDB may hand arrays back as objects with numeric keys; normalize to an array.
const arr = <T,>(v: T[] | Record<string, T> | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : Object.values(v);

// ── Live report: one candidate card (unchanged from the live view) ───────────

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

// ── Official report view (copy blocks + handled toggles) ─────────────────────

function CopyButton({ label, text }: { label: string; text: string }) {
  const { addToast } = useToast();
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => addToast(`${label} copied.`, 'success'))
      .catch(() => addToast('Copy failed.', 'error'));
  };
  return (
    <button className="dash-action-btn" disabled={!text} onClick={copy}>⧉ Copy {label}</button>
  );
}

function WarnWorldRow({ reportId, reportTs, index, world }: { reportId: string; reportTs: number; index: number; world: OfficialWarnWorld }) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const items = arr(world.items);
  const handle = async () => {
    setBusy(true);
    try {
      // Resets this world's timer to the report's own ts (guarded server-side
      // against moving a newer lastReportAt backward).
      await markStatusWarningHandled(reportId, index, { kind: world.kind, id: world.id }, reportTs);
      addToast('Warning marked handled.', 'success');
    } catch (e) {
      addToast(`Could not mark handled: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="sr-warn-world">
      <div className="sr-warn-world-head">
        <span className="sr-warn-world-name">{world.name}</span>
        <button
          className={`sr-handled-btn${world.handled ? ' done' : ''}`}
          disabled={busy || world.handled}
          onClick={handle}
          title={world.handled ? 'Handled' : 'Mark this warning handled (resets its timer)'}
        >{world.handled ? '✓ handled' : 'mark handled'}</button>
      </div>
      <ul className="sr-warn-item-list">
        {items.map((it, i) => <li key={i}>{warnItemText(it)}</li>)}
      </ul>
    </div>
  );
}

function OfficialReportView({ reportId, report }: { reportId: string; report: OfficialReport }) {
  const problemsMd = renderProblemsMarkdown(report);
  const warningsMd = renderWarningsMarkdown(report);
  const warns = arr(report.warnings);

  return (
    <div className="sr-report">
      {/* Problems — player-facing */}
      <div className="sr-report-block">
        <div className="sr-report-block-head">
          <span>Problems</span>
          <CopyButton label="Problems" text={problemsMd} />
        </div>
        {problemsMd
          ? <pre className="sr-md">{problemsMd}</pre>
          : <div className="dash-empty">No problems in this report.</div>}
      </div>

      {/* Warnings — admin-facing, handled manually */}
      <div className="sr-report-block">
        <div className="sr-report-block-head">
          <span>Warnings (handled manually)</span>
          <CopyButton label="Warnings" text={warningsMd} />
        </div>
        {warns.length === 0
          ? <div className="dash-empty">No warnings in this report.</div>
          : warns.map((w, i) => (
              <WarnWorldRow key={`${w.kind}-${w.id}`} reportId={reportId} reportTs={report.ts} index={i} world={w} />
            ))}
      </div>
    </div>
  );
}

function StoredReportRow({ reportId, report }: { reportId: string; report: OfficialReport }) {
  const [open, setOpen] = useState(false);
  const when = new Date(report.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const pCount = arr(report.problems).length;
  const wCount = arr(report.warnings).length;
  return (
    <div className="sr-stored">
      <div className="casino-log-toggle" onClick={() => setOpen(o => !o)}>
        <span>{when} · {pCount} problem world{pCount === 1 ? '' : 's'} · {wCount} warning world{wCount === 1 ? '' : 's'}</span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && <OfficialReportView reportId={reportId} report={report} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StatusReportPage() {
  const { gameState } = useGameState();
  const { addToast } = useToast();
  const uid = useAuth().user?.id;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

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

  const reports = Object.entries(gameState?.statusReports ?? {})
    .sort((a, b) => b[1].ts - a[1].ts);
  const latest = reports[0];
  const lastRunAgoH = latest ? (now - latest[1].ts) / HOUR : Infinity;
  const ranRecently = lastRunAgoH < RECENT_RUN_HOURS;

  const doRun = async () => {
    setRunning(true);
    try {
      await runOfficialStatusReport(buildOfficialReport(active, Date.now(), uid));
      addToast('Official report generated.', 'success');
    } catch (e) {
      addToast(`Could not run report: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  };

  const onRunClick = () => {
    if (ranRecently) { setConfirming(true); return; }
    doRun();
  };

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">📋 Status Report</h2>

      {/* Run bar */}
      <div className="sr-run-bar">
        <button
          className="dash-action-btn primary"
          disabled={active.length === 0 || running}
          onClick={onRunClick}
          title={active.length === 0 ? 'No active report candidates to report on' : 'Run an official status report'}
        >{running ? 'Running…' : '▶ Run Official Report'}</button>
        <span className="sr-legend">
          <span><span className="sr-badge sr-badge-problem">⛔</span> Problem</span>
          <span><span className="sr-badge sr-badge-warning">⚠</span> Warning</span>
        </span>
      </div>

      {confirming && (
        <div className="sr-confirm">
          <span>Last official report was {Math.floor(lastRunAgoH)}h ago (under {RECENT_RUN_HOURS}h). Run another?</span>
          <button className="dash-action-btn danger" disabled={running} onClick={doRun}>Run anyway</button>
          <button className="dash-action-btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}

      {/* Latest official report */}
      {latest && (
        <div className="sr-report-card">
          <div className="sr-report-card-title">
            Latest Official Report · {new Date(latest[1].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
          <OfficialReportView reportId={latest[0]} report={latest[1]} />
        </div>
      )}

      {/* Live candidates */}
      <h3 className="sr-subhead">Live Candidates</h3>
      {active.length === 0
        ? <div className="dash-empty">No active report candidates — every in-progress mission and challenge is healthy.</div>
        : active.map(c => <CandidateCard key={`${c.kind}-${c.id}`} c={c} />)}

      <CollapsibleSection title="Too Early" list={tooEarly} />
      <CollapsibleSection title="Recently Reported" list={recentlyReported} />

      {/* Recent reports archive — the full last-10, newest first (includes the one
          shown above, so reviewing always works even after a single run). */}
      <div className="sr-section">
        <div className="casino-log-toggle" onClick={() => setReviewOpen(o => !o)}>
          <span>Recent Reports (last 10) ({reports.length})</span>
          <span>{reviewOpen ? '▾' : '▸'}</span>
        </div>
        {reviewOpen && (
          reports.length === 0
            ? <div className="dash-empty">No reports run yet.</div>
            : reports.map(([id, r]) => <StoredReportRow key={id} reportId={id} report={r} />)
        )}
      </div>
    </div>
  );
}
