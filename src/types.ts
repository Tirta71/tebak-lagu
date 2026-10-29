export type Song = { id: number; title: string; artist: string; cover: string | null; preview?: string; link: string }

import type { Level } from './levels'

/** Guess the song's title, or who sings it. */
export type Mode = 'title' | 'artist'

/** Which songs a quiz uses; `key` names it for best scores. `daily` is the date of a daily challenge. */
export type QuizSource = { key: string; name: string; query: string; picture?: string | null; mode?: Mode; level?: Level; daily?: string }

export type Question = { answer: Song; options: Song[] }

export type Answer = { question: Question; picked: Song | null; points: number; seconds: number; combo: number }
