import './profileLink.css';

const PROFILE_SITE = 'https://profiles.brisbe.org/p';

/** Compass rose mark. Two-tone cardinal needles + diagonal minor points inside a
 *  double ring — the arms alone read as a plus sign at icon size, so the rings
 *  and the diagonals are what make it legible as a compass. */
export function CompassRose({ size = 19 }: { size?: number }) {
  return (
    <svg className="profile-compass" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.15" opacity="0.45" />
      <circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.22" />
      {/* diagonal (minor) points */}
      <g fill="currentColor" opacity="0.4">
        <path d="M12 12 L17 7 L13.6 12 Z" /><path d="M12 12 L17 17 L12 13.6 Z" />
        <path d="M12 12 L7 17 L10.4 12 Z" /><path d="M12 12 L7 7 L12 10.4 Z" />
      </g>
      {/* cardinal points — split light/full so each arm reads as a faceted needle */}
      <g fill="currentColor">
        <path d="M12 1.6 L12 12 L9.6 12 Z" opacity="0.45" /><path d="M12 1.6 L14.4 12 L12 12 Z" />
        <path d="M12 22.4 L12 12 L14.4 12 Z" opacity="0.45" /><path d="M12 22.4 L9.6 12 L12 12 Z" />
        <path d="M1.6 12 L12 12 L12 14.4 Z" opacity="0.45" /><path d="M1.6 12 L12 9.6 L12 12 Z" />
        <path d="M22.4 12 L12 12 L12 9.6 Z" opacity="0.45" /><path d="M22.4 12 L12 14.4 L12 12 Z" />
      </g>
      <circle cx="12" cy="12" r="1.5" fill="var(--bg-card)" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/** Link out to the player's page on the external profile site. Shared by the map
 *  app's ProfileLightbox and the casino landing's ProfileModal so the mark and
 *  the affordance stay identical in both. */
export default function ProfileLink({ uid }: { uid: string }) {
  return (
    <a
      className="profile-link"
      href={`${PROFILE_SITE}/${uid}`}
      target="_blank"
      rel="noopener noreferrer"
      title="View your full player profile (opens in a new tab)"
    >
      <CompassRose />
      <span className="profile-link-lbl">Profile</span>
      <span className="profile-link-arrow" aria-hidden="true">↗</span>
    </a>
  );
}
