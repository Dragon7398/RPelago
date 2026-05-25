import { useState } from 'react';
import { useGameState } from '../contexts/GameStateContext';

const COLLAPSED_KEY   = 'realm_feed_collapsed';
const LAST_VIEWED_KEY = 'realm_feed_last_viewed';

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
    localStorage.getItem(COLLAPSED_KEY) === 'true'
  );
  const [lastViewedAt, setLastViewedAt] = useState<number>(() =>
    Number(localStorage.getItem(LAST_VIEWED_KEY) ?? 0)
  );

  const newCount = activityLog.filter(e => e.timestamp > lastViewedAt).length;

  const toggle = () => setCollapsed(c => {
    const next = !c;
    localStorage.setItem(COLLAPSED_KEY, String(next));
    if (next) {
      // Collapsing — everything currently visible is now "seen"
      const now = Date.now();
      localStorage.setItem(LAST_VIEWED_KEY, String(now));
      setLastViewedAt(now);
    }
    return next;
  });

  return (
    <div className={`activity-feed${collapsed ? ' activity-feed-collapsed' : ''}`}>
      <div className="activity-feed-title" onClick={toggle}>
        <span>RECENT ACTIVITY</span>
        <span className="activity-feed-title-right">
          {collapsed && newCount > 0 && (
            <span className="activity-feed-new-badge">{newCount} new</span>
          )}
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
