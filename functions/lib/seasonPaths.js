"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sp = sp;
exports.secret = secret;
exports.getConfig = getConfig;
exports.seasonInfo = seasonInfo;
exports.isDraftSeason = isDraftSeason;
exports.tickableSeasons = tickableSeasons;
exports.resolveWriteSeason = resolveWriteSeason;
const database_1 = require("firebase-admin/database");
const https_1 = require("firebase-functions/v2/https");
/** `sp(id, 'tiles/D3')` → `seasons/{id}/tiles/D3`. */
function sp(seasonId, sub = '') {
    const base = `seasons/${seasonId}`;
    return sub ? `${base}/${sub}` : base;
}
/** `secret(id, 'missions/m1/participants/u/deck')` → `seasonSecrets/{id}/…`. */
function secret(seasonId, sub = '') {
    const base = `seasonSecrets/${seasonId}`;
    return sub ? `${base}/${sub}` : base;
}
async function getConfig(db = (0, database_1.getDatabase)()) {
    const snap = await db.ref('config').get();
    if (!snap.exists())
        throw new https_1.HttpsError('failed-precondition', 'Season config missing.');
    return snap.val();
}
/** Status + shell of a season, from config. Drafts live in a separate list. */
function seasonInfo(config, seasonId) {
    const listed = config.seasonList?.[seasonId];
    if (listed)
        return { status: listed.status, shell: listed.shell };
    const draft = config.draftSeasons?.[seasonId];
    if (draft)
        return { status: 'draft', shell: draft.shell };
    return null;
}
/** True when the season is a draft — used to suppress profile writes. */
async function isDraftSeason(seasonId, db = (0, database_1.getDatabase)()) {
    const config = await getConfig(db);
    return seasonInfo(config, seasonId)?.status === 'draft';
}
/**
 * Season ids a scheduled function should process. Scheduled functions have no
 * `event.params.seasonId`, so they must fan out over seasons explicitly.
 *
 * - includeDraft: process draft seasons too (mission tick, so alphas can
 *   playtest deploy). The weekly gold top-up passes false — it runs live only.
 * Archived seasons are always skipped (frozen).
 */
async function tickableSeasons(db = (0, database_1.getDatabase)(), includeDraft = true) {
    const config = await getConfig(db);
    const out = [];
    for (const [seasonId, e] of Object.entries(config.seasonList ?? {})) {
        if (e.status === 'active' || e.status === 'closing')
            out.push({ seasonId, status: e.status, shell: e.shell });
    }
    if (includeDraft) {
        for (const [seasonId, e] of Object.entries(config.draftSeasons ?? {})) {
            out.push({ seasonId, status: 'draft', shell: e.shell });
        }
    }
    return out;
}
/**
 * Resolve the season a player callable should act on, and authorize it.
 *
 * - No requested id → the active season (the normal case; keeps player calls
 *   from having to know the season id).
 * - A requested id → must be writable BY THIS USER:
 *     active / closing → anyone
 *     draft            → admin or alpha only (playtesting)
 *     archived         → admin only (frozen history)
 *
 * Returns the resolved id plus its status/shell.
 */
async function resolveWriteSeason(uid, requestedSeasonId, db = (0, database_1.getDatabase)()) {
    const config = await getConfig(db);
    const seasonId = requestedSeasonId || config.activeSeasonId;
    const info = seasonInfo(config, seasonId);
    if (!info)
        throw new https_1.HttpsError('not-found', 'Unknown season.');
    const isAdmin = config.adminId === uid;
    const isAlpha = !!config.alphaUsers?.[uid];
    if (info.status === 'draft' && !isAdmin && !isAlpha)
        throw new https_1.HttpsError('permission-denied', 'Season not available.');
    if (info.status === 'archived' && !isAdmin)
        throw new https_1.HttpsError('failed-precondition', 'Season is archived.');
    return { seasonId, status: info.status, shell: info.shell };
}
//# sourceMappingURL=seasonPaths.js.map