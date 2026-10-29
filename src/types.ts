export type Song = { id: number; title: string; artist: string; cover: string | null; preview?: string; link: string }

import type { Level } from './levels'

/** Guess the song's title, who sings it, or a mix (each song one or the other, at random). */
export type Mode = 'title' | 'artist' | 'both'

/** Which songs a quiz uses; `key` names it for best scores. `daily` is the date of a daily challenge. */
export type QuizSource = { key: string; name: string; query: string; picture?: string | null; mode?: Mode; level?: Level; daily?: string }

/** One song: `kind` says whether this one asks for the title or the singer. */
export type Question = { answer: Song; options: Song[]; kind: 'title' | 'artist' }

export type Answer = { question: Question; picked: Song | null; points: number; seconds: number; combo: number }
