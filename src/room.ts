/*
 * Playing together without accounts: one browser hosts the room through PeerJS (its free public
 * server only introduces the browsers; the game runs between them). The host keeps the answers and
 * the scores; guests get each song's preview and choices, send back what they picked and how fast,
 * and the host tells everyone the result.
 */
import type { Level } from './levels'
import type { Count, Mode, Song } from './types'

/** Peer ids are public on the shared server, so they carry a prefix of our own. */
export const peerId = (code: string) => `tebak-lagu-tirta-${code}`

/** A room code: five letters, without ones that are easy to misread (I, O, L). */
export function newCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ'
  return Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
}

export type Player = { id: string; name: string; avatar: string; score: number }

/** What a guest sees of a question: no hint of which choice is right. */
export type PublicQuestion = { i: number; total: number; kind: 'title' | 'artist'; preview: string; options: { id: number; title: string; artist: string }[] }

/** How one player did on a song: only the fastest right answer (`first`) scores; `right` is any right answer. */
export type RoundResult = { id: string; picked: number | null; points: number; first: boolean; right: boolean; seconds: number | null }

/** The room's set-up, as everyone sees it: the quiz (once picked), what to guess, how hard, how many. */
export type Settings = { quiz: string | null; picture?: string | null; mode: Mode; level: Level; count: Count; lyrics?: boolean }

/** Where the host is in setting up: 1 settings, 2 picking a quiz, 3 ready to start. */
export type Step = 'atur' | 'kuis' | 'main'

export type TimedLine = { time: number | null; text: string }
/** A lyrics question: lines are revealed one by one; players buzz to answer. */
export type LyricsPublicQuestion = { i: number; total: number; preview: string; lines: TimedLine[]; synced: boolean; audioStart: number; options: { id: number; title: string; artist: string }[] }

/** Host → guests. */
export type HostMsg =
  | { t: 'lobby'; players: Player[]; settings: Settings; step: Step }
  | { t: 'loading' }
  | { t: 'q'; q: PublicQuestion }
  | { t: 'answered'; ids: string[] }
  | { t: 'reveal'; i: number; answer: Song; results: RoundResult[]; players: Player[] }
  | { t: 'end'; players: Player[] }
  | { t: 'full' }
  // lyrics mode messages
  | { t: 'lq'; q: LyricsPublicQuestion }
  | { t: 'lq-line'; i: number; lineIdx: number }
  | { t: 'lq-buzz-ok'; id: string }
  | { t: 'lq-buzz-taken'; id: string; name: string }
  | { t: 'lq-wrong'; id: string; penalty: number }
  | { t: 'lq-correct'; id: string; points: number }

/** Guest → host. */
export type GuestMsg =
  | { t: 'hello'; name: string; avatar: string }
  | { t: 'answer'; i: number; id: number | null; seconds: number }
  | { t: 'profile'; name: string; avatar: string }
  // lyrics mode messages
  | { t: 'lq-buzz'; i: number }
  | { t: 'lq-answer'; i: number; id: number }

/** Extra points for the fastest right answer on each song (on top of its points for speed). */
export const FIRST_BONUS = 200
/** Points lost for a wrong pick (not for running out of time), so guessing at random costs something. */
export const WRONG_PENALTY = 100
/** Seconds everyone listens before the choices open (3, 2, 1); the clock for answering starts after. */
export const ANSWER_DELAY = 3
export const MAX_PLAYERS = 8
