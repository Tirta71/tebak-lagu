import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Volume2, VolumeX, X } from 'lucide-react'
import { sfx, isMuted, setMuted } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import { Bit, Equalizer } from './Bit'
import type { Answer, Mode, Question, QuizSource, Song } from './types'
import { makeQuestions, comboFactor } from './Quiz'

const LINE_INTERVAL = 2.5
const WRONG_PENALTY = 200

type TimedLine = { time: number | null; text: string }
type LyricsQuestion = Question & { lines: TimedLine[]; synced: boolean; audioStart: number }

/** Points: the fewer lines revealed when you answer, the more you get. */
function lyricsPoints(linesRevealed: number, totalLines: number, combo: number, rules: LevelRules) {
  const progress = Math.min(1, linesRevealed / totalLines)
  const base = Math.round((300 + 700 * (1 - progress)) * rules.factor)
  return Math.round(base * comboFactor(combo))
}

export function LyricsQuiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string, mode: Mode) => void; onQuit: () => void }) {
  const rules = LEVELS[source.level ?? 'normal']
  const [questions, setQuestions] = useState<LyricsQuestion[] | null>(null)
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(3)
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [mute, setMute] = useState(isMuted)
  // how many lines are visible right now
  const [revealed, setRevealed] = useState(0)
  // options the player already tried and got wrong
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  // total penalty accumulated this question
  const [penalty, setPenalty] = useState(0)
  // has the player answered correctly (or all options exhausted)?
  const [done, setDone] = useState(false)
  // the correct pick (or null if failed all)
  const [picked, setPicked] = useState<Song | null>(null)
  const [started, setStarted] = useState(false)
  const [silent, setSilent] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const nextAudio = useRef<HTMLAudioElement | null>(null)
  const lineTimer = useRef(0)
  const startedAt = useRef(0)

  const combo = answers.length && answers[answers.length - 1].points > 0 ? answers[answers.length - 1].combo : 0

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/quiz?${source.query}&want=${source.count ?? 10}`)
        const j = await res.json()
        if (!alive) return
        if (j.error || !j.tracks) return setError(j.error ?? 'Kuis tidak bisa dimuat.')
        setName(source.name === 'Playlist kamu' && j.name ? j.name : source.name)
        const qCount = source.count === 'all' ? j.tracks.length : (source.count ?? 10)
        const qs = makeQuestions(j.tracks, 'title', Math.random, rules.sameArtist, qCount)

        const withLyrics: LyricsQuestion[] = []
        const results = await Promise.all(
          qs.map(async (q) => {
            try {
              const audioStart = rules.randomStart ? 3 + Math.random() * Math.max(0, 24) : 0
              const r = await fetch(`/api/lyrics?${new URLSearchParams({ title: q.answer.title, artist: q.answer.artist, start: String(Math.round(audioStart)) })}`)
              const lj = await r.json()
              if (lj.found && lj.lines?.length >= 4) return { ...q, lines: lj.lines as TimedLine[], synced: !!lj.synced, audioStart }
            } catch {}
            return null
          }),
        )
        for (const r of results) if (r) withLyrics.push(r)
        if (!alive) return
        if (withLyrics.length < 4) return setError('Tidak cukup lagu yang punya lirik untuk kuis ini.')
        setQuestions(withLyrics)
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

  // play audio + reveal lines one by one
  useEffect(() => {
    if (!q) return
    setRevealed(1)
    setWrong(new Set())
    setPenalty(0)
    setDone(false)
    setPicked(null)
    setStarted(false)
    setSilent(false)
    startedAt.current = 0

    const a = nextAudio.current?.src === q.answer.preview ? nextAudio.current : new Audio(q.answer.preview)
    audio.current = a
    const onPlaying = () => {
      if (startedAt.current) return
      startedAt.current = performance.now()
      setStarted(true)
    }
    a.addEventListener('playing', onPlaying)
    a.currentTime = q.audioStart
    a.play().catch(() => setStarted(false))

    const upcoming = questions?.[i + 1]
    nextAudio.current = upcoming?.answer.preview ? new Audio(upcoming.answer.preview) : null
    if (nextAudio.current) nextAudio.current.preload = 'auto'

    // reveal lines: synced = based on audio time, plain = fixed interval
    let lineCount = 1
    if (q.synced && q.lines[0].time != null) {
      const baseTime = q.lines[0].time
      lineTimer.current = window.setInterval(() => {
        if (!a.currentTime) return
        const now = a.currentTime
        let show = 1
        for (let k = 0; k < q.lines.length; k++) {
          if (q.lines[k].time != null && now >= q.lines[k].time - baseTime + q.audioStart) show = k + 1
        }
        if (show !== lineCount) {
          lineCount = show
          setRevealed(show)
        }
        if (lineCount >= q.lines.length) clearInterval(lineTimer.current)
      }, 200)
    } else {
      lineTimer.current = window.setInterval(() => {
        lineCount++
        setRevealed(lineCount)
        if (lineCount >= q.lines.length) clearInterval(lineTimer.current)
      }, LINE_INTERVAL * 1000)
    }

    return () => {
      a.removeEventListener('playing', onPlaying)
      a.pause()
      clearInterval(lineTimer.current)
    }
  }, [q, i, questions, rules])

  // auto-finish when all lines revealed and no answer yet: give a few more seconds
  useEffect(() => {
    if (!q || done) return
    if (revealed >= q.lines.length) {
      const id = setTimeout(() => {
        if (!done) {
          setDone(true)
          setPicked(null)
          sfx.wrong()
          setAnswers((a) => [...a, { question: q, picked: null, points: -penalty, seconds: 0, combo: 0 }])
        }
      }, 5000)
      return () => clearTimeout(id)
    }
  }, [revealed, q, done, penalty])

  const tryAnswer = useCallback((song: Song) => {
    if (!q || done || wrong.has(song.id)) return
    if (song.id === q.answer.id) {
      sfx.right()
      const nextCombo = combo + 1
      if (nextCombo === 3 || nextCombo === 5) setTimeout(sfx.combo, 250)
      const pts = Math.max(0, lyricsPoints(revealed, q.lines.length, nextCombo, rules) - penalty)
      clearInterval(lineTimer.current)
      setDone(true)
      setPicked(song)
      setAnswers((a) => [...a, { question: q, picked: song, points: pts, seconds: 0, combo: nextCombo }])
    } else {
      sfx.wrong()
      setWrong((w) => new Set(w).add(song.id))
      setPenalty((p) => p + WRONG_PENALTY)
      // if all 3 wrong options tried, auto-fail
      const newWrongCount = wrong.size + 1
      if (newWrongCount >= 3) {
        clearInterval(lineTimer.current)
        setDone(true)
        setPicked(null)
        setAnswers((a) => [...a, { question: q, picked: null, points: -(penalty + WRONG_PENALTY), seconds: 0, combo: 0 }])
      }
    }
  }, [q, done, wrong, combo, revealed, rules, penalty])

  const next = () => {
    if (!questions) return
    if (i + 1 >= questions.length) return onDone(answers, name, 'title')
    setI(i + 1)
  }

  // keyboard: 1-4 / A-D pick, Enter next
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return
      const n = Number(e.key) || 'abcd'.indexOf(e.key.toLowerCase()) + 1
      const o = q.options[n - 1]
      if (!done && o) tryAnswer(o)
      else if (done && e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
            <p>Dengarkan lagu, baca liriknya!</p>
          </>
        ) : (
          <p className="note">Menyiapkan lirik...</p>
        )}
      </section>
    )
  if (!q) return null

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[i]

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

      <div className={`progress${questions.length > 20 ? ' many' : ''}`} style={{ gridTemplateColumns: `repeat(${questions.length}, 1fr)` }}>
        {questions.map((_, k) => {
          const a = answers[k]
          return <i key={k} className={a ? (a.points > 0 ? 'right' : 'wrong') : k === i ? 'now' : ''} />
        })}
      </div>

      {/* lyrics lines progress bar */}
      <div className="timebar" aria-hidden>
        <span style={{ transform: `scaleX(${done ? 1 : Math.min(1, revealed / q.lines.length)})`, background: 'linear-gradient(90deg, #3fd6c6, #8b8cff)' }} />
      </div>

      <div className="stage lyrics-stage">
        {done ? (
          <>
            <div className="now-playing">
              {q.answer.cover && <img src={q.answer.cover} alt="" />}
              <span>
                <b>{q.answer.title}</b>
                <small>{q.answer.artist}</small>
              </span>
            </div>
            <Bit size={86} mood={mine?.points > 0 ? 'happy' : 'sad'} />
            {mine && mine.points > 0 && (
              <span className="float-points">
                +{mine.points}
                {mine.combo >= 3 && <small> x{comboFactor(mine.combo)}</small>}
              </span>
            )}
            {mine && mine.points < 0 && (
              <span className="float-points penalty">{mine.points}</span>
            )}
          </>
        ) : (
          <>
            <div className="lyrics-snippet">
              {q.lines.slice(0, revealed).map((line, k) => (
                <p key={k} className={k === revealed - 1 ? 'lyrics-new' : ''}>{line.text}</p>
              ))}
            </div>
            <Equalizer on={started && !silent} />
          </>
        )}
      </div>

      <div className="hud">
        <span className={`combo${combo >= 3 ? ' hot' : ''}`} title="Benar berturut-turut">
          <Flame size={15} /> {combo}
        </span>
        <p className="ask">
          {done
            ? mine?.points > 0
              ? 'Benar!'
              : 'Gagal'
            : `Lagu apa ini? · Baris ${revealed}/${q.lines.length}`}
        </p>
        {!done && penalty > 0 && <span className="penalty-tag">-{penalty}</span>}
      </div>

      {!started && !done && (
        <button className="ghost small center-self" onClick={() => audio.current?.play()}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}

      <div className="options">
        {q.options.map((o, k) => {
          const isWrong = wrong.has(o.id)
          const state = done
            ? o.id === q.answer.id ? 'right' : picked?.id === o.id ? 'wrong' : isWrong ? 'wrong' : 'dim'
            : isWrong ? 'wrong disabled' : ''
          return (
            <button key={o.id} className={`option c${k} ${state}`} disabled={done || isWrong} onClick={() => tryAnswer(o)}>
              <kbd>{'ABCD'[k]}</kbd>
              <span>
                <b>{o.title}</b>
                <small>{o.artist}</small>
              </span>
              {done && o.id === q.answer.id && <Check size={20} />}
              {isWrong && <X size={20} />}
            </button>
          )
        })}
      </div>

      {done && (
        <button className="primary" onClick={next}>
          {i + 1 >= questions.length ? 'Lihat hasil' : 'Lanjut'} <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
