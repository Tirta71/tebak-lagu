import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Flame, Volume2, VolumeX, X } from 'lucide-react'
import { sfx, isMuted, setMuted } from './sfx'
import { LEVELS, type LevelRules } from './levels'
import { Bit, Equalizer } from './Bit'
import type { Answer, Mode, QuizSource, Song } from './types'
import { makeQuestions, comboFactor } from './Quiz'
import { shuffle } from './random'

const WRONG_PENALTY = 200

type SyncedLine = { time: number; text: string }
type LyricOption = { text: string; correct: boolean }
type LyricsQuestion = {
  song: Song
  lines: SyncedLine[]
  contextIdx: number
  contextLen: number
  answerIdx: number
  answer: string
  options: LyricOption[]
}

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
      for (const l of allQuestions[j].lines) {
        const k = l.text.toLowerCase()
        if (!seen.has(k) && l.text.length > 5) { wrongs.push(l.text); seen.add(k) }
        if (wrongs.length >= 3) break
      }
    }
  }
  const opts: LyricOption[] = [{ text: answer, correct: true }]
  for (const w of wrongs.slice(0, 3)) opts.push({ text: w, correct: false })
  return shuffle(opts, Math.random)
}

/**
 * Auto-detect which offset aligns the most lyrics into a 30s window.
 * Tries offsets 0..maxTime in 5s steps, picks the one with the most lines.
 */
function detectOffset(lines: SyncedLine[]): number {
  if (!lines.length) return 30
  const maxT = lines[lines.length - 1].time
  let bestOff = 0, bestCount = 0
  for (let off = 0; off <= maxT - 20; off += 5) {
    const count = lines.filter(l => l.time >= off && l.time < off + 30).length
    if (count > bestCount) { bestCount = count; bestOff = off }
  }
  return bestOff
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
  const [revealed, setRevealed] = useState<SyncedLine[]>([])
  const [phase, setPhase] = useState<'revealing' | 'countdown' | 'choosing' | 'done'>('revealing')
  const [countdownNum, setCountdownNum] = useState(3)
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  const [penalty, setPenalty] = useState(0)
  const [pickedIdx, setPickedIdx] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const nextAudio = useRef<HTMLAudioElement | null>(null)
  const offsetRef = useRef(0)
  const phaseRef = useRef<string>('revealing')
  const chooseTimer = useRef(0)
  const lastRevealIdx = useRef(-1)

  phaseRef.current = phase

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

        type RawQ = { q: (typeof qs)[0]; lines: SyncedLine[]; contextIdx: number; contextLen: number; answerIdx: number; answer: string; wrongs: string[] }
        const raw: RawQ[] = []
        const results = await Promise.all(
          qs.map(async (q) => {
            try {
              const params: Record<string, string> = { title: q.answer.title, artist: q.answer.artist }
              if (q.answer.duration) params.duration = String(q.answer.duration)
              if (q.answer.album) params.album = q.answer.album
              const r = await fetch(`/api/lyrics?${new URLSearchParams(params)}`)
              const lj = await r.json()
              if (lj.found && lj.synced && lj.lines?.length >= 8) {
                return {
                  q,
                  lines: lj.lines as SyncedLine[],
                  contextIdx: lj.contextIdx as number,
                  contextLen: lj.contextLen as number,
                  answerIdx: lj.answerIdx as number,
                  answer: lj.answer as string,
                  wrongs: (lj.wrongs ?? []) as string[],
                } as RawQ
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
          lines: r.lines,
          contextIdx: r.contextIdx,
          contextLen: r.contextLen,
          answerIdx: r.answerIdx,
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

  // real-time lyrics sync using audio.ontimeupdate
  useEffect(() => {
    if (!q) return
    setRevealed([])
    setPhase('revealing')
    setWrong(new Set())
    setPenalty(0)
    setPickedIdx(null)
    setStarted(false)
    lastRevealIdx.current = -1
    phaseRef.current = 'revealing'

    // compute offset: the context lines start at q.lines[q.contextIdx]
    // the audio preview plays ~30s from some point in the song
    // offset = timestamp of first context line (so audio second 0 = that timestamp)
    const ctxStart = q.lines[q.contextIdx].time
    offsetRef.current = ctxStart

    const a = (nextAudio.current?.src === q.song.preview ? nextAudio.current : null) ?? new Audio(q.song.preview)
    audio.current = a
    a.addEventListener('playing', () => setStarted(true), { once: true })

    const contextEnd = q.contextIdx + q.contextLen
    const stopAtLine = contextEnd // stop before answer line

    const onTimeUpdate = () => {
      if (phaseRef.current !== 'revealing') return
      const t = a.currentTime + offsetRef.current
      // reveal all lines from contextIdx whose timestamp <= current time
      let newLastIdx = lastRevealIdx.current
      for (let i = q.contextIdx; i < stopAtLine; i++) {
        if (q.lines[i].time <= t && i > lastRevealIdx.current) {
          newLastIdx = i
        }
      }
      if (newLastIdx > lastRevealIdx.current) {
        lastRevealIdx.current = newLastIdx
        const revealedLines = q.lines.slice(q.contextIdx, newLastIdx + 1)
        setRevealed(revealedLines)

        // if all context lines revealed, transition to countdown
        if (newLastIdx >= stopAtLine - 1) {
          a.pause()
          setStarted(false)
          setTimeout(() => setPhase('countdown'), 400)
        }
      }
    }

    a.addEventListener('timeupdate', onTimeUpdate)
    a.play().catch(() => {})

    // fallback: if after 25s still revealing, force transition
    const fallback = window.setTimeout(() => {
      if (phaseRef.current === 'revealing') {
        const revealedLines = q.lines.slice(q.contextIdx, stopAtLine)
        setRevealed(revealedLines)
        a.pause()
        setStarted(false)
        setPhase('countdown')
      }
    }, 25000)

    const upcoming = questions?.[qi + 1]
    nextAudio.current = upcoming?.song.preview ? new Audio(upcoming.song.preview) : null
    if (nextAudio.current) nextAudio.current.preload = 'auto'

    return () => {
      a.pause()
      a.removeEventListener('timeupdate', onTimeUpdate)
      clearTimeout(fallback)
      clearTimeout(chooseTimer.current)
    }
  }, [q, qi, questions])

  // countdown 3-2-1
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
  const totalContext = q.contextLen

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
        <span style={{ transform: `scaleX(${phase === 'done' ? 1 : Math.min(1, revealed.length / totalContext)})`, background: 'linear-gradient(90deg, #3fd6c6, #8b8cff)' }} />
      </div>

      <div className="stage lyrics-stage">
        <div className="lyrics-snippet">
          {(phase === 'revealing' ? revealed : q.lines.slice(q.contextIdx, q.contextIdx + q.contextLen)).map((line, k) => (
            <p key={k} className={k === revealed.length - 1 && phase === 'revealing' ? 'lyrics-new' : ''}>{line.text}</p>
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
