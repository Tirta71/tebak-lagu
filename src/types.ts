export type Song = { id: number; title: string; artist: string; cover: string | null; preview?: string; link: string; duration?: number; album?: string }

import type { Level } from './levels'

/** Guess the song's title, who sings it, or a mix (each song one or the other, at random). */
export type Mode = 'title' | 'artist' | 'both'

/** Which songs a quiz uses; `key` names it for best scores. */
/** How many songs a quiz plays: a number, or every song it has. */
export type Count = 5 | 10 | 15 | 20 | 'all'

export type QuizSource = { key: string; name: string; query: string; picture?: string | null; mode?: Mode; level?: Level; count?: Count }

/** One song: `kind` says whether this one asks for the title or the singer. */
export type Question = { answer: Song; options: Song[]; kind: 'title' | 'artist' }

/** In Tebak Lirik, `line` is the line to guess and `tries` the wrong picks before the end. */
export type Answer = { question: Question; picked: Song | null; points: number; seconds: number; combo: number; line?: string; tries?: number }
