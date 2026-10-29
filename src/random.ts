/** A random number source: Math.random, or any function like it. */
export type Rng = () => number

export function shuffle<T>(list: T[], rng: Rng = Math.random) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
