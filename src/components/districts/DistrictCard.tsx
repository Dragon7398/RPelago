import { districtSprite, type DistrictDef } from './districtData';

interface Props {
  def:      DistrictDef;
  /** Logged out, or the district isn't open yet. */
  disabled: boolean;
  /** Shown in place of the flavour line when disabled for a reason worth saying. */
  note?:    string;
  onOpen:   () => void;
}

// One district card. Logged out, these are deliberately VISIBLE but inert
// (decision 19) — a visitor should be able to see what the capital holds before
// signing in, which is why the disabled state dims rather than hides.
//
// It renders as a <button> even when disabled rather than swapping to a <div>: the
// element keeps its role and its disabled state is announced, where a div would
// silently stop being a control.
export default function DistrictCard({ def, disabled, note, onOpen }: Props) {
  const sprite = districtSprite(def);

  return (
    <button
      className={`district-card${disabled ? ' disabled' : ''}`}
      onClick={disabled ? undefined : onOpen}
      disabled={disabled}
      aria-label={`${def.label}${note ? ` — ${note}` : ''}`}
    >
      <div className="district-art" aria-hidden="true">
        {sprite
          ? <img className="district-sprite" src={sprite} alt="" />
          : <span className="district-glyph">{def.glyph}</span>}
      </div>
      <div className="district-name">{def.label}</div>
      <div className="district-line">{note ?? def.line}</div>
    </button>
  );
}
