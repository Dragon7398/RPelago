import './HelpModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PrivacyModal({ open, onClose }: Props) {
  return (
    <div
      className={`help-overlay ${open ? 'open' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="help-modal" style={{ maxWidth: 560 }}>
        <button className="help-close" onClick={onClose} aria-label="Close privacy policy">✕</button>
        <div className="help-header">
          <span className="help-header-emblem">📜</span>
          <h2 className="help-header-title">PRIVACY POLICY</h2>
        </div>
        <div className="help-content">
          <div className="help-section">
            <h3>What We Collect</h3>
            <p>
              When you sign in with Discord, RPelago receives your <strong>Discord username,
              display name, avatar, and user ID</strong>. We store these to identify you
              within the game.
            </p>
            <p>
              We also store your <strong>game progress</strong>: XP, gold, level, feats,
              adventurer names, item inventory, and in-game activity such as tile completions,
              shop purchases, and orb acquisitions.
            </p>

            <h3>How It's Used</h3>
            <p>
              Your data is used solely to run the RPelago metagame session — tracking your
              progress and displaying your identity to other participants. We do not use it
              for advertising or any purpose outside the game.
            </p>

            <h3>Who Can See It</h3>
            <p>
              Your username and game progress are <strong>visible to other RPelago
              participants</strong> in the session. The game admin can also view and manage
              all player records.
            </p>

            <h3>Storage</h3>
            <p>
              All data is stored in <strong>Google Firebase Realtime Database</strong>.
              Google's infrastructure handles storage and security on our behalf. See{' '}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
                Google's Privacy Policy
              </a>{' '}
              for details on how they handle data.
            </p>

            <h3>Data Retention & Deletion</h3>
            <p>
              Your data is retained for the duration of the game session. To request
              deletion of your account and associated data, contact the game admin at{' '}
              <a href="mailto:admin@kyre.org">admin@kyre.org</a>.
            </p>

            <h3>Third Parties</h3>
            <p>
              We do not sell, trade, or share your personal data with any third parties
              outside of Firebase's infrastructure.
            </p>

            <h3>Service</h3>
            <p>
              RPelago is provided as-is. We reserve the right to suspend access or
              discontinue the service at any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
