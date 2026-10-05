import { useState } from 'react';
import type { SlotMerc } from '../types';
import { setSlotMerc, type MercTarget } from '../firebase/db';
import { useGameState } from '../contexts/GameStateContext';
import { useIsAdmin } from '../contexts/SeasonContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { playersByHandle } from '../lib/mercLogic';

/**
 * The merc tag and hire/remove affordance for ONE slot, used on every surface
 * that draws slots (casino landing, map lightbox, admin slot management).
 *
 * The permissions are asymmetric on purpose, and the server enforces them too:
 *   • the slot's owner may HIRE, but only onto a slot with no merc;
 *   • only the admin may REPLACE or REMOVE a merc.
 * An owner who could remove their own merc could hire help early and boot it
 * before settle to keep the whole reward.
 *
 * `variant` only picks the class prefix — the casino landing and the map/admin
 * pages run different token sets (themes.css vs index.css).
 */
export default function MercControl({ target, merc, ownerId, live, variant = 'map' }: {
  target:   MercTarget;
  merc?:    SlotMerc | null;
  ownerId:  string;
  /** The world is in progress — hiring and removing are refused at any other time. */
  live:     boolean;
  variant?: 'map' | 'casino';
}) {
  const isAdmin = useIsAdmin();
  const uid     = useAuth().user?.id;
  const { gameState } = useGameState();
  const { addToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft,   setDraft]   = useState('');
  const [busy,    setBusy]    = useState(false);

  const p        = variant === 'casino' ? 'mp-merc' : 'merc';
  const isOwner  = !!uid && uid === ownerId;
  const canHire  = live && (isAdmin || (isOwner && !merc));
  const canClear = live && isAdmin && !!merc;

  const tag = merc ? (
    <span className={`${p}-tag`}
          title={`${merc.playerName} is mercing this slot (since ${new Date(merc.since).toLocaleDateString()}). `
               + 'They take half of its reward at settle; the slot stays its owner’s responsibility.'}>
      ⚔ {merc.playerName}
    </span>
  ) : null;

  if (!canHire && !canClear) return tag;

  const matches = playersByHandle(gameState?.players, draft);
  const match   = matches.length === 1 ? matches[0] : null;
  const problem = !draft.trim() ? null
    : matches.length === 0       ? 'No player with that handle this season.'
    : matches.length > 1         ? 'More than one player matches.'
    : match!.id === ownerId      ? 'That’s the slot’s owner.'
    : match!.disabled            ? 'That player is disabled.'
    : merc?.playerId === match!.id ? 'Already mercing this slot.'
    : null;

  const run = async (handle: string | null) => {
    setBusy(true);
    try {
      const res = await setSlotMerc(target, handle);
      addToast(handle ? `${res.mercName ?? 'Merc'} is now mercing this slot.` : 'Merc removed.', 'success');
      setEditing(false); setConfirm(false); setDraft('');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`${p}`}>
      {tag}
      {!editing && !confirm && canHire && (
        <button type="button" className={`${p}-btn`} onClick={() => setEditing(true)}
                title={merc ? 'Hand this slot to a different merc (admin)' : 'Hire a mercenary to help play this slot'}>
          {merc ? 'Change' : '+ Merc'}
        </button>
      )}
      {!editing && !confirm && canClear && (
        <button type="button" className={`${p}-btn danger`} onClick={() => setConfirm(true)}
                title="Remove this merc (admin only)">✕</button>
      )}

      {confirm && (
        <span className={`${p}-form`}>
          <span className={`${p}-hint`}>Remove {merc?.playerName}? They get nothing from this slot.</span>
          <button type="button" className={`${p}-btn danger`} disabled={busy} onClick={() => void run(null)}>
            {busy ? '…' : 'Remove'}
          </button>
          <button type="button" className={`${p}-btn`} disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
        </span>
      )}

      {editing && (
        <span className={`${p}-form`}>
          <input
            className={`${p}-input`}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && match && !problem && !busy) void run(draft);
            }}
            placeholder="@discord handle"
            maxLength={40}
            autoFocus
          />
          <span className={`${p}-hint${problem ? ' bad' : ''}`}>
            {problem ?? (match ? `→ ${match.displayName}` : '')}
          </span>
          <button type="button" className={`${p}-btn`} disabled={busy || !match || !!problem}
                  onClick={() => void run(draft)}>
            {busy ? '…' : 'Hire'}
          </button>
          <button type="button" className={`${p}-btn`} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          {/* Owners get one shot at this — say so before they commit. */}
          {!isAdmin && (
            <span className={`${p}-hint`}>They take half this slot’s reward. Only the admin can remove a merc once hired.</span>
          )}
        </span>
      )}
    </span>
  );
}
