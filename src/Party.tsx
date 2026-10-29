import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection } from 'peerjs'
import { ArrowLeft, Check, ChevronRight, Copy, Crown, ListMusic, LogOut, Play, Settings2, Users, Volume2, X, Zap } from 'lucide-react'
import { Bit, Equalizer } from './Bit'
import { LEVELS } from './levels'
import type { Profile } from './local'
import { QuizPicker } from './QuizPicker'
import { FIRST_BONUS, MAX_PLAYERS, newCode, peerId, type GuestMsg, type HostMsg, type Player, type PublicQuestion, type RoundResult, type Settings, type Step } from './room'
import { enoughArtists, makeQuestions, MODE_LABEL, pointsFor } from './Quiz'
import { SettingsPanel, type GameSettings } from './Settings'
import { sfx } from './sfx'
import type { Mode, Question, QuizSource, Song } from './types'

const HOST = 'host'
/** Seconds after a song starts before the host closes it anyway (slow loading, someone away). */
const GRACE = 3

type Phase = 'connecting' | 'lobby' | 'loading' | 'question' | 'reveal' | 'end' | 'error'
type View = {
  phase: Phase
  players: Player[]
  settings: Settings | null
  step: Step
  q: PublicQuestion | null
  answered: string[]
  reveal: { answer: Song; results: RoundResult[] } | null
  error: string | null
}

const blank: View = { phase: 'connecting', players: [], settings: null, step: 'atur', q: null, answered: [], reveal: null, error: null }

/** Everyone, highest score first. */
const ranked = (players: Player[]) => [...players].sort((a, b) => b.score - a.score)

/**
 * A room. The host's browser runs it: it opens the room at once, sets it up (settings, then a quiz)
 * while friends join, loads the songs, sends each one to the guests, collects the answers, scores
 * them (faster is more, the first right answer gets a bonus) and sends the results. Guests show
 * what the host sends and answer.
 */
