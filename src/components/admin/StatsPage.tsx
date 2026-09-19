import { useMemo, useState } from 'react';
import { useGameState } from '../../contexts/GameStateContext';
import { CASINO_GAMES, CASINO_GAME_ORDER } from '../../lib/casinoData';
import { normalizeSlots } from '../../lib/slotHelpers';
import { playerStatus } from '../../lib/gameLogic';
import type { AdvSlot, GMMission, TriState } from '../../types';

// ── Mission tallies ───────────────────────────────────────────────────────────
//
// "Complete" missions do not stay in `missions/` — `completeMission` moves them to
// `missionsHistory/` and nulls the live node — so the complete set is essentially
// missionsHistory. The union (deduped by id) is still taken because an admin state
// transition can park a mission at `complete` without archiving it, and counting it
// twice would be worse than counting it once from the wrong node.

interface Tally { live: number; done: number }
type Rows = { key: string; label: string; tally: Tally }[];

const TRI_ORDER: TriState[] = ['on', 'off', 'special'];
const TRI_LABEL: Record<TriState, string> = { on: 'On', off: 'Off', special: 'Special' };

const UNSET = '—unset—';

function tallyBy(live: GMMission[], done: GMMission[], key: (m: GMMission) => string): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  const bump = (m: GMMission, field: keyof Tally) => {
    const k = key(m);
    (out[k] ??= { live: 0, done: 0 })[field]++;
  };
  live.forEach(m => bump(m, 'live'));
  done.forEach(m => bump(m, 'done'));
  return out;
}

// Ordered rows for a fixed row set, plus a trailing "unset/other" row for any key
// outside it (legacy records with no casinoGame, a release that never got rolled).
function buildRows(
  counts: Record<string, Tally>,
  order: readonly string[],
  label: (k: string) => string,
): Rows {
  const rows: Rows = order.map(k => ({ key: k, label: label(k), tally: counts[k] ?? { live: 0, done: 0 } }));
  const extra = Object.keys(counts).filter(k => !order.includes(k));
  for (const k of extra) {
    rows.push({ key: k, label: k === UNSET ? 'Unset' : k, tally: counts[k] });
  }
  return rows;
}

// `foot` overrides the computed footer for tables that show only a slice of their
// data (the Top Games list, which is paged), where summing the visible rows would
// understate. `rankFrom` numbers those rows from their position in the WHOLE list,
// so page 2 reads 21-40 rather than restarting at 1.
// ── Game titles ───────────────────────────────────────────────────────────────
//
// On a casino seat `slot.game` is NOT hand-typed: parseApYaml lifts it verbatim
// from the `game:` field of the player's uploaded config and the manifest rows are
// read-only, so the only thing that ever reaches this field is a string Archipelago
// itself already accepted — and AP requires an exact match against the APworld name
// or the world won't load. Titles are therefore canonical on arrival, and the ONLY
// drift possible is surrounding whitespace and letter case, which is exactly what
// the grouping key folds. No fuzzy matching is wanted here: two titles that differ
// by more than case/whitespace are two different APworlds.
//
// (Non-casino mission slots are admin-entered through the Missions row editor, so
// they are the one input under "All missions" scope that isn't YAML-derived.)
//
// A weighted `game:` block parses to the RANDOMIZED_GAME sentinel and so ranks here
// as a game literally named "Randomized". That is intentional and needs no special
// case: those seats get hand-resolved to a concrete game, exactly as in a
// non-casino season, and the row corrects itself once they are.
//
// Rows are DISPLAYED with the spelling their key saw most often, since the folded
// key itself would render as lowercase mush.
//
// The list is long enough (a season runs well over a hundred distinct APworlds) that
// a single top-N slice hid most of it, so it is paged (PAGE_SIZE) rather than
// truncated.

const foldGame = (raw: string) => raw.trim().replace(/\s+/g, ' ');

interface GameAcc { tally: Tally; spellings: Map<string, number> }

