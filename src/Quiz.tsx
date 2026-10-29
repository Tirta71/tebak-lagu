import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Plus, Scissors, Volume2, VolumeX, X } from 'lucide-react'
import { norm } from '../api/_match.js'
import { Bit, Equalizer } from './Bit'
import { Loading } from './Loading'
import { shuffle, type Rng } from './random'
import { isMuted, setMuted, sfx } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import type { Answer, Mode, Question, QuizSource, Song } from './types'

export const MODE_LABEL: Record<Mode, string> = { title: 'Tebak judul', artist: 'Tebak penyanyi', both: 'Judul / penyanyi acak' }
const ASK = { title: 'Lagu apa ini?', artist: 'Siapa penyanyinya?' }
const EXTRA = 5
/** Deezer's previews are 30 seconds long. */
const PREVIEW = 30

/**
 * Ten songs from the pool, each with three others to choose from: other titles, or (guessing the
 * singer) songs by other artists. In the mixed mode each song is one or the other at random.
 */
export function makeQuestions(pool: Song[], mode: Mode, rng: Rng, sameArtist: boolean, count: number): Question[] {
  const singer = (s: Song) => norm(s.artist.split(',')[0])
  const songs = shuffle(pool, rng)
  return songs.slice(0, count).map((answer) => {
    const kind = mode === 'both' ? (rng() < 0.5 ? 'title' : 'artist') : mode
    const key = (s: Song) => (kind === 'artist' ? singer(s) : norm(s.title))
    // on harder levels, other songs by the same singer come first, so the singer gives nothing away
    const others = shuffle(songs, rng)
    const candidates = sameArtist && kind === 'title' ? [...others.filter((s) => singer(s) === singer(answer)), ...others.filter((s) => singer(s) !== singer(answer))] : others
    const picked: Song[] = []
    for (const s of candidates) if (picked.length < 3 && key(s) !== key(answer) && !picked.some((p) => key(p) === key(s))) picked.push(s)
    return { answer, options: shuffle([answer, ...picked], rng), kind }
  })
}

/** Guessing the singer (alone or mixed in) needs at least four different artists in the pool. */
export const enoughArtists = (pool: Song[]) => new Set(pool.map((s) => norm(s.artist.split(',')[0]))).size >= 4

/** Points for a right answer: 1000 straight away, down to 300 at the buzzer, times the combo and the level. */
export const pointsFor = (secondsLeft: number, combo: number, rules: LevelRules) => Math.round((300 + 700 * Math.min(1, secondsLeft / rules.seconds)) * comboFactor(combo) * rules.factor)
export const comboFactor = (combo: number) => (combo >= 5 ? 2 : combo >= 3 ? 1.5 : 1)

