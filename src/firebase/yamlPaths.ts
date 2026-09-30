// ── Config (YAML) Storage paths ───────────────────────────────────────────────
// S2 collects an Archipelago config at EVERY join, not just casino seats
// (docs/season-2-map-plan.md §0.5). This module owns the path scheme and is
// deliberately dependency-free so the Cloud Functions can mirror it exactly —
// the server verifies the object exists before a join commits, so client and
// server must build the identical string.

/** What kind of world a config was submitted for. */
export type YamlKind = 'challenge' | 'mission';

/**
 * Max config size in UTF-8 bytes. MUST match the cap in storage.rules — the rule
 * is the real gate (Firebase rejects an oversized upload before storing); this
 * mirror lets us reject early with a clear message instead of a raw Storage error.
 */
export const MAX_YAML_BYTES = 1024 * 1024; // 1 MB

/**
 * `yaml/{seasonId}/{kind}/{containerId}/{uid}.yaml`
 *
 * `containerId` is the world's own id, verbatim:
 *   · a surface tile coord       — `D4`
 *   · an interior tile coord     — `G1:2_3`, `T1:0_2`  (§3.3)
 *   · a mission id               — the push key
 *
 * Interior coords carry `:`, which is legal in a Storage object name, so the
 * compound coord IS the containerId — no encoding, no second scheme to keep in
 * step with the RTDB one.
 */
export function yamlPath(
  seasonId: string,
  kind: YamlKind,
  containerId: string,
  uid: string,
): string {
  return `yaml/${seasonId}/${kind}/${containerId}/${uid}.yaml`;
}

/**
 * The legacy S1.5 casino path, kept so archived seats stay readable.
 * Nothing new writes here — `uploadCasinoYaml` is the sole remaining caller.
 */
export function legacyCasinoYamlPath(
  seasonId: string,
  missionId: string,
  uid: string,
): string {
  return `casino/${seasonId}/${missionId}/${uid}.yaml`;
}

/** Shared size guard, so every upload path rejects with the same message. */
export function assertYamlSize(bytes: number): void {
  if (bytes >= MAX_YAML_BYTES) {
    throw new Error(
      `That config is too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Configs must be under 1 MB.`,
    );
  }
}
