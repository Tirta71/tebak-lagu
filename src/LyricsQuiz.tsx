import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Plus, Scissors, Volume2, VolumeX, X } from 'lucide-react'
import { shuffle, type Rng } from './random'
import { sfx } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import { Bit } from './Bit'
import type { Answer, Mode, Question, QuizSource, Song } from './types'
import { pointsFor, comboFactor, makeQuestions, enoughArtists } from './Quiz'

type LyricsQuestion = Question & { snippet: string }

export function LyricsQuiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string, mode: Mode) => void; onQuit: () => void }) {
  const rules = LEVELS[source.level ?? 'normal']
  const SECONDS = rules.seconds
  const [questions, setQuestions] = useState<LyricsQuestion[] | null>(null)
  const [mode, setMode] = useState<Mode>('title')
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [count, setCount] = useState(3)
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [left, setLeft] = useState(SECONDS)
  const [started, setStarted] = useState(false)
  const [fifty, setFifty] = useState<{ at: number; hidden: number[] } | null>(null)
  const [extraAt, setExtraAt] = useState<number | null>(null)
  const startedAt = useRef(0)
  const limit = useRef(SECONDS)
  const lastTick = useRef(99)
  const raf = useRef(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/quiz?${source.query}&want=${source.count ?? 10}`)
        const j = await res.json()
        if (!alive) return
        if (j.error || !j.tracks) return setError(j.error ?? 'Kuis tidak bisa dimuat.')
        setName(source.name === 'Playlist kamu' && j.name ? j.name : source.name)

        const m: Mode = 'title'
        setMode(m)
        const qCount = source.count === 'all' ? j.tracks.length : (source.count ?? 10)
        const qs = makeQuestions(j.tracks, m, Math.random, rules.sameArtist, qCount)

        // fetch lyrics for each question's answer in parallel
        const withLyrics: LyricsQuestion[] = []
        const results = await Promise.all(
          qs.map(async (q) => {
            try {
              const r = await fetch(`/api/lyrics?${new URLSearchParams({ title: q.answer.title, artist: q.answer.artist })}`)
              const lj = await r.json()
              if (lj.found && lj.snippet) return { ...q, snippet: lj.snippet }
            } catch {}
            return null
          }),
        )
        for (const r of results) if (r) withLyrics.push(r)
        if (!alive) return
        if (withLyrics.length < 4) return setError('Tidak cukup lagu yang punya lirik untuk kuis ini.')
        setQuestions(withLyrics)
        setLoading(false)
      } catch {
        if (alive) setError('Tidak bisa tersambung. Coba lagi.')
      }
    })()
    return () => { alive = false }
  }, [source])

  // countdown 3, 2, 1
  useEffect(() => {
    if (!questions || count <= 0) return
    sfx.count(count === 1)
    const id = setTimeout(() => setCount((c) => c - 1), 750)
    return () => clearTimeout(id)
  }, [questions, count])

  const q = count <= 0 ? questions?.[i] : undefined
  const answered = answers.length > i
  const combo = answers.length && answers[answers.length - 1].points ? answers[answers.length - 1].combo : 0

  const stopClock = () => cancelAnimationFrame(raf.current)

  const answer = useCallback(
    (picked: Song | null) => {
      if (!q || answers.length > i) return
      stopClock()
      const elapsed = startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0
      const secondsLeft = Math.max(0, Math.min(SECONDS, limit.current - elapsed))
      const right = !!picked && picked.id === q.answer.id
      const nextCombo = right ? combo + 1 : 0
      if (right) {
        sfx.right()
        if (nextCombo === 3 || nextCombo === 5) setTimeout(sfx.combo, 250)
      } else sfx.wrong()
      setAnswers((a) => [...a, { question: q, picked, points: right ? pointsFor(secondsLeft, nextCombo, rules) : 0, seconds: Math.min(elapsed, limit.current), combo: nextCombo }])
    },
    [q, answers.length, i, combo, rules, SECONDS],
  )

  // start the clock when the question appears
  useEffect(() => {
    if (!q) return
    setStarted(true)
    setLeft(SECONDS)
    limit.current = SECONDS
    lastTick.current = 99
    startedAt.current = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - startedAt.current) / 1000
      const l = limit.current - elapsed
      setLeft(Math.max(0, l))
      const whole = Math.ceil(l)
      if (whole <= 3 && whole >= 1 && whole < lastTick.current) {
        lastTick.current = whole
        sfx.tick()
      }
      if (l <= 0) return
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => stopClock()
  }, [q, i, SECONDS])

  // out of time
  useEffect(() => {
    if (started && left <= 0 && !answered) answer(null)
  }, [left, started, answered, answer])

  const useFifty = () => {
    if (!q || fifty || answered || !rules.fifty) return
    const wrong = shuffle(q.options.filter((o) => o.id !== q.answer.id)).slice(0, 2)
    setFifty({ at: i, hidden: wrong.map((o) => o.id) })
  }
  const useExtra = () => {
    if (!q || extraAt !== null || answered || !started || !rules.extra) return
    limit.current += 5
    lastTick.current = 99
    setExtraAt(i)
  }
  const hidden = fifty?.at === i ? fifty.hidden : []

  // keys 1-4 / A-D pick, Enter next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return
      const n = Number(e.key) || 'abcd'.indexOf(e.key.toLowerCase()) + 1
      const o = q.options[n - 1]
      if (!answered && o && !hidden.includes(o.id)) answer(o)
      else if (answered && e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const next = () => {
    if (!questions) return
    if (i + 1 >= questions.length) return onDone(answers, name, mode)
    setI(i + 1)
  }

  if (error)
    return (
      <section className="panel center">
        <Bit size={110} mood="sad" />
        <p className="note error">{error}</p>
        <button className="primary" onClick={onQuit}>Kembali</button>
      </section>
    )
  if (!questions || count > 0)
    return (
      <section className="countdown">
        <Bit size={140} mood="listen" />
        {questions ? (
          <>
            <span key={count} className="count-num">{count}</span>
            <p>Baca liriknya, tebak lagunya!</p>
          </>
        ) : (
          <p className="note">Menyiapkan lirik…</p>
        )}
      </section>
    )
  if (!q) return null

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[i]
  const factor = comboFactor(combo + 1)

  return (
    <section className="quiz lyrics-quiz">
      <header className="quiz-head">
        <button className="ghost small" onClick={onQuit}><X size={14} /> Keluar</button>
        <span className="quiz-name">{name} · Tebak Lirik · {rules.label}</span>
        <b className="quiz-score" key={score}>{score}</b>
      </header>

      <div className={`progress${questions.length > 20 ? ' many' : ''}`} style={{ gridTemplateColumns: `repeat(${questions.length}, 1fr)` }}>
        {questions.map((_, k) => {
          const a = answers[k]
          return <i key={k} className={a ? (a.points ? 'right' : 'wrong') : k === i ? 'now' : ''} />
        })}
      </div>

      <div className={`timebar${left <= 5 && !answered ? ' hurry' : ''}`} aria-hidden>
        <span style={{ transform: `scaleX(${answered ? 0 : Math.min(1, left / SECONDS)})` }} />
      </div>

      <div className="stage lyrics-stage">
        {answered ? (
          <div className="now-playing">
            {q.answer.cover && <img src={q.answer.cover} alt="" />}
            <span>
              <b>{q.answer.title}</b>
              <small>{q.answer.artist}</small>
            </span>
          </div>
        ) : (
          <div className="lyrics-snippet">
            {q.snippet.split('\n').map((line, k) => (
              <p key={k}>{line}</p>
            ))}
          </div>
        )}
        {answered && <Bit size={86} mood={mine.points ? 'happy' : 'sad'} />}
        {answered && mine.points > 0 && (
          <span className="float-points">
            +{mine.points}
            {mine.combo >= 3 && <small> x{comboFactor(mine.combo)}</small>}
          </span>
        )}
      </div>

      <div className="hud">
        <span className={`combo${combo >= 3 ? ' hot' : ''}`} title="Benar berturut-turut">
          <Flame size={15} /> {combo}
          {factor > 1 && !answered && <em>x{factor}</em>}
        </span>
        <p className="ask">
          {answered
            ? mine.points
              ? 'Benar!'
              : mine.picked
                ? 'Kurang tepat'
                : 'Waktu habis'
            : `Lagu apa ini? · ${Math.ceil(left)}`}
        </p>
        <span className="lifelines">
          {rules.fifty && (
            <button className="lifeline" disabled={!!fifty || answered} onClick={useFifty} title="Hapus 2 jawaban salah">
              <Scissors size={14} /> 50:50
            </button>
          )}
          {rules.extra && (
            <button className="lifeline" disabled={extraAt !== null || answered || !started} onClick={useExtra} title="Tambah 5 detik">
              <Plus size={14} /> 5 dtk
            </button>
          )}
        </span>
      </div>

      <div className="options">
        {q.options.map((o, k) => {
          const state = !answered ? (hidden.includes(o.id) ? 'gone' : '') : o.id === q.answer.id ? 'right' : mine.picked?.id === o.id ? 'wrong' : 'dim'
          return (
            <button key={o.id} className={`option c${k} ${state}`} disabled={answered || state === 'gone'} onClick={() => answer(o)}>
              <kbd>{'ABCD'[k]}</kbd>
              <span>
                <b>{o.title}</b>
                <small>{o.artist}</small>
              </span>
              {state === 'right' && <Check size={20} />}
              {state === 'wrong' && <X size={20} />}
            </button>
          )
        })}
      </div>

      {answered && (
        <button className="primary" onClick={next}>
          {i + 1 >= questions.length ? 'Lihat hasil' : 'Lanjut'} <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
