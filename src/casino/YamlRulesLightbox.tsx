// Lightwindow surfacing the YAML Rules on the mission manifest (submit) screen.
// The casino table is a standalone app with no Auth/GameState context, so this
// mirrors the *casino* variant of the map app's SectionYaml (help/SectionYaml.tsx):
// a casino season has no feats, so there are no feat-bonus values to show here.
// Keep the rules text in sync with that component.

interface YamlRulesLightboxProps {
  onClose: () => void;
}

export function YamlRulesLightbox({ onClose }: YamlRulesLightboxProps) {
  return (
    <div className="cz-preview-overlay" onClick={onClose}>
      <div className="cz-preview-panel" onClick={e => e.stopPropagation()}>
        <div className="cz-preview-head">
          <h2>YAML Rules</h2>
          <button className="cz-preview-close" onClick={onClose} aria-label="Close rules">✕</button>
        </div>
        <div className="cz-rules">
          <p>
            New to Archipelago? Start with the{' '}
            <a href="https://archipelago.gg/tutorial/Archipelago/setup_en" target="_blank" rel="noopener noreferrer">official YAML setup guide</a>.
          </p>
          <ul>
            <li>
              Submit <strong>1 YAML per mission</strong>. Your YAML may include up to <strong>5 games</strong>;
              duplicates are allowed. If submitting multiple games, combine them into one file using{' '}
              <code>---</code> between entries — do not submit separate files.
            </li>
            <li>
              <strong>Game eligibility:</strong> Unsupported games are allowed if they are listed as
              allowed for Async or Sync on{' '}
              <a href="https://docs.google.com/spreadsheets/d/1YdsVZWxICS7NF0y68NMW-jXIwljZJcKOAHN_wiJh2Ms" target="_blank" rel="noopener noreferrer">Drago's list</a>.
              Manuals and Keymaster's Keep are not allowed.
            </li>
            <li>
              <strong>Meta games</strong> (such as AP Bingo and Autopelago) are allowed, but may be
              at most <strong>50%</strong> of your total checks. For example, a 5×5 Bingo board alone
              (25 checks) is not permitted, but pairing it with a Checksfinder (25 checks) is fine.
            </li>
            <li>
              <strong>Check limits:</strong> At least <strong>50 checks</strong> and no more than{' '}
              <strong>2,000 checks</strong> total, unless otherwise approved.
            </li>
            <li>
              <strong>Keep it fun!</strong>  Please use your best judgment on games to keep things fun for everyone.
              Unless you're confident of your ability to keep things moving,
              please don't submit, for example, a fully-maxed Stardew Valley.
              Likewise, please don't submit trivially easy slots or goal excessively out-of-logic
              [e.g. using BLJ to reach goal early in SM64].
            </li>
            <li>
              <strong>YAML settings:</strong> Unless approved by special permission, you are limited to:
              <ul>
                <li><strong>0</strong> starting inventory items per game</li>
                <li><strong>2</strong> priority locations per game</li>
                <li><strong>2</strong> excluded locations per game</li>
                <li>Progression balancing between <strong>0</strong> and <strong>50</strong></li>
                <li>
                  <strong>1</strong> starting hint [targeting a maximum of <strong>10</strong> items] and{' '}
                  <strong>1</strong> hint location per game
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
