import { useState } from 'react';
import type { AdvSlot } from '../types';
import { setSlotMerc, type MercTarget } from '../firebase/db';
import { useGameState } from '../contexts/GameStateContext';
import { useIsAdmin } from '../contexts/SeasonContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { MERC_BLOCKER_TEXT, mercHireBlockers, playersByHandle } from '../lib/mercLogic';

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
 * On top of that, the hiring limits (`mercHireBlockers`: no claimed slot, one per
 * casino table, never every slot) are HARD for players — the button is withheld
 * or disabled with the reason — and SOFT for the admin, who sees the same reasons
 * as warnings and can "Hire anyway".
 *
 * `variant` only picks the class prefix — the casino landing and the map/admin
 * pages run different token sets (themes.css vs index.css).
 */
export default function MercControl({ target, slot, ownerSlots, casino, ownerId, live, variant = 'map' }: {
  target:   MercTarget;
  /** The slot itself — its `merc` and `claimed` flags. */
  slot:     AdvSlot;
  /** Everything the owner holds on this world (their seat; every adventurer of theirs on a tile). */
  ownerSlots: readonly (AdvSlot | null | undefined)[];
  /** A casino table — the one-merced-slot limit applies. */
  casino:   boolean;
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

  const merc     = slot.merc;
  const p        = variant === 'casino' ? 'mp-merc' : 'merc';
  const isOwner  = !!uid && uid === ownerId;
  const blockers = mercHireBlockers(slot, ownerSlots, casino);
  const reasons  = blockers.map(b => MERC_BLOCKER_TEXT[b]);
  // A claimed slot can never be merced by its owner, so a player isn't shown a
  // button for it at all. The count limits can lift (the admin removes another
  // merc), so those leave the button visible but disabled, with the reason.
  const canHire  = live && (isAdmin || (isOwner && !merc && !blockers.includes('claimed')));
  const blocked  = !isAdmin && blockers.length > 0;
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
      // The admin has seen the warnings in the form; hiring past them is the confirmation.
      const res = await setSlotMerc(target, handle, isAdmin && blockers.length > 0);
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
        <button type="button" className={`${p}-btn`} onClick={() => setEditing(true)} disabled={blocked}
                title={blocked ? reasons.join(' ')
                  : merc ? 'Hand this slot to a different merc (admin)' : 'Hire a mercenary to help play this slot'}>
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
          <button type="button" className={`${p}-btn${blockers.length ? ' danger' : ''}`}
                  disabled={busy || !match || !!problem}
                  onClick={() => void run(draft)}>
            {busy ? '…' : blockers.length ? 'Hire anyway' : 'Hire'}
          </button>
          <button type="button" className={`${p}-btn`} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          {/* Only the admin ever reaches the form with blockers — warn, then allow. */}
          {reasons.map(r => <span key={r} className={`${p}-hint bad`}>⚠ {r}</span>)}
          {/* Owners get one shot at this — say so before they commit. */}
          {!isAdmin && (
            <span className={`${p}-hint`}>They take half this slot’s reward. Only the admin can remove a merc once hired.</span>
          )}
        </span>
      )}
    </span>
  );
}
