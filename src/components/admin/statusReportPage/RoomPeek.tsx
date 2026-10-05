// The Report tab's room peek: everything the host needs to judge a flagged world
// without leaving the page for Cheesetracker and matching slot names by eye.
//
// Two data sources, deliberately different. The room-pace samples ride along in
// `gameState` (they are small and every card's badge needs them), so the health
// strip paints immediately. The per-slot history lives in the top-level
// `roomTelemetry/` tree — it is several times the size and serves one world at a
// time, so it is NOT streamed to every player and is fetched on first open.

import { useEffect, useState } from 'react';
import { useGameState } from '../../../contexts/GameStateContext';
import { fetchRoomTelemetry } from '../../../firebase/db';
import { apSlotKey, claimEntries } from '../../../lib/slotHelpers';
import {
  roomHealth, roomDailySeries, slotDailySeries, worldSlotReport,
  missionScope, tileScope, roomHealthText, fmtDuration,
  ROOM_WINDOW_HOURS, ROOM_CAUTION_PCT, ROOM_DANGER_PCT,
  type SlotProgressSamples, type DayBucket, type WorldSlot, type RoomHealth,
} from '../../../lib/statusReport';
import type { GMMission, Tile, AdvSlot, RoomProgressSample } from '../../../types';

const HOUR = 3_600_000;

/** Relative age, or the honest "never" — a missing stamp is unknown, not zero. */
const ago = (ts: number | null | undefined, now: number): string =>
  ts == null ? 'never' : fmtDuration((now - ts) / HOUR);

