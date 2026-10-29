import { CalendarDays, Trophy, User, Users, Zap } from 'lucide-react'
import { Bit } from './Bit'
import { AVATARS, readBests, readDaily, saveProfile, type Profile } from './local'
import { LEVELS } from './levels'
import { QuizPicker } from './QuizPicker'
import { SettingsPanel, useGameSettings } from './Settings'
import { today } from './random'
import type { QuizSource } from './types'

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

export function Home({ profile, onProfile, onStart: start, onParty }: { profile: Profile; onProfile: (p: Profile) => void; onStart: (q: QuizSource) => void; onParty: () => void }) {
  const { settings, setMode, setLevel, setCount } = useGameSettings()
  const { mode, level, count } = settings
  // artist quizzes are always "guess the title": every song is by the same singer
  const onStart = (q: QuizSource) => start({ ...q, level, count, mode: q.key.startsWith('artist:') ? 'title' : mode })
  const day = today()
  const daily = readDaily(day)
  const bests = readBests().sort((a, b) => b.score - a.score).slice(0, 5)

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
          <button className="mode friends" onClick={onParty}>
            <Users size={22} />
            <b>Main bareng teman</b>
            <small>Buat room atau masuk dengan kode</small>
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

      <SettingsPanel settings={settings} setMode={setMode} setLevel={setLevel} setCount={setCount} />

      <div id="kuis">
        <QuizPicker onStart={onStart} />
      </div>
    </>
  )
}
