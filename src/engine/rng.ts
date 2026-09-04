// Единственный источник случайности для движка. Все формулы принимают
// rng: () => number вместо Math.random() напрямую — edge case раздела 26
// спеки: это даёт детерминированные юнит-тесты (сидированный генератор) при
// живой игре на несидированном.

/** mulberry32 — маленький, быстрый, детерминированный PRNG для тестов. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Живой RNG для игры — не воспроизводим, сидирован временем при каждом вызове. */
export function liveRng(): () => number {
  return Math.random;
}
