import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Link2, Search, Trophy, User, Users, Zap } from 'lucide-react'
import { Bit } from './Bit'
import { AVATARS, readBests, saveProfile, type Profile } from './local'
import type { QuizSource } from './types'

type Artist = { id: number; name: string; picture: string; fans: number }
type Genre = { id: number; name: string; picture: string }
type Catalog = { artists: Artist[]; genres: Genre[]; decades: number[]; error?: string }

const PETRO_JAM = 'https://open.spotify.com/playlist/16iEQxHem0W1B5Di8jCpjH'

/** A quiz to pick: a picture card (or a coloured one), its name over a shade at the bottom. */
function Tile({ name, sub, picture, round, tint, onPick }: { name: string; sub?: string; picture?: string | null; round?: boolean; tint?: string; onPick: () => void }) {
  // Deezer's grey stand-in for artists without a photo ("…/images/artist//…"): use a coloured card
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

export function Home({ profile, onProfile, onStart }: { profile: Profile; onProfile: (p: Profile) => void; onStart: (q: QuizSource) => void }) {
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
          <p>10 lagu per kuis, 4 pilihan judul, 15 detik untuk menjawab. Makin cepat benar, makin besar poinnya.</p>
          <div className="hero-facts">
            <span>
              <b>10</b> lagu
            </span>
            <span>
              <b>15</b> detik
            </span>
            <span>
              <b>1000</b> poin maks
            </span>
          </div>
        </div>
        <div className="hero-bit">
          <Bit size={190} mood="listen" />
        </div>
      </section>

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
