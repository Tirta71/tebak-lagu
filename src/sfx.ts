/*
 * Little sound effects, synthesised in the browser (no audio files): a rising chime for a right
 * answer, a low buzz for a wrong one, ticks for the last seconds and the countdown. Muting is
 * remembered in this browser.
 */

let ctx: AudioContext | null = null
let muted = (() => {
  try {
    return localStorage.getItem('tl-mute') === '1'
  } catch {
    return false
  }
})()

export const isMuted = () => muted
export function setMuted(m: boolean) {
  muted = m
  try {
    localStorage.setItem('tl-mute', m ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** One note: frequency, start offset and length in seconds, wave shape, loudness. */
function note(freq: number, at: number, len: number, type: OscillatorType = 'sine', vol = 0.12) {
  if (muted) return
  ctx ??= new AudioContext()
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + len)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + len + 0.05)
}

export const sfx = {
  right: () => {
    note(660, 0, 0.12, 'triangle')
    note(880, 0.09, 0.12, 'triangle')
    note(1320, 0.18, 0.22, 'triangle')
  },
  wrong: () => {
    note(180, 0, 0.18, 'sawtooth', 0.06)
    note(140, 0.12, 0.25, 'sawtooth', 0.06)
  },
  tick: () => note(1000, 0, 0.05, 'square', 0.04),
  count: (last = false) => note(last ? 880 : 520, 0, last ? 0.3 : 0.15, 'triangle'),
  combo: () => [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.06, 0.12, 'triangle', 0.08)),
}
