/* The player's profile and best scores, kept in this browser only. */

export type Profile = { name: string; avatar: string }
export type Best = { key: string; name: string; score: number; at: number }

export const AVATARS = ['🎧', '🎸', '🎤', '🎹', '🥁', '🎷', '🐱', '🦊', '🐼', '👾']

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

export const readProfile = () => read<Profile>('tl-profile', { name: '', avatar: AVATARS[0] })
export const saveProfile = (p: Profile) => write('tl-profile', p)

export const readBests = () => read<Best[]>('tl-bests', [])
/** Records a score; returns whether it beat the old best for that quiz. */
export function saveBest(b: Best) {
  const all = readBests()
  const old = all.find((x) => x.key === b.key)
  if (old && old.score >= b.score) return false
  write('tl-bests', [b, ...all.filter((x) => x.key !== b.key)].slice(0, 30))
  return true
}

/** The daily challenge: today's best score and right/wrong row, to show on the home page and share. */
export type Daily = { day: string; score: number; marks: boolean[] }
export const readDaily = (day: string) => {
  const d = read<Daily | null>('tl-daily', null)
  return d?.day === day ? d : null
}
export function saveDaily(d: Daily) {
  const old = readDaily(d.day)
  if (!old || d.score > old.score) write('tl-daily', d)
}
