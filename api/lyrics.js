// Fetches plain-text lyrics for a song, for the "Tebak Lirik" quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>
// Tries LRCLIB first (clean, synced lyrics), then lyrics.ovh as fallback.
import { norm } from './_match.js'

const json = (body, cache = 'no-store', status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

/** Pick a snippet of 4 consecutive non-empty lines from roughly the middle of the lyrics. */
function snippet(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('['))
  if (lines.length < 4) return lines.join('\n')
  // skip first ~25% (usually intro/first verse, too recognizable) and pick from the middle
  const start = Math.max(0, Math.floor(lines.length * 0.25))
  const end = Math.max(start + 4, lines.length - 2)
  const i = start + Math.floor(Math.random() * Math.max(1, end - start - 3))
  return lines.slice(i, i + 4).join('\n')
}

async function fromLrclib(title, artist) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist.split(',')[0].trim() })
  const res = await fetch(`https://lrclib.net/api/get?${params}`, {
    headers: { 'user-agent': 'TebakLagu/1.0 (https://tebak-lagu.vercel.app)' },
  })
  if (!res.ok) return null
  const j = await res.json()
  const text = j.plainLyrics || j.syncedLyrics
  return text || null
}

async function fromLyricsOvh(title, artist) {
  const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist.split(',')[0].trim())}/${encodeURIComponent(title)}`)
  if (!res.ok) return null
  const j = await res.json()
  return j.lyrics || null
}

export async function GET(request) {
  const p = new URL(request.url).searchParams
  const title = p.get('title') ?? ''
  const artist = p.get('artist') ?? ''
  if (!title) return json({ error: 'title required' }, 'no-store', 400)

  try {
    let text = await fromLrclib(title, artist)
    if (!text) text = await fromLyricsOvh(title, artist)
    if (!text) return json({ found: false }, 's-maxage=3600')
    return json({ found: true, snippet: snippet(text) }, 's-maxage=3600')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
