import { useState } from 'react';
import type { KmkList, KmkArea, KmkTask, KmkStatus } from '../../../types';
import { useKmk } from '../../../contexts/KmkContext';

const ALL_STATUSES: KmkStatus[] = ['Incomplete', 'Pending', 'Verifying', 'Complete'];

// ── Progress meter ────────────────────────────────────────────────────────────

function KmkMeter({ tasks }: { tasks: { status: KmkStatus }[] }) {
  return (
    <div className="kmk-meter">
      {tasks.map((t, i) => (
        <div key={i} className={`kmk-seg kmk-s-${t.status}`} title={t.status} />
      ))}
    </div>
  );
}

// ── Area card ─────────────────────────────────────────────────────────────────

function KmkAreaCard({
  listId, areaId, area,
}: {
  listId: string; areaId: string; area: KmkArea;
}) {
  const { setAreaLocked, adminSetTaskStatus, adminEditTaskPlayer } = useKmk();
  const [completedOpen, setCompletedOpen] = useState(false);

  const sortedTasks = Object.entries(area.tasks ?? {})
    .sort(([, a], [, b]) => a.order - b.order);

  const activeTasks   = sortedTasks.filter(([, t]) => t.status !== 'Complete');
  const completeTasks = sortedTasks.filter(([, t]) => t.status === 'Complete');
  const doneCount     = completeTasks.length;
  const totalCount    = sortedTasks.length;

  const handleStatusChange = (taskId: string, status: KmkStatus) => {
    adminSetTaskStatus(listId, areaId, taskId, status);
  };

  const handlePlayerBlur = (taskId: string, task: KmkTask, newName: string) => {
    const trimmed = newName.trim();
    if (trimmed && trimmed !== task.playerName && task.playerId) {
      adminEditTaskPlayer(listId, areaId, taskId, task.playerId, trimmed);
    }
  };

  return (
    <div className={`kmk-area-card ${area.locked ? '' : 'unlocked'}`}>
      {/* Header row */}
      <div className="kmk-area-header">
        <button
          className="kmk-lock-btn"
          title={area.locked ? 'Unlock area' : 'Lock area'}
          onClick={() => setAreaLocked(listId, areaId, !area.locked)}
        >
          {area.locked ? '🔒' : '🔓'}
        </button>

        <div className="kmk-area-info">
          <div className="kmk-area-name">{area.name}</div>
          <div className="kmk-area-sub">
            {area.locked
              ? 'Locked · tap to unlock'
              : activeTasks.length === 0
                ? 'All trials complete'
                : `${activeTasks.length} remaining`}
          </div>
        </div>

        <div className="kmk-meter-and-count">
          <KmkMeter tasks={sortedTasks.map(([, t]) => t)} />
          <div className={`kmk-count-chip ${doneCount === totalCount && totalCount > 0 ? 'all-done' : ''}`}>
            {doneCount}/{totalCount}
          </div>
        </div>
      </div>

      {/* Expanded content (unlocked) */}
      {!area.locked && (
        <>
          {activeTasks.length > 0 && (
            <>
              <div className="kmk-area-divider" />
              <div className="kmk-tasks">
                {activeTasks.map(([taskId, task]) => (
                  <div key={taskId} className="kmk-task-row">
                    <div className={`kmk-task-accent kmk-s-${task.status}`} />
                    <div className="kmk-task-body">
                      <div className="kmk-task-trial">{task.trial}</div>
                      <div className="kmk-task-desc">{task.desc}</div>
                    </div>
                    <div className="kmk-task-right">
                      {task.playerId && (
                        <div className="kmk-player-row">
                          <span className="kmk-player-icon">👤</span>
                          <input
                            key={`${taskId}-${task.playerName}`}
                            className="kmk-player-input"
                            defaultValue={task.playerName ?? ''}
                            onBlur={e => handlePlayerBlur(taskId, task, e.target.value)}
                          />
                        </div>
                      )}
                      <select
                        className={`kmk-status-select kmk-s-${task.status}`}
                        value={task.status}
                        onChange={e => handleStatusChange(taskId, e.target.value as KmkStatus)}
                      >
                        {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {completeTasks.length > 0 && (
            <>
              <button
                className="kmk-completed-toggle"
                onClick={() => setCompletedOpen(o => !o)}
              >
                {completedOpen ? '▾' : '▸'} Completed ({completeTasks.length})
              </button>
              {completedOpen && (
                <div className="kmk-completed-list">
                  {completeTasks.map(([taskId, task]) => (
                    <div key={taskId} className="kmk-completed-row">
                      <span className="kmk-completed-check">✓</span>
                      <span className="kmk-completed-trial">{task.trial}</span>
                      {task.playerName && (
                        <span className="kmk-completed-player">👤 {task.playerName}</span>
                      )}
                      <div className="kmk-completed-select-wrap">
                        <select
                          className={`kmk-status-select kmk-s-${task.status}`}
                          value={task.status}
                          onChange={e => handleStatusChange(taskId, e.target.value as KmkStatus)}
                        >
                          {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Ledger ────────────────────────────────────────────────────────────────────

interface Props { listId: string; list: KmkList; }

export default function KmkLedger({ listId, list }: Props) {
  const sortedAreas = Object.entries(list.areas ?? {})
    .sort(([, a], [, b]) => (a as KmkArea).order - (b as KmkArea).order);

  const totalTrials   = sortedAreas.reduce((acc, [, a]) => acc + Object.keys((a as KmkArea).tasks ?? {}).length, 0);
  const totalComplete = sortedAreas.reduce((acc, [, a]) => acc + Object.values((a as KmkArea).tasks ?? {}).filter((t: KmkTask) => t.status === 'Complete').length, 0);

  return (
    <div className="dash-section">
      <div className="kmk-ledger-header">
        <div className="kmk-ledger-title">{list.name}</div>
        <div className="kmk-ledger-stats">
          {sortedAreas.length} area{sortedAreas.length !== 1 ? 's' : ''} · {totalTrials} trial{totalTrials !== 1 ? 's' : ''} · {totalComplete} complete
        </div>
      </div>
      <div className="kmk-area-stack">
        {sortedAreas.map(([areaId, area]) => (
          <KmkAreaCard key={areaId} listId={listId} areaId={areaId} area={area as KmkArea} />
        ))}
      </div>
    </div>
  );
}
