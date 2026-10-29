import { useEffect, useState } from 'react'
import { Check, ExternalLink, FileText, Flame, RotateCcw, Trophy, X } from 'lucide-react'
import { Bit } from './Bit'
import { Confetti } from './Confetti'
import { LyricsPanel } from './LyricsPanel'
import { LEVELS } from './levels'
import { saveBest, type Profile } from './local'
import type { Answer, Mode, QuizSource } from './types'

/** The score, a best-score flag, and the ten songs: what they were, what you picked, lyrics on tap. */
export function Result({ source, name, answers, mode, lyrics, profile, onAgain, onHome }: { source: QuizSource; name: string; answers: Answer[]; mode: Mode; lyrics: boolean; profile: Profile; onAgain: () => void; onHome: () => void }) {
  const score = answers.reduce((s, a) => s + a.points, 0)
  // Tebak Lirik takes points away for a miss, so only a gain counts as right
  const correct = answers.filter((a) => a.points > 0)
  const right = correct.length
  const [best, setBest] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const bestCombo = Math.max(0, ...answers.map((a) => a.combo))

  useEffect(() => {
    // each mode and level keeps its own best score
    const level = source.level ?? 'normal'
    // a longer quiz scores more, so each length keeps its own best too
    const kind = lyrics ? 'lirik' : mode
    const key = `${source.key}:${kind}:${level}:${source.count ?? 10}`
    const label = lyrics ? ' · lirik' : mode === 'artist' ? ' · penyanyi' : mode === 'both' ? ' · acak' : ''
    setBest(saveBest({ key, name: `${name}${label} · ${LEVELS[level].label} · ${source.count === 'all' ? 'semua' : (source.count ?? 10)} lagu`, score, at: Date.now() }))
  }, [source.key, name, score, mode, lyrics, answers])

  const fast = [...correct].sort((a, b) => a.seconds - b.seconds)[0]
  const avg = right ? correct.reduce((t, a) => t + a.seconds, 0) / right : 0
  const clean = correct.filter((a) => !a.tries).length
  // a title for how it went, by share of songs right (a quiz can be 5 songs or 50)
  const share = answers.length ? right / answers.length : 0
  const rank = share >= 0.9 ? 'Telinga emas' : share >= 0.7 ? 'Pendengar sejati' : share >= 0.4 ? 'Lumayan hafal' : right ? 'Masih pemanasan' : 'Coba sekali lagi'
  return (
    <section className="result">
      {(best || share >= 0.7) && <Confetti />}
      <div className="panel center">
        <Bit size={120} mood={share >= 0.5 ? 'happy' : right ? 'listen' : 'sad'} />
        <p className="muted">
          <span aria-hidden>{profile.avatar}</span> {profile.name || 'Kamu'} · {name}
          {lyrics ? ' · Tebak Lirik' : ''} · {LEVELS[source.level ?? 'normal'].label}
        </p>
        <span className="rank">{rank}</span>
        <h1 className={`final${score < 0 ? ' negative' : ''}`}>{score}</h1>
        <dl className={`result-stats${lyrics ? ' three' : ''}`}>
          <div>
            <dt>Benar</dt>
            <dd>
              {right}/{answers.length}
            </dd>
          </div>
          {lyrics ? (
            <div>
              <dt>Tanpa salah</dt>
              <dd>{clean}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Tercepat</dt>
                <dd>{fast ? `${fast.seconds.toFixed(1)} dtk` : '-'}</dd>
              </div>
              <div>
                <dt>Rata-rata</dt>
                <dd>{right ? `${avg.toFixed(1)} dtk` : '-'}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Combo</dt>
            <dd>
              <Flame size={14} /> {bestCombo}
            </dd>
          </div>
        </dl>
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
                    {a.points <= 0 && a.picked ? ` · kamu: ${a.picked.title}` : ''}
                  </small>
                </span>
                <em className={a.points > 0 ? 'right' : 'wrong'}>
                  {a.points > 0 ? <Check size={14} /> : <X size={14} />} {a.points !== 0 && a.points}
                </em>
              </div>
              {a.line && <p className="recap-line">"{a.line}"</p>}
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
