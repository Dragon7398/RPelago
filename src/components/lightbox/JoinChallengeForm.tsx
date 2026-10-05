import { useMemo, useState } from 'react';
import { ADV_ICONS } from '../../lib/constants';
import { hordeFloor, type TraitEntry } from '../../lib/traits';
import { uploadYaml } from '../../firebase/yamlUpload';
import { getCurrentSeason } from '../../firebase/season';
import { MAX_YAML_BYTES } from '../../firebase/yamlPaths';
import {
  parseApYaml, checkWorldCount, checkProgressionBalancing, checkBlanketTargets,
  checkYamlLimits, summarizeLimitFindings,
} from '../../lib/apYaml';
import { yamlLimitsForPlayer } from '../../lib/gameLogic';
import type { Adventurer, DeclaredSlot, Player, Tile } from '../../types';

// ── The join step (map plan §0.5.1) ───────────────────────────────────────────
// Joining is ONE action: pick an adventurer, declare 1–5 slots, attach a config.
// The config uploads to Storage first; only then does the join callable run, and
// it independently verifies the object exists before committing.

const MAX_SLOTS = 5;

interface Props {
  tile:   Tile;
  coord:  string;
  player: Player;
  uid:    string;
  freeAdvs: Adventurer[];
  onJoin: (advId: string, slots: DeclaredSlot[]) => Promise<void>;
}

const blank = (): DeclaredSlot => ({ name: '', game: '' });

