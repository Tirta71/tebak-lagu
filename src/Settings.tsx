import { useState } from 'react'
import { Mic2, Music, Shuffle } from 'lucide-react'
import { LEVELS, LEVEL_ORDER, type Level } from './levels'
import type { Count, Mode } from './types'

export const COUNTS: Count[] = [5, 10, 15, 20]

function read<T>(key: string, ok: (v: string) => T | null, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return (v !== null && ok(v)) || fallback
  } catch {
    return fallback
  }
}

function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

export type GameSettings = { mode: Mode; level: Level; count: Count }

/** What to guess, how hard, how many songs: remembered in this browser. */
export function useGameSettings() {
  const [mode, setMode] = useState<Mode>(() => read('tl-mode', (v) => (v === 'artist' || v === 'both' || v === 'title' ? v : null), 'title'))
  const [level, setLevel] = useState<Level>(() => read('tl-level', (v) => (v in LEVELS ? (v as Level) : null), 'normal'))
  const [count, setCount] = useState<Count>(() => read<Count>('tl-count', (v) => (v === 'all' ? 'all' : COUNTS.includes(Number(v) as Count) ? (Number(v) as Count) : null), 10))
  return {
    settings: { mode, level, count } as GameSettings,
    setMode: (m: Mode) => (setMode(m), keep('tl-mode', m)),
    setLevel: (l: Level) => (setLevel(l), keep('tl-level', l)),
    setCount: (c: Count) => (setCount(c), keep('tl-count', String(c))),
  }
}

/** The three rows of choices. Read-only (for guests in a room) when no setters are given. */
export function SettingsPanel({ settings, setMode, setLevel, setCount, hideMode }: { settings: GameSettings; setMode?: (m: Mode) => void; setLevel?: (l: Level) => void; setCount?: (c: Count) => void; hideMode?: boolean }) {
  const { mode, level, count } = settings
  const locked = !setMode
  return (
    <section className={`settings${locked ? ' locked' : ''}`}>
      <div className="setting" hidden={hideMode}>
        <h3>Tebak apa?</h3>
        <div className="seg modes-seg" role="radiogroup" aria-label="Mode permainan">
          <button role="radio" aria-checked={mode === 'title'} disabled={locked} onClick={() => setMode?.('title')}>
            <Music size={18} />
            <b>Judul</b>
          </button>
          <button role="radio" aria-checked={mode === 'artist'} disabled={locked} onClick={() => setMode?.('artist')}>
            <Mic2 size={18} />
            <b>Penyanyi</b>
          </button>
          <button role="radio" aria-checked={mode === 'both'} disabled={locked} onClick={() => setMode?.('both')}>
            <Shuffle size={18} />
            <b>Acak</b>
          </button>
        </div>
      </div>
      <div className="setting">
        <h3>Tingkat kesulitan</h3>
        <div className="seg levels" role="radiogroup" aria-label="Tingkat kesulitan">
          {LEVEL_ORDER.map((l, k) => (
            <button key={l} role="radio" aria-checked={level === l} disabled={locked} className={`lv lv-${l}`} onClick={() => setLevel?.(l)}>
              <b>{LEVELS[l].label}</b>
              <span className="meter" aria-hidden>
                {LEVEL_ORDER.map((_, n) => (
                  <i key={n} className={n <= k ? 'on' : ''} />
                ))}
              </span>
              <small>
                {LEVELS[l].seconds} dtk · ×{LEVELS[l].factor}
              </small>
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <h3>Jumlah lagu</h3>
        <div className="seg counts" role="radiogroup" aria-label="Jumlah lagu">
          {[...COUNTS, 'all' as const].map((c) => (
            <button key={c} role="radio" aria-checked={count === c} disabled={locked} onClick={() => setCount?.(c)}>
              <b>{c === 'all' ? 'Semua' : c}</b>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