function tallyGames(live: GMMission[], done: GMMission[]) {
  const acc = new Map<string, GameAcc>();
  const totals: Tally = { live: 0, done: 0 };
  // Casino slots are created blank by cardsToSlots and only get a game in the
  // manifest phase, so an unnamed slot is "not chosen yet", not a game called "".
  let unassigned = 0;

  const walk = (missions: GMMission[], field: keyof Tally) => {
    for (const m of missions) {
      for (const p of Object.values(m.participants ?? {})) {
        for (const s of normalizeSlots(p.slots as AdvSlot[] | Record<string, AdvSlot> | undefined)) {
          const name = foldGame(s.game ?? '');
          if (!name) { unassigned++; continue; }
          const entry = acc.get(name.toLowerCase()) ?? { tally: { live: 0, done: 0 }, spellings: new Map() };
          entry.tally[field]++;
          entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
          acc.set(name.toLowerCase(), entry);
          totals[field]++;
        }
      }
    }
  };
  walk(live, 'live');
  walk(done, 'done');

  const rows: Rows = [...acc.entries()].map(([key, e]) => {
    const label = [...e.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    return { key, label, tally: e.tally };
  }).sort((a, b) =>
    (b.tally.live + b.tally.done) - (a.tally.live + a.tally.done)
    || b.tally.live - a.tally.live
    || a.label.localeCompare(b.label));

  // Unique-game counts are a UNION, not a sum: a game running on an in-progress
  // table and also on a settled one is one unique game but appears in both buckets,
  // so `live + done` overshoots `total` by however many overlap. Each is counted
  // independently against the rows and the page says so, rather than presenting
  // three figures that look like they should add up and don't.
  const unique = {
    live:  rows.filter(r => r.tally.live > 0).length,
    done:  rows.filter(r => r.tally.done > 0).length,
    total: acc.size,
  };

  return { rows, totals, unique, distinct: acc.size, unassigned };
}

// ── Paging ────────────────────────────────────────────────────────────────────
//
// Both paged lists (games, players) hold their page un-clamped in state and derive
// the page actually in effect here on every render. The row set shrinks underneath
// them — narrowing the scope drops games, a ban sweep drops players — and a page
// index trusted from state then renders an empty list with no way back.
const PAGE_SIZE = 20;

function pageWindow(total: number, raw: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(raw, pages - 1);
  const from = page * PAGE_SIZE;
  return { pages, page, from, to: Math.min(from + PAGE_SIZE, total), total };
}

type PageWindow = ReturnType<typeof pageWindow>;

function Pager({ win, unit, onPage }: {
  win: PageWindow;
  unit: string;
  onPage: (page: number) => void;
}) {
  if (win.pages <= 1) return null;
  return (
    <div className="dash-stat-pager">
      <button
        className="dash-stat-pager-btn"
        onClick={() => onPage(win.page - 1)}
        disabled={win.page === 0}
      >&lsaquo; Prev</button>
      <span className="dash-stat-pager-info">
        {win.from + 1}&ndash;{win.to} of {win.total} {unit}
        <span className="dash-stat-pager-page"> &middot; page {win.page + 1} of {win.pages}</span>
      </span>
      <button
        className="dash-stat-pager-btn"
        onClick={() => onPage(win.page + 1)}
        disabled={win.page >= win.pages - 1}
      >Next &rsaquo;</button>
    </div>
  );
}

// ── Per-player table counts ───────────────────────────────────────────────────
//
// One participant record is one seat, so a player is counted ONCE per table however
// many slots they hold on it (including a claimed slot, which also creates a
// participant record). Release/Collect are read off the MISSION, not the seat —
// they are a property of the generated room that every seat on it shares.
//
// `tables` is carried alongside the four counts so the shortfall is legible: a
// TriState may also be `special` (or, on a legacy record, missing), which is neither
// on nor off, and without the total those tables would silently vanish from both
// columns.
interface TableTally { tables: number; relOn: number; relOff: number; colOn: number; colOff: number }

const NO_TABLES: TableTally = { tables: 0, relOn: 0, relOff: 0, colOn: 0, colOff: 0 };

function tallyPlayerTables(live: GMMission[], done: GMMission[]): Record<string, TableTally> {
  const out: Record<string, TableTally> = {};
  for (const m of [...live, ...done]) {
    for (const p of Object.values(m.participants ?? {})) {
      if (!p?.playerId) continue;
      const t = (out[p.playerId] ??= { ...NO_TABLES });
      t.tables++;
      if (m.release === 'on') t.relOn++; else if (m.release === 'off') t.relOff++;
      if (m.collect === 'on') t.colOn++; else if (m.collect === 'off') t.colOff++;
    }
  }
  return out;
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="dash-stat-fig">
      <span className="dash-stat-fig-val">{value}</span>
      <span className="dash-stat-fig-lbl">{label}</span>
    </div>
  );
}