export default function JoinChallengeForm({ tile, coord, player, uid, freeAdvs, onJoin }: Props) {
  const [advId, setAdvId]   = useState<string>('');
  const [slots, setSlots]   = useState<DeclaredSlot[]>([blank()]);
  const [yamlText, setYaml] = useState<string | null>(null);
  const [yamlName, setName] = useState<string>('');
  const [busy, setBusy]     = useState(false);
  // How many slots the last attachment filled in, for the notice. The fill lands in
  // step 2, ABOVE where the player is looking when they attach in step 3, so
  // without this the form rewrites fields off-screen with nothing to show for it.
  const [filledFrom, setFilledFrom] = useState<number | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // Traits raise the FLOOR but never the ceiling — Horde demands at least N
  // games; nothing lets a player exceed five.
  const floor = hordeFloor(tile.traits as Record<string, TraitEntry> | undefined);

  // Everything below is DERIVED from yamlText rather than stamped at attach, for
  // the reason the casino table gives: a stamped finding has as many chances to
  // go stale as it has reset sites. Memoised because this component re-renders on
  // every slot keystroke and a config may be up to 1 MB.
  const parsed = useMemo(() => (yamlText ? parseApYaml(yamlText) : null), [yamlText]);
  const pbFindings = useMemo(
    () => (yamlText ? checkProgressionBalancing(yamlText) : []),
    [yamlText],
  );
  const pbBlocked = pbFindings.some(f => f.severity === 'reject');
  // A hint, priority, exclusion or inventory grant aimed at Everything /
  // Everywhere. A HARD block with no exception path — there is nothing in a
  // loophole for the host to waive (see checkBlanketTargets).
  const blanketBlock = useMemo(
    () => (yamlText ? checkBlanketTargets(yamlText) : []),
    [yamlText],
  );
  const limitFindings = useMemo(
    () => (yamlText ? summarizeLimitFindings(checkYamlLimits(yamlText, yamlLimitsForPlayer(player))) : []),
    [yamlText, player],
  );

  const filled = slots.filter(s => s.name.trim() && s.game.trim());
  // The config must describe exactly the games being declared. A too-many-worlds
  // file is the case that matters: nothing else here would notice it, and the
  // host would generate a room with worlds nobody is seated on.
  const countErr = parsed
    ? checkWorldCount(parsed.slots.length, { count: filled.length })
    : null;

  const canSubmit = !!advId && !!yamlText && !pbBlocked && !countErr
    && blanketBlock.length === 0
    && filled.length >= Math.max(1, floor) && filled.length <= MAX_SLOTS && !busy;

  const setSlot = (i: number, patch: Partial<DeclaredSlot>) => {
    // Any hand edit retires the notice — it would otherwise keep claiming these
    // fields came from the file.
    setFilledFrom(null);
    setSlots(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };

  async function handleFile(file: File) {
    setError(null);
    setFilledFrom(null);
    if (file.size >= MAX_YAML_BYTES) {
      setError(`That config is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Configs must be under 1 MB.`);
      return;
    }
    const text = await file.text();
    setYaml(text);
    setName(file.name);

    // The config already names every world, so declaring them by hand is both
    // tedious and the one place a mismatch can be introduced. Fill step 2 from the
    // file, exactly as the casino table fills its manifest.
    //
    // Slot names keep their `{number}` token verbatim (parseApYaml preserves it),
    // which is what we want: the token is the player's collision-avoidance, and
    // resolveNumberedSlotName adopts the name AP actually generated later.
    const { slots: worlds } = parseApYaml(text);
    // An unreadable file parses to nothing — never wipe what the player typed on
    // the strength of a file we could not read.
    if (worlds.length === 0) return;
    // Truncate rather than absorb: a config with more worlds than a challenge
    // allows is a real mismatch, and countErr reports it against the five declared
    // here instead of it passing unnoticed.
    setSlots(prev => worlds.slice(0, MAX_SLOTS).map((w, i) => ({
      name: w.name || (prev[i]?.name ?? ''),
      game: w.game || (prev[i]?.game ?? ''),
    })));
    setFilledFrom(Math.min(worlds.length, MAX_SLOTS));
  }

  async function submit() {
    if (!canSubmit || !yamlText) return;
    setBusy(true);
    setError(null);
    try {
      // Upload FIRST: the callable verifies the object exists, so a join can
      // never commit without one.
      await uploadYaml(getCurrentSeason(), 'challenge', coord, uid, yamlText);
      await onJoin(advId, filled);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  if (freeAdvs.length === 0) {
    return <div className="lb-no-adv">All your Adventurers are currently on missions.</div>;
  }

  return (
    <div className="lb-join-form">
      <div className="lb-join-label">1 · Choose an Adventurer</div>
      <div className="lb-adv-picker">
        {freeAdvs.map(adv => (
          <button
            key={adv.id}
            className={`lb-adv-pick-btn${advId === adv.id ? ' selected' : ''}`}
            onClick={() => setAdvId(adv.id)}
          >
            <span>{ADV_ICONS[adv.cls] ?? '⚔️'}</span>
            <span className="btn-adv-name">{adv.firstName} {adv.lastName}</span>
          </button>
        ))}
      </div>

      <div className="lb-join-label">
        2 · Declare your games
        <span className="lb-join-hint">
          {floor > 1
            ? `This challenge needs at least ${floor} games (Horde).`
            : `1–${MAX_SLOTS} games.`}
        </span>
      </div>
      {filledFrom != null && (
        <div className="lb-join-autofill">
          ✓ Filled {filledFrom} game{filledFrom === 1 ? '' : 's'} in from your config — check them over.
        </div>
      )}
      {slots.map((s, i) => (
        <div key={i} className="lb-join-slot">
          <input
            className="lb-join-input" placeholder="Slot name"
            value={s.name} onChange={e => setSlot(i, { name: e.target.value })}
          />
          <input
            className="lb-join-input" placeholder="Game"
            value={s.game} onChange={e => setSlot(i, { game: e.target.value })}
          />
          {slots.length > 1 && (
            <button
              className="lb-join-slot-del"
              title="Remove this slot"
              onClick={() => setSlots(prev => prev.filter((_, j) => j !== i))}
            >✕</button>
          )}
        </div>
      ))}
      {slots.length < MAX_SLOTS && (
        <button className="lb-join-add" onClick={() => setSlots(prev => [...prev, blank()])}>
          + Add a game
        </button>
      )}

      <div className="lb-join-label">3 · Attach your config</div>
      <input
        type="file" accept=".yaml,.yml" className="lb-join-file"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
      {yamlName && <div className="lb-join-file-name">📎 {yamlName}</div>}

      {/* Screening mirrors the casino table's, and must stay in step with it:
          progression balancing can BLOCK, a blanket target and a wrong game count
          ALWAYS block, and the settings caps are advisory only — the host grants
          exceptions routinely, so an over-cap config must stay submittable. */}
      {countErr && (
        <div className="lb-join-finding reject">
          ⛔ {countErr} Attach a config with exactly {filled.length} game{filled.length === 1 ? '' : 's'}.
        </div>
      )}
      {blanketBlock.map((f, i) => (
        <div key={`b${i}`} className="lb-join-finding reject">⛔ {f.message}</div>
      ))}
      {pbFindings.map((f, i) => (
        <div key={i} className={`lb-join-finding ${f.severity}`}>{f.message}</div>
      ))}
      {/* Unreadable documents and weighted games are NOTICES, not blocks — the
          host resolves a randomized game from the config at generation. */}
      {parsed?.errors.map((e, i) => (
        <div key={`e${i}`} className="lb-join-finding warn">{e}</div>
      ))}
      {parsed?.slots.some(s => s.randomized) && (
        <div className="lb-join-finding warn">
          One or more games are a weighted / randomized choice — your host resolves
          the actual game from your config.
        </div>
      )}
      {limitFindings.map((f, i) => (
        <div key={i} className="lb-join-finding warn">{f.message}</div>
      ))}
      {error && <div className="lb-join-finding reject">{error}</div>}

      <button className="lb-join-submit" disabled={!canSubmit} onClick={() => void submit()}>
        {busy ? 'Joining…' : 'Join the Challenge'}
      </button>
    </div>
  );
}
