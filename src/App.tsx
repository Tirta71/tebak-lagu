import { useState } from 'react'
import { Music2 } from 'lucide-react'
import { Home } from './Home'
import { Party } from './Party'
import { PartyHome } from './PartyHome'
import { useGameSettings } from './Settings'
import { Quiz } from './Quiz'
import { Result } from './Result'
import { readProfile, type Profile } from './local'
import type { Answer, Mode, QuizSource } from './types'

/*
 * Tebak Lagu: pick a quiz (an artist, a genre, a decade, or a Spotify playlist), then ten songs
 * play one after another; for each, choose its title from four within 15 seconds. The faster
 * you're right, the more points. Audio is Deezer's 30-second previews; lyrics come from Genius.
 */

type Screen = { at: 'home' } | { at: 'party-home' } | { at: 'party'; role: 'host' | 'guest'; code: string } | { at: 'quiz'; source: QuizSource; run: number } | { at: 'result'; source: QuizSource; name: string; answers: Answer[]; mode: Mode }

export function App() {
  const [profile, setProfile] = useState<Profile>(readProfile)
  // a new room starts with the settings last used here
  const { settings: gameSettings } = useGameSettings()
  // an invite link (?room=KODE) opens that room straight away
  const [screen, setScreen] = useState<Screen>(() => {
    const room = new URLSearchParams(location.search).get('room')
    return room ? { at: 'party', role: 'guest', code: room.toUpperCase() } : { at: 'home' }
  })
  const home = () => {
    setScreen({ at: 'home' })
    history.replaceState(null, '', '/')
    scrollTo({ top: 0 })
  }
  const start = (source: QuizSource) => {
    setScreen({ at: 'quiz', source, run: Date.now() })
    scrollTo({ top: 0 })
  }

  return (
    <div className="page">
      <header className="top">
        <button className="brand" onClick={home}>
          <span className="logo" aria-hidden>
            <Music2 size={18} />
          </span>
          <div>
            <b>Tebak Lagu</b>
            <small>by Tirta</small>
          </div>
        </button>
        <span className="me">
          <span aria-hidden>{profile.avatar}</span> {profile.name || 'Tamu'}
        </span>
      </header>

      <main>
        {screen.at === 'home' && (
          <Home
            profile={profile}
            onProfile={setProfile}
            onStart={start}
            onParty={() => setScreen({ at: 'party-home' })}
          />
        )}
        {screen.at === 'party-home' && <PartyHome onBack={home} onCreate={() => setScreen({ at: 'party', role: 'host', code: '' })} onJoin={(code) => setScreen({ at: 'party', role: 'guest', code })} />}
        {screen.at === 'party' && <Party key={`${screen.role}-${screen.code}`} role={screen.role} code={screen.code} initial={gameSettings} profile={profile} onLeave={home} />}
        {screen.at === 'quiz' && <Quiz key={screen.run} source={screen.source} onQuit={home} onDone={(answers, name, mode) => setScreen({ at: 'result', source: screen.source, name, answers, mode })} />}
        {screen.at === 'result' && <Result source={screen.source} name={screen.name} answers={screen.answers} mode={screen.mode} profile={profile} onAgain={() => start(screen.source)} onHome={home} />}
      </main>

      <footer className="foot">
        Cuplikan lagu dari{' '}
        <a href="https://www.deezer.com" target="_blank" rel="noreferrer">
          Deezer
        </a>{' '}
        · lirik dari{' '}
        <a href="https://genius.com" target="_blank" rel="noreferrer">
          Genius
        </a>
      </footer>
    </div>
  )
}