const pct1 = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
const signed = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString()}`;

// ── Daily bars ───────────────────────────────────────────────────────────────
// Scaled to the series' own busiest day so a quiet room still shows its shape.
// A `null` bucket is a GAP (nothing sampled to bracket that day) and is drawn as
// a hollow tick, never as a zero-height bar that would read as "no progress".
function Bars({ days, title }: { days: DayBucket[]; title: (d: DayBucket) => string }) {
  const peak = Math.max(1, ...days.map(d => d.gained ?? 0));
  return (
    <div className="sr-peek-bars">
      {days.map(d => (
        <span
          key={d.dayStart}
          className={`sr-peek-bar${d.gained == null ? ' gap' : d.gained === 0 ? ' zero' : ''}`}
          style={d.gained == null ? undefined : { height: `${Math.max(6, (d.gained / peak) * 100)}%` }}
          title={title(d)}
        />
      ))}
    </div>
  );
}

const dayTitle = (d: DayBucket, unit: string): string => {
  const when = new Date(d.dayStart).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (d.gained == null) return `${when} — no samples to measure this day`;
  return `${when} — ${signed(d.gained)} ${unit}${d.pct == null ? '' : ` (${pct1(d.pct)})`}`;
};

// ── Room health ──────────────────────────────────────────────────────────────

function HealthStrip({ progress, now, room, showRoom }: {
  progress: Record<string, RoomProgressSample> | undefined;
  now: number; room: 1 | 2; showRoom: boolean;
}) {
  const h: RoomHealth | null = roomHealth(progress, now, room);
  const days = roomDailySeries(progress, now, 14);

  // No verdict yet is a real state, not an empty one: a room under 72h old has no
  // baseline to judge against and must not be drawn as a dead one.
  if (!h) {
    return (
      <div className="sr-peek-health">
        <div className="sr-peek-health-none">
          {showRoom && <strong>Room {room}: </strong>}
          Not enough history yet — a verdict needs a baseline {ROOM_WINDOW_HOURS}h old.
        </div>
        <Bars days={days} title={d => dayTitle(d, 'checks')} />
      </div>
    );
  }

  return (
    <div className={`sr-peek-health${h.tier ? ` sr-peek-health-${h.tier}` : ''}`}>
      <div className="sr-peek-health-figure">
        <span className="sr-peek-pct">{pct1(h.pct)}</span>
        <span className="sr-peek-clear">clear{showRoom ? ` · room ${room}` : ''}</span>
        <span className="sr-peek-counts">
          {h.done.toLocaleString()} / {h.total.toLocaleString()} — <strong>{h.remaining.toLocaleString()} remain</strong>
        </span>
        {h.tier && (
          <span className={`sr-peek-tier sr-peek-tier-${h.tier}`}>
            {h.tier === 'danger' ? '⛔ DANGER' : '⚠ CAUTION'}
          </span>
        )}
      </div>
      <div className="sr-peek-chart">
        <div className="sr-peek-chart-head">
          <span>SHARE OF THE ROOM FOUND, PER DAY</span>
          <span className="sr-peek-dim">
            under {ROOM_CAUTION_PCT}% / {ROOM_WINDOW_HOURS}h is caution, under {ROOM_DANGER_PCT}% is danger
          </span>
        </div>
        <Bars days={days} title={d => dayTitle(d, 'checks')} />
      </div>
      <div className="sr-peek-health-text">{roomHealthText(h, showRoom)}</div>
    </div>
  );
}

// ── One slot row ─────────────────────────────────────────────────────────────

// Why a row has no bars. These are four different facts and the row must not
// blame the slot for any of the first three: "no tracker match" is an accusation
// that this slot's name matches nothing the room generated, and saying it while
// the tree is merely empty sends the host hunting a bug that isn't there.
export type TelemetryState = 'loading' | 'failed' | 'empty' | 'ready';

const NO_SERIES: Record<TelemetryState, string> = {
  loading: 'loading…',
  failed:  'history unavailable',
  empty:   'no samples yet',
  ready:   'no tracker match',
};

function SlotRow({ ws, telemetry, state, incidents, now }: {
  ws: WorldSlot; telemetry: SlotProgressSamples; state: TelemetryState;
  incidents: number; now: number;
}) {
  const { slot, finding } = ws;
  const series = state === 'ready'
    ? slotDailySeries(telemetry, apSlotKey(slot.name || ''), now, 7)
    : null;
  const tier = finding?.tier ?? (ws.rank === 3 ? 'done' : 'ok');

  return (
    <div className={`sr-peek-row sr-peek-row-${tier}`}>
      <div className="sr-peek-id">
        <span className="sr-peek-handle">{ws.handle ?? 'public slot'}</span>
        <span className="sr-peek-slotname">{slot.name || '(unnamed)'}</span>
        <span className="sr-peek-game">{slot.game || '—'}</span>
        <span className="sr-peek-status">{slot.status ?? 'Unstarted'}</span>
        {incidents > 0 && (
          <span className="sr-peek-incidents" title="Official reports where this player had a Problem on this world">
            {incidents} incident{incidents === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* The next three cells render even when empty. Dropping them would give
          rows different child counts, and the grid columns would stop lining up
          the moment one slot had history and another did not. */}
      <div className="sr-peek-progress">
        {series
          ? (
            <>
              <div className="sr-peek-progress-nums">
                <span>{series.total > 0 ? pct1((series.done / series.total) * 100) : '—'}</span>
                <span className="sr-peek-dim">{series.done.toLocaleString()} / {series.total.toLocaleString()}</span>
              </div>
              <div className="sr-peek-track">
                <div
                  className="sr-peek-fill"
                  style={{ width: series.total > 0 ? `${(series.done / series.total) * 100}%` : '0%' }}
                />
              </div>
            </>
          )
          : <span className="sr-peek-nodata">{NO_SERIES[state]}</span>}
      </div>

      <div className="sr-peek-barcell">
        {series && <Bars days={series.days} title={d => dayTitle(d, 'checks')} />}
      </div>

      <span className="sr-peek-delta">
        {series ? (series.gained == null ? '—' : `${signed(series.gained)} / 7d`) : ''}
      </span>

      <div className="sr-peek-meta">
        <div className="sr-peek-timers">
          {/* lastActivity is the STRONG signal; the other two are self-reports and
              are styled flat so the row never implies they carry equal weight. */}
          <span className={slot.lastActivity != null && now - slot.lastActivity >= 144 * HOUR ? 'strong stale' : 'strong'}>
            <span className="sr-peek-dim">activity</span> {ago(slot.lastActivity, now)}
          </span>
          <span><span className="sr-peek-dim">checked</span> {ago(slot.lastChecked, now)}</span>
          <span><span className="sr-peek-dim">reported</span> {ago(slot.lastReported, now)}</span>
        </div>
        <div className="sr-peek-why">
          {slot.note
            ? <span className="sr-peek-note">&ldquo;{slot.note.text}&rdquo;</span>
            : <span className="sr-peek-nonote">no note</span>}
          {/* Every code that fired, not just the winning tier — a problem outranks
              a warning in the report, so `lastChecker` never reaches the ping even
              when it is the most useful thing on the row. */}
          {finding?.codes.map((code, i) => (
            <span key={code} className={`sr-peek-code sr-peek-code-${finding.tier}`} title={finding.reasons[i]}>
              {code}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

export default function RoomPeek({ kind, id, now, showOpenSlots = true }: {
  kind: 'mission' | 'tile'; id: string; now: number;
  /** The admin Missions card already carries its own OPEN SLOTS panel, with the
   *  ⊘ release control this read-only one lacks — two headers on one card is
   *  noise, so that caller turns this half off. */
  showOpenSlots?: boolean;
}) {
  const { gameState } = useGameState();
  const mission: GMMission | undefined = kind === 'mission' ? gameState?.missions?.[id] : undefined;
  const tile: Tile | undefined = kind === 'tile' ? gameState?.tiles?.[id] : undefined;

  // A bifurcated tile is two Archipelago rooms and therefore two of everything.
  const bifurcated = kind === 'tile' && tile?.traits?.['bifurcated'] !== undefined;
  const roomNums: (1 | 2)[] = bifurcated ? [1, 2] : [1];

  const [telemetry, setTelemetry] = useState<Record<number, SlotProgressSamples> | null>(null);
  const [failed, setFailed] = useState(false);

  // Fetched once per open: the card renders `{peek && <RoomPeek …>}`, so closing
  // it unmounts this and reopening starts from the initial state. That is also why
  // the effect needs no reset — there is no stale telemetry to clear.
  useEffect(() => {
    let live = true;
    Promise.all(roomNums.map(r => fetchRoomTelemetry(kind, id, r)))
      .then(res => { if (live) setTelemetry(Object.fromEntries(roomNums.map((r, i) => [r, res[i]]))); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // `roomNums` is derived from the world's traits and is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, bifurcated]);

  if (!mission && !tile) return <div className="sr-peek-empty">This world is no longer live.</div>;

  const players = gameState?.players ?? {};
  const scope = mission ? missionScope(mission) : tileScope(tile!);
  const slots = worldSlotReport(scope, players, now);
  const incidents = (mission ?? tile!).statusIncidents ?? {};
  const open = mission && showOpenSlots ? claimEntries(mission) : [];

  const progressFor = (room: 1 | 2): Record<string, RoomProgressSample> | undefined =>
    mission ? mission.roomProgress : (room === 1 ? tile!.roomProgress : tile!.roomProgress2);

  return (
    <div className="sr-peek">
      {roomNums.map(room => {
        const here    = bifurcated ? slots.filter(s => s.room === room) : slots;
        const samples = telemetry?.[room] ?? {};
        const state: TelemetryState =
          failed            ? 'failed'
          : telemetry == null ? 'loading'
          : Object.keys(samples).length === 0 ? 'empty'
          : 'ready';
        return (
          <div key={room} className="sr-peek-room">
            <HealthStrip progress={progressFor(room)} now={now} room={room} showRoom={bifurcated} />

            <div className="sr-peek-slots-head">
              <span>SLOTS · {here.length}</span>
              <span className="sr-peek-dim">
                worst first · bars are checks found per day, scaled to each slot
                {state === 'empty' && ' · nothing sampled for this room yet'}
                {state === 'failed' && ' · per-slot history could not be loaded'}
              </span>
            </div>
            {here.map((ws, i) => (
              <SlotRow
                key={`${ws.ownerId ?? 'public'}:${ws.slot.name}:${i}`}
                ws={ws}
                telemetry={samples}
                state={state}
                incidents={ws.ownerId ? incidents[ws.ownerId] ?? 0 : 0}
                now={now}
              />
            ))}
          </div>
        );
      })}

      {open.length > 0 && (
        <div className="sr-peek-open">
          <div className="sr-peek-open-head">
            <span>OPEN SLOTS · {open.length}</span>
            <span className="sr-peek-dim">
              vacated by a kick and unclaimed — live Archipelago slots with no player, holding the table open
            </span>
          </div>
          {open.flatMap(([key, entry]) =>
            entry.slots.map((s: AdvSlot, i: number) => (
              <div key={`${key}:${i}`} className="sr-peek-open-row">
                <span className="sr-peek-slotname">{s.name || '(unnamed)'}</span>
                <span className="sr-peek-game">{s.game || '—'}</span>
                <span className="sr-peek-status">{s.status ?? 'Unstarted'}</span>
                <span className="sr-peek-dim">activity {ago(s.lastActivity, now)}</span>
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}
