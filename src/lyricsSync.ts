// Deezer's 30-second preview almost always starts 48.2s into the song (measured by transcribing
// previews and matching the words to timed lyrics), so a lyric sung at song second T is heard at
// clip second T - PREVIEW_START. A few songs start elsewhere, so each clip is checked: the voice
// in it has to line up with the lyrics at 48.2s, or the song is skipped.

import type { Song } from './types'
import { shuffle } from './random'

export type SyncedLine = { time: number; text: string }

export const PREVIEW_START = 48.2
/** How strongly the voice must match the lyrics at PREVIEW_START (two z-scores added up). */
const MATCH_NEEDED = 3
/** How much better a start a few seconds away may fit (badly timed lyrics fit elsewhere). */
const NEARBY_BETTER_MAX = 0.15

export type SyncedQuestion = {
  /** Clip second to start playing from. */
  from: number
  /** Clip second each context line starts being sung. */
  cues: number[]
  context: string[]
  /** Clip second to stop the music: just before the answer line is sung. */
  stopAt: number
  answer: string
  /** Other lines of the same song that can't be mistaken for the answer. */
  wrongs: string[]
}

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** A line reduced to its words, so lines that only differ in case, punctuation or odd spaces count as one. */
export const lineKey = key

/** Pick lines sung inside the clip: a few to show, then the one to guess. */
export function buildQuestion(lines: SyncedLine[], rand = Math.random, offset = PREVIEW_START, clipLen = 30): SyncedQuestion | null {
  const inClip = (t: number) => t - offset >= 1 && t - offset <= clipLen - 1
  const picks: Array<[number, number]> = []
  for (let i = 0; i < lines.length; i++) {
    for (let n = 4; n >= 2; n--) {
      const j = i + n
      if (j >= lines.length || !inClip(lines[i].time) || !inClip(lines[j].time)) continue
      if (lines[j].time - lines[i].time < 3) continue
      if (key(lines[j].text).length < 4) continue
      picks.push([i, n])
      break
    }
  }
  if (!picks.length) return null
  const most = Math.max(...picks.map((p) => p[1]))
  const pool = picks.filter((p) => p[1] === most)
  const [i, n] = pool[Math.floor(rand() * pool.length)]
  const ctx = lines.slice(i, i + n)
  const ans = lines[i + n]

  // a short lead-in before the first shown line; if another line is sung in it, start near its end
  let from = Math.max(0, ctx[0].time - offset - 2.5)
  const prev = lines[i - 1]
  if (prev && prev.time - offset > from) from = Math.max(0, prev.time - offset + 0.6 * (ctx[0].time - prev.time))

  const lastKey = key(ctx[ctx.length - 1].text)
  const banned = new Set([key(ans.text), ...ctx.map((l) => key(l.text))])
  // whatever follows the last shown line elsewhere in the song would also be "right"
  lines.forEach((l, k) => { if (key(l.text) === lastKey && lines[k + 1]) banned.add(key(lines[k + 1].text)) })
  const wrongs: string[] = []
  for (const l of lines) {
    const k = key(l.text)
    if (k.length < 4 || banned.has(k)) continue
    banned.add(k)
    wrongs.push(l.text)
  }
  for (let a = wrongs.length - 1; a > 0; a--) {
    const b = Math.floor(rand() * (a + 1))
    ;[wrongs[a], wrongs[b]] = [wrongs[b], wrongs[a]]
  }
  return {
    from,
    cues: ctx.map((l) => l.time - offset),
    context: ctx.map((l) => l.text),
    stopAt: ans.time - offset - 0.15,
    answer: ans.text,
    wrongs,
  }
}

/** Thrown when LRCLIB (or the connection) was busy: the song may still have lyrics, so ask again later. */
const BUSY = new Error('busy')

// LRCLIB turns lookups away when many come at once (half a playlist was lost that way), so only a
// few are asked at a time; the rest of each song's check (Deezer, the clip) still runs in parallel
const lyricsSlots = { free: 4, waiting: [] as Array<() => void> }
async function inLyricsSlot<T>(job: () => Promise<T>): Promise<T> {
  if (lyricsSlots.free > 0) lyricsSlots.free--
  else await new Promise<void>((r) => lyricsSlots.waiting.push(r))
  try {
    return await job()
  } finally {
    // hand the slot straight to the next in line, or give it back
    const next = lyricsSlots.waiting.shift()
    if (next) next()
    else lyricsSlots.free++
  }
}

