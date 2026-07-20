// Build a Discord CDN avatar URL from an RPelago uid (`discord_<snowflake>`) and
// the stored `avatarHash`. Returns null when there's no custom avatar or the id
// isn't a Discord snowflake — callers fall back to the letter avatar.
//
// Animated avatars carry an `a_` hash prefix and are served as GIF; the rest as
// PNG. `size` is a power-of-two the CDN accepts (16–4096).
export function discordAvatarUrl(
  playerId: string | undefined | null,
  avatarHash: string | null | undefined,
  size = 64,
): string | null {
  if (!playerId || !avatarHash) return null;
  const id = playerId.startsWith('discord_') ? playerId.slice('discord_'.length) : playerId;
  if (!/^\d+$/.test(id)) return null;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.${ext}?size=${size}`;
}
