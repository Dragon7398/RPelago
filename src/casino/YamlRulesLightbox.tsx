// Lightwindow surfacing the YAML Rules on the mission manifest (submit) screen.
// The casino table is a standalone app with no Auth/GameState context, so this
// mirrors the map app's SectionYaml (help/SectionYaml.tsx). Keep the rules text in
// sync with that component.
//
// The settings numbers are NOT written here: they come in as `limits`, the same
// value the attach box screens the config against (CasinoTable's yamlLimits), so
// the rules a player reads and the rules they are warned about are one number. A
// casino season has no feats, so those are usually the base caps — but a casino
// table inside a map season shows that player's feat-raised allowance.

import { DRAGOS_LIST_URL, PB_LIMITS, START_HINT_ITEM_CAP } from '../lib/constants';
import type { YamlLimits } from '../lib/apYaml';

interface YamlRulesLightboxProps {
  onClose: () => void;
  limits:  YamlLimits;
}

export function YamlRulesLightbox({ onClose, limits }: YamlRulesLightboxProps) {
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
              <a href={DRAGOS_LIST_URL} target="_blank" rel="noopener noreferrer">Drago's list</a>.
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
                <li><strong>{limits.startInventory}</strong> starting inventory item{limits.startInventory === 1 ? '' : 's'} per game</li>
                <li><strong>{limits.priorityLocations}</strong> priority locations per game</li>
                <li><strong>{limits.excludeLocations}</strong> excluded locations per game</li>
                <li>Progression balancing between <strong>{PB_LIMITS.min}</strong> and <strong>{PB_LIMITS.max}</strong></li>
                <li>
                  <strong>{limits.startHints}</strong> starting hint{limits.startHints === 1 ? '' : 's'}{' '}
                  [targeting a maximum of <strong>{START_HINT_ITEM_CAP}</strong> items] and{' '}
                  <strong>{limits.startLocationHints}</strong> hint location{limits.startLocationHints === 1 ? '' : 's'} per game
                </li>
              </ul>
              <p className="cz-rules-note">
                Your config is checked against these when you attach it. Going over is not blocked —
                sometimes an exception is granted — but it is flagged for you and for your host, so
                clear it with them first.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