/** Timed lyrics for a song, or null when there are none we trust. */
export async function fetchSyncedLines(song: { title: string; artist: string; duration?: number; album?: string }): Promise<SyncedLine[] | null> {
  const params: Record<string, string> = { title: song.title, artist: song.artist }
  if (song.duration) params.duration = String(song.duration)
  if (song.album) params.album = song.album
  let lj
  try {
    lj = await inLyricsSlot(async () => (await fetch(`/api/lyrics?${new URLSearchParams(params)}`)).json())
  } catch {
    throw BUSY
  }
  if (lj.busy) throw BUSY
  return lj.found && Array.isArray(lj.lines) ? (lj.lines as SyncedLine[]) : null
}

// ---------- checking a clip against its lyrics ----------

const FPS = 20
const WIN = 2048

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** Per frame: loudness of the center-panned mid band (where a lead voice sits), and of the whole mid band. */
function voiceFeatures(buf: AudioBuffer) {
  const sr = buf.sampleRate
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const hop = Math.round(sr / FPS)
  const lo = Math.round((200 * WIN) / sr), hi = Math.round((5000 * WIN) / sr)
  const hann = new Float32Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN))
  const mr = new Float32Array(WIN), mi = new Float32Array(WIN), sR = new Float32Array(WIN), sI = new Float32Array(WIN)
  const center: number[] = [], band: number[] = []
  for (let st = 0; st + WIN <= L.length; st += hop) {
    for (let i = 0; i < WIN; i++) {
      const l = L[st + i], r = R[st + i]
      mr[i] = ((l + r) / 2) * hann[i]; mi[i] = 0
      sR[i] = ((l - r) / 2) * hann[i]; sI[i] = 0
    }
    fft(mr, mi)
    fft(sR, sI)
    let c = 0, b = 0
    for (let k = lo; k < hi; k++) {
      const m = Math.hypot(mr[k], mi[k]), s = Math.hypot(sR[k], sI[k])
      const d = m - 1.5 * s
      if (d > 0) c += d * d
      b += m * m
    }
    center.push(Math.log(1e-6 + c))
    band.push(Math.log(1e-6 + b))
  }
  return [center, band]
}

/** 1 while a line is being sung, over the whole song. */
function singing(lines: SyncedLine[], total: number) {
  const n = Math.ceil(total * FPS)
  const out = new Array<number>(n).fill(0)
  lines.forEach((l, i) => {
    const words = l.text.split(/\s+/).length
    const next = lines[i + 1]?.time ?? l.time + 8
    const end = Math.min(next - 0.1, l.time + Math.min(8, Math.max(1.5, words * 0.45 + 0.6)))
    for (let f = Math.max(0, Math.floor(l.time * FPS)); f < Math.min(n, Math.ceil(end * FPS)); f++) out[f] = 1
  })
  return out
}

function corr(a: number[], b: number[], off: number) {
  let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0
  const n = a.length
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i + off] ?? 0
    sa += x; sb += y; sab += x * y; saa += x * x; sbb += y * y
  }
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0
}

/**
 * How unusually well the voice lines up with the lyrics if the clip starts at `start` (a z-score),
 * and by how much some nearby start (±8s) would fit better.
 */
function matchAt(feat: number[], lines: SyncedLine[], songDuration: number, start: number) {
  const sm = feat.map((_, i) => {
    let s = 0, c = 0
    for (let d = -3; d <= 3; d++) if (feat[i + d] !== undefined) { s += feat[i + d]; c++ }
    return s / c
  })
  // leave out the fade in/out
  const clip = sm.slice(FPS, sm.length - FPS)
  const total = Math.max(songDuration, (lines[lines.length - 1]?.time ?? 0) + 10)
  const sing = singing(lines, total)
  const maxOff = Math.max(0, Math.floor((total - clip.length / FPS - 2) * FPS))
  const all: number[] = []
  for (let o = 0; o <= maxOff; o += 5) all.push(corr(clip, sing, o + FPS))
  const mean = all.reduce((s, v) => s + v, 0) / all.length
  const sd = Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / all.length) || 1
  let here = -Infinity, near = -Infinity
  for (let o = Math.round((start - 8) * FPS); o <= Math.round((start + 8) * FPS); o++) {
    if (o < 0) continue
    const c = corr(clip, sing, o + FPS)
    near = Math.max(near, c)
    if (Math.abs(o / FPS - start) <= 1) here = Math.max(here, c)
  }
  return { z: (here - mean) / sd, gap: near - here }
}

/** Whether a decoded clip lines up with the lyrics when it starts at PREVIEW_START. */
export function clipFits(buf: AudioBuffer, lines: SyncedLine[], songDuration: number) {
  const m = voiceFeatures(buf).map((f) => matchAt(f, lines, songDuration, PREVIEW_START))
  const z = m.reduce((s, x) => s + x.z, 0), gap = m.reduce((s, x) => s + x.gap, 0)
  return { z, gap, ok: z >= MATCH_NEEDED && gap <= NEARBY_BETTER_MAX }
}

