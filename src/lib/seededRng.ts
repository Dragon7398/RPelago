// ── Seeded RNG helpers ────────────────────────────────────────────────────────
// Board-agnostic and dependency-free. Lives apart from tileGen so that the S1
// and S2 generators can both use it without importing each other — tileGen
// imports tileGenS2 to dispatch, so any shared helper living in tileGen would
// make that a cycle.

/** Fisher–Yates driven by an LCG — same seed, same permutation, every time. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
