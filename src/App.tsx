import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, FileText, Music2, Pause, Play, Search, SkipForward, X } from 'lucide-react'
import { norm, sameArtist } from '../api/_match.js'

/*
 * Tebak Lagu: a song from the playlist plays for 15 seconds; guess it, or skip to hear a little
 * more (18, 21, 24, 27, 30 s, the whole preview). Six tries; the sooner you get it, the more points. Song lists come
 * from a Spotify playlist, the audio from Deezer's 30-second previews.
 */

const DEFAULT_PLAYLIST = 'https://open.spotify.com/playlist/16iEQxHem0W1B5Di8jCpjH'
const CLIPS = [15, 18, 21, 24, 27, 30]
/** The whole bar: Deezer's previews are 30 seconds. */
const FULL = CLIPS[CLIPS.length - 1]
const POINTS = [100, 80, 60, 40, 25, 10]

type Track = { uri: string; title: string; artist: string }
type Playlist = { name: string; tracks: Track[] }
type Song = { id: number; title: string; artist: string; cover: string; preview?: string; link: string }
type Guess = { kind: 'skip' } | { kind: 'wrong' | 'right'; label: string }
type Round = { n: number; track: Track; answer: Song; guesses: Guess[]; over: boolean; won: boolean }

function shuffle<T>(list: T[]) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function readBest() {
  try {
    return Number(localStorage.getItem('tebak-lagu-best')) || 0
  } catch {
    return 0
  }
}

/** One audio element for the round: play from the top for `limit` seconds, with the time for the bar. */
function useClip(src: string | undefined) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const raf = useRef(0)

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    audio.current?.pause()
    setPlaying(false)
  }, [])

  useEffect(() => {
    if (!src) return
    const a = new Audio(src)
    a.preload = 'auto'
    audio.current = a
    setTime(0)
    return () => {
      cancelAnimationFrame(raf.current)
      a.pause()
      a.src = ''
      setPlaying(false)
    }
  }, [src])

  const play = useCallback(
    (limit: number) => {
      const a = audio.current
      if (!a) return
      cancelAnimationFrame(raf.current)
      a.currentTime = 0
      a.play().then(
        () => {
          setPlaying(true)
          const tick = () => {
            setTime(a.currentTime)
            if (a.currentTime >= limit || a.ended) return stop()
            raf.current = requestAnimationFrame(tick)
          }
          raf.current = requestAnimationFrame(tick)
        },
        () => setPlaying(false),
      )
    },
    [stop],
  )

  return { play, stop, playing, time }
}

type Genius = { configured?: boolean; found?: boolean; id?: number; url?: string }

/** The page Genius's embed runs in: its script writes the lyrics in as the page loads, with Genius's own credit and links. */
function geniusPage(id: number, url: string, title: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:4px 2px;background:#0d1020;color:#eef0ff;font:14px/1.7 'Plus Jakarta Sans',system-ui,sans-serif}a{color:#8b8cff}</style></head>
<body><div id="rg_embed_link_${id}" class="rg_embed_link" data-song-id="${id}">Baca lirik “${esc(title)}” di <a href="${esc(url)}">Genius</a></div>
<script crossorigin src="https://genius.com/songs/${id}/embed.js"></script></body></html>`
}

/**
 * The song's lyrics on the answer card, as Genius's own embed: Genius shows them, with its credit
 * and links; the game only finds the song on Genius and keeps no lyrics itself. The embed runs in
 * a sandboxed frame so its script can't touch the game. Without a Genius token, or for a song
 * Genius doesn't have, there are links to the lyrics on Spotify and Genius instead.
 */
function LyricsPanel({ title, artist, spotify }: { title: string; artist: string; spotify: string }) {
  const [genius, setGenius] = useState<Genius | null>(null)
  useEffect(() => {
    let alive = true
    setGenius(null)
    fetch(`/api/genius?${new URLSearchParams({ title, artist })}`)
      .then((r) => r.json())
      .catch(() => ({ found: false }))
      .then((j: Genius) => alive && setGenius(j))
    return () => {
      alive = false
    }
  }, [title, artist])

  if (!genius) return <p className="lyrics-note">Mencari lirik…</p>
  if (!genius.found || !genius.id || !genius.url) {
    const search = `https://genius.com/search?q=${encodeURIComponent(`${artist.split(',')[0]} ${norm(title)}`)}`
    return (
      <p className="lyrics-note">
        <FileText size={14} /> Lirik:{' '}
        <a href={spotify} target="_blank" rel="noreferrer">
          Spotify
        </a>{' '}
        ·{' '}
        <a href={search} target="_blank" rel="noreferrer">
          Genius
        </a>
      </p>
    )
  }
  return (
    <details className="lyrics" open>
      <summary>
        <FileText size={14} /> Lirik · Genius
      </summary>
      <iframe
        className="lyrics-frame"
        title={`Lirik ${title} dari Genius`}
        srcDoc={geniusPage(genius.id, genius.url, title)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        loading="lazy"
      />
    </details>
  )
}

