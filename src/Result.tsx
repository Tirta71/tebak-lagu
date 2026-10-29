import { useEffect, useState } from 'react'
import { Check, ExternalLink, FileText, Flame, RotateCcw, Share2, Trophy, X } from 'lucide-react'
import { Bit } from './Bit'
import { Confetti } from './Confetti'
import { LyricsPanel } from './LyricsPanel'
import { LEVELS } from './levels'
import { saveBest, saveDaily, type Profile } from './local'
import type { Answer, Mode, QuizSource } from './types'

/** The score, a best-score flag, and the ten songs: what they were, what you picked, lyrics on tap. */
export function Result({ source, name, answers, mode, profile, onAgain, onHome }: { source: QuizSource; name: string; answers: Answer[]; mode: Mode; profile: Profile; onAgain: () => void; onHome: () => void }) {
  const score = answers.reduce((s, a) => s + a.points, 0)
  const right = answers.filter((a) => a.points).length
  const [best, setBest] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const [shared, setShared] = useState(false)
  const bestCombo = Math.max(0, ...answers.map((a) => a.combo))

  useEffect(() => {
    // each mode and level keeps its own best score
    const level = source.level ?? 'normal'
    // a longer quiz scores more, so each length keeps its own best too
    const key = `${source.key}:${mode}:${level}:${source.count ?? 10}`
    setBest(saveBest({ key, name: `${name}${mode === 'artist' ? ' · penyanyi' : mode === 'both' ? ' · acak' : ''} · ${LEVELS[level].label} · ${source.count === 'all' ? 'semua' : (source.count ?? 10)} lagu`, score, at: Date.now() }))
    if (source.daily) saveDaily({ day: source.daily, score, marks: answers.map((a) => a.points > 0) })
  }, [source.key, source.daily, name, score, mode, answers])

  // the daily challenge's result as text: a row of squares, like the word games do
  const share = async () => {
    const text = `Tebak Lagu · Tantangan ${source.daily}\n${answers.map((a) => (a.points ? '🟩' : '🟥')).join('')}\n${score} poin · ${right}/${answers.length} benar\n${location.origin}`
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        setShared(true)
      }
    } catch {
      /* closed the share sheet */
    }
  }

  const fast = answers.filter((a) => a.points).sort((a, b) => a.seconds - b.seconds)[0]
  const avg = right ? answers.filter((a) => a.points).reduce((t, a) => t + a.seconds, 0) / right : 0
  // a title for how it went
  const rank = right >= 9 ? 'Telinga emas' : right >= 7 ? 'Pendengar sejati' : right >= 4 ? 'Lumayan hafal' : right >= 1 ? 'Masih pemanasan' : 'Coba sekali lagi'
  return (
    <section className="result">
      {(best || right >= 7) && <Confetti />}
      <div className="panel center">
        <Bit size={120} mood={right >= 5 ? 'happy' : right ? 'listen' : 'sad'} />
        <p className="muted">
          <span aria-hidden>{profile.avatar}</span> {profile.name || 'Kamu'} · {name} · {LEVELS[source.level ?? 'normal'].label}
        </p>
        <span className="rank">{rank}</span>
        <h1 className="final">{score}</h1>
        <dl className="result-stats">
          <div>
            <dt>Benar</dt>
            <dd>
              {right}/{answers.length}
            </dd>
          </div>
          <div>
            <dt>Tercepat</dt>
            <dd>{fast ? `${fast.seconds.toFixed(1)} dtk` : '–'}</dd>
          </div>
          <div>
            <dt>Rata-rata</dt>
            <dd>{right ? `${avg.toFixed(1)} dtk` : '–'}</dd>
          </div>
          <div>
            <dt>Combo</dt>
            <dd>
              <Flame size={14} /> {bestCombo}
            </dd>
          </div>
        </dl>
        {source.daily && (
          <p className="marks" aria-label={`${right} dari ${answers.length} benar`}>
            {answers.map((a, k) => (
              <i key={k} className={a.points ? 'right' : 'wrong'} />
            ))}
          </p>
        )}
        {best && (
          <p className="best-flag">
            <Trophy size={15} /> Skor terbaik baru untuk kuis ini!
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={onAgain}>
            <RotateCcw size={16} /> Main lagi
          </button>
          {source.daily && (
            <button className="ghost" onClick={share}>
              <Share2 size={15} /> {shared ? 'Tersalin!' : 'Bagikan'}
            </button>
          )}
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
