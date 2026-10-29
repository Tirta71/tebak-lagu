import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Link2, Mic2, Music, Search, Shuffle, Trophy, User, Users, Zap } from 'lucide-react'
import { Bit } from './Bit'
import { AVATARS, readBests, readDaily, saveProfile, type Profile } from './local'
import { LEVELS, LEVEL_ORDER, type Level } from './levels'
import { today } from './random'
import type { Count, Mode, QuizSource } from './types'

type Artist = { id: number; name: string; picture: string; fans: number }
type Genre = { id: number; name: string; picture: string }
type Catalog = { artists: Artist[]; genres: Genre[]; decades: number[]; error?: string }

const PETRO_JAM = 'https://open.spotify.com/playlist/16iEQxHem0W1B5Di8jCpjH'
const COUNTS: Count[] = [5, 10, 15, 20]

/** A quiz to pick: a picture card (or a coloured one), its name over a shade at the bottom. */
function Tile({ name, sub, picture, round, tint, onPick }: { name: string; sub?: string; picture?: string | null; round?: boolean; tint?: string; onPick: () => void }) {
  // Deezer's stand-in for artists without a photo ("…/images/artist//…"): use a coloured card
  if (picture?.includes('/artist//')) picture = null
  if (round && !picture) tint ??= 'linear-gradient(150deg,#9d8cff,#ff8ab4)'
  return (
    <button className={`tile${round ? ' round' : ''}`} onClick={onPick} style={picture || round ? undefined : { background: tint }}>
      {picture ? <img src={picture} alt="" loading="lazy" /> : round && <span className="initial" style={{ background: tint }} aria-hidden>{name.slice(0, 1)}</span>}
      <span className="tile-text">
        <b>{name}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  )
}

/** A row of quizzes that scrolls sideways, with arrow buttons on wide screens. */
function Shelf({ title, id, children, extra }: { title: string; id?: string; children: ReactNode; extra?: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  const move = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="shelf" id={id}>
      <div className="shelf-head">
        <h2>{title}</h2>
        <span className="shelf-arrows">
          <button aria-label="Geser ke kiri" onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button aria-label="Geser ke kanan" onClick={() => move(1)}>
            <ChevronRight size={18} />
          </button>
        </span>
      </div>
      {extra}
      <div className="shelf-row" ref={row}>
        {children}
      </div>
    </section>
  )
}

