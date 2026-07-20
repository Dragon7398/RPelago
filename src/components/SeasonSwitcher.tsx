import { useSeason } from '../contexts/SeasonContext';

/**
 * Admin/alpha season switcher.
 *
 * Lets an admin (or an alpha playtester) view the live season or preview any
 * other — including unlaunched drafts, which are invisible to everyone else.
 * The choice persists (localStorage), because the dashboard opens in its own
 * tab and the shell is chosen from the previewed season, so the selection has
 * to survive navigation and reloads.
 *
 * Renders nothing for normal players.
 */
export default function SeasonSwitcher() {
  const { available, previewingId, previewSeason, config, isAdmin, isAlpha } = useSeason();

  if ((!isAdmin && !isAlpha) || available.length === 0) return null;

  const liveId    = config?.activeSeasonId;
  const liveLabel = (liveId && config?.seasonList?.[liveId]?.label) || liveId || 'Live';

  return (
    <div className="dash-season">
      <label className="dash-season-lbl" htmlFor="dash-season-select">Season</label>
      <select
        id="dash-season-select"
        className="dash-season-select"
        value={previewingId ?? ''}
        onChange={e => previewSeason(e.target.value || null)}
      >
        <option value="">▶ Live — {liveLabel}</option>
        {available
          .filter(s => s.id !== liveId)
          .map(s => <option key={s.id} value={s.id}>{s.label} — {s.status}</option>)}
      </select>
      {previewingId && (
        <button
          className="dash-season-clear"
          title="Stop previewing and return to the live season"
          onClick={() => previewSeason(null)}
        >
          Previewing ✕
        </button>
      )}
    </div>
  );
}
