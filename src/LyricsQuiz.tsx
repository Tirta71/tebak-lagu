import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Volume2, VolumeX, X } from 'lucide-react'
import { sfx, isMuted, setMuted } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import { Bit, Equalizer } from './Bit'
import type { Answer, Mode, QuizSource } from './types'
import { comboFactor } from './Quiz'
import { shuffle } from './random'
import { cueAt, lineKey, loadSyncedQuestions, lyricsCandidates, type LoadProgress, type ReadyQuestion } from './lyricsSync'
import { LyricsCard } from './LyricsCard'
import { Loading } from './Loading'

const WRONG_PENALTY = 200
/** Start playing once this many songs are ready; the rest load while you play. */
const START_AFTER = 3

type LyricOption = { text: string; correct: boolean }
type LyricsQuestion = ReadyQuestion & { options: LyricOption[] }

function lyricsPoints(combo: number, fast: boolean, rules: LevelRules) {
  const base = fast ? 800 : 500
  return Math.round(base * rules.factor * comboFactor(combo))
}

/** The answer plus three wrong lines: from the same song first, else from the other songs. */
function buildOptions(q: LyricsQuestion, all: LyricsQuestion[]): LyricOption[] {
  const seen = new Set([lineKey(q.answer), ...q.context.map(lineKey)])
  const wrongs: string[] = []
  const take = (line: string) => {
    const k = lineKey(line)
    if (wrongs.length < 3 && !seen.has(k) && line.length > 5) { wrongs.push(line); seen.add(k) }
  }
  q.wrongs.forEach(take)
  for (const o of all) if (o !== q) [...o.context, o.answer].forEach(take)
  return shuffle([{ text: q.answer, correct: true }, ...wrongs.map((text) => ({ text, correct: false }))], Math.random)
}