function StatTable({ headLabel, rows, foot, rankFrom }: {
  headLabel: string;
  rows: Rows;
  foot?: { label: string; tally: Tally };
  rankFrom?: number;
}) {
  const total = foot?.tally ?? rows.reduce<Tally>(
    (acc, r) => ({ live: acc.live + r.tally.live, done: acc.done + r.tally.done }),
    { live: 0, done: 0 });

  return (
    <table className="dash-stat-table">
      <thead>
        <tr>
          <th scope="col">{headLabel}</th>
          <th scope="col" className="num">In Progress</th>
          <th scope="col" className="num">Complete</th>
          <th scope="col" className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const sum = r.tally.live + r.tally.done;
          return (
            <tr key={r.key} className={sum === 0 ? 'zero' : undefined}>
              <th scope="row">
                {rankFrom !== undefined && <span className="dash-stat-rank">{rankFrom + i}</span>}
                {r.label}
              </th>
              <td className="num live">{r.tally.live}</td>
              <td className="num done">{r.tally.done}</td>
              <td className="num total">{sum}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">{foot?.label ?? 'Total'}</th>
          <td className="num live">{total.live}</td>
          <td className="num done">{total.done}</td>
          <td className="num total">{total.live + total.done}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default function StatsPage() {
  const { gameState } = useGameState();
  // Release/Collect and the chosen game titles all exist on every mission type, so
  // those breakdowns are only unambiguous once the scope is stated. Casino-only is
  // the default because the odds are a casino mechanic (rolled per table); "All"
  // folds in basic/patrol. The game-TYPE table above is inherently casino and
  // ignores this.
  const [scope, setScope] = useState<'casino' | 'all'>('casino');
  // Both held un-clamped; `pageWindow` derives the page actually in effect.
  const [gamePageRaw, setGamePage] = useState(0);
  const [playerPageRaw, setPlayerPage] = useState(0);

  const { live, done } = useMemo(() => {
    const current = Object.values(gameState?.missions ?? {});
    const byId = new Map<string, GMMission>();
    for (const m of Object.values(gameState?.missionsHistory ?? {})) byId.set(m.id, m);
    for (const m of current) if (m.state === 'complete') byId.set(m.id, m);
    return {
      live: current.filter(m => m.state === 'inprogress'),
      done: [...byId.values()],
    };
  }, [gameState?.missions, gameState?.missionsHistory]);

  const gameRows = useMemo(() => {
    const casino = (ms: GMMission[]) => ms.filter(m => m.type === 'casino');
    const counts = tallyBy(casino(live), casino(done), m => m.casinoGame ?? UNSET);
    return buildRows(counts, CASINO_GAME_ORDER, k => CASINO_GAMES[k as keyof typeof CASINO_GAMES].label);
  }, [live, done]);

  const [scopedLive, scopedDone] = useMemo(() => {
    const keep = (ms: GMMission[]) => scope === 'all' ? ms : ms.filter(m => m.type === 'casino');
    return [keep(live), keep(done)];
  }, [live, done, scope]);

  const releaseRows = useMemo(
    () => buildRows(tallyBy(scopedLive, scopedDone, m => m.release ?? UNSET), TRI_ORDER, k => TRI_LABEL[k as TriState]),
    [scopedLive, scopedDone]);

  const collectRows = useMemo(
    () => buildRows(tallyBy(scopedLive, scopedDone, m => m.collect ?? UNSET), TRI_ORDER, k => TRI_LABEL[k as TriState]),
    [scopedLive, scopedDone]);

  const games = useMemo(() => tallyGames(scopedLive, scopedDone), [scopedLive, scopedDone]);

  const playerTables = useMemo(() => tallyPlayerTables(scopedLive, scopedDone), [scopedLive, scopedDone]);

  // Same phantom-record guard as the Players roster: a record with no `id` was
  // never a player, just an ancestor RTDB created under a stray leaf write.
  //
  // Ties break on name so the order is total: with a page boundary falling inside a
  // run of equal-gold players, an order that depends on RTDB key order could show
  // the same player on both pages, or on neither.
  const goldRows = useMemo(() => Object.values(gameState?.players ?? {})
    .filter(p => !!p?.id)
    .sort((a, b) => (b.gold ?? 0) - (a.gold ?? 0)
      || (a.displayName || a.discordHandle || a.id).localeCompare(b.displayName || b.discordHandle || b.id)),
    [gameState?.players]);

  const gameWin = pageWindow(games.rows.length, gamePageRaw);
  const goldWin = pageWindow(goldRows.length, playerPageRaw);

  if (!gameState) return null;

  return (
    <div className="dash-page">
      <h2 className="dash-page-title">📊 Stats</h2>

      <section className="dash-section">
        <h3 className="dash-section-title">Casino Tables by Game Type</h3>
        <StatTable headLabel="Game Type" rows={gameRows} />
      </section>

      <div className="dash-stat-scope">
        <span className="dash-stat-scope-lbl">Scope (below)</span>
        {(['casino', 'all'] as const).map(s => (
          <button
            key={s}
            className={`dash-stat-scope-btn${scope === s ? ' active' : ''}`}
            onClick={() => { setScope(s); setGamePage(0); }}
          >
            {s === 'casino' ? 'Casino only' : 'All missions'}
          </button>
        ))}
      </div>

      <section className="dash-section">
        <h3 className="dash-section-title">Missions by Release Setting</h3>
        <StatTable headLabel="Release" rows={releaseRows} />
      </section>

      <section className="dash-section">
        <h3 className="dash-section-title">Missions by Collect Setting</h3>
        <StatTable headLabel="Collect" rows={collectRows} />
      </section>

      <section className="dash-section">
        <h3 className="dash-section-title">Top Games Selected</h3>
        {games.rows.length === 0 ? (
          <div className="dash-empty">No games chosen yet in this scope.</div>
        ) : (
          <>
            <div className="dash-stat-figures">
              <Figure value={games.unique.total} label="Unique games" />
              <Figure value={games.unique.live}  label="…in progress" />
              <Figure value={games.unique.done}  label="…complete" />
              <Figure value={games.totals.live + games.totals.done} label="Slots filled" />
            </div>
            <StatTable
              headLabel="Game"
              rows={games.rows.slice(gameWin.from, gameWin.to)}
              rankFrom={gameWin.from + 1}
              foot={{
                label: games.rows.length > PAGE_SIZE ? `All ${games.distinct} games` : 'Total',
                tally: games.totals,
              }}
            />
            <Pager win={gameWin} unit="games" onPage={setGamePage} />
            <div className="dash-stat-note">
              A game on both an in-progress and a completed mission counts once under Unique games, so the
              first three figures overlap rather than add up.
              {games.unassigned > 0 && ` ${games.unassigned} slot${games.unassigned === 1 ? '' : 's'} ${games.unassigned === 1 ? 'has' : 'have'} no game chosen yet.`}
              {' '}Titles come from each config's <code>game:</code> field, which Archipelago requires to match the
              APworld exactly, so grouping folds only case and whitespace.
            </div>
          </>
        )}
      </section>

      <section className="dash-section">
        <h3 className="dash-section-title">Players by Gold</h3>
        {goldRows.length === 0 ? (
          <div className="dash-empty">No players in this season.</div>
        ) : (
          <>
            {/* Five columns of numbers need a header saying what they are exactly
                once, rather than a label repeated on all twenty rows — so the header
                and the rows share one grid template (`dash-gold-grid`) and sit in one
                overflow box, since a header that scrolls independently of its own
                numbers is worse than no header at all. */}
            <div className="dash-gold-wrap">
              <div className="dash-gold-scroll">
                <div className="dash-gold-head dash-gold-grid">
                  <span />
                  <span>Player</span>
                  <span className="num" title="Tables this player held a seat on, within the scope selected above">Tables</span>
                  <span className="num" title="…of those, tables that generated with Release ON">Rel On</span>
                  <span className="num" title="…of those, tables that generated with Release OFF">Rel Off</span>
                  <span className="num" title="…of those, tables that generated with Collect ON">Col On</span>
                  <span className="num" title="…of those, tables that generated with Collect OFF">Col Off</span>
                  <span className="num">Gold</span>
                </div>
                <ol className="dash-gold-board">
                  {goldRows.slice(goldWin.from, goldWin.to).map((p, i) => {
                    const rank = goldWin.from + i + 1;
                    const t = playerTables[p.id] ?? NO_TABLES;
                    const status = playerStatus(p);
                    // Gilding the top three is driven by the RANK, not by row position:
                    // as a `:nth-child` rule it re-gilded the first three rows of every
                    // page, so page 2 showed ranks 21-23 as the richest in the season.
                    const cls = [
                      'dash-gold-row', 'dash-gold-grid',
                      status === 'disabled' ? 'disabled' : '',
                      rank <= 3 ? 'top' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <li key={p.id} className={cls}>
                        <span className="dash-gold-rank">{rank}</span>
                        <span className="dash-gold-who">
                          <span className="dash-gold-name">{p.displayName || p.discordHandle || p.id}</span>
                          {p.discordHandle && p.discordHandle !== p.displayName && (
                            <span className="dash-gold-handle">{p.discordHandle}</span>
                          )}
                          {status === 'disabled' && (
                            <span className="dash-gold-off" title="Disabled — cannot sign in.">DISABLED</span>
                          )}
                          {status === 'restricted' && (
                            <span className="dash-gold-off restrict"
                                  title="Restricted — plays as normal, but claims are only returned when the world resolves.">
                              RESTRICTED
                            </span>
                          )}
                        </span>
                        <span className={`dash-gold-ct${t.tables === 0 ? ' zero' : ''}`}>{t.tables}</span>
                        <span className={`dash-gold-ct${t.relOn === 0 ? ' zero' : ''}`}>{t.relOn}</span>
                        <span className={`dash-gold-ct${t.relOff === 0 ? ' zero' : ''}`}>{t.relOff}</span>
                        <span className={`dash-gold-ct pair${t.colOn === 0 ? ' zero' : ''}`}>{t.colOn}</span>
                        <span className={`dash-gold-ct${t.colOff === 0 ? ' zero' : ''}`}>{t.colOff}</span>
                        <span className="dash-gold-amt">{(p.gold ?? 0).toLocaleString()}<span className="dash-gold-unit">g</span></span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
            <Pager win={goldWin} unit="players" onPage={setPlayerPage} />
            <div className="dash-stat-note">
              Release and Collect belong to the generated room, so a player counts once per table they
              held a seat on, whatever their slot count there. Only tables in the scope selected above
              are counted, and only ones that have deployed — both settings are rolled at deploy, so a
              forming table has nothing to count yet. On + Off can therefore fall short of Tables: a
              table that rolled <em>Special</em> is neither.
            </div>
          </>
        )}
      </section>
    </div>
  );
}
