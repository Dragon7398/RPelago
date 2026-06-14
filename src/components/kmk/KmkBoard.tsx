import { useState } from 'react';
import { useKmk } from '../../contexts/KmkContext';
import { useAuth } from '../../contexts/AuthContext';
import type { KmkArea, KmkStatus } from '../../types';

const STATUS_LABELS: Record<KmkStatus, string> = {
  Incomplete: 'Available',
  Pending:    'In Progress',
  Verifying:  'Awaiting Review',
  Complete:   'Complete',
};

function StatusBadge({ status }: { status: KmkStatus }) {
  return (
    <span className={`kmk-board-badge kmk-board-badge-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TrialCard({
  listId, areaId, taskId, task, userId, areaFull,
}: {
  listId:   string;
  areaId:   string;
  taskId:   string;
  task:     { trial: string; desc: string; status: KmkStatus; playerId?: string | null; playerName?: string | null };
  userId:   string | null;
  areaFull: boolean;
}) {
  const { playerClaimTrial, playerMarkDone, playerResume, playerAbandon } = useKmk();
  const [busy, setBusy] = useState(false);
  const isOwner = !!userId && userId === task.playerId;
  const claimed = !!task.playerId;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="kmk-board-trial">
      <div className={`kmk-board-trial-accent kmk-s-${task.status}`} />
      <div className="kmk-board-trial-body">
        <div className="kmk-board-trial-name">{task.trial}</div>
        <div className="kmk-board-trial-desc">{task.desc}</div>
        <div className="kmk-board-trial-footer">
          <div className="kmk-board-trial-meta">
            <StatusBadge status={task.status} />
            {claimed && (
              <span className="kmk-board-claimer">👤 {task.playerName ?? 'Unknown'}</span>
            )}
          </div>
          {userId && (
            <div className="kmk-board-actions">
              {task.status === 'Incomplete' && (
                areaFull
                  ? <span className="kmk-board-chip-limit">1 per area</span>
                  : <button
                      className="kmk-board-btn kmk-board-btn-claim"
                      disabled={busy}
                      onClick={() => act(() => playerClaimTrial(listId, areaId, taskId))}
                    >
                      {busy ? '…' : 'Claim'}
                    </button>
              )}
              {task.status === 'Pending' && isOwner && (
                <>
                  <button
                    className="kmk-board-btn kmk-board-btn-done"
                    disabled={busy}
                    onClick={() => act(() => playerMarkDone(listId, areaId, taskId))}
                  >
                    {busy ? '…' : 'Mark Done'}
                  </button>
                  <button
                    className="kmk-board-btn kmk-board-btn-abandon"
                    disabled={busy}
                    onClick={() => act(() => playerAbandon(listId, areaId, taskId))}
                  >
                    {busy ? '…' : 'Abandon'}
                  </button>
                </>
              )}
              {task.status === 'Verifying' && isOwner && (
                <>
                  <button
                    className="kmk-board-btn kmk-board-btn-resume"
                    disabled={busy}
                    onClick={() => act(() => playerResume(listId, areaId, taskId))}
                  >
                    {busy ? '…' : 'Resume'}
                  </button>
                  <button
                    className="kmk-board-btn kmk-board-btn-abandon"
                    disabled={busy}
                    onClick={() => act(() => playerAbandon(listId, areaId, taskId))}
                  >
                    {busy ? '…' : 'Abandon'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AreaPanel({
  listId, areaId, area, userId,
}: {
  listId: string;
  areaId: string;
  area:   KmkArea;
  userId: string | null;
}) {
  const [completedOpen, setCompletedOpen] = useState(false);

  const sortedTasks   = Object.entries(area.tasks ?? {}).sort(([, a], [, b]) => a.order - b.order);
  const activeTasks   = sortedTasks.filter(([, t]) => t.status !== 'Complete');
  const completeTasks = sortedTasks.filter(([, t]) => t.status === 'Complete');
  const areaFull      = !!userId && sortedTasks.some(
    ([, t]) => t.playerId === userId && (t.status === 'Pending' || t.status === 'Verifying'),
  );

  if (area.locked) {
    return (
      <div className="kmk-board-area-sealed">
        <span className="kmk-board-sealed-icon">🔒</span>
        <span className="kmk-board-sealed-name">{area.name}</span>
        <span className="kmk-board-sealed-sub">Area sealed</span>
      </div>
    );
  }

  return (
    <div className="kmk-board-area">
      <div className="kmk-board-area-header">
        <div className="kmk-board-area-name">{area.name}</div>
        <div className="kmk-board-area-count">
          {completeTasks.length}/{sortedTasks.length}
        </div>
      </div>

      {activeTasks.length > 0 && (
        <div className="kmk-board-trials">
          {activeTasks.map(([taskId, task]) => (
            <TrialCard
              key={taskId}
              listId={listId}
              areaId={areaId}
              taskId={taskId}
              task={task}
              userId={userId}
              areaFull={areaFull}
            />
          ))}
        </div>
      )}

      {completeTasks.length > 0 && (
        <>
          <button
            className="kmk-board-completed-toggle"
            onClick={() => setCompletedOpen(o => !o)}
          >
            {completedOpen ? '▾' : '▸'} Completed ({completeTasks.length})
          </button>
          {completedOpen && (
            <div className="kmk-board-completed-list">
              {completeTasks.map(([taskId, task]) => (
                <div key={taskId} className="kmk-board-completed-row">
                  <span className="kmk-board-completed-check">✓</span>
                  <span className="kmk-board-completed-trial">{task.trial}</span>
                  {task.desc && (
                    <span className="kmk-board-completed-desc">{task.desc}</span>
                  )}
                  {task.playerName && (
                    <span className="kmk-board-completed-claimer">👤 {task.playerName}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {sortedTasks.length === 0 && (
        <div className="kmk-board-empty">No trials in this area.</div>
      )}
    </div>
  );
}

interface Props { listId: string; }

export default function KmkBoard({ listId }: Props) {
  const { lists, loading } = useKmk();
  const { user } = useAuth();

  if (loading) {
    return (
      <div className="kmk-board-loading">
        <div className="loading-emblem">🗝</div>
        <div className="loading-title">KEYMASTER'S KEEP</div>
        <div className="loading-subtitle">Loading trials…</div>
      </div>
    );
  }

  const list = lists[listId];
  if (!list) {
    return (
      <div className="kmk-board-notfound">
        <div className="kmk-board-notfound-icon">🗝</div>
        <div className="kmk-board-notfound-msg">Keep not found.</div>
        <a className="kmk-board-notfound-link" href="/">Return to map</a>
      </div>
    );
  }

  const sortedAreas = Object.entries(list.areas ?? {}).sort(([, a], [, b]) => a.order - b.order);

  return (
    <div className="kmk-board">
      <header className="kmk-board-header">
        <div className="kmk-board-header-left">
          <div className="kmk-board-eyebrow">🗝 Keymaster's Keep</div>
          <div className="kmk-board-list-name">{list.name}</div>
        </div>
        <a className="kmk-board-home-link" href="/">↩ Map</a>
      </header>

      {!user && (
        <div className="kmk-board-login-prompt">
          <span className="kmk-board-login-msg">Sign in to claim trials and track your progress.</span>
          <a className="kmk-board-login-link" href="/">Sign in</a>
        </div>
      )}

      <div className="kmk-board-areas">
        {sortedAreas.map(([areaId, area]) => (
          <AreaPanel
            key={areaId}
            listId={listId}
            areaId={areaId}
            area={area}
            userId={user?.id ?? null}
          />
        ))}
      </div>
    </div>
  );
}