/** The guess box: type, pick a song from Deezer's results (Enter takes the first). */
function GuessBox({ onGuess, disabled }: { onGuess: (s: Song) => void; disabled: boolean }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Song[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    const words = q.trim()
    if (words.length < 2) return setResults([])
    let alive = true
    const id = setTimeout(async () => {
      const r: Song[] = await fetch(`/api/deezer?q=${encodeURIComponent(words)}`)
        .then((x) => (x.ok ? x.json() : []))
        .catch(() => [])
      if (alive) {
        setResults(r)
        setActive(0)
      }
    }, 280)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q])

  const pick = (s: Song) => {
    onGuess(s)
    setQ('')
    setResults([])
  }

  return (
    <div className="guess">
      <label className="guess-input">
        <Search size={17} aria-hidden />
        <input
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1))
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0))
            else if (e.key === 'Enter' && results[active]) pick(results[active])
            else if (e.key === 'Escape') setResults([])
            else return
            e.preventDefault()
          }}
          placeholder="Tebak judul atau penyanyinya…"
          aria-label="Tebakan"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {results.length > 0 && (
        <ul className="suggestions" role="listbox">
          {results.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active}>
              <button onMouseEnter={() => setActive(i)} onClick={() => pick(s)}>
                <img src={s.cover} alt="" loading="lazy" />
                <span>
                  <b>{s.title}</b>
                  <small>{s.artist}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<Track[]>([])
  const [round, setRound] = useState<Round | null>(null)
  const [loading, setLoading] = useState(false)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(readBest)
  const [link, setLink] = useState('')
  const next = useRef(0)

  const { play, stop, playing, time } = useClip(round?.answer.preview)

  const load = useCallback(async (url: string) => {
    setError(null)
    setRound(null)
    const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`).catch(() => null)
    const j = res ? await res.json().catch(() => null) : null
    if (!res?.ok || !j?.tracks) return setError(j?.error ?? 'Playlist tidak bisa dimuat.')
    setPlaylist(j)
    setOrder(shuffle(j.tracks))
    next.current = 0
  }, [])

  useEffect(() => {
    load(DEFAULT_PLAYLIST)
  }, [load])

  /** Moves on to the next song that has a preview (some songs aren't on Deezer). */
  const newRound = useCallback(async () => {
    if (!order.length) return
    stop()
    setLoading(true)
    for (let tries = 0; tries < 8; tries++) {
      const i = next.current++ % order.length
      if (next.current % order.length === 0) setOrder((o) => shuffle(o))
      const track = order[i]
      const res = await fetch(`/api/deezer?${new URLSearchParams({ find: track.title, artist: track.artist })}`).catch(() => null)
      if (!res?.ok) continue
      const answer: Song = await res.json()
      setRound((r) => ({ n: (r?.n ?? 0) + 1, track, answer, guesses: [], over: false, won: false }))
      setLoading(false)
      return
    }
    setLoading(false)
    setError('Cuplikan lagu belum bisa diambil sekarang. Coba lagi sebentar lagi.')
  }, [order, stop])

  const unlocked = round ? CLIPS[Math.min(round.guesses.length, CLIPS.length - 1)] : CLIPS[0]

  const finish = (r: Round, won: boolean) => {
    stop()
    if (won) {
      const gained = POINTS[r.guesses.length - 1]
      setScore((s) => s + gained)
      setStreak((s) => s + 1)
      const total = score + gained
      if (total > best) {
        setBest(total)
        try {
          localStorage.setItem('tebak-lagu-best', String(total))
        } catch {
          /* storage unavailable */
        }
      }
    } else setStreak(0)
    return { ...r, over: true, won }
  }

  const guess = (s: Song) => {
    if (!round || round.over) return
    const right = s.id === round.answer.id || (norm(s.title) === norm(round.answer.title) && (sameArtist(round.answer.artist, s.artist) || sameArtist(round.track.artist, s.artist)))
    const r: Round = { ...round, guesses: [...round.guesses, { kind: right ? 'right' : 'wrong', label: `${s.title} · ${s.artist}` }] }
    setRound(right || r.guesses.length >= CLIPS.length ? finish(r, right) : r)
  }

  const skip = () => {
    if (!round || round.over) return
    const r: Round = { ...round, guesses: [...round.guesses, { kind: 'skip' }] }
    if (r.guesses.length >= CLIPS.length) return setRound(finish(r, false))
    setRound(r)
    // play the longer clip straight away
    play(CLIPS[r.guesses.length])
  }

  const spotifyLink = round ? `https://open.spotify.com/track/${round.track.uri.split(':')[2]}` : ''

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <Music2 size={18} />
          </span>
          <div>
            <b>Tebak Lagu</b>
            <small>by Tirta</small>
          </div>
        </div>
        <dl className="stats">
          <div>
            <dt>Skor</dt>
            <dd>{score}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{streak}</dd>
          </div>
          <div>
            <dt>Terbaik</dt>
            <dd>{best}</dd>
          </div>
        </dl>
      </header>

      <main className="card">
        {error && <p className="note error">{error}</p>}
        {!playlist && !error && <p className="note">Memuat playlist…</p>}

        {playlist && !round && (
          <div className="intro">
            <span className="disc" aria-hidden />
            <h1>Seberapa kenal kamu playlist ini?</h1>
            <p>
              Dengar potongan lagu dari <b>{playlist.name}</b> ({playlist.tracks.length} lagu), lalu tebak judulnya. Mulai dari 15 detik; tiap kali
              lewati, potongannya makin panjang. Makin cepat benar, makin banyak poin.
            </p>
            <button className="primary" onClick={newRound} disabled={loading}>
              {loading ? 'Menyiapkan lagu…' : 'Mulai main'}
            </button>
          </div>
        )}

        {round && (
          <>
            <div className="round-head">
              <span>Lagu #{round.n}</span>
              <span>{playlist?.name}</span>
            </div>

            <ol className="tries">
              {CLIPS.map((_, i) => {
                const g = round.guesses[i]
                return (
                  <li key={i} className={g ? g.kind : i === round.guesses.length && !round.over ? 'now' : ''}>
                    {g?.kind === 'skip' && <span className="muted">Dilewati</span>}
                    {g && g.kind !== 'skip' && (
                      <>
                        {g.kind === 'right' ? <Check size={15} /> : <X size={15} />}
                        <span>{g.label}</span>
                      </>
                    )}
                  </li>
                )
              })}
            </ol>

            {/* the clip bar: the whole 30 s preview, lit up to the part you can hear now */}
            <div className="clip" aria-hidden>
              <span className="clip-open" style={{ width: `${((round.over ? FULL : unlocked) / FULL) * 100}%` }} />
              <span className="clip-time" style={{ width: `${(Math.min(time, FULL) / FULL) * 100}%`, opacity: playing ? 1 : 0 }} />
              {CLIPS.slice(0, -1).map((c) => (
                <i key={c} style={{ left: `${(c / FULL) * 100}%` }} />
              ))}
            </div>

            {!round.over ? (
              <>
                <div className="controls">
                  <button className="play" onClick={() => (playing ? stop() : play(unlocked))} aria-label={playing ? 'Berhenti' : `Putar ${unlocked} detik`}>
                    {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                  </button>
                  <span className="hint">
                    Dengar <b>{unlocked} detik</b>
                  </span>
                </div>
                <GuessBox onGuess={guess} disabled={round.over} />
                <div className="actions">
                  <button className="ghost" onClick={skip}>
                    <SkipForward size={16} />
                    {round.guesses.length < CLIPS.length - 1 ? `Lewati (+${CLIPS[round.guesses.length + 1] - unlocked} dtk)` : 'Menyerah'}
                  </button>
                </div>
              </>
            ) : (
              <div className={`reveal ${round.won ? 'won' : 'lost'}`}>
                <img src={round.answer.cover} alt="" />
                <div>
                  <small>{round.won ? `Benar! +${POINTS[round.guesses.length - 1]} poin` : 'Belum kena. Lagunya:'}</small>
                  <b>{round.track.title}</b>
                  <span>{round.track.artist}</span>
                  <div className="reveal-links">
                    <button className="ghost small" onClick={() => (playing ? stop() : play(30))}>
                      {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Berhenti' : 'Dengar 30 dtk'}
                    </button>
                    <a className="ghost small" href={spotifyLink} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Spotify
                    </a>
                  </div>
                </div>
                <LyricsPanel title={round.track.title} artist={round.track.artist} spotify={spotifyLink} />
                <button className="primary" onClick={newRound} disabled={loading}>
                  {loading ? 'Menyiapkan…' : 'Lagu berikutnya'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="foot">
        <form
          className="swap"
          onSubmit={(e) => {
            e.preventDefault()
            if (link.trim()) load(link.trim()).then(() => setLink(''))
          }}
        >
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Tempel link playlist Spotify lain…" aria-label="Link playlist Spotify" />
          <button className="ghost small" type="submit">
            Ganti
          </button>
        </form>
        <p>
          Cuplikan lagu dari{' '}
          <a href="https://www.deezer.com" target="_blank" rel="noreferrer">
            Deezer
          </a>{' '}
          · daftar lagu dari Spotify
        </p>
      </footer>
    </div>
  )
}
