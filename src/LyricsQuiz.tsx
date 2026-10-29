import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Volume2, VolumeX, X } from 'lucide-react'
import { sfx, isMuted, setMuted } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import { Bit, Equalizer } from './Bit'
import type { Answer, Mode, QuizSource, Song } from './types'
import { makeQuestions, comboFactor } from './Quiz'
import { shuffle } from './random'

const WRONG_PENALTY = 200

type ContextLine = { text: string; delay: number }
type LyricOption = { text: string; correct: boolean }
type LyricsQuestion = { song: Song; context: ContextLine[]; answer: string; options: LyricOption[] }

function lyricsPoints(combo: number, fast: boolean, rules: LevelRules) {
  const base = fast ? 800 : 500
  return Math.round(base * rules.factor * comboFactor(combo))
}

function buildOptions(answer: string, wrongPool: string[], allQuestions: LyricsQuestion[], qi: number): LyricOption[] {
  const wrongs: string[] = []
  const seen = new Set([answer.toLowerCase()])
  for (const w of wrongPool) {
    const k = w.toLowerCase()
    if (!seen.has(k)) { wrongs.push(w); seen.add(k) }
    if (wrongs.length >= 3) break
  }
  if (wrongs.length < 3) {
    for (let j = 0; j < allQuestions.length && wrongs.length < 3; j++) {
      if (j === qi) continue
      for (const line of [...allQuestions[j].context.map(c => c.text), allQuestions[j].answer]) {
        const k = line.toLowerCase()
        if (!seen.has(k) && line.length > 5) { wrongs.push(line); seen.add(k) }
        if (wrongs.length >= 3) break
      }
    }
  }
  const opts: LyricOption[] = [{ text: answer, correct: true }]
  for (const w of wrongs.slice(0, 3)) opts.push({ text: w, correct: false })
  return shuffle(opts, Math.random)
}