function ProfileCard({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const set = (p: Profile) => {
    onChange(p)
    saveProfile(p)
  }
  return (
    <section className="panel profile">
      <h2>
        <User size={16} /> Profil kamu
      </h2>
      <div className="avatars" role="radiogroup" aria-label="Avatar">
        {AVATARS.map((a) => (
          <button key={a} role="radio" aria-checked={profile.avatar === a} className="avatar" onClick={() => set({ ...profile, avatar: a })}>
            {a}
          </button>
        ))}
      </div>
      <input className="field" value={profile.name} maxLength={18} onChange={(e) => set({ ...profile, name: e.target.value })} placeholder="Nama panggilan" aria-label="Nama panggilan" />
    </section>
  )
}

const DECADE_TINTS = ['linear-gradient(135deg,#f6a54a,#d9534f)', 'linear-gradient(135deg,#ff6fb5,#7b4dff)', 'linear-gradient(135deg,#3fd6c6,#2f6fe0)', 'linear-gradient(135deg,#9d8cff,#3b3fc4)', 'linear-gradient(135deg,#ffcf5c,#f0662f)', 'linear-gradient(135deg,#5ee0a0,#1f8f73)']

export function Home({ profile, onProfile, onStart: start }: { profile: Profile; onProfile: (p: Profile) => void; onStart: (q: QuizSource) => void }) {
  // guess the title or the singer; remembered in this browser
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const v = localStorage.getItem('tl-mode')
      return v === 'artist' || v === 'both' ? v : 'title'
    } catch {
      return 'title'
    }
  })
  const pickMode = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem('tl-mode', m)
    } catch {
      /* storage unavailable */
    }
  }
  // how hard; remembered too
  const [level, setLevel] = useState<Level>(() => {
    try {
      const v = localStorage.getItem('tl-level') as Level | null
      return v && v in LEVELS ? v : 'normal'
    } catch {
      return 'normal'
    }
  })
  const pickLevel = (l: Level) => {
    setLevel(l)
    try {
      localStorage.setItem('tl-level', l)
    } catch {
      /* storage unavailable */
    }
  }
  // how many songs; remembered too
  const [count, setCount] = useState<Count>(() => {
    try {
      const v = localStorage.getItem('tl-count')
      return v === 'all' ? 'all' : COUNTS.includes(Number(v) as Count) ? (Number(v) as Count) : 10
    } catch {
      return 10
    }
  })
  const pickCount = (c: Count) => {
    setCount(c)
    try {
      localStorage.setItem('tl-count', String(c))
    } catch {
      /* storage unavailable */
    }
  }
  // artist quizzes are always "guess the title": every song is by the same singer
  const onStart = (q: QuizSource) => start({ ...q, level, count, mode: q.key.startsWith('artist:') ? 'title' : mode })
  const day = today()
  const daily = readDaily(day)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Artist[] | null>(null)
  const [link, setLink] = useState('')
  const bests = readBests().sort((a, b) => b.score - a.score).slice(0, 5)

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .catch(() => ({ error: 'offline' }))
      .then(setCatalog)
  }, [])

  // artist search, once typing pauses
  useEffect(() => {
    const words = q.trim()
    if (words.length < 2) return setFound(null)
    let alive = true
    const id = setTimeout(async () => {
      const r = await fetch(`/api/catalog?artist=${encodeURIComponent(words)}`)
        .then((x) => x.json())
        .catch(() => ({ artists: [] }))
      if (alive) setFound(r.artists ?? [])
    }, 300)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [q])

  const artist = (a: Artist) => onStart({ key: `artist:${a.id}`, name: a.name, query: `kind=artist&id=${a.id}`, picture: a.picture })
  const scrollToQuizzes = () => document.getElementById('kuis')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <section className="hero">
        <div>
          <span className="pill">Kuis musik · gratis</span>
          <h1>
            Dengar sebentar,
            <br />
            <span>tebak lagunya.</span>
          </h1>
          {/* follows the settings below */}
          <p>
            {count === 'all' ? 'Semua lagu di kuis' : `${count} lagu per kuis`}, 4 pilihan jawaban, {LEVELS[level].seconds} detik untuk menjawab. Makin cepat benar, makin
            besar poinnya.
          </p>
          <div className="hero-facts">
            <span>
              <b>{count === 'all' ? 'Semua' : count}</b> lagu
            </span>
            <span>
              <b>{LEVELS[level].seconds}</b> detik
            </span>
            <span>
              <b>{Math.round(1000 * LEVELS[level].factor)}</b> poin maks
            </span>
          </div>
        </div>
        <div className="hero-bit">
          <Bit size={190} mood="listen" />
        </div>
      </section>

      {/* the daily challenge: the same ten songs for everyone today */}
      <button className="daily" onClick={() => start({ key: 'daily', name: 'Tantangan Harian', query: 'kind=genre&id=0', mode: 'title', level: 'normal', count: 10, daily: day })}>
        <span className="daily-icon" aria-hidden>
          <CalendarDays size={24} />
        </span>
        <span className="daily-text">
          <small>Tantangan Harian · {new Intl.DateTimeFormat('id', { day: 'numeric', month: 'long' }).format(new Date())}</small>
          <b>10 lagu yang sama untuk semua orang hari ini</b>
          <span>{daily ? `Skormu hari ini: ${daily.score} · main lagi untuk memperbaiki` : 'Lagu-lagu terpopuler di dunia. Bandingkan skormu dengan teman.'}</span>
        </span>
        <em>{daily ? 'Main lagi' : 'Main'}</em>
      </button>

      <div className="two">
        <ProfileCard profile={profile} onChange={onProfile} />
        <section className="modes">
          <button className="mode solo" onClick={scrollToQuizzes}>
            <Zap size={22} />
            <b>Main sendiri</b>
            <small>Pilih kuis di bawah dan kejar skor tertinggi</small>
          </button>
          <button className="mode friends" disabled>
            <Users size={22} />
            <b>
              Main bareng teman <em>Segera</em>
            </b>
            <small>Satu room, lagu yang sama, siapa paling cepat menang</small>
          </button>
        </section>
      </div>

      {bests.length > 0 && (
        <section className="panel bests">
          <h2>
            <Trophy size={16} /> Skor terbaikmu
          </h2>
          <ol>
            {bests.map((b) => (
              <li key={b.key}>
                <span>{b.name}</span>
                <b>{b.score}</b>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* game settings: what to guess, and how hard */}
      <section className="settings">
        <div className="setting">
          <h3>Tebak apa?</h3>
          <div className="seg modes-seg" role="radiogroup" aria-label="Mode permainan">
            <button role="radio" aria-checked={mode === 'title'} onClick={() => pickMode('title')}>
              <Music size={18} />
              <b>Judul lagu</b>
            </button>
            <button role="radio" aria-checked={mode === 'artist'} onClick={() => pickMode('artist')}>
              <Mic2 size={18} />
              <b>Penyanyi</b>
            </button>
            <button role="radio" aria-checked={mode === 'both'} onClick={() => pickMode('both')}>
              <Shuffle size={18} />
              <b>Acak</b>
            </button>
          </div>
        </div>
        <div className="setting">
          <h3>Tingkat kesulitan</h3>
          <div className="seg levels" role="radiogroup" aria-label="Tingkat kesulitan">
            {LEVEL_ORDER.map((l, k) => (
              <button key={l} role="radio" aria-checked={level === l} className={`lv lv-${l}`} onClick={() => pickLevel(l)}>
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
              <button key={c} role="radio" aria-checked={count === c} onClick={() => pickCount(c)}>
                <b>{c === 'all' ? 'Semua' : c}</b>
              </button>
            ))}
          </div>
        </div>
      </section>

      <Shelf
        title="Pilihan Tirta"
        id="kuis"
        extra={
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault()
              const url = link.trim()
              if (url) onStart({ key: `playlist:${url}`, name: 'Playlist kamu', query: `kind=playlist&url=${encodeURIComponent(url)}` })
            }}
          >
            <Link2 size={16} aria-hidden />
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Tempel link playlist Spotify-mu…" aria-label="Link playlist Spotify" />
            <button className="ghost small" type="submit">
              Main
            </button>
          </form>
        }
      >
        <Tile name="Petro Jam" sub="Playlist Tirta" tint="linear-gradient(150deg,#9d8cff,#4a3fd8)" onPick={() => onStart({ key: 'petro-jam', name: 'Petro Jam', query: `kind=playlist&url=${encodeURIComponent(PETRO_JAM)}` })} />
        <Tile name="Hits Indonesia" sub="Lagu Indonesia terpopuler" tint="linear-gradient(150deg,#ff7a7a,#c3203b)" onPick={() => onStart({ key: 'indonesia', name: 'Hits Indonesia', query: 'kind=indonesia' })} />
        {catalog?.genres?.slice(0, 1).map((g) => (
          <Tile key={g.id} name={`Top ${g.name}`} sub="Chart Deezer" picture={g.picture} onPick={() => onStart({ key: `genre:${g.id}`, name: g.name, query: `kind=genre&id=${g.id}`, picture: g.picture })} />
        ))}
      </Shelf>

      <Shelf
        title="Artis"
        extra={
          <label className="search">
            <Search size={16} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari artis mana pun…" aria-label="Cari artis" />
          </label>
        }
      >
        {!catalog && Array.from({ length: 6 }, (_, k) => <span key={k} className="tile round skeleton" />)}
        {(found ?? catalog?.artists ?? []).map((a) => (
          <Tile key={a.id} round name={a.name} sub={a.fans ? `${Intl.NumberFormat('id', { notation: 'compact' }).format(a.fans)} fans` : undefined} picture={a.picture} onPick={() => artist(a)} />
        ))}
      </Shelf>
      {catalog?.error && <p className="note">Daftar kuis belum bisa dimuat. Coba muat ulang.</p>}
      {found?.length === 0 && <p className="note">Artis tidak ketemu.</p>}

      {catalog?.genres && (
        <Shelf title="Genre">
          {catalog.genres.map((g) => (
            <Tile key={g.id} name={g.name} sub="Lagu terpopuler" picture={g.picture} onPick={() => onStart({ key: `genre:${g.id}`, name: g.name, query: `kind=genre&id=${g.id}`, picture: g.picture })} />
          ))}
        </Shelf>
      )}

      {catalog?.decades && (
        <Shelf title="Dekade">
          {catalog.decades.map((d, i) => (
            <Tile key={d} name={`${String(d).slice(2)}an`} sub={`Hits ${d}-an`} tint={DECADE_TINTS[i % DECADE_TINTS.length]} onPick={() => onStart({ key: `decade:${d}`, name: `Hits ${String(d).slice(2)}an`, query: `kind=decade&id=${d}` })} />
          ))}
        </Shelf>
      )}
    </>
  )
}
