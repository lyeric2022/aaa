// Seeded pseudo-random generator for replayable matches.
//
// The arena and the enemy brain must never call Math.random in the per-frame
// path — every match is reproducible from its seed. mulberry32 is a tiny,
// fast, well-distributed 32-bit generator that is plenty for game AI noise.

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Pick an element deterministically. */
  pick<T>(arr: readonly T[]): T;
  /** Float in [lo, hi). */
  range(lo: number, hi: number): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
  };
}

/** Default seed so the legacy arena call path stays deterministic. */
export const DEFAULT_SEED = 0x5eed;