export function LyricsQuiz({ source, onDone, onQuit }: { source: QuizSource; onDone: (answers: Answer[], name: string, mode: Mode) => void; onQuit: () => void }) {
  const rules = LEVELS[source.level ?? 'normal']
  const [questions, setQuestions] = useState<LyricsQuestion[] | null>(null)
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(3)
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [mute, setMute] = useState(isMuted)
  const [revealed, setRevealed] = useState(0)
  const [phase, setPhase] = useState<'revealing' | 'countdown' | 'choosing' | 'done'>('revealing')
  const [countdownNum, setCountdownNum] = useState(3)
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  const [penalty, setPenalty] = useState(0)
  const [pickedIdx, setPickedIdx] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const nextAudio = useRef<HTMLAudioElement | null>(null)
  const revealTimers = useRef<number[]>([])
  const chooseTimer = useRef(0)

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

        type RawLyrics = { q: (typeof qs)[0]; context: ContextLine[]; answer: string; wrongs: string[] }
        const raw: RawLyrics[] = []
        const results = await Promise.all(
          qs.map(async (q) => {
            try {
              const params: Record<string, string> = { title: q.answer.title, artist: q.answer.artist }
              if (q.answer.duration) params.duration = String(q.answer.duration)
              if (q.answer.album) params.album = q.answer.album
              const r = await fetch(`/api/lyrics?${new URLSearchParams(params)}`)
              const lj = await r.json()
              if (lj.found && lj.context?.length >= 2) {
                const context: ContextLine[] = lj.context.map((c: ContextLine | string) =>
                  typeof c === 'string' ? { text: c, delay: 2.5 } : c
                )
                return { q, context, answer: lj.answer, wrongs: lj.wrongs ?? [] } as RawLyrics
              }
            } catch {}
            return null
          }),
        )
        for (const r of results) if (r) raw.push(r)
        if (!alive) return
        if (raw.length < 4) return setError('Tidak cukup lagu yang punya lirik untuk kuis ini.')

        const lqs: LyricsQuestion[] = raw.map((r) => ({
          song: r.q.answer,
          context: r.context,
          answer: r.answer,
          options: [],
        }))
        for (let k = 0; k < lqs.length; k++) {
          lqs[k].options = buildOptions(raw[k].answer, raw[k].wrongs, lqs, k)
        }
        setQuestions(lqs)
      } catch {
        if (alive) setError('Tidak bisa tersambung. Coba lagi.')
      }
    })()
    return () => { alive = false }
  }, [source])

  useEffect(() => {
    if (!questions || count <= 0) return
    sfx.count(count === 1)
    const id = setTimeout(() => setCount((c) => c - 1), 750)
    return () => clearTimeout(id)
  }, [questions, count])

  const q = count <= 0 ? questions?.[qi] : undefined

  // play audio + reveal context lines using per-line delays from synced lyrics
  useEffect(() => {
    if (!q) return
    setRevealed(0)
    setPhase('revealing')
    setWrong(new Set())
    setPenalty(0)
    setPickedIdx(null)
    setStarted(false)

    const a = (nextAudio.current?.src === q.song.preview ? nextAudio.current : null) ?? new Audio(q.song.preview)
    audio.current = a
    a.addEventListener('playing', () => setStarted(true), { once: true })
    a.play().catch(() => {})

    const upcoming = questions?.[qi + 1]
    nextAudio.current = upcoming?.song.preview ? new Audio(upcoming.song.preview) : null
    if (nextAudio.current) nextAudio.current.preload = 'auto'

    // schedule each line reveal at its own delay
    const timers: number[] = []
    let cumDelay = 0
    for (let i = 0; i < q.context.length; i++) {
      cumDelay += (i === 0 ? 1.0 : q.context[i].delay) * 1000
      const lineNum = i + 1
      const isLast = i === q.context.length - 1
      timers.push(window.setTimeout(() => {
        setRevealed(lineNum)
        if (isLast) {
          a.pause()
          setStarted(false)
          setTimeout(() => setPhase('countdown'), 400)
        }
      }, cumDelay))
    }
    revealTimers.current = timers

    return () => {
      a.pause()
      for (const t of timers) clearTimeout(t)
      clearTimeout(chooseTimer.current)
    }
  }, [q, qi, questions])

  // countdown 3-2-1 before showing options
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

  // auto-fail after 15s in choosing phase
  useEffect(() => {
    if (phase !== 'choosing' || !q) return
    chooseTimer.current = window.setTimeout(() => {
      sfx.wrong()
      setPhase('done')
      setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: null, points: -penalty, seconds: 0, combo: 0 }])
    }, 15000)
    return () => clearTimeout(chooseTimer.current)
  }, [phase, q, penalty])

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
      setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: q.song, points: pts, seconds: 0, combo: nextCombo }])
    } else {
      sfx.wrong()
      setWrong((w) => new Set(w).add(idx))
      setPenalty((p) => p + WRONG_PENALTY)
      if (wrong.size + 1 >= 3) {
        clearTimeout(chooseTimer.current)
        setPhase('done')
        setAnswers((a) => [...a, { question: { kind: 'title', answer: q.song, options: [] }, picked: null, points: -(penalty + WRONG_PENALTY), seconds: 0, combo: 0 }])
      }
    }
  }, [q, phase, wrong, combo, rules, penalty])

  const next = () => {
    if (!questions) return
    if (qi + 1 >= questions.length) return onDone(answers, name, 'title')
    setQi(qi + 1)
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
            <p>Dengarkan lagu, lanjutkan liriknya!</p>
          </>
        ) : (
          <p className="note">Menyiapkan lirik...</p>
        )}
      </section>
    )
  if (!q) return null

  const score = answers.reduce((s, a) => s + a.points, 0)
  const mine = answers[qi]

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
          return <i key={k} className={a ? (a.points > 0 ? 'right' : 'wrong') : k === qi ? 'now' : ''} />
        })}
      </div>

      <div className="timebar" aria-hidden>
        <span style={{ transform: `scaleX(${phase === 'done' ? 1 : Math.min(1, revealed / q.context.length)})`, background: 'linear-gradient(90deg, #3fd6c6, #8b8cff)' }} />
      </div>

      <div className="stage lyrics-stage">
        <div className="lyrics-snippet">
          {q.context.slice(0, Math.max(revealed, phase !== 'revealing' ? q.context.length : 0)).map((line, k) => (
            <p key={k} className={k === revealed - 1 && phase === 'revealing' ? 'lyrics-new' : ''}>{line.text}</p>
          ))}
          {(phase === 'countdown' || phase === 'choosing') && <p className="lyrics-blank">???</p>}
          {phase === 'done' && (
            <p className={`lyrics-answer ${mine?.points > 0 ? 'correct' : 'missed'}`}>{q.answer}</p>
          )}
        </div>
        <Equalizer on={started} />
      </div>

      <div className="hud">
        <span className={`combo${combo >= 3 ? ' hot' : ''}`} title="Benar berturut-turut">
          <Flame size={15} /> {combo}
        </span>
        <p className="ask">
          {phase === 'revealing' && `Dengarkan...`}
          {phase === 'countdown' && <span key={countdownNum} className="count-num small">{countdownNum}</span>}
          {phase === 'choosing' && 'Lanjutkan liriknya!'}
          {phase === 'done' && (mine?.points > 0 ? 'Benar!' : 'Gagal')}
        </p>
        {penalty > 0 && phase !== 'done' && <span className="penalty-tag">-{penalty}</span>}
      </div>

      {phase === 'done' && (
        <div className="now-playing" style={{ justifyContent: 'center' }}>
          {q.song.cover && <img src={q.song.cover} alt="" />}
          <span>
            <b>{q.song.title}</b>
            <small>{q.song.artist}</small>
          </span>
        </div>
      )}

      {phase === 'done' && (
        <>
          <Bit size={72} mood={mine?.points > 0 ? 'happy' : 'sad'} />
          {mine && mine.points > 0 && (
            <span className="float-points">
              +{mine.points}
              {mine.combo >= 3 && <small> x{comboFactor(mine.combo)}</small>}
            </span>
          )}
          {mine && mine.points < 0 && <span className="float-points penalty">{mine.points}</span>}
        </>
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
        <button className="primary" onClick={next}>
          {qi + 1 >= questions.length ? 'Lihat hasil' : 'Lanjut'} <ArrowRight size={16} />
        </button>
      )}
    </section>
  )
}
