/*
 * How hard a quiz is. Harder levels give less time, start the song somewhere in the middle, hide
 * the singer under each title, pick the other choices from the same singer where they can, cut the
 * song short and take lifelines away; they pay more points for it.
 */

export type Level = 'santai' | 'normal' | 'sulit' | 'ahli'

export type LevelRules = {
  label: string
  /** Seconds to answer. */
  seconds: number
  /** How long the song plays (null: until you answer). */
  listen: number | null
  /** Start somewhere inside the preview instead of at its beginning. */
  randomStart: boolean
  /** Hide the singer under each title. */
  hideArtist: boolean
  /** Choose the wrong answers from the same singer's songs when the quiz has them. */
  sameArtist: boolean
  fifty: boolean
  extra: boolean
  /** Points multiplier. */
  factor: number
}

export const LEVELS: Record<Level, LevelRules> = {
  santai: { label: 'Santai', seconds: 15, listen: null, randomStart: false, hideArtist: false, sameArtist: false, fifty: true, extra: true, factor: 1 },
  normal: { label: 'Normal', seconds: 10, listen: null, randomStart: false, hideArtist: false, sameArtist: false, fifty: true, extra: true, factor: 1.2 },
  sulit: { label: 'Sulit', seconds: 7, listen: null, randomStart: true, hideArtist: true, sameArtist: true, fifty: true, extra: false, factor: 1.5 },
  ahli: { label: 'Ahli', seconds: 5, listen: 3, randomStart: true, hideArtist: true, sameArtist: true, fifty: false, extra: false, factor: 2 },
}

export const LEVEL_ORDER: Level[] = ['santai', 'normal', 'sulit', 'ahli']