export function Quiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string, mode: Mode) => void; onQuit: () => void }) {
  const rules = LEVELS[source.level ?? 'normal']
  const SECONDS = rules.seconds
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [mode, setMode] = useState<Mode>(source.mode ?? 'title')
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(3)
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [left, setLeft] = useState(SECONDS)
  const [started, setStarted] = useState(false)
  // the song has stopped (on Ahli it only plays for a few seconds)
  const [silent, setSilent] = useState(false)
  const [mute, setMute] = useState(isMuted)
  // lifelines, once each per quiz: 50:50 (which question, and which options it hid) and +5 s
  const [fifty, setFifty] = useState<{ at: number; hidden: number[] } | null>(null)
  const [extraAt, setExtraAt] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const nextAudio = useRef<HTMLAudioElement | null>(null)
  const startedAt = useRef(0)
  const limit = useRef(SECONDS)
  const lastTick = useRef(99)
  const raf = useRef(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/quiz?${source.query}&want=${source.count ?? 10}`)
      .then((r) => r.json())
      .catch(() => ({ error: 'Tidak bisa tersambung. Coba lagi.' }))
      .then((j) => {
        if (!alive) return
        if (j.error || !j.tracks) return setError(j.error ?? 'Kuis tidak bisa dimuat.')
        setName(source.name === 'Playlist kamu' && j.name ? j.name : source.name)
        const m: Mode = source.mode !== 'title' && source.mode && enoughArtists(j.tracks) ? source.mode : 'title'
        setMode(m)
        // "all" plays every song that has a preview
        const count = source.count === 'all' ? j.tracks.length : (source.count ?? 10)
        setQuestions(makeQuestions(j.tracks, m, Math.random, rules.sameArtist, count))
      })
    return () => {
      alive = false
    }
  }, [source])

  // 3, 2, 1 before the first song (once the songs are ready)
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

  // each question: play the preview, and start the clock when the music actually starts
  useEffect(() => {
    if (!q) return
    setStarted(false)
    setSilent(false)
    setLeft(SECONDS)
    limit.current = SECONDS
    lastTick.current = 99
    const ready = nextAudio.current
    const a = ready && ready.src === q.answer.preview ? ready : new Audio(q.answer.preview)
    audio.current = a
    const onPlaying = () => {
      if (startedAt.current) return
      startedAt.current = performance.now()
      setStarted(true)
      const tick = () => {
        const elapsed = (performance.now() - startedAt.current) / 1000
        // on Ahli the song stops after a few seconds; the clock keeps going
        if (rules.listen && elapsed >= rules.listen && !a.paused) {
          a.pause()
          setSilent(true)
        }
        const l = limit.current - elapsed
        setLeft(Math.max(0, l))
        // a tick for each of the last three seconds
        const whole = Math.ceil(l)
        if (whole <= 3 && whole >= 1 && whole < lastTick.current) {
          lastTick.current = whole
          sfx.tick()
        }
        if (l <= 0) return
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    }
    startedAt.current = 0
    a.addEventListener('playing', onPlaying)
    // harder levels start somewhere inside the preview, not at its (often quiet) beginning
    const span = rules.listen ?? SECONDS
    a.currentTime = rules.randomStart ? 3 + Math.random() * Math.max(0, PREVIEW - span - 6) : 0
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
  }, [q, i, questions, rules, SECONDS])

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
    limit.current += EXTRA
    lastTick.current = 99
    setExtraAt(i)
  }
  const hidden = fifty?.at === i ? fifty.hidden : []

  // keys 1–4 (or A–D) pick an option, Enter moves on
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

  // on a phone the answer and the next button can sit below the screen: bring them up, then back to the top
  useEffect(() => {
    scrollTo({ top: answered ? document.documentElement.scrollHeight : 0, behavior: 'smooth' })
  }, [answered])

  const next = () => {
    if (!questions) return
    if (i + 1 >= questions.length) return onDone(answers, name, mode)
    // reset the clock with the move: after a timeout it still reads 0, which would end the next song at once
    setStarted(false)
    setLeft(SECONDS)
    setI(i + 1)
  }

  if (error)
    return (
      <section className="panel center">
        <Bit size={110} mood="sad" />
        <p className="note error">{error}</p>
        <button className="primary" onClick={onQuit}>
          Kembali
        </button>
      </section>
    )
  if (!questions) return <Loading title={`Menyiapkan ${name}…`} onCancel={onQuit} />
  if (count > 0)
    return (
      <section className="countdown">
        <Bit size={140} mood="listen" />
        <span key={count} className="count-num">
          {count}
        </span>
        <p>{mode === 'artist' ? 'Tebak penyanyinya!' : mode === 'both' ? 'Kadang judul, kadang penyanyi!' : 'Tebak judulnya!'}</p>
      </section>
    )
  if (!q) return null

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[i]
  const factor = comboFactor(combo + 1)
  return (
    <section className="quiz">
      <header className="quiz-head">
        <button className="ghost small" onClick={onQuit}>
          <X size={14} /> Keluar
        </button>
        <span className="quiz-name">
          {name} · {MODE_LABEL[mode]} · {rules.label}
        </span>
        <button
          className="ghost small icon"
          aria-label={mute ? 'Nyalakan efek suara' : 'Matikan efek suara'}
          onClick={() => {
            setMuted(!mute)
            setMute(!mute)
          }}
        >
          {mute ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <b className="quiz-score" key={score}>
          {score}
        </b>
      </header>

      <div className={`progress${questions.length > 20 ? ' many' : ''}`} style={{ gridTemplateColumns: `repeat(${questions.length}, 1fr)` }} aria-label={`Lagu ${i + 1} dari ${questions.length}`}>
        {questions.map((_, k) => {
          const a = answers[k]
          return <i key={k} className={a ? (a.points ? 'right' : 'wrong') : k === i ? 'now' : ''} />
        })}
      </div>

      {/* the clock: a thick bar that runs down, red in the last five seconds */}
      <div className={`timebar${left <= 5 && !answered ? ' hurry' : ''}`} aria-hidden>
        <span style={{ transform: `scaleX(${answered ? 0 : Math.min(1, left / SECONDS)})` }} />
      </div>

      <div className="stage">
        {answered ? (
          <div className="now-playing">
            {q.answer.cover && <img src={q.answer.cover} alt="" />}
            <span>
              <b>{q.answer.title}</b>
              <small>{q.answer.artist}</small>
            </span>
          </div>
        ) : (
          <>
            <Bit size={120} mood="listen" />
            <Equalizer on={started && !silent} />
          </>
        )}
        {answered && <Bit size={86} mood={mine.points ? 'happy' : 'sad'} />}
        {answered && mine.points > 0 && (
          <span className="float-points">
            +{mine.points}
            {mine.combo >= 3 && <small> ×{comboFactor(mine.combo)}</small>}
          </span>
        )}
      </div>

      <div className="hud">
        <span className={`combo${combo >= 3 ? ' hot' : ''}`} title="Benar berturut-turut">
          <Flame size={15} /> {combo}
          {factor > 1 && !answered && <em>×{factor}</em>}
        </span>
        <p className="ask">
          {answered
            ? mine.points
              ? 'Benar!'
              : mine.picked
                ? 'Kurang tepat'
                : 'Waktu habis'
            : started
              ? `${ASK[q.kind]} · ${Math.ceil(left)}`
              : ASK[q.kind]}
        </p>
        <span className="lifelines">
          {rules.fifty && (
            <button className="lifeline" disabled={!!fifty || answered} onClick={useFifty} title="Hapus 2 jawaban salah (sekali per kuis)">
              <Scissors size={14} /> 50:50
            </button>
          )}
          {rules.extra && (
            <button className="lifeline" disabled={extraAt !== null || answered || !started} onClick={useExtra} title="Tambah 5 detik (sekali per kuis)">
              <Plus size={14} /> 5 dtk
            </button>
          )}
        </span>
      </div>
      {!started && !answered && (
        <button className="ghost small center-self" onClick={() => audio.current?.play()}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}

      <div className="options">
        {q.options.map((o, k) => {
          const state = !answered ? (hidden.includes(o.id) ? 'gone' : '') : o.id === q.answer.id ? 'right' : mine.picked?.id === o.id ? 'wrong' : 'dim'
          return (
            <button key={o.id} className={`option c${k} ${state}`} disabled={answered || state === 'gone'} onClick={() => answer(o)}>
              <kbd>{'ABCD'[k]}</kbd>
              <span>
                <b>{q.kind === 'artist' ? o.artist : o.title}</b>
                {q.kind === 'title' && !rules.hideArtist && <small>{o.artist}</small>}
              </span>
              {state === 'right' && <Check size={20} />}
              {state === 'wrong' && <X size={20} />}
            </button>
          )
        })}
      </div>

      {answered && (
        <button className="primary next" onClick={next}>
          {i + 1 >= questions.length ? 'Lihat hasil' : 'Lagu berikutnya'} <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
