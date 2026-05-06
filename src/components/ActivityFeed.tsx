import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ActivityFeed() {
  const { activityLog } = useGameState();
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('realm_feed_collapsed') === 'true'
  );

  const toggle = () => setCollapsed(c => {
    localStorage.setItem('realm_feed_collapsed', String(!c));
    return !c;
  });

  return (
    <div className={`activity-feed${collapsed ? ' activity-feed-collapsed' : ''}`}>
      <div className="activity-feed-title" onClick={toggle}>
        <span>RECENT ACTIVITY</span>
        <span className="activity-feed-title-right">
          <span className="orb-bar-chevron">{collapsed ? '▸' : '▾'}</span>
        </span>
      </div>
      {!collapsed && (
        <div className="activity-feed-list">
          {activityLog.length === 0 ? (
            <div className="activity-feed-empty">No activity yet.</div>
          ) : (
            activityLog.map(entry => (
              <div key={entry.id} className="activity-entry">
                <span className="activity-icon">{entry.icon}</span>
                <span className="activity-message">{entry.message}</span>
                <span className="activity-time">{timeAgo(entry.timestamp)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
