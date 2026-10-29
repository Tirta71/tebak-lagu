import { useEffect, useState } from 'react'
import { Check, ExternalLink, FileText, RotateCcw, Trophy, X } from 'lucide-react'
import { LyricsPanel } from './LyricsPanel'
import { saveBest, type Profile } from './local'
import type { Answer, QuizSource } from './types'

/** The score, a best-score flag, and the ten songs: what they were, what you picked, lyrics on tap. */
export function Result({ source, name, answers, profile, onAgain, onHome }: { source: QuizSource; name: string; answers: Answer[]; profile: Profile; onAgain: () => void; onHome: () => void }) {
  const score = answers.reduce((s, a) => s + a.points, 0)
  const right = answers.filter((a) => a.points).length
  const [best, setBest] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    setBest(saveBest({ key: source.key, name, score, at: Date.now() }))
  }, [source.key, name, score])

  const fast = answers.filter((a) => a.points).sort((a, b) => a.seconds - b.seconds)[0]
  return (
    <section className="result">
      <div className="panel center">
        <span className="big-avatar" aria-hidden>
          {profile.avatar}
        </span>
        <p className="muted">{profile.name || 'Kamu'} · {name}</p>
        <h1 className="final">{score}</h1>
        <p>
          {right} dari {answers.length} benar
          {fast ? ` · tercepat ${fast.seconds.toFixed(1)} detik` : ''}
        </p>
        {best && (
          <p className="best-flag">
            <Trophy size={15} /> Skor terbaik baru untuk kuis ini!
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={onAgain}>
            <RotateCcw size={16} /> Main lagi
          </button>
          <button className="ghost" onClick={onHome}>
            Kuis lain
          </button>
        </div>
      </div>

      <ol className="recap">
        {answers.map((a, k) => {
          const s = a.question.answer
          const spotify = `https://open.spotify.com/search/${encodeURIComponent(`${s.artist} ${s.title}`)}`
          return (
            <li key={s.id}>
              <div className="recap-row">
                {s.cover && <img src={s.cover} alt="" loading="lazy" />}
                <span>
                  <b>{s.title}</b>
                  <small>
                    {s.artist}
                    {!a.points && a.picked ? ` · kamu: ${a.picked.title}` : ''}
                  </small>
                </span>
                <em className={a.points ? 'right' : 'wrong'}>{a.points ? <><Check size={14} /> {a.points}</> : <X size={14} />}</em>
              </div>
              <div className="recap-links">
                <a className="ghost small" href={spotify} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} /> Spotify
                </a>
                <button className="ghost small" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
                  <FileText size={13} /> Lirik
                </button>
              </div>
              {open === k && <LyricsPanel title={s.title} artist={s.artist} spotify={spotify} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
