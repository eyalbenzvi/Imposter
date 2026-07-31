/**
 * Deterministic PRNG.
 *
 * The reducer must never call `Math.random()` — every random decision is
 * derived from a `seed` string that arrives in the action payload. The same
 * seed always produces the same game, which is what will let an online mode
 * replay a room's state from the server's seed without touching this file.
 */

/** cyrb128 string hash → four 32-bit seeds. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export type Rng = {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). */
  int(max: number): number;
  /** Uniformly picked member. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates copy — never mutates the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` distinct members, order randomized. */
  sample<T>(items: readonly T[], count: number): T[];
};

/** mulberry32 core, seeded from a string. */
export function makeRng(seed: string): Rng {
  let a = cyrb128(seed)[0];

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (max: number): number => Math.floor(next() * max);

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('makeRng: pick() on an empty list');
    return items[int(items.length)]!;
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  };

  const sample = <T,>(items: readonly T[], count: number): T[] =>
    shuffle(items).slice(0, Math.min(count, items.length));

  return { next, int, pick, shuffle, sample };
}

/**
 * Derive an independent sub-seed. The reducer draws its randomness in a fixed,
 * documented order (word → hint → imposters → turn order → distractors) so
 * that adding a future draw can't shift the existing ones.
 */
export function subSeed(seed: string, purpose: string): string {
  return `${seed}::${purpose}`;
}
