"use strict";
// ── Server mirror: config (YAML) Storage paths ────────────────────────────────
//
// ⚠️ DUAL COPY — mirrors src/firebase/yamlPaths.ts. The client uploads to a path
// and the server then verifies THAT EXACT OBJECT exists before a join commits,
// so the two must build a byte-identical string. A drift here does not fail
// loudly: every join starts rejecting with "config not attached" while the file
// sits happily in the bucket. Listed in CLAUDE.md's mirror list.
Object.defineProperty(exports, "__esModule", { value: true });
exports.yamlPath = yamlPath;
/**
 * `yaml/{seasonId}/{kind}/{containerId}/{uid}.yaml`
 *
 * `containerId` is the world's own id verbatim — a surface tile coord (`D4`), an
 * interior tile coord (`G1:2_3`, `T1:0_2`), or a mission push key.
 */
function yamlPath(seasonId, kind, containerId, uid) {
    return `yaml/${seasonId}/${kind}/${containerId}/${uid}.yaml`;
}
//# sourceMappingURL=yamlPaths.js.map