import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Peer, { type DataConnection } from 'peerjs'
import { ArrowLeft, Check, ChevronRight, Copy, Crown, Hand, History, ListMusic, LogOut, Pencil, Play, RotateCcw, Settings2, Trophy, Users, Volume2, X, Zap } from 'lucide-react'
import { Bit, Equalizer } from './Bit'
import { LEVELS } from './levels'
import { AVATARS, saveProfile, type Profile } from './local'
import { QuizPicker } from './QuizPicker'
import { ANSWER_DELAY, BUZZ_PENALTY, BUZZ_SECONDS, FIRST_BONUS, MAX_PLAYERS, WRONG_PENALTY, newCode, peerId, type GuestMsg, type HostMsg, type LyricsPublicQuestion, type Player, type PublicQuestion, type RoundResult, type Settings, type Step } from './room'
import { enoughArtists, makeQuestions, MODE_LABEL, pointsFor } from './Quiz'
import { SettingsPanel, type GameSettings } from './Settings'
import { sfx } from './sfx'
import { cueAt, lineKey, loadSyncedQuestions, lyricsCandidates, type LoadProgress, type ReadyQuestion } from './lyricsSync'
import { LyricsCard } from './LyricsCard'
import { Loading } from './Loading'
import type { Mode, Question, QuizSource, Song } from './types'

const PEER_CONFIG = { host: 'peer.allegiaant.net', port: 443, path: '/peer', secure: true }
const HOST = 'host'
const NO_WEBRTC = 'Browser ini tidak bisa main bareng. Kalau link-nya terbuka di dalam aplikasi (Instagram, LINE, dll.), buka di Chrome atau Safari.'
/** Seconds after a song starts before the host closes it anyway (slow loading, someone away). */
const GRACE = 3
/** Extra wait after a raised hand's time is up, for a pick made at the last moment to arrive. */
const BUZZ_GRACE = 0.8

type Phase = 'connecting' | 'lobby' | 'loading' | 'question' | 'reveal' | 'end' | 'error' | 'lyrics-q'
/** A song that has been played: its answer and how everyone did. */
type Round = { i: number; answer: Song; results: RoundResult[] }
/** A song to play: guess its title or singer, or (Tebak Lirik) continue its lyrics. */
type Turn = { kind: 'song'; q: Question } | { kind: 'lyrics'; q: ReadyQuestion }
type View = {
  phase: Phase
  players: Player[]
  settings: Settings | null
  step: Step
  q: PublicQuestion | null
  answered: string[]
  /** `line`: in Tebak Lirik, the line that came next. */
  reveal: { answer: Song; results: RoundResult[]; line?: string } | null
  history: Round[]
  error: string | null
  /** While the songs are got ready: how many have been checked for lyrics. */
  loading: LoadProgress | null
  // lyrics mode
  lq: LyricsPublicQuestion | null
  buzzer: string | null
  buzzerName: string | null
}

const blank: View = { phase: 'connecting', players: [], settings: null, step: 'atur', q: null, answered: [], reveal: null, history: [], error: null, loading: null, lq: null, buzzer: null, buzzerName: null }

/** `extra` mixed into `list`, one somewhere in each equal stretch of the game, so they don't bunch up. */
function spread<T>(list: T[], extra: T[]) {
  const out = [...list]
  const n = list.length + extra.length
  extra.forEach((x, k) => {
    const from = Math.floor((k * n) / extra.length)
    const to = Math.floor(((k + 1) * n) / extra.length)
    out.splice(Math.min(out.length, from + Math.floor(Math.random() * (to - from))), 0, x)
  })
  return out
}

/** Everyone, highest score first. */
const ranked = (players: Player[]) => [...players].sort((a, b) => b.score - a.score)

/**
 * A room. The host's browser runs it: it opens the room at once, sets it up (settings, then a quiz)
 * while friends join, loads the songs, sends each one to the guests, collects the answers, scores
 * them (only the fastest right answer scores: points for speed plus a bonus; a wrong pick loses
 * points) and sends the results. Guests show what the host sends and answer.
 */
