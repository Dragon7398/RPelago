import { useState, useEffect } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { banDiscordId, unbanDiscordId, subscribeToDiscordBans } from '../../../firebase/db';
import type { DiscordBan } from '../../../types';

/**
 * Pre-emptive ban list, keyed by Discord snowflake.
 *
 * This is the counterpart to the per-player Disable toggle: Disable is reactive
 * (needs an existing player record), while a ban is checked by
 * `exchangeDiscordCode` BEFORE any account is minted — so it can keep out
 * someone who has never signed in. The list itself is admin-read-only by rule,
 * because it is a roster of banned Discord IDs.
 */
export default function BanPanel() {
  const { addToast } = useToast();
  const [bans,    setBans]    = useState<Record<string, DiscordBan>>({});
  const [idDraft, setIdDraft] = useState('');
  const [reason,  setReason]  = useState('');
  const [busy,    setBusy]    = useState(false);
  const [open,    setOpen]    = useState(false);

  useEffect(() => subscribeToDiscordBans(setBans), []);

  const entries = Object.entries(bans).sort(([, a], [, b]) => b.ts - a.ts);

  const submit = async () => {
    const id = idDraft.trim();
    if (!id) return;
    setBusy(true);
    try {
      await banDiscordId(id, reason.trim() || undefined);
      addToast(`Banned Discord ID ${id.replace(/^discord_/, '')}.`, 'success');
      setIdDraft('');
      setReason('');
    } catch (err) {
      // The server rejects a malformed snowflake with a message worth showing —
      // a silently-wrong id would create a ban that never matches anyone.
      addToast((err as { message?: string }).message ?? 'Failed to apply ban.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dash-ban-panel">
      <button
        className="dash-ban-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>⛔ Banned Discord Accounts</span>
        <span className="dash-ban-count">
          {entries.length === 0 ? 'none' : entries.length}
          <span className="dash-ban-chev">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="dash-ban-body">
          <p className="dash-ban-help">
            Blocks the account before it can sign in — no player record is ever created.
            Keyed on the Discord <strong>user ID</strong>, not the username, so renaming
            doesn&apos;t shake it. In Discord: Settings → Advanced → Developer Mode, then
            right-click the user → Copy User ID.
          </p>

          <div className="dash-ban-form">
            <input
              className="dash-ban-input id"
              value={idDraft}
              onChange={e => setIdDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              placeholder="Discord user ID (17–20 digits)"
              inputMode="numeric"
            />
            <input
              className="dash-ban-input reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              placeholder="Reason (optional — shown to them at sign-in)"
            />
            <button
              className="dash-ban-submit"
              disabled={busy || !idDraft.trim()}
              onClick={() => void submit()}
            >
              {busy ? 'Banning…' : 'Ban'}
            </button>
          </div>

          {entries.length === 0 ? (
            <div className="dash-ban-empty">No banned accounts.</div>
          ) : entries.map(([id, ban]) => (
            <div key={id} className="dash-ban-row">
              <span className="dash-ban-tag">BANNED</span>
              <span className="dash-ban-id">
                {id}
                {ban.handle && <span className="dash-ban-handle">@{ban.handle}</span>}
              </span>
              <span className="dash-ban-reason">{ban.reason || <em>no reason recorded</em>}</span>
              <span className="dash-ban-meta">
                {new Date(ban.ts).toLocaleDateString()}
                {ban.lastAttemptAt && (
                  <span
                    className="dash-ban-attempt"
                    title={`Last blocked sign-in attempt: ${new Date(ban.lastAttemptAt).toLocaleString()}`}
                  >
                    {' '}· tried {new Date(ban.lastAttemptAt).toLocaleDateString()}
                  </span>
                )}
              </span>
              <button
                className="dash-ban-lift"
                title="Lift this ban"
                onClick={async () => {
                  if (!confirm(`Lift the ban on ${id}? They will be able to sign in again.`)) return;
                  try {
                    await unbanDiscordId(id);
                    addToast(`Ban lifted for ${id}.`, 'success');
                  } catch {
                    addToast('Failed to lift ban.', 'error');
                  }
                }}
              >
                Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