function useRoom(role: 'host' | 'guest', code: string, me: Profile, initial: GameSettings) {
  const [view, setView] = useState<View>(blank)
  const [roomCode, setRoomCode] = useState(code)
  const myId = useRef(role === 'host' ? HOST : '')
  const peer = useRef<Peer | null>(null)
  // host-only state
  const conns = useRef(new Map<string, DataConnection>())
  const players = useRef(new Map<string, Player>())
  const settings = useRef<Settings>({ quiz: null, mode: initial.mode, level: initial.level, count: initial.count })
  const step = useRef<Step>('atur')
  const quiz = useRef<QuizSource | null>(null)
  const questions = useRef<Question[]>([])
  const current = useRef(-1)
  const answers = useRef(new Map<string, { id: number | null; seconds: number }>())
  const timer = useRef(0)
  const hostConn = useRef<DataConnection | null>(null)

  /** What everyone (the host included) does with a message from the host. */
  const apply = useCallback((m: HostMsg) => {
    setView((v) => {
      switch (m.t) {
        case 'lobby':
          return { ...v, phase: v.phase === 'connecting' || v.phase === 'end' ? 'lobby' : v.phase, players: m.players, settings: m.settings, step: m.step }
        case 'loading':
          return { ...v, phase: 'loading' }
        case 'q':
          return { ...v, phase: 'question', q: m.q, answered: [], reveal: null }
        case 'answered':
          return { ...v, answered: m.ids }
        case 'reveal':
          return { ...v, phase: 'reveal', reveal: { answer: m.answer, results: m.results }, players: m.players }
        case 'end':
          return { ...v, phase: 'end', players: m.players }
        case 'full':
          return { ...v, phase: 'error', error: 'Room sudah penuh.' }
      }
    })
  }, [])

  /** Host: send to every guest and show it here too. */
  const emit = useCallback(
    (m: HostMsg) => {
      for (const c of conns.current.values()) if (c.open) c.send(m)
      apply(m)
    },
    [apply],
  )

  const lobby = useCallback(() => emit({ t: 'lobby', players: [...players.current.values()], settings: settings.current, step: step.current }), [emit])

  // ---------- host: setting up ----------

  const setStep = useCallback(
    (s: Step) => {
      step.current = s
      lobby()
    },
    [lobby],
  )

  const configure = useCallback(
    (patch: Partial<GameSettings>) => {
      settings.current = { ...settings.current, ...patch }
      lobby()
    },
    [lobby],
  )

  const chooseQuiz = useCallback(
    (q: QuizSource) => {
      quiz.current = q
      settings.current = { ...settings.current, quiz: q.name, picture: q.picture ?? null }
      setStep('main')
    },
    [setStep],
  )

  // ---------- host: scoring and moving through the songs ----------

  const rulesOf = () => LEVELS[settings.current.level]

  const finish = useCallback(() => {
    clearTimeout(timer.current)
    const i = current.current
    const q = questions.current[i]
    if (!q || !Number.isInteger(i)) return
    const rules = rulesOf()
    const right = [...answers.current.entries()].filter(([, a]) => a.id === q.answer.id).sort((a, b) => a[1].seconds - b[1].seconds)
    const firstId = right[0]?.[0]
    const results: RoundResult[] = [...players.current.values()].map((p) => {
      const a = answers.current.get(p.id)
      const ok = a?.id === q.answer.id
      const points = ok ? pointsFor(Math.max(0, rules.seconds - a!.seconds), 0, rules) + (p.id === firstId ? Math.round(FIRST_BONUS * rules.factor) : 0) : 0
      p.score += points
      return { id: p.id, picked: a?.id ?? null, points, first: p.id === firstId, seconds: a ? a.seconds : null }
    })
    current.current = i + 0.5 // answers for this song are closed
    emit({ t: 'reveal', i, answer: q.answer, results, players: [...players.current.values()] })
  }, [emit])

  const ask = useCallback(
    (i: number) => {
      const q = questions.current[i]
      if (!q?.answer.preview) return
      current.current = i
      answers.current.clear()
      emit({ t: 'q', q: { i, total: questions.current.length, kind: q.kind, preview: q.answer.preview, options: q.options.map(({ id, title, artist }) => ({ id, title, artist })) } })
      timer.current = window.setTimeout(finish, (rulesOf().seconds + GRACE) * 1000)
    },
    [emit, finish],
  )

  const onAnswer = useCallback(
    (from: string, m: { i: number; id: number | null; seconds: number }) => {
      if (m.i !== current.current || answers.current.has(from)) return
      answers.current.set(from, { id: m.id, seconds: Math.max(0, m.seconds) })
      emit({ t: 'answered', ids: [...answers.current.keys()] })
      if (answers.current.size >= players.current.size) finish()
    },
    [emit, finish],
  )

  /** Host: load the chosen quiz's songs, shuffle the questions and play the first. */
  const begin = useCallback(async () => {
    const q = quiz.current
    if (!q) return setStep('kuis')
    emit({ t: 'loading' })
    const s = settings.current
    const j = await fetch(`/api/quiz?${q.query}&want=${s.count}`)
      .then((r) => r.json())
      .catch(() => ({ error: 'Kuis tidak bisa dimuat.' }))
    if (j.error || !j.tracks) {
      setView((v) => ({ ...v, phase: 'lobby', error: j.error ?? 'Kuis tidak bisa dimuat.' }))
      return setStep('kuis')
    }
    // artist quizzes are always "guess the title": every song is by the same singer
    const mode: Mode = q.key.startsWith('artist:') || !enoughArtists(j.tracks) ? 'title' : s.mode
    const count = s.count === 'all' ? j.tracks.length : Math.min(s.count, j.tracks.length)
    for (const p of players.current.values()) p.score = 0
    questions.current = makeQuestions(j.tracks, mode, Math.random, LEVELS[s.level].sameArtist, count)
    setView((v) => ({ ...v, error: null }))
    ask(0)
  }, [emit, ask, setStep])

  const nextSong = useCallback(() => {
    const i = Math.floor(current.current) + 1
    if (i < questions.current.length) ask(i)
    else emit({ t: 'end', players: [...players.current.values()] })
  }, [ask, emit])

  /** Host: after the podium, back to the lobby to play again (same people, maybe another quiz). */
  const backToLobby = useCallback(() => {
    current.current = -1
    for (const p of players.current.values()) p.score = 0
    step.current = 'main'
    lobby()
  }, [lobby])

  // ---------- connecting ----------

  useEffect(() => {
    let closed = false
    const fail = (error: string) => !closed && setView((v) => ({ ...v, phase: 'error', error }))

    if (role === 'host') {
      players.current.set(HOST, { id: HOST, name: me.name || 'Host', avatar: me.avatar, score: 0 })
      const open = (tries: number) => {
        if (closed) return
        const c = newCode()
        const p = new Peer(peerId(c))
        peer.current = p
        p.on('open', () => {
          if (closed) return p.destroy()
          setRoomCode(c)
          lobby()
        })
        p.on('error', (e) => {
          // someone else already has this code: pick another
          if ((e as { type?: string }).type === 'unavailable-id' && tries > 0) {
            p.destroy()
            open(tries - 1)
          } else fail('Tidak bisa membuat room. Cek koneksi internet lalu coba lagi.')
        })
        p.on('connection', (conn) => {
          conn.on('data', (raw) => {
            const m = raw as GuestMsg
            if (m.t === 'hello') {
              if (players.current.size >= MAX_PLAYERS) return conn.send({ t: 'full' } satisfies HostMsg)
              conns.current.set(conn.peer, conn)
              players.current.set(conn.peer, { id: conn.peer, name: m.name.slice(0, 18) || 'Tamu', avatar: m.avatar, score: 0 })
              lobby()
            } else if (m.t === 'answer') onAnswer(conn.peer, m)
          })
          conn.on('close', () => {
            conns.current.delete(conn.peer)
            players.current.delete(conn.peer)
            lobby()
            // everyone still here has answered: no need to wait for the one who left
            if (Number.isInteger(current.current) && current.current >= 0 && answers.current.size >= players.current.size) finish()
          })
        })
      }
      open(3)
    } else {
      const p = new Peer()
      peer.current = p
      p.on('open', (id) => {
        if (closed) return p.destroy()
        myId.current = id
        const conn = p.connect(peerId(code.toUpperCase()), { reliable: true })
        hostConn.current = conn
        conn.on('open', () => conn.send({ t: 'hello', name: me.name || 'Tamu', avatar: me.avatar } satisfies GuestMsg))
        conn.on('data', (raw) => apply(raw as HostMsg))
        conn.on('close', () => fail('Host menutup room.'))
      })
      p.on('error', (e) => fail((e as { type?: string }).type === 'peer-unavailable' ? `Room ${code.toUpperCase()} tidak ditemukan.` : 'Koneksi ke room gagal. Coba lagi.'))
      // no answer from the room for a while: say so rather than wait forever
      setTimeout(() => setView((v) => (v.phase === 'connecting' ? { ...v, phase: 'error', error: `Belum bisa masuk ke room ${code.toUpperCase()}. Pastikan kodenya benar dan host masih di lobi.` } : v)), 15000)
    }
    return () => {
      closed = true
      clearTimeout(timer.current)
      peer.current?.destroy()
    }
    // the room lives as long as this screen; me/initial are read once when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** My answer to song `i` (the host answers like everyone else). */
  const answer = useCallback(
    (i: number, id: number | null, seconds: number) => {
      if (role === 'host') onAnswer(HOST, { i, id, seconds })
      else hostConn.current?.send({ t: 'answer', i, id, seconds } satisfies GuestMsg)
    },
    [role, onAnswer],
  )

  return { view, roomCode, myId, answer, begin, nextSong, setStep, configure, chooseQuiz, backToLobby }
}

/** One song in the room: the preview plays, the clock runs, pick a choice. */
function RoomQuestion({ q, settings, answered, players, onAnswer }: { q: PublicQuestion; settings: Settings; answered: string[]; players: Player[]; onAnswer: (id: number | null, seconds: number) => void }) {
  const rules = LEVELS[settings.level]
  const [left, setLeft] = useState(rules.seconds)
  const [started, setStarted] = useState(false)
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const audio = useRef<HTMLAudioElement | null>(null)
  const startedAt = useRef(0)
  const done = useRef(false)

  const pick = useCallback(
    (id: number | null) => {
      if (done.current) return
      done.current = true
      setPicked(id)
      const seconds = startedAt.current ? (performance.now() - startedAt.current) / 1000 : rules.seconds
      onAnswer(id, Math.min(seconds, rules.seconds))
    },
    [onAnswer, rules.seconds],
  )

  useEffect(() => {
    const a = new Audio(q.preview)
    audio.current = a
    const span = rules.listen ?? rules.seconds
    a.currentTime = rules.randomStart ? 3 + Math.random() * Math.max(0, 30 - span - 6) : 0
    let raf = 0
    const onPlaying = () => {
      if (startedAt.current) return
      startedAt.current = performance.now()
      setStarted(true)
      const tick = () => {
        const elapsed = (performance.now() - startedAt.current) / 1000
        if (rules.listen && elapsed >= rules.listen) a.pause()
        const l = rules.seconds - elapsed
        setLeft(Math.max(0, l))
        if (l <= 0) return pick(null)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    a.addEventListener('playing', onPlaying)
    a.play().catch(() => setStarted(false))
    return () => {
      cancelAnimationFrame(raf)
      a.removeEventListener('playing', onPlaying)
      a.pause()
    }
  }, [q, rules, pick])

  const waiting = players.filter((p) => !answered.includes(p.id)).length
  return (
    <section className="quiz">
      <div className="room-bar">
        <span>
          Lagu {q.i + 1}/{q.total}
        </span>
        <span>{q.kind === 'artist' ? 'Siapa penyanyinya?' : 'Lagu apa ini?'}</span>
        <span>
          <Users size={14} /> {answered.length}/{players.length}
        </span>
      </div>
      <div className={`timebar${left <= 5 && picked === undefined ? ' hurry' : ''}`} aria-hidden>
        <span style={{ transform: `scaleX(${picked !== undefined ? 0 : left / rules.seconds})` }} />
      </div>
      <div className="stage">
        <Bit size={110} mood="listen" />
        <Equalizer on={started} />
      </div>
      {!started && (
        <button className="ghost small center-self" onClick={() => audio.current?.play()}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}
      {/* who has answered so far */}
      <div className="who-answered">
        {players.map((p) => (
          <span key={p.id} className={answered.includes(p.id) ? 'in' : ''} title={p.name}>
            {p.avatar}
          </span>
        ))}
      </div>
      <div className="options">
        {q.options.map((o, k) => (
          <button key={o.id} className={`option c${k}${picked === o.id ? ' chosen' : picked !== undefined ? ' dim' : ''}`} disabled={picked !== undefined} onClick={() => pick(o.id)}>
            <kbd>{'ABCD'[k]}</kbd>
            <span>
              <b>{q.kind === 'artist' ? o.artist : o.title}</b>
              {q.kind === 'title' && !rules.hideArtist && <small>{o.artist}</small>}
            </span>
          </button>
        ))}
      </div>
      {picked !== undefined && <p className="note center-text">{waiting ? `Menunggu ${waiting} pemain lagi…` : 'Semua sudah menjawab!'}</p>}
    </section>
  )
}

function Scoreboard({ players, results, myId }: { players: Player[]; results?: RoundResult[]; myId: string }) {
  return (
    <ol className="scoreboard">
      {ranked(players).map((p, k) => {
        const r = results?.find((x) => x.id === p.id)
        return (
          <li key={p.id} className={p.id === myId ? 'me' : ''}>
            <span className="place">{k + 1}</span>
            <span className="sb-avatar">{p.avatar}</span>
            <b>{p.name}</b>
            {r &&
              (r.points ? (
                <em className="gain">
                  +{r.points}
                  {r.first && <Zap size={12} />}
                </em>
              ) : (
                <em className="miss">{r.picked === null ? 'waktu habis' : 'salah'}</em>
              ))}
            <span className="sb-score">{p.score}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** The players column: everyone in the room, then empty seats up to the limit. */
function Seats({ players, me }: { players: Player[]; me: string }) {
  return (
    <aside className="seats">
      <h3>
        Pemain {players.length}/{MAX_PLAYERS}
      </h3>
      <ol>
        {players.map((p) => (
          <li key={p.id} className={`seat${p.id === HOST ? ' host' : ''}`}>
            <span className="sb-avatar">{p.avatar}</span>
            <b>{p.name}</b>
            {p.id === me && <small>kamu</small>}
            {p.id === HOST && <Crown size={16} className="crown" />}
          </li>
        ))}
        {Array.from({ length: MAX_PLAYERS - players.length }, (_, k) => (
          <li key={`empty-${k}`} className="seat empty">
            <span className="sb-avatar" />
            <b>Kosong</b>
          </li>
        ))}
      </ol>
    </aside>
  )
}

const STEPS: { id: Step; label: string; icon: typeof Settings2 }[] = [
  { id: 'atur', label: 'Atur', icon: Settings2 },
  { id: 'kuis', label: 'Pilih kuis', icon: ListMusic },
  { id: 'main', label: 'Main', icon: Play },
]

/** The quiz and settings the room will play, as a card. */
function Summary({ s }: { s: Settings }) {
  return (
    <div className="summary">
      {s.picture ? (
        <img src={s.picture} alt="" />
      ) : (
        <span className="summary-art" aria-hidden>
          <ListMusic size={30} />
        </span>
      )}
      <div>
        <small>Kuis</small>
        <b>{s.quiz ?? 'Belum dipilih'}</b>
        <span className="chips">
          <i>{MODE_LABEL[s.mode]}</i>
          <i className={`lv-${s.level}`}>{LEVELS[s.level].label}</i>
          <i>{s.count === 'all' ? 'Semua lagu' : `${s.count} lagu`}</i>
        </span>
      </div>
    </div>
  )
}

export function Party({ role, code, initial, profile, onLeave }: { role: 'host' | 'guest'; code: string; initial: GameSettings; profile: Profile; onLeave: () => void }) {
  const { view, roomCode, myId, answer, begin, nextSong, setStep, configure, chooseQuiz, backToLobby } = useRoom(role, code, profile, initial)
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}/?room=${roomCode}`
  const me = myId.current
  const host = role === 'host'

  // a sound when the result comes in, and the host moves on by itself after a while
  useEffect(() => {
    if (view.phase !== 'reveal' || !view.reveal) return
    const mine = view.reveal.results.find((r) => r.id === me)
    if (mine?.points) sfx.right()
    else sfx.wrong()
    if (!host) return
    const id = setTimeout(nextSong, 8000)
    return () => clearTimeout(id)
  }, [view.phase, view.reveal, me, host, nextSong])

  const invite = async () => {
    try {
      if (navigator.share) await navigator.share({ text: `Main Tebak Lagu bareng aku! Kode room: ${roomCode}`, url: link })
      else {
        await navigator.clipboard.writeText(link)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      /* closed the share sheet */
    }
  }

  if (view.phase === 'error')
    return (
      <section className="panel center">
        <Bit size={110} mood="sad" />
        <p className="note error">{view.error}</p>
        <button className="primary" onClick={onLeave}>
          Kembali
        </button>
      </section>
    )

  if (view.phase === 'connecting' || view.phase === 'loading')
    return (
      <section className="countdown">
        <Bit size={130} mood="listen" />
        <p className="note">{view.phase === 'loading' ? 'Menyiapkan lagu-lagunya…' : host ? 'Membuka room…' : `Masuk ke room ${code.toUpperCase()}…`}</p>
      </section>
    )

  const s = view.settings
  const stepIndex = STEPS.findIndex((x) => x.id === view.step)
  return (
    <section className="room">
      <header className="room-head">
        <button className="ghost small" onClick={onLeave}>
          <LogOut size={14} /> Keluar
        </button>
        {view.phase === 'lobby' && (
          <ol className="steps">
            {STEPS.map((x, k) => (
              <li key={x.id} className={k === stepIndex ? 'now' : k < stepIndex ? 'done' : ''}>
                <button disabled={!host || (x.id === 'main' && !s?.quiz)} onClick={() => setStep(x.id)}>
                  <x.icon size={15} /> {x.label}
                </button>
                {k < STEPS.length - 1 && <ChevronRight size={14} className="arrow" />}
              </li>
            ))}
          </ol>
        )}
        <span className="room-code">
          Room <b>{roomCode}</b>
        </span>
      </header>

      {view.phase === 'lobby' && s && (
        <>
          <div className="lobby-grid">
            <Seats players={view.players} me={me} />
            <div className="lobby-main">
              {view.error && <p className="note error">{view.error}</p>}
              {host && view.step === 'atur' && (
                <SettingsPanel settings={{ mode: s.mode, level: s.level, count: s.count }} setMode={(mode) => configure({ mode })} setLevel={(level) => configure({ level })} setCount={(count) => configure({ count })} />
              )}
              {host && view.step === 'kuis' && (
                <div className="lobby-picker">
                  <QuizPicker onStart={chooseQuiz} />
                </div>
              )}
              {(view.step === 'main' || !host) && (
                <div className="ready">
                  <Summary s={s} />
                  {host ? (
                    <p className="muted center-text">Semua siap? Teman yang masuk sekarang masih bisa ikut.</p>
                  ) : (
                    <p className="note center-text">{view.step === 'main' ? 'Menunggu host memulai…' : 'Host sedang mengatur permainan…'}</p>
                  )}
                  {!host && <SettingsPanel settings={{ mode: s.mode, level: s.level, count: s.count }} />}
                </div>
              )}
            </div>
          </div>

          <footer className="lobby-bar">
            <button className="ghost" onClick={invite}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Link tersalin!' : 'Undang teman'}
            </button>
            {host && view.step !== 'atur' && (
              <button className="ghost" onClick={() => setStep(STEPS[stepIndex - 1].id)}>
                <ArrowLeft size={16} /> Kembali
              </button>
            )}
            {host && view.step === 'atur' && (
              <button className="primary" onClick={() => setStep(s.quiz ? 'main' : 'kuis')}>
                Berikutnya <ChevronRight size={16} />
              </button>
            )}
            {host && view.step === 'main' && (
              <button className="primary" onClick={begin}>
                <Play size={16} /> Mulai
              </button>
            )}
          </footer>
        </>
      )}

      {view.phase === 'question' && view.q && s && <RoomQuestion key={view.q.i} q={view.q} settings={s} answered={view.answered} players={view.players} onAnswer={(id, seconds) => answer(view.q!.i, id, seconds)} />}

      {view.phase === 'reveal' && view.reveal && (
        <div className="reveal-room">
          <div className="now-playing">
            {view.reveal.answer.cover && <img src={view.reveal.answer.cover} alt="" />}
            <span>
              <small className="muted">Jawabannya</small>
              <b>{view.reveal.answer.title}</b>
              <small>{view.reveal.answer.artist}</small>
            </span>
          </div>
          <Scoreboard players={view.players} results={view.reveal.results} myId={me} />
          {host ? (
            <button className="primary" onClick={nextSong}>
              Lagu berikutnya
            </button>
          ) : (
            <p className="note center-text">Lagu berikutnya sebentar lagi…</p>
          )}
        </div>
      )}

      {view.phase === 'end' && (
        <div className="reveal-room">
          <div className="podium">
            {ranked(view.players)
              .slice(0, 3)
              .map((p, k) => (
                <div key={p.id} className={`step step-${k + 1}`}>
                  <span className="sb-avatar big">{p.avatar}</span>
                  <b>{p.name}</b>
                  <span>{p.score}</span>
                  <i>{k + 1}</i>
                </div>
              ))}
          </div>
          <Scoreboard players={view.players} myId={me} />
          <div className="row">
            {host && (
              <button className="primary" onClick={backToLobby}>
                <Play size={16} /> Main lagi
              </button>
            )}
            <button className="ghost" onClick={onLeave}>
              <X size={15} /> Keluar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