function useRoom(role: 'host' | 'guest', code: string, me: Profile, initial: GameSettings) {
  const [view, setView] = useState<View>(blank)
  const [roomCode, setRoomCode] = useState(code)
  // host: the room has lost the PeerJS server and is getting it back
  const [offline, setOffline] = useState(false)
  const myId = useRef(role === 'host' ? HOST : '')
  const peer = useRef<Peer | null>(null)
  // host-only state
  const conns = useRef(new Map<string, DataConnection>())
  const players = useRef(new Map<string, Player>())
  const settings = useRef<Settings>({ quiz: null, mode: initial.mode, level: initial.level, count: initial.count })
  const step = useRef<Step>('atur')
  const quiz = useRef<QuizSource | null>(null)
  const turns = useRef<Turn[]>([])
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
          return { ...v, phase: 'loading', history: [], q: null, lq: null, loading: m.progress ?? null }
        // a game can mix both kinds of song: only the one playing is kept
        case 'q':
          return { ...v, phase: 'question', q: m.q, lq: null, answered: [], reveal: null }
        case 'answered':
          return { ...v, answered: m.ids }
        case 'reveal':
          return {
            ...v,
            phase: 'reveal',
            reveal: { answer: m.answer, results: m.results, line: m.line },
            players: m.players,
            history: [...v.history.filter((h) => h.i !== m.i), { i: m.i, answer: m.answer, results: m.results }],
          }
        case 'end':
          return { ...v, phase: 'end', players: m.players }
        case 'full':
          return { ...v, phase: 'error', error: 'Room sudah penuh.' }
        // lyrics mode
        case 'lq':
          return { ...v, phase: 'lyrics-q', lq: m.q, q: null, answered: [], buzzer: null, buzzerName: null }
        case 'lq-buzz-ok':
          return { ...v, buzzer: m.id, buzzerName: null }
        case 'lq-buzz-taken':
          return { ...v, buzzer: m.id, buzzerName: m.name }
        case 'lq-wrong':
          return { ...v, buzzer: null, buzzerName: null }
        case 'lq-correct':
          return v // reveal message follows
        case 'lq-line':
          return v // lines are already in the question
        default:
          return v
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
    (patch: Partial<GameSettings> & { lyrics?: boolean }) => {
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
    const t = turns.current[i]
    if (t?.kind !== 'song' || !Number.isInteger(i)) return
    const q = t.q
    const rules = rulesOf()
    const right = [...answers.current.entries()].filter(([, a]) => a.id === q.answer.id).sort((a, b) => a[1].seconds - b[1].seconds)
    const firstId = right[0]?.[0]
    const results: RoundResult[] = [...players.current.values()].map((p) => {
      const a = answers.current.get(p.id)
      const ok = a?.id === q.answer.id
      // the song goes to whoever was right fastest; the others who were right get nothing, and a
      // wrong pick costs points (running out of time doesn't)
      const wrong = a !== undefined && a.id !== null && !ok
      const points = p.id === firstId ? pointsFor(Math.max(0, rules.seconds - a!.seconds), 0, rules) + Math.round(FIRST_BONUS * rules.factor) : wrong ? -WRONG_PENALTY : 0
      p.score += points
      return { id: p.id, picked: a?.id ?? null, points, first: p.id === firstId, right: ok, seconds: a ? a.seconds : null }
    })
    current.current = i + 0.5 // answers for this song are closed
    emit({ t: 'reveal', i, answer: q.answer, results, players: [...players.current.values()] })
  }, [emit])

  const ask = useCallback(
    (i: number) => {
      const t = turns.current[i]
      const q = t?.kind === 'song' ? t.q : null
      if (!q?.answer.preview) return
      current.current = i
      answers.current.clear()
      clearTimeout(timer.current)
      emit({ t: 'q', q: { i, total: turns.current.length, kind: q.kind, preview: q.answer.preview, options: q.options.map(({ id, title, artist }) => ({ id, title, artist })) } })
      timer.current = window.setTimeout(finish, (ANSWER_DELAY + rulesOf().seconds + GRACE) * 1000)
    },
    [emit, finish],
  )

  const onAnswer = useCallback(
    (from: string, m: { i: number; id: number | null; seconds: number }) => {
      if (m.i !== current.current || answers.current.has(from)) return
      answers.current.set(from, { id: m.id, seconds: Math.max(0, m.seconds) })
      emit({ t: 'answered', ids: [...answers.current.keys()] })
      // the song ends once everyone has answered (or the time is up); the fastest right one wins it,
      // by each player's own clock rather than by whose answer reached the host first
      if (answers.current.size >= players.current.size) finish()
    },
    [emit, finish],
  )

  // ---------- host: lyrics mode ----------

  const lyricsBuzzer = useRef<string | null>(null)
  const lyricsWrongIds = useRef(new Set<number>())
  const lyricsLineTimer = useRef(0)
  const lyricsPenalties = useRef(new Map<string, number>())
  const lastEmittedLyricsQ = useRef<LyricsPublicQuestion | null>(null)
  const buzzTimer = useRef(0)

  /** Song i's Tebak Lirik question, when it is one. */
  const lyricsAt = (i: number) => {
    const t = turns.current[i]
    return t?.kind === 'lyrics' ? t.q : null
  }

  const askLyrics = useCallback((i: number) => {
    const q = lyricsAt(i)
    if (!q?.song.preview) return
    current.current = i
    lyricsBuzzer.current = null
    clearTimeout(buzzTimer.current)
    lyricsWrongIds.current = new Set()
    lyricsPenalties.current = new Map()
    clearInterval(lyricsLineTimer.current)
    const seen = new Set([lineKey(q.answer), ...q.context.map(lineKey)])
    const wrongs: string[] = []
    const take = (line: string) => { const k = lineKey(line); if (wrongs.length < 3 && !seen.has(k) && line.length > 5) { wrongs.push(line); seen.add(k) } }
    q.wrongs.forEach(take)
    turns.current.forEach((t, j) => { if (j !== i && t.kind === 'lyrics') [...t.q.context, t.q.answer].forEach(take) })
    const opts = [{ text: q.answer, correct: true }, ...wrongs.map((t) => ({ text: t, correct: false }))]
    for (let k = opts.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [opts[k], opts[j]] = [opts[j], opts[k]] }
    const lq: LyricsPublicQuestion = { i, total: turns.current.length, preview: q.song.preview, context: q.context, options: opts, from: q.from, cues: q.cues, stopAt: q.stopAt }
    lastEmittedLyricsQ.current = lq
    emit({ t: 'lq', q: lq })
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { finishLyrics(i) }, (q.stopAt - q.from + 25) * 1000)
  }, [emit])

  const finishLyrics = useCallback((qi: number) => {
    clearTimeout(timer.current)
    clearTimeout(buzzTimer.current)
    clearInterval(lyricsLineTimer.current)
    const q = lyricsAt(qi)
    if (!q) return
    const results: RoundResult[] = [...players.current.values()].map((p) => {
      const pen = lyricsPenalties.current.get(p.id) ?? 0
      if (pen > 0) p.score -= pen
      return { id: p.id, picked: null, points: -pen, first: false, right: false, seconds: null }
    })
    current.current = qi + 0.5
    emit({ t: 'reveal', i: qi, answer: q.song, results, players: [...players.current.values()], line: q.answer })
  }, [emit])

  const onLyricsBuzz = useCallback((from: string, qi: number) => {
    if (qi !== current.current || lyricsBuzzer.current !== null) return
    lyricsBuzzer.current = from
    const p = players.current.get(from)
    // tell the buzzer they got it
    const conn = conns.current.get(from)
    if (conn?.open) conn.send({ t: 'lq-buzz-ok', id: from } satisfies HostMsg)
    // tell everyone else someone buzzed
    for (const [id, c] of conns.current) {
      if (id !== from && c.open) c.send({ t: 'lq-buzz-taken', id: from, name: p?.name ?? '?' } satisfies HostMsg)
    }
    // host sees it too
    if (from === HOST) apply({ t: 'lq-buzz-ok', id: from })
    else apply({ t: 'lq-buzz-taken', id: from, name: p?.name ?? '?' })
    // no pick in time: the turn ends like a wrong pick, and anyone may raise their hand again
    clearTimeout(buzzTimer.current)
    buzzTimer.current = window.setTimeout(() => {
      if (lyricsBuzzer.current !== from || current.current !== qi) return
      lyricsBuzzer.current = null
      const pen = (lyricsPenalties.current.get(from) ?? 0) + BUZZ_PENALTY
      lyricsPenalties.current.set(from, pen)
      emit({ t: 'lq-wrong', id: from, penalty: pen })
    }, (BUZZ_SECONDS + BUZZ_GRACE) * 1000)
  }, [apply, emit])

  const onLyricsAnswer = useCallback((from: string, qi: number, optIdx: number) => {
    if (qi !== Math.floor(current.current) || lyricsBuzzer.current !== from) return
    const q = lyricsAt(Math.floor(qi))
    if (!q) return
    // the guest sends the index of a choice; the host kept the shuffled choices it sent
    const emittedQ = lastEmittedLyricsQ.current
    if (!emittedQ || emittedQ.i !== qi) return
    const picked = emittedQ.options[optIdx]
    if (!picked) return
    clearTimeout(buzzTimer.current)

    if (picked.correct) {
      const rules = rulesOf()
      const pen = lyricsPenalties.current.get(from) ?? 0
      const pts = Math.max(100, Math.round(800 * rules.factor) - pen)
      const p = players.current.get(from)
      if (p) p.score += pts
      clearTimeout(timer.current)
      clearInterval(lyricsLineTimer.current)
      const results: RoundResult[] = [...players.current.values()].map((pl) => {
        const myPen = lyricsPenalties.current.get(pl.id) ?? 0
        if (myPen > 0 && pl.id !== from) pl.score -= myPen
        return { id: pl.id, picked: pl.id === from ? q.song.id : null, points: pl.id === from ? pts : -myPen, first: pl.id === from, right: pl.id === from, seconds: null }
      })
      current.current = qi + 0.5
      emit({ t: 'reveal', i: qi, answer: q.song, results, players: [...players.current.values()], line: q.answer })
    } else {
      lyricsBuzzer.current = null
      lyricsWrongIds.current.add(optIdx)
      const pen = (lyricsPenalties.current.get(from) ?? 0) + BUZZ_PENALTY
      lyricsPenalties.current.set(from, pen)
      emit({ t: 'lq-wrong', id: from, penalty: pen })
    }
  }, [emit])

  /** Host: play song i, whichever kind it is. */
  const play = useCallback((i: number) => (turns.current[i]?.kind === 'lyrics' ? askLyrics(i) : ask(i)), [ask, askLyrics])

  /** Host: load the chosen quiz's songs, shuffle the questions and play the first. */
  const begin = useCallback(async () => {
    const q = quiz.current
    if (!q) return setStep('kuis')
    emit({ t: 'loading' })
    const s = settings.current
    const failed = (error: string) => {
      setView((v) => ({ ...v, phase: 'lobby', error }))
      setStep('kuis')
    }

    const start = (list: Turn[]) => {
      for (const p of players.current.values()) p.score = 0
      turns.current = list
      setView((v) => ({ ...v, error: null }))
      play(0)
    }
    /**
     * Tebak Lirik questions, up to `want(songs)`: every song is a candidate (only some have lyrics
     * that line up with their clip), and guests play the clip from Deezer themselves.
     */
    const lyrics = async (want: (songs: number) => number) => {
      const { songs, error } = await lyricsCandidates(q.query)
      const found: ReadyQuestion[] = []
      if (error) return { found, error }
      await loadSyncedQuestions(songs, want(songs.length), (rq) => {
        URL.revokeObjectURL(rq.audioUrl)
        found.push(rq)
      }, { onProgress: (progress) => emit({ t: 'loading', progress }) })
      return { found }
    }

    if (s.lyrics) {
      const { found, error } = await lyrics((n) => (s.count === 'all' ? n : s.count))
      if (error) return failed(error)
      if (found.length < 4) return failed('Tidak cukup lagu yang liriknya pas dengan lagunya.')
      return start(found.map((rq): Turn => ({ kind: 'lyrics', q: rq })))
    }

    // Acak: about a third of the songs are Tebak Lirik, the rest a title or a singer to guess
    const mixed = s.mode === 'both'
    const [j, withLyrics] = await Promise.all([
      fetch(`/api/quiz?${q.query}&want=${s.count}`)
        .then((r) => r.json())
        .catch(() => ({ error: 'Kuis tidak bisa dimuat.' })),
      mixed ? lyrics((n) => Math.round((s.count === 'all' ? n : s.count) / 3)).then((r) => r.found) : [],
    ])
    if (j.error || !j.tracks) return failed(j.error ?? 'Kuis tidak bisa dimuat.')
    // a song asked for its lyrics isn't asked again for its title
    const taken = new Set(withLyrics.flatMap((x) => [String(x.song.id), lineKey(x.song.title)]))
    const pool = (j.tracks as Song[]).filter((t) => !taken.has(String(t.id)) && !taken.has(lineKey(t.title)))
    const mode: Mode = q.key.startsWith('artist:') || !enoughArtists(pool) ? 'title' : s.mode
    const count = Math.min((s.count === 'all' ? j.tracks.length : s.count) - withLyrics.length, pool.length)
    const songs = makeQuestions(pool, mode, Math.random, LEVELS[s.level].sameArtist, count).map((sq): Turn => ({ kind: 'song', q: sq }))
    start(spread(songs, withLyrics.map((rq): Turn => ({ kind: 'lyrics', q: rq }))))
  }, [emit, play, setStep])

  const nextSong = useCallback(() => {
    const i = Math.floor(current.current) + 1
    if (i < turns.current.length) play(i)
    else emit({ t: 'end', players: [...players.current.values()] })
  }, [play, emit])

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
        const p = new Peer(peerId(c), PEER_CONFIG)
        peer.current = p
        let opened = false
        p.on('open', () => {
          if (closed) return p.destroy()
          setOffline(false)
          if (opened) return // back after a reconnect: same code, same room
          opened = true
          setRoomCode(c)
          lobby()
        })
        // The link to the PeerJS server drops when the phone sleeps or the tab goes to the
        // background (say, to send the code on WhatsApp). Players already in keep playing, but
        // nobody new can find the room until it is back, so get it back under the same code.
        p.on('disconnected', () => {
          if (closed || p.destroyed) return
          setOffline(true)
          window.setTimeout(revive, 1500)
        })
        p.on('error', (e) => {
          const type = (e as { type?: string }).type
          if (!opened) {
            // someone else already has this code: pick another
            if (type === 'unavailable-id' && tries > 0) {
              p.destroy()
              open(tries - 1)
            } else fail('Tidak bisa membuat room. Cek koneksi internet lalu coba lagi.')
          } else if (type === 'unavailable-id') fail('Room ini terputus terlalu lama dan kodenya sudah tidak bisa dipakai. Buat room baru.')
          // any other trouble once the room is open: 'disconnected' and revive bring it back
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
            else if (m.t === 'lq-buzz') onLyricsBuzz(conn.peer, m.i)
            else if (m.t === 'lq-answer') onLyricsAnswer(conn.peer, m.i, m.id)
            else if (m.t === 'profile') {
              const p = players.current.get(conn.peer)
              if (!p) return
              p.name = m.name.slice(0, 18) || 'Tamu'
              p.avatar = AVATARS.includes(m.avatar) ? m.avatar : p.avatar
              lobby()
            }
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
    } else if (typeof RTCPeerConnection === 'undefined') fail(NO_WEBRTC)
    else {
      const room = code.toUpperCase()
      const p = new Peer(undefined as unknown as string, PEER_CONFIG)
      peer.current = p
      p.on('open', (id) => {
        if (closed) return p.destroy()
        myId.current = id
        const conn = p.connect(peerId(room), { reliable: true })
        hostConn.current = conn
        conn.on('open', () => conn.send({ t: 'hello', name: me.name || 'Tamu', avatar: me.avatar } satisfies GuestMsg))
        conn.on('data', (raw) => apply(raw as HostMsg))
        conn.on('close', () => fail('Sambungan ke host terputus. Host mungkin keluar dari room, atau jaringannya putus.'))
      })
      p.on('error', (e) => {
        const type = (e as { type?: string }).type
        if (type === 'peer-unavailable') fail(`Room ${room} tidak ditemukan. Cek lagi kodenya. Kalau kodenya benar, minta host membuka lagi tab Tebak Lagu-nya, lalu coba lagi.`)
        else if (type === 'browser-incompatible') fail(NO_WEBRTC)
        else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') fail('Server room tidak bisa dihubungi. Cek internetmu, lalu coba lagi.')
        else fail('Koneksi ke room gagal. Coba lagi.')
      })
      // the room was found but the two browsers can't reach each other (usually the network)
      setTimeout(
        () =>
          setView((v) =>
            v.phase === 'connecting'
              ? { ...v, phase: 'error', error: `Belum bisa tersambung ke room ${room}. Biasanya karena jaringan: coba pindah dari data seluler ke WiFi (atau sebaliknya), atau buka link-nya di Chrome atau Safari, lalu coba lagi.` }
              : v,
          ),
        15000,
      )
    }

    // host: try to get the room back while it is cut off, and as soon as the tab is back in front
    // or the internet returns
    const revive = () => {
      const p = peer.current
      if (!closed && role === 'host' && p && p.disconnected && !p.destroyed) p.reconnect()
    }
    const onVisible = () => document.visibilityState === 'visible' && revive()
    const retry = window.setInterval(revive, 5000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', revive)
    return () => {
      closed = true
      clearTimeout(timer.current)
      clearTimeout(buzzTimer.current)
      clearInterval(retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', revive)
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

  /** A new name or avatar for me: the host changes its own seat, a guest asks the host to. */
  const rename = useCallback(
    (name: string, avatar: string) => {
      if (role === 'host') {
        const p = players.current.get(HOST)
        if (!p) return
        p.name = name.slice(0, 18) || 'Host'
        p.avatar = avatar
        lobby()
      } else hostConn.current?.send({ t: 'profile', name, avatar } satisfies GuestMsg)
    },
    [role, lobby],
  )

  /** My buzz (raise hand) for lyrics question `i`. */
  const lyricsBuzz = useCallback(
    (i: number) => {
      if (role === 'host') onLyricsBuzz(HOST, i)
      else hostConn.current?.send({ t: 'lq-buzz', i } satisfies GuestMsg)
    },
    [role, onLyricsBuzz],
  )

  /** My answer after buzzing in lyrics mode. */
  const lyricsAnswer = useCallback(
    (i: number, id: number) => {
      if (role === 'host') onLyricsAnswer(HOST, i, id)
      else hostConn.current?.send({ t: 'lq-answer', i, id } satisfies GuestMsg)
    },
    [role, onLyricsAnswer],
  )

  return { view, roomCode, offline, myId, answer, begin, nextSong, setStep, configure, chooseQuiz, backToLobby, rename, lyricsBuzz, lyricsAnswer }
}

/** One song in the room: the preview plays, the clock runs, pick a choice. */
function RoomQuestion({ q, settings, answered, players, onAnswer }: { q: PublicQuestion; settings: Settings; answered: string[]; players: Player[]; onAnswer: (id: number | null, seconds: number) => void }) {
  const rules = LEVELS[settings.level]
  const [left, setLeft] = useState(rules.seconds)
  const [started, setStarted] = useState(false)
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  // seconds until the choices open; the clock for answering starts after that
  const [wait, setWait] = useState(ANSWER_DELAY)
  const audio = useRef<HTMLAudioElement | null>(null)
  const startedAt = useRef(0)
  const open = useRef(false)
  const done = useRef(false)
  // the room re-renders whenever someone answers; keep the song and its clock out of that
  const report = useRef(onAnswer)
  report.current = onAnswer

  const pick = useCallback(
    (id: number | null) => {
      if (done.current || !open.current) return
      done.current = true
      setPicked(id)
      const seconds = (performance.now() - startedAt.current) / 1000 - ANSWER_DELAY
      report.current(id, Math.min(Math.max(0, seconds), rules.seconds))
    },
    [rules.seconds],
  )

  useEffect(() => {
    const a = new Audio(q.preview)
    audio.current = a
    const span = rules.listen ?? rules.seconds
    a.currentTime = rules.randomStart ? 3 + Math.random() * Math.max(0, 30 - span - 6) : 0
    let raf = 0
    let shown = ANSWER_DELAY
    const onPlaying = () => {
      if (startedAt.current) return
      startedAt.current = performance.now()
      setStarted(true)
      sfx.count()
      const tick = () => {
        const elapsed = (performance.now() - startedAt.current) / 1000
        if (rules.listen && elapsed - ANSWER_DELAY >= rules.listen) a.pause()
        // everyone listens first: 3, 2, 1 with a beep each, a higher one when the choices open
        const locked = ANSWER_DELAY - elapsed
        if (locked > 0) {
          if (Math.ceil(locked) !== shown) {
            shown = Math.ceil(locked)
            setWait(shown)
            sfx.count()
          }
          raf = requestAnimationFrame(tick)
          return
        }
        if (!open.current) {
          open.current = true
          setWait(0)
          sfx.count(true)
        }
        const l = rules.seconds - (elapsed - ANSWER_DELAY)
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
      {started && wait > 0 && (
        <p className="answer-lock" aria-live="polite">
          Dengarkan dulu… <b key={wait}>{wait}</b>
        </p>
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
          <button key={o.id} className={`option c${k}${picked === o.id ? ' chosen' : picked !== undefined ? ' dim' : wait > 0 ? ' locked' : ''}`} disabled={picked !== undefined || wait > 0} onClick={() => pick(o.id)}>
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

/** Lyrics round in a room: context lines appear, then players buzz to pick the next line. */
function RoomLyricsQuestion({ q, myId, buzzer, buzzerName, onBuzz, onAnswer }: {
  q: LyricsPublicQuestion
  myId: string
  buzzer: string | null
  buzzerName: string | null
  onBuzz: () => void
  onAnswer: (idx: number) => void
}) {
  const [revealed, setRevealed] = useState(0)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState<'revealing' | 'choosing'>('revealing')
  const [started, setStarted] = useState(false)
  const [myWrong, setMyWrong] = useState<Set<number>>(new Set())
  const [myPenalty, setMyPenalty] = useState(0)
  // seconds left for whoever raised their hand; `picked` once they've picked, so a slow reply from the host isn't a timeout
  const [buzzLeft, setBuzzLeft] = useState(BUZZ_SECONDS)
  const picked = useRef(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  // reset before paint, or the new question's lines flash with the last one's state
  useLayoutEffect(() => {
    setRevealed(0)
    setProgress(0)
    setPhase('revealing')
    setMyWrong(new Set())
    setMyPenalty(0)
  }, [q])

  // play from just before the first shown line; show each line as it's sung; stop before the answer
  useEffect(() => {
    const a = new Audio(q.preview)
    a.preload = 'auto'
    audio.current = a
    let raf = 0
    let choose = 0
    let over = false
    const stop = () => {
      if (over) return
      over = true
      cancelAnimationFrame(raf)
      a.pause()
      setStarted(false)
      setRevealed(q.context.length)
      setProgress(1)
      choose = window.setTimeout(() => setPhase('choosing'), 600)
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
      a.play().catch(() => {})
    }
    const onPlaying = () => {
      setStarted(true)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    a.addEventListener('playing', onPlaying)
    a.addEventListener('ended', stop)
    a.addEventListener('error', stop)
    a.addEventListener('loadedmetadata', start, { once: true })
    return () => {
      over = true
      cancelAnimationFrame(raf)
      clearTimeout(choose)
      a.pause()
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('ended', stop)
      a.removeEventListener('error', stop)
      a.removeEventListener('loadedmetadata', start)
    }
  }, [q])

  const iHaveBuzz = buzzer === myId
  const someoneElseBuzzing = buzzer !== null && buzzer !== myId

  // a raised hand has BUZZ_SECONDS to pick; the host ends the turn after that
  useEffect(() => {
    if (!buzzer) return
    picked.current = false
    setBuzzLeft(BUZZ_SECONDS)
    const t0 = performance.now()
    let raf = 0
    let ticked = BUZZ_SECONDS
    const tick = () => {
      const left = BUZZ_SECONDS - (performance.now() - t0) / 1000
      setBuzzLeft(Math.max(0, left))
      if (buzzer === myId && Math.ceil(left) < ticked && left > 0) {
        ticked = Math.ceil(left)
        if (ticked <= 3) sfx.tick()
      }
      if (left > 0) raf = requestAnimationFrame(tick)
      else if (buzzer === myId && !picked.current) setMyPenalty((p) => p + BUZZ_PENALTY)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [buzzer, myId])

  const myTurn = iHaveBuzz && buzzLeft > 0 && !picked.current
  const tryAnswer = (idx: number) => {
    if (!myTurn || myWrong.has(idx)) return
    picked.current = true
    onAnswer(idx)
    setMyWrong((w) => new Set(w).add(idx))
    setMyPenalty((p) => p + BUZZ_PENALTY)
  }

  return (
    <section className="quiz lyrics-quiz">
      <div className="room-bar">
        <span>Lagu {q.i + 1}/{q.total}</span>
        <span>Tebak Lirik</span>
      </div>
      <div className="timebar" aria-hidden>
        <span style={{ transform: `scaleX(${progress})`, background: 'linear-gradient(90deg, #3fd6c6, #8b8cff)' }} />
      </div>
      <LyricsCard lines={q.context} shown={phase === 'revealing' ? revealed : q.context.length} live={phase === 'revealing' && started} blank={phase === 'choosing'} />

      {phase === 'revealing' && (
        <p className="ask center-text">
          <Equalizer on={started} mini /> Dengarkan...
        </p>
      )}

      {!started && phase === 'revealing' && (
        <button className="ghost small center-self" onClick={() => audio.current?.play()}>
          <Volume2 size={14} /> Putar lagunya
        </button>
      )}

      {phase === 'choosing' && (
        <>
          <p className="ask center-text">Lanjutkan liriknya!</p>
          <div className="buzzer-area">
            {someoneElseBuzzing && <p className="buzz-status"><Hand size={16} /> {buzzerName ?? 'Seseorang'} sedang menjawab...</p>}
            {iHaveBuzz && <p className="buzz-status you"><Hand size={16} /> {buzzLeft > 0 ? 'Giliranmu! Pilih jawaban' : 'Waktu habis!'}</p>}
            {buzzer && (
              <div className={`buzz-clock${buzzLeft <= 2 ? ' hurry' : ''}`} aria-label={`${Math.ceil(buzzLeft)} detik lagi`}>
                <b>{Math.ceil(buzzLeft)}</b>
                <span><i style={{ transform: `scaleX(${buzzLeft / BUZZ_SECONDS})` }} /></span>
              </div>
            )}
            {!buzzer && (
              <button className="primary buzz-btn" onClick={onBuzz}>
                <Hand size={18} /> Angkat Tangan
              </button>
            )}
          </div>

          {myPenalty > 0 && <p className="penalty-tag center-text">Penalti: -{myPenalty}</p>}

          <div className="options lyrics-options">
            {q.options.map((o, k) => {
              const isMyWrong = myWrong.has(k)
              return (
                <button
                  key={k}
                  className={`option c${k}${isMyWrong ? ' wrong disabled' : !myTurn ? ' locked' : ''}`}
                  disabled={!myTurn || isMyWrong}
                  onClick={() => tryAnswer(k)}
                >
                  <kbd>{'ABCD'[k]}</kbd>
                  <span><b>{o.text}</b></span>
                  {isMyWrong && <X size={20} />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function Scoreboard({ players, results, myId }: { players: Player[]; results?: RoundResult[]; myId: string }) {
  return (
    <ol className="scoreboard">
      {ranked(players).map((p, k) => {
        const r = results?.find((x) => x.id === p.id)
        return (
          <li key={p.id} className={p.id === myId ? 'mine' : ''}>
            <span className="place">{k + 1}</span>
            <span className="sb-avatar">{p.avatar}</span>
            <b>{p.name}</b>
            {r &&
              (r.points > 0 ? (
                <em className="gain">
                  +{r.points}
                  {r.first && <Zap size={12} />}
                </em>
              ) : (
                <em className="miss">{r.picked === null ? 'waktu habis' : r.points < 0 ? r.points : 'salah'}</em>
              ))}
            <span className="sb-score">{p.score}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Who took the song, and how you did. */
function Winner({ reveal, players, me }: { reveal: { results: RoundResult[] }; players: Player[]; me: string }) {
  const first = reveal.results.find((r) => r.first)
  const p = players.find((x) => x.id === first?.id)
  const mine = reveal.results.find((r) => r.id === me)
  return (
    <div className={`winner${first ? '' : ' none'}`}>
      {p && first ? (
        <>
          <span className="sb-avatar big">{p.avatar}</span>
          <span>
            <small>{first.id === me ? 'Kamu paling cepat!' : 'Paling cepat'}</small>
            <b>{p.name}</b>
          </span>
          <em className="gain">
            +{first.points} <Zap size={14} />
          </em>
        </>
      ) : (
        <span>
          <b>Tidak ada yang benar</b>
          <small>{mine?.picked === null ? 'Waktunya habis.' : 'Semua pilihan meleset.'}</small>
        </span>
      )}
      {mine && mine.points < 0 && <small className="late-note wrong-note">Pilihanmu salah: {mine.points} poin</small>}
      {mine?.right && !mine.first && <small className="late-note">Kamu juga benar, tapi kalah cepat {mine.seconds !== null && first?.seconds != null && `(${(mine.seconds - first.seconds).toFixed(1)} dtk)`}</small>}
    </div>
  )
}

/** How many song dots fit in one row; a longer quiz shows the ones around the current song. */
const DOTS = 10

/** One dot per song: how you did on the ones played, the current one lit (while it plays). */
function SongDots({ total, at, live, history, me }: { total: number; at: number; live: boolean; history: Round[]; me: string }) {
  const from = Math.max(0, Math.min(at - Math.floor(DOTS / 2) + 1, total - DOTS))
  const to = Math.min(total, from + DOTS)
  return (
    <ol className="song-dots" aria-label={`Lagu ${at + 1} dari ${total}`}>
      {from > 0 && <li className="more">…</li>}
      {Array.from({ length: to - from }, (_, k) => {
        const i = from + k
        const mine = history.find((h) => h.i === i)?.results.find((r) => r.id === me)
        const state = live && i === at ? 'now' : mine ? (mine.points > 0 ? 'right' : mine.right ? 'late' : 'wrong') : ''
        return (
          <li key={i} className={state}>
            {i + 1}
          </li>
        )
      })}
      {to < total && <li className="more">{total}</li>}
    </ol>
  )
}

/** The column beside a song: everyone's score (and who has answered), or the songs so far. */
function Board({ players, answered, results, history, me }: { players: Player[]; answered: string[]; results?: RoundResult[]; history: Round[]; me: string }) {
  const [tab, setTab] = useState<'rank' | 'history'>('rank')
  const names = new Map(players.map((p) => [p.id, p]))
  return (
    <aside className="board">
      <div className="board-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'rank'} onClick={() => setTab('rank')}>
          <Trophy size={15} /> Peringkat
        </button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          <History size={15} /> Riwayat
        </button>
      </div>

      {tab === 'rank' ? (
        <ol className="board-list">
          {ranked(players).map((p, k) => {
            const r = results?.find((x) => x.id === p.id)
            const tag = r ? (
              r.points > 0 ? (
                <em className="gain">
                  +{r.points}
                  {r.first && <Zap size={11} />}
                </em>
              ) : r.points < 0 ? (
                <em className="miss">{r.points}</em>
              ) : r.right ? (
                <em className="late">telat</em>
              ) : null
            ) : answered.includes(p.id) ? (
              <em className="answered">
                <Check size={12} /> sudah jawab
              </em>
            ) : null
            return (
              <li key={p.id} className={p.id === me ? 'mine' : ''}>
                <span className="place">{k + 1}</span>
                <span className="sb-avatar">{p.avatar}</span>
                <span className="who">
                  <b>{p.name}</b>
                  {(p.id === me || tag) && (
                    <span className="meta">
                      {p.id === me && <small className="you">kamu</small>}
                      {tag}
                    </span>
                  )}
                </span>
                <span className="sb-score">{p.score}</span>
              </li>
            )
          })}
        </ol>
      ) : history.length ? (
        <ol className="board-list history">
          {[...history].reverse().map((h) => {
            const mine = h.results.find((r) => r.id === me)
            const winner = names.get(h.results.find((r) => r.first)?.id ?? '')
            return (
              <li key={h.i}>
                {h.answer.cover ? <img src={h.answer.cover} alt="" /> : <span className="sb-avatar" />}
                <span className="h-song">
                  <b>{h.answer.title}</b>
                  <small>
                    {winner ? `${winner.avatar} ${winner.name} tercepat` : 'Tidak ada yang benar'}
                  </small>
                </span>
                {mine && mine.points > 0 ? <em className="gain">+{mine.points}</em> : mine?.right ? <em className="late">telat</em> : <em className="miss">{mine?.picked === null ? 'habis' : mine && mine.points < 0 ? mine.points : 'salah'}</em>}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="note center-text">Lagu yang sudah dimainkan muncul di sini.</p>
      )}
    </aside>
  )
}

/** Your own seat in the lobby: tap the name to change it, the avatar to pick another. */
function MySeat({ player, host, onChange }: { player: Player; host: boolean; onChange: (name: string, avatar: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(player.name)
  const save = () => {
    setEditing(false)
    const next = name.trim()
    if (next && next !== player.name) onChange(next, player.avatar)
    else setName(player.name)
  }
  const nextAvatar = () => onChange(player.name, AVATARS[(AVATARS.indexOf(player.avatar) + 1) % AVATARS.length])
  return (
    <li className={`seat mine${host ? ' host' : ''}`}>
      <button className="sb-avatar" onClick={nextAvatar} title="Ganti avatar" aria-label="Ganti avatar">
        {player.avatar}
      </button>
      {editing ? (
        <input
          className="seat-name"
          value={name}
          maxLength={18}
          autoFocus
          aria-label="Nama kamu"
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setName(player.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button className="seat-edit" onClick={() => setEditing(true)} title="Ganti nama">
          <b>{player.name}</b>
          <Pencil size={13} />
        </button>
      )}
      <small>kamu</small>
      {host && <Crown size={16} className="crown" />}
    </li>
  )
}

/** The players column: everyone in the room, then empty seats up to the limit. */
function Seats({ players, me, onRename }: { players: Player[]; me: string; onRename: (name: string, avatar: string) => void }) {
  return (
    <aside className="seats">
      <h3>
        Pemain {players.length}/{MAX_PLAYERS}
      </h3>
      <ol>
        {players.map((p) =>
          p.id === me ? (
            <MySeat key={p.id} player={p} host={p.id === HOST} onChange={onRename} />
          ) : (
            <li key={p.id} className={`seat${p.id === HOST ? ' host' : ''}`}>
              <span className="sb-avatar">{p.avatar}</span>
              <b>{p.name}</b>
              {p.id === HOST && <Crown size={16} className="crown" />}
            </li>
          ),
        )}
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
          <i>{s.lyrics ? 'Tebak Lirik' : s.mode === 'both' ? 'Judul / penyanyi / lirik acak' : MODE_LABEL[s.mode]}</i>
          <i className={`lv-${s.level}`}>{LEVELS[s.level].label}</i>
          <i>{s.count === 'all' ? 'Semua lagu' : `${s.count} lagu`}</i>
        </span>
      </div>
    </div>
  )
}

type PartyProps = { role: 'host' | 'guest'; code: string; initial: GameSettings; profile: Profile; onProfile: (p: Profile) => void; onLeave: () => void }

/** A room, opened again from scratch when "Coba lagi" is pressed after it failed. */
export function Party(props: PartyProps) {
  const [attempt, setAttempt] = useState(0)
  return <Room key={attempt} {...props} onRetry={() => setAttempt((a) => a + 1)} />
}

function Room({ role, code, initial, profile, onProfile, onLeave, onRetry }: PartyProps & { onRetry: () => void }) {
  const { view, roomCode, offline, myId, answer, begin, nextSong, setStep, configure, chooseQuiz, backToLobby, rename, lyricsBuzz, lyricsAnswer } = useRoom(role, code, profile, initial)
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}/?room=${roomCode}`
  const me = myId.current
  const host = role === 'host'

  // a sound when the result comes in, and the host moves on to the next song shortly after
  useEffect(() => {
    if (view.phase !== 'reveal' || !view.reveal) return
    const mine = view.reveal.results.find((r) => r.id === me)
    if (mine && mine.points > 0) sfx.right()
    else sfx.wrong()
    if (!host) return
    const id = setTimeout(nextSong, 3000)
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
        <div className="row">
          <button className="primary" onClick={onRetry}>
            <RotateCcw size={15} /> Coba lagi
          </button>
          <button className="ghost" onClick={onLeave}>
            Kembali
          </button>
        </div>
      </section>
    )

  if (view.phase === 'loading') return <Loading title={view.loading ? 'Mencocokkan lirik dengan lagunya…' : 'Menyiapkan lagu-lagunya…'} progress={view.loading} />
  if (view.phase === 'connecting')
    return (
      <section className="countdown">
        <Bit size={130} mood="listen" />
        <p className="note">{host ? 'Membuka room…' : `Masuk ke room ${code.toUpperCase()}…`}</p>
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
        {(view.phase === 'question' || view.phase === 'reveal') && view.q && <SongDots total={view.q.total} at={view.q.i} live={view.phase === 'question'} history={view.history} me={me} />}
        {(view.phase === 'lyrics-q' || (view.phase === 'reveal' && view.lq)) && view.lq && <SongDots total={view.lq.total} at={view.lq.i} live={view.phase === 'lyrics-q'} history={view.history} me={me} />}
        {offline && <span className="room-offline">Menyambung ulang…</span>}
        <button className="room-code" type="button" onClick={() => { navigator.clipboard.writeText(roomCode); const el = document.querySelector('.room-code') as HTMLElement; el?.classList.add('copied'); setTimeout(() => el?.classList.remove('copied'), 1200) }}>
          Room <b>{roomCode}</b> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </header>

      {view.phase === 'lobby' && s && (
        <>
          <div className="lobby-grid">
            <Seats
              players={view.players}
              me={me}
              onRename={(name, avatar) => {
                rename(name, avatar)
                // the next room (and solo play) uses it too
                const p = { name, avatar }
                saveProfile(p)
                onProfile(p)
              }}
            />
            <div className="lobby-main">
              {view.error && <p className="note error">{view.error}</p>}
              {host && view.step === 'atur' && (
                <SettingsPanel
                  settings={{ mode: s.mode, level: s.level, count: s.count }}
                  setMode={(mode) => configure({ mode, lyrics: false })}
                  setLevel={(level) => configure({ level })}
                  setCount={(count) => configure({ count })}
                  lyrics={!!s.lyrics}
                  setLyrics={() => configure({ lyrics: true })}
                />
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
                  {!host && <SettingsPanel settings={{ mode: s.mode, level: s.level, count: s.count }} lyrics={!!s.lyrics} />}
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

      {(view.phase === 'question' || view.phase === 'reveal' || view.phase === 'lyrics-q') && (
        <div className="play-grid">
          <Board players={view.players} answered={view.answered} results={view.phase === 'reveal' ? view.reveal?.results : undefined} history={view.history} me={me} />

          {view.phase === 'question' && view.q && s && <RoomQuestion key={view.q.i} q={view.q} settings={s} answered={view.answered} players={view.players} onAnswer={(id, seconds) => answer(view.q!.i, id, seconds)} />}

          {view.phase === 'lyrics-q' && view.lq && (
            <RoomLyricsQuestion
              key={view.lq.i}
              q={view.lq}
              myId={me}
              buzzer={view.buzzer}
              buzzerName={view.buzzerName}
              onBuzz={() => lyricsBuzz(view.lq!.i)}
              onAnswer={(id) => lyricsAnswer(view.lq!.i, id)}
            />
          )}

          {view.phase === 'reveal' && view.reveal && (
            <div className="reveal-room">
              {view.reveal.line && <p className="lyrics-answer correct center-text">"{view.reveal.line}"</p>}
              <div className="now-playing">
                {view.reveal.answer.cover && <img src={view.reveal.answer.cover} alt="" />}
                <span>
                  <small className="muted">Jawabannya</small>
                  <b>{view.reveal.answer.title}</b>
                  <small>{view.reveal.answer.artist}</small>
                </span>
              </div>
              <Winner reveal={view.reveal} players={view.players} me={me} />
              <p className="note center-text">Lagu berikutnya sebentar lagi…</p>
            </div>
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
