import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Volume2, X } from 'lucide-react'
import { norm } from '../api/_match.js'
import type { Answer, Question, QuizSource, Song } from './types'

export const QUESTIONS = 10
export const SECONDS = 15

function shuffle<T>(list: T[]) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Ten songs from the pool, each with three other titles from the same pool to choose from. */
function makeQuestions(pool: Song[]): Question[] {
  const songs = shuffle(pool)
  return songs.slice(0, QUESTIONS).map((answer) => {
    const others = shuffle(songs.filter((s) => norm(s.title) !== norm(answer.title)))
    const picked: Song[] = []
    for (const s of others) if (picked.length < 3 && !picked.some((p) => norm(p.title) === norm(s.title))) picked.push(s)
    return { answer, options: shuffle([answer, ...picked]) }
  })
}

/** Points for a right answer: 1000 straight away, down to 300 at the buzzer. */
export const pointsFor = (secondsLeft: number) => Math.round(300 + 700 * (secondsLeft / SECONDS))

export function Quiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string) => void; onQuit: () => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [left, setLeft] = useState(SECONDS)
  const [started, setStarted] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const nextAudio = useRef<HTMLAudioElement | null>(null)
  const startedAt = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/quiz?${source.query}`)
      .then((r) => r.json())
      .catch(() => ({ error: 'Tidak bisa tersambung. Coba lagi.' }))
      .then((j) => {
        if (!alive) return
        if (j.error || !j.tracks) return setError(j.error ?? 'Kuis tidak bisa dimuat.')
        setName(source.name === 'Playlist kamu' && j.name ? j.name : source.name)
        setQuestions(makeQuestions(j.tracks))
      })
    return () => {
      alive = false
    }
  }, [source])

  const q = questions?.[i]
  const answered = answers.length > i

  const stopClock = () => cancelAnimationFrame(raf.current)

  const answer = useCallback(
    (picked: Song | null) => {
      if (!q || answers.length > i) return
      stopClock()
      const secondsLeft = Math.max(0, SECONDS - (performance.now() - startedAt.current) / 1000)
      const right = !!picked && picked.id === q.answer.id
      setAnswers((a) => [...a, { question: q, picked, points: right ? pointsFor(secondsLeft) : 0, seconds: SECONDS - secondsLeft }])
    },
    [q, answers.length, i],
  )

  // each question: play the preview, and start the clock when the music actually starts
  useEffect(() => {
    if (!q) return
    setStarted(false)
    setLeft(SECONDS)
    const ready = nextAudio.current
    const a = ready && ready.src === q.answer.preview ? ready : new Audio(q.answer.preview)
    audio.current = a
    const onPlaying = () => {
      if (startedAt.current) return
      startedAt.current = performance.now()
      setStarted(true)
      const tick = () => {
        const l = SECONDS - (performance.now() - startedAt.current) / 1000
        setLeft(Math.max(0, l))
        if (l <= 0) return
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    }
    startedAt.current = 0
    a.addEventListener('playing', onPlaying)
    a.currentTime = 0
    a.play().catch(() => setStarted(false))
    // load the next song meanwhile, so it starts straight away
    const upcoming = questions?.[i + 1]
    nextAudio.current = upcoming?.answer.preview ? new Audio(upcoming.answer.preview) : null
    if (nextAudio.current) nextAudio.current.preload = 'auto'
    return () => {
      a.removeEventListener('playing', onPlaying)
      a.pause()
      stopClock()
    }
  }, [q, i, questions])

  // out of time
  useEffect(() => {
    if (started && left <= 0 && !answered) answer(null)
  }, [left, started, answered, answer])

  // keys 1–4 pick an option, Enter moves on
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return
      const n = Number(e.key)
      if (!answered && n >= 1 && n <= q.options.length) answer(q.options[n - 1])
      else if (answered && e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const next = () => {
    if (!questions) return
    if (i + 1 >= questions.length) return onDone(answers, name)
    setI(i + 1)
  }

  if (error)
    return (
      <section className="panel center">
        <p className="note error">{error}</p>
        <button className="primary" onClick={onQuit}>
          Kembali
        </button>
      </section>
    )
  if (!questions || !q)
    return (
      <section className="panel center">
        <span className="disc" aria-hidden />
        <p className="note">Menyiapkan {name}…</p>
      </section>
    )

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[i]
  return (
    <section className="quiz">
      <header className="quiz-head">
        <button className="ghost small" onClick={onQuit}>
          <X size={14} /> Keluar
        </button>
        <span className="quiz-name">{name}</span>
        <b className="quiz-score">{score}</b>
      </header>

      <div className="progress" aria-label={`Lagu ${i + 1} dari ${questions.length}`}>
        {questions.map((_, k) => {
          const a = answers[k]
          return <i key={k} className={a ? (a.points ? 'right' : 'wrong') : k === i ? 'now' : ''} />
        })}
      </div>

      {/* the clock: a ring that runs down over 15 seconds */}
      <div className={`timer${answered ? ' done' : ''}`}>
        <svg viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r="52" className="timer-track" />
          <circle cx="60" cy="60" r="52" className="timer-run" style={{ strokeDashoffset: `${326.7 * (1 - (answered ? 0 : left / SECONDS))}` }} />
        </svg>
        {answered ? (
          <img src={q.answer.cover ?? ''} alt="" />
        ) : (
          <span className="timer-num">{started ? Math.ceil(left) : <Volume2 size={28} />}</span>
        )}
      </div>
      {!started && !answered && (
        <button className="ghost small center-self" onClick={() => audio.current?.play()}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}

      <p className="ask">{answered ? (mine.points ? `Benar! +${mine.points}` : mine.picked ? 'Kurang tepat' : 'Waktu habis') : 'Lagu apa ini?'}</p>

      <div className="options">
        {q.options.map((o, k) => {
          const state = !answered ? '' : o.id === q.answer.id ? 'right' : mine.picked?.id === o.id ? 'wrong' : 'dim'
          return (
            <button key={o.id} className={`option ${state}`} disabled={answered} onClick={() => answer(o)}>
              <kbd>{k + 1}</kbd>
              <span>
                <b>{o.title}</b>
                <small>{o.artist}</small>
              </span>
              {state === 'right' && <Check size={18} />}
              {state === 'wrong' && <X size={18} />}
            </button>
          )
        })}
      </div>

      {answered && (
        <button className="primary" onClick={next}>
          {i + 1 >= questions.length ? 'Lihat hasil' : 'Lagu berikutnya'} <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
