interface Props {
  onBack: () => void;
}

// Casino — the one district that REPLACES the map view rather than opening over it
// (decision 18), because the casino landing is a full page in its own right.
//
// The full view arrives in §1.9, which extracts `CasinoShell`'s body into a
// `CasinoLanding` taking an optional `onBack` — at which point this file's body
// becomes `<CasinoLanding onBack={onBack} />` and nothing else changes. The routing
// is built now so that swap is a one-liner and the view-replacement behaviour is
// exercised before anything depends on it.
//
// It is NOT wired to `CasinoShell` directly in the meantime: that component is the
// casino SEASON's root and assumes it is the whole app, and §1.9 has to settle how
// a casino inside a map season differs — notably `ChallengePanel`'s `showXp`, which
// must flip to true because a map season pays gambit XP as XP.
export default function CasinoDistrict({ onBack }: Props) {
  return (
    <section className="casino-district" aria-label="Casino">
      <button className="district-back" onClick={onBack}>← Back to the map</button>
      <div className="district-pending full">
        The tables are being set. The casino opens here shortly.
      </div>
    </section>
  );
}