export function LyricsQuiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string, mode: Mode) => void; onQuit: () => void }) {
  const rules = LEVELS[source.level ?? 'normal']
  const [questions, setQuestions] = useState<LyricsQuestion[]>([])
  const [loadingDone, setLoadingDone] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(3)
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [mute, setMute] = useState(isMuted)
  const [revealed, setRevealed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'revealing' | 'countdown' | 'choosing' | 'done'>('revealing')
  const [countdownNum, setCountdownNum] = useState(3)
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  const [penalty, setPenalty] = useState(0)
  const [pickedIdx, setPickedIdx] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [wanted, setWanted] = useState(0)
  const [loaded, setLoaded] = useState<LoadProgress | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const urls = useRef<string[]>([])
  const chooseTimer = useRef(0)

  const combo = answers.length && answers[answers.length - 1].points > 0 ? answers[answers.length - 1].combo : 0

  // questions arrive one by one; play starts after the first few while the rest keep loading
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // only some songs have lyrics that line up with their clip, so every song is a candidate
        const { name: listName, songs, error } = await lyricsCandidates(source.query)
        if (!alive) return
        if (error) return setError(error)
        setName(source.name === 'Playlist kamu' && listName ? listName : source.name)
        const want = source.count === 'all' ? songs.length : (source.count ?? 10)
        setWanted(want)
        const found = await loadSyncedQuestions(
          songs,
          want,
          (rq) => {
            urls.current.push(rq.audioUrl)
            setQuestions((prev) => [...prev, { ...rq, options: buildOptions({ ...rq, options: [] }, prev) }])
          },
          { cancelled: () => !alive, onProgress: setLoaded },
        )
        if (!alive) return
        setLoadingDone(true)
        if (!found) setError('Tidak ada lagu yang liriknya pas dengan lagunya di kuis ini. Coba kuis lain.')
      } catch {
        if (alive) setError('Tidak bisa tersambung. Coba lagi.')
      }
    })()
    return () => { alive = false }
  }, [source])

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const canStart = questions.length >= START_AFTER || (loadingDone && questions.length > 0)

  useEffect(() => {
    if (!canStart || count <= 0) return
    sfx.count(count === 1)
    const id = setTimeout(() => setCount((c) => c - 1), 750)
    return () => clearTimeout(id)
  }, [canStart, count])

  // "Lanjut" pressed before the next song finished loading: go on once it's there
  useEffect(() => {
    if (!waiting) return
    if (qi + 1 < questions.length) {
      setWaiting(false)
      setQi(qi + 1)
    } else if (loadingDone) {
      setWaiting(false)
      onDone(answers, name, 'title')
    }
  }, [waiting, questions.length, loadingDone, qi, answers, name, onDone])

  const q = count <= 0 ? questions[qi] : undefined
  const total = loadingDone ? questions.length : Math.max(wanted, questions.length)

  // reset before paint, or the new question's lines (and answer) flash with the last one's state
  useLayoutEffect(() => {
    if (!q) return
    setRevealed(0)
    setProgress(0)
    setPhase('revealing')
    setWrong(new Set())
    setPenalty(0)
    setPickedIdx(null)
    setStarted(false)
    setBlocked(false)
  }, [q])

  // play from just before the first shown line; show each line as it's sung; stop before the answer
  useEffect(() => {
    if (!q) return
    // the clip was already downloaded (and checked) while loading, so it starts and seeks at once
    const a = new Audio(q.audioUrl)
    a.preload = 'auto'
    audio.current = a
    let raf = 0
    let over = false
    const stop = () => {
      if (over) return
      over = true
      cancelAnimationFrame(raf)
      a.pause()
      setStarted(false)
      setRevealed(q.context.length)
      setProgress(1)
      setPhase('countdown')
    }
    const tick = () => {
      const t = a.currentTime
      if (t >= q.stopAt) return stop()
      setRevealed(cueAt(q.cues, t) + 1)
      setProgress(Math.max(0, Math.min(1, (t - q.from) / (q.stopAt - q.from))))
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      a.currentTime = q.from
      a.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }
    const onPlaying = () => {
      setStarted(true)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    a.addEventListener('playing', onPlaying)
    a.addEventListener('ended', stop)
    a.addEventListener('error', stop)
    if (a.readyState >= 1) start()
    else a.addEventListener('loadedmetadata', start, { once: true })

    return () => {
      over = true
      cancelAnimationFrame(raf)
      a.pause()
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('ended', stop)
      a.removeEventListener('error', stop)
      a.removeEventListener('loadedmetadata', start)
      clearTimeout(chooseTimer.current)
    }
  }, [q])

  // countdown 3-2-1 before the options
  useEffect(() => {
    if (phase !== 'countdown') return
    setCountdownNum(3)
    sfx.count(false)
    let n = 3
    const id = setInterval(() => {
      n--
      if (n <= 0) {
        clearInterval(id)
        setPhase('choosing')
      } else {
        setCountdownNum(n)
        sfx.count(n === 1)
      }
    }, 750)
    return () => clearInterval(id)
  }, [phase])

  // auto-fail after 15s
  useEffect(() => {
    if (phase !== 'choosing' || !q) return
    chooseTimer.current = window.setTimeout(() => {
      sfx.wrong()
      setPhase('done')
      setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: null, points: -penalty, seconds: 0, combo: 0, line: q.answer, tries: wrong.size }])
    }, 15000)
    return () => clearTimeout(chooseTimer.current)
  }, [phase, q, penalty, wrong])

  const tryAnswer = useCallback((idx: number) => {
    if (!q || phase !== 'choosing' || wrong.has(idx)) return
    const opt = q.options[idx]
    if (opt.correct) {
      sfx.right()
      clearTimeout(chooseTimer.current)
      const nextCombo = combo + 1
      if (nextCombo === 3 || nextCombo === 5) setTimeout(sfx.combo, 250)
      const fast = wrong.size === 0
      const pts = Math.max(0, lyricsPoints(nextCombo, fast, rules) - penalty)
      setPickedIdx(idx)
      setPhase('done')
      setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: q.song, points: pts, seconds: 0, combo: nextCombo, line: q.answer, tries: wrong.size }])
    } else {
      sfx.wrong()
      setWrong((w) => new Set(w).add(idx))
      setPenalty((p) => p + WRONG_PENALTY)
      if (wrong.size + 1 >= 3) {
        clearTimeout(chooseTimer.current)
        setPhase('done')
        setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: null, points: -(penalty + WRONG_PENALTY), seconds: 0, combo: 0, line: q.answer, tries: wrong.size + 1 }])
      }
    }
  }, [q, phase, wrong, combo, rules, penalty])

  const next = () => {
    if (qi + 1 < questions.length) return setQi(qi + 1)
    if (loadingDone) return onDone(answers, name, 'title')
    setWaiting(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return
      const n = Number(e.key) || 'abcd'.indexOf(e.key.toLowerCase()) + 1
      if (phase === 'choosing' && n >= 1 && n <= 4) tryAnswer(n - 1)
      else if (phase === 'done' && e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // on a phone the answer and the next button can sit below the screen: bring them up, then back to the top
  const done = phase === 'done'
  useEffect(() => {
    scrollTo({ top: done ? document.documentElement.scrollHeight : 0, behavior: 'smooth' })
  }, [done])

  if (error)
    return (
      <section className="panel center">
        <Bit size={110} mood="sad" />
        <p className="note error">{error}</p>
        <button className="primary" onClick={onQuit}>Kembali</button>
      </section>
    )
  if (!canStart)
    return <Loading title={loaded ? 'Mencocokkan lirik dengan lagunya…' : `Menyiapkan ${name}…`} progress={loaded} need={Math.min(START_AFTER, wanted)} onCancel={onQuit} />
  if (count > 0)
    return (
      <section className="countdown">
        <Bit size={140} mood="listen" />
        <span key={count} className="count-num">{count}</span>
        <p>Dengarkan lagu, lanjutkan liriknya!</p>
      </section>
    )
  if (!q) return null

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[qi]
  const right = (mine?.points ?? 0) > 0
  const shown = phase === 'revealing' ? revealed : q.context.length

  return (
    <section className="quiz lyrics-quiz">
      <header className="quiz-head">
        <button className="ghost small" onClick={onQuit}><X size={14} /> Keluar</button>
        <span className="quiz-name">{name} · Tebak Lirik · {rules.label}</span>
        <button className="ghost small icon" aria-label={mute ? 'Nyalakan suara' : 'Matikan suara'} onClick={() => { setMuted(!mute); setMute(!mute) }}>
          {mute ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <b className="quiz-score" key={score}>{score}</b>
      </header>

      <div className={`progress${total > 20 ? ' many' : ''}`} style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
        {Array.from({ length: total }, (_, k) => {
          const a = answers[k]
          return <i key={k} className={a ? (a.points > 0 ? 'right' : 'wrong') : k === qi ? 'now' : ''} />
        })}
      </div>

      <div className="timebar" aria-hidden>
        <span style={{ transform: `scaleX(${phase === 'revealing' ? progress : 1})`, background: 'linear-gradient(90deg, #3fd6c6, #8b8cff)' }} />
      </div>

      <LyricsCard
        lines={q.context}
        shown={shown}
        live={phase === 'revealing' && started}
        blank={phase === 'countdown' || phase === 'choosing'}
        answer={phase === 'done' ? { text: q.answer, right: right } : undefined}
      />

      {blocked && phase === 'revealing' && (
        <button className="ghost small center-self" onClick={() => audio.current?.play().then(() => setBlocked(false)).catch(() => {})}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}

      <div className="hud">
        <span className={`combo${combo >= 3 ? ' hot' : ''}`} title="Benar berturut-turut">
          <Flame size={15} /> {combo}
        </span>
        <p className="ask">
          {phase === 'revealing' && (
            <>
              <Equalizer on={started} mini /> Dengarkan...
            </>
          )}
          {phase === 'countdown' && <span key={countdownNum} className="count-num small">{countdownNum}</span>}
          {phase === 'choosing' && 'Lanjutkan liriknya!'}
          {phase === 'done' && (right ? 'Benar!' : 'Gagal')}
        </p>
        <span className="penalty-tag">{penalty > 0 && phase !== 'done' ? `-${penalty}` : ''}</span>
      </div>

      {phase === 'done' && (
        <div className="song-reveal">
          {q.song.cover && <img src={q.song.cover} alt="" />}
          <span>
            <b>{q.song.title}</b>
            <small>{q.song.artist}</small>
          </span>
          <Bit size={60} mood={right ? 'happy' : 'sad'} />
          {mine && mine.points !== 0 && (
            <span className={`float-points${mine.points < 0 ? ' penalty' : ''}`}>
              {mine.points > 0 ? `+${mine.points}` : mine.points}
              {right && mine.combo >= 3 && <small> x{comboFactor(mine.combo)}</small>}
            </span>
          )}
        </div>
      )}

      {(phase === 'choosing' || phase === 'done') && (
        <div className="options lyrics-options">
          {q.options.map((o, k) => {
            const isWrong = wrong.has(k)
            const state = phase === 'done'
              ? o.correct ? 'right' : pickedIdx === k ? 'wrong' : isWrong ? 'wrong' : 'dim'
              : isWrong ? 'wrong disabled' : ''
            return (
              <button key={k} className={`option c${k} ${state}`} disabled={phase === 'done' || isWrong} onClick={() => tryAnswer(k)}>
                <kbd>{'ABCD'[k]}</kbd>
                <span><b>{o.text}</b></span>
                {phase === 'done' && o.correct && <Check size={20} />}
                {isWrong && <X size={20} />}
              </button>
            )
          })}
        </div>
      )}

      {phase === 'done' && (
        <button className="primary next" onClick={next} disabled={waiting}>
          {waiting ? 'Menyiapkan lagu berikutnya...' : qi + 1 >= total ? 'Lihat hasil' : 'Lanjut'} {!waiting && <ArrowRight size={16} />}
        </button>
      )}
    </section>
  )
}