export type ReadyQuestion = SyncedQuestion & { song: Song; audioUrl: string }

/** Download a song's clip, check it lines up with its lyrics, and build its question. */
async function prepare(song: Song, ctx: BaseAudioContext): Promise<ReadyQuestion | null> {
  if (!song.preview) return null
  const lines = await fetchSyncedLines(song)
  const sq = lines && buildQuestion(lines)
  if (!lines || !sq) return null
  const bytes = await (await fetch(song.preview)).arrayBuffer()
  const buf = await ctx.decodeAudioData(bytes.slice(0))
  if (!clipFits(buf, lines, song.duration || buf.duration).ok) return null
  return { ...sq, song, audioUrl: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) }
}

/** A song from a Spotify playlist, still to be found on Deezer (for its clip). */
type Listed = { title: string; artist: string }
export type Candidate = Song | Listed

async function findOnDeezer(t: Listed): Promise<Song | null> {
  const r = await fetch(`/api/deezer?${new URLSearchParams({ find: t.title, artist: t.artist })}`)
  return r.ok ? r.json() : null
}

/**
 * Every song a lyrics quiz can try, and the quiz's name. A Spotify playlist offers all its songs
 * (Spotify shows up to 100), each found on Deezer only when its turn comes, since only some
 * will have lyrics that line up with their clip; other quizzes come with their clips already.
 */
export async function lyricsCandidates(query: string): Promise<{ name?: string; songs: Candidate[]; error?: string }> {
  const p = new URLSearchParams(query)
  const url = p.get('kind') === 'playlist' ? `/api/playlist?${new URLSearchParams({ url: p.get('url') ?? '' })}` : `/api/quiz?${query}&want=all`
  const j = await fetch(url)
    .then((r) => r.json())
    .catch(() => ({ error: 'Tidak bisa tersambung. Coba lagi.' }))
  if (j.error || !j.tracks) return { songs: [], error: j.error ?? 'Kuis tidak bisa dimuat.' }
  // the same song twice (or in two versions: "(feat. …)", "- Remastered") would be the same question twice
  const bare = (title: string) => key(title.replace(/\s*[([].*$|\s+-\s.*$/, '')) || key(title)
  const seen = new Set<string>()
  const songs = (j.tracks as Candidate[]).filter((t) => {
    const k = `${bare(t.title)}|${key(t.artist.split(',')[0])}`
    return !seen.has(k) && !!seen.add(k)
  })
  return { name: j.name, songs }
}

/** How far loading has got: songs checked of all of them, and how many of those made a question (of `want`). */
export type LoadProgress = { checked: number; total: number; found: number; want: number }

/**
 * Questions from songs whose clip lines up with their lyrics, up to `want` of them, in random
 * order. Each is handed to `onReady` as soon as it's checked, so play can start before all are.
 */
export async function loadSyncedQuestions(
  songs: Candidate[],
  want: number,
  onReady: (q: ReadyQuestion) => void,
  { cancelled = () => false, onProgress }: { cancelled?: () => boolean; onProgress?: (p: LoadProgress) => void } = {},
) {
  const queue = shuffle(songs, Math.random)
  const ctx = new OfflineAudioContext(2, 1, 44100)
  const tries = new Map<Candidate, number>()
  let found = 0
  let checked = 0
  const report = () => onProgress?.({ checked, total: songs.length, found, want })
  const worker = async () => {
    while (found < want && queue.length && !cancelled()) {
      const next = queue.shift()!
      let song: Song | null = null
      try {
        song = 'id' in next ? next : await findOnDeezer(next)
        const q = song && (await prepare(song, ctx))
        if (q && found < want && !cancelled()) {
          found++
          onReady(q)
        } else if (q) URL.revokeObjectURL(q.audioUrl)
      } catch (e) {
        // LRCLIB was busy, not out of lyrics: two more goes for this song, at the back of the queue
        const again = song ?? next
        const n = tries.get(again) ?? 0
        if (e === BUSY && n < 2) {
          tries.set(again, n + 1)
          queue.push(again)
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
      }
      checked++
      if (!cancelled()) report()
    }
  }
  report()
  // most of the wait is the lyrics lookup, so several songs are checked at once
  await Promise.all(Array.from({ length: 10 }, worker))
  return found
}

/** Index of the last cue reached at clip second t (-1 before the first). */
export function cueAt(cues: number[], t: number) {
  let k = -1
  while (k + 1 < cues.length && cues[k + 1] - 0.1 <= t) k++
  return k
}
