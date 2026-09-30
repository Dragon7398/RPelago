import { useState } from 'react';
import { ADV_ICONS } from '../../lib/constants';
import { hordeFloor, type TraitEntry } from '../../lib/traits';
import { uploadYaml } from '../../firebase/yamlUpload';
import { getCurrentSeason } from '../../firebase/season';
import { MAX_YAML_BYTES } from '../../firebase/yamlPaths';
import { checkProgressionBalancing, checkYamlLimits, summarizeLimitFindings } from '../../lib/apYaml';
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
  const [error, setError]   = useState<string | null>(null);

  // Traits raise the FLOOR but never the ceiling — Horde demands at least N
  // games; nothing lets a player exceed five.
  const floor = hordeFloor(tile.traits as Record<string, TraitEntry> | undefined);

  const pbFindings    = yamlText ? checkProgressionBalancing(yamlText) : [];
  const pbBlocked     = pbFindings.some(f => f.severity === 'reject');
  const limitFindings = yamlText
    ? summarizeLimitFindings(checkYamlLimits(yamlText, yamlLimitsForPlayer(player)))
    : [];

  const filled   = slots.filter(s => s.name.trim() && s.game.trim());
  const canSubmit = !!advId && !!yamlText && !pbBlocked
    && filled.length >= Math.max(1, floor) && filled.length <= MAX_SLOTS && !busy;

  const setSlot = (i: number, patch: Partial<DeclaredSlot>) =>
    setSlots(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function handleFile(file: File) {
    setError(null);
    if (file.size >= MAX_YAML_BYTES) {
      setError(`That config is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Configs must be under 1 MB.`);
      return;
    }
    setYaml(await file.text());
    setName(file.name);
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

      {/* Screening mirrors the casino's: progression balancing can BLOCK, the
          settings caps are advisory only — the host grants exceptions routinely,
          so an over-cap config must stay submittable. */}
      {pbFindings.map((f, i) => (
        <div key={i} className={`lb-join-finding ${f.severity}`}>{f.message}</div>
      ))}
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
