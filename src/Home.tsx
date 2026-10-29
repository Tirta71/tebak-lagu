import { useEffect, useState } from 'react'
import { Link2, Search, Trophy, User, Users, Zap } from 'lucide-react'
import { AVATARS, readBests, saveProfile, type Profile } from './local'
import type { QuizSource } from './types'

type Artist = { id: number; name: string; picture: string; fans: number }
type Genre = { id: number; name: string; picture: string }
type Catalog = { artists: Artist[]; genres: Genre[]; decades: number[]; error?: string }

const PETRO_JAM = 'https://open.spotify.com/playlist/16iEQxHem0W1B5Di8jCpjH'

/** A quiz to pick: picture (or a coloured tile), name, a line under it. */
function Tile({ name, sub, picture, round, tint, onPick }: { name: string; sub?: string; picture?: string | null; round?: boolean; tint?: string; onPick: () => void }) {
  return (
    <button className={`tile${round ? ' round' : ''}`} onClick={onPick}>
      {picture ? <img src={picture} alt="" loading="lazy" /> : <span className="tile-art" style={{ background: tint }} aria-hidden>{name}</span>}
      <b>{name}</b>
      {sub && <small>{sub}</small>}
    </button>
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
        <h1>
          Dengar sebentar,
          <br />
          <span>tebak lagunya.</span>
        </h1>
        <p>10 lagu per kuis, 4 pilihan judul, 15 detik untuk menjawab. Makin cepat benar, makin besar poinnya.</p>
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

      <section id="kuis" className="shelf">
        <h2>Pilihan Tirta</h2>
        <div className="tiles">
          <Tile name="Petro Jam" sub="Playlist Tirta" tint="linear-gradient(135deg,#8b8cff,#5b5cf0)" onPick={() => onStart({ key: 'petro-jam', name: 'Petro Jam', query: `kind=playlist&url=${encodeURIComponent(PETRO_JAM)}` })} />
          <Tile name="Hits Indonesia" sub="Lagu Indonesia terpopuler" tint="linear-gradient(135deg,#ff5f6d,#c3203b)" onPick={() => onStart({ key: 'indonesia', name: 'Hits Indonesia', query: 'kind=indonesia' })} />
        </div>
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            const url = link.trim()
            if (url) onStart({ key: `playlist:${url}`, name: 'Playlist kamu', query: `kind=playlist&url=${encodeURIComponent(url)}` })
          }}
        >
          <Link2 size={16} aria-hidden />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Atau tempel link playlist Spotify-mu…" aria-label="Link playlist Spotify" />
          <button className="ghost small" type="submit">
            Main
          </button>
        </form>
      </section>

      <section className="shelf">
        <h2>Artis</h2>
        <label className="search">
          <Search size={16} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari artis mana pun…" aria-label="Cari artis" />
        </label>
        {catalog?.error && <p className="note">Daftar kuis belum bisa dimuat. Coba muat ulang.</p>}
        {!catalog && <p className="note">Memuat kuis…</p>}
        <div className="tiles">
          {(found ?? catalog?.artists ?? []).map((a) => (
            <Tile key={a.id} round name={a.name} sub={a.fans ? `${Intl.NumberFormat('id', { notation: 'compact' }).format(a.fans)} fans` : undefined} picture={a.picture} onPick={() => artist(a)} />
          ))}
        </div>
        {found?.length === 0 && <p className="note">Artis tidak ketemu.</p>}
      </section>

      {catalog?.genres && (
        <section className="shelf">
          <h2>Genre</h2>
          <div className="tiles">
            {catalog.genres.map((g) => (
              <Tile key={g.id} name={g.name} sub="Lagu terpopuler" picture={g.picture} onPick={() => onStart({ key: `genre:${g.id}`, name: g.name, query: `kind=genre&id=${g.id}`, picture: g.picture })} />
            ))}
          </div>
        </section>
      )}

      {catalog?.decades && (
        <section className="shelf">
          <h2>Dekade</h2>
          <div className="tiles">
            {catalog.decades.map((d, i) => (
              <Tile key={d} name={`${String(d).slice(2)}an`} sub={`Hits ${d}-an`} tint={DECADE_TINTS[i % DECADE_TINTS.length]} onPick={() => onStart({ key: `decade:${d}`, name: `Hits ${String(d).slice(2)}an`, query: `kind=decade&id=${d}` })} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
