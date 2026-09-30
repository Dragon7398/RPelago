// Join callables reject with specific, player-facing reasons — "attach your
// config", "this challenge needs at least 3 games", "already full". Swallowing
// them into a generic "please try again" would leave the player with no idea
// what to fix, which is the whole point of validating server-side.
//
// Firebase wraps a callable's HttpsError so `message` carries the server text.

const GENERIC = 'Could not join. Please try again.';

export function joinErrorText(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const msg = (e?.message ?? '').replace(/^.*?:\s*/, '').trim();

  // `internal` means an unexpected server fault — its message is not for players.
  if (e?.code === 'functions/internal' || !msg) return GENERIC;
  if (e?.code === 'functions/unauthenticated') return 'Sign in to join.';

  return msg;
}
