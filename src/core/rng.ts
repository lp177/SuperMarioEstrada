// Deterministic seeded RNG (mulberry32). Gameplay NEVER calls Math.random —
// it takes a stream from here so identical event sequences replay identically
// and the whole sim runs headless under test.
//
// Separate concerns get separate streams (seed XOR a distinct salt) so one
// system's draws never perturb another's sequence.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distinct stream salts. Add one per concern; never reuse. */
export const RNG_STREAM = {
  entities: 0x9e3779b9,
  fx: 0x85ebca6b,
  music: 0xc2b2ae35,
  decor: 0x27d4eb2f,
} as const;

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  const v = arr[Math.floor(rng() * arr.length)];
  if (v === undefined) throw new Error('pick from empty array');
  return v;
}

/** Shuffle-bag: every item once before any repeats — the house pattern for
 *  gag lines and music variety so nothing repeats soon. */
export function shuffleBag<T>(rng: Rng, items: readonly T[]): () => T {
  let bag: T[] = [];
  return () => {
    if (bag.length === 0) {
      bag = [...items];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const bi = bag[i]!;
        bag[i] = bag[j]!;
        bag[j] = bi;
      }
    }
    return bag.pop()!;
  };
}
