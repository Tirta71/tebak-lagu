// Finds a song on Genius so the answer card can show Genius's own lyrics embed. Only the song's
// Genius id and page come back from here; the lyrics are shown by Genius's embed in the browser.
// Needs a free access token from https://genius.com/api-clients in GENIUS_ACCESS_TOKEN.
//   /api/genius?title=<title>&artist=<artist>
import { norm, sameArtist } from './_match.js'

const json = (body, cache = 'no-store', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

export async function GET(request, env = process.env) {
  const token = env.GENIUS_ACCESS_TOKEN
  if (!token) return json({ configured: false })
  const params = new URL(request.url).searchParams
  const title = params.get('title') ?? ''
  const artist = params.get('artist') ?? ''
  if (!title) return json({ error: 'ask with ?title=&artist=' }, 'no-store', 400)
  try {
    const res = await fetch(`https://api.genius.com/search?${new URLSearchParams({ q: `${artist.split(',')[0]} ${norm(title)}` })}`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return json({ configured: true, found: false, error: res.status === 401 }, 'no-store')
    const hits = ((await res.json()).response?.hits ?? []).map((h) => h.result).filter(Boolean)
    // the same song by the same artist; songs Genius has no lyrics for are no use
    const song = hits.find((s) => norm(s.title) === norm(title) && sameArtist(artist, s.primary_artist?.name ?? '') && s.lyrics_state !== 'unreleased')
    if (!song) return json({ configured: true, found: false }, 's-maxage=86400')
    return json({ configured: true, found: true, id: song.id, url: song.url, title: song.title }, 's-maxage=86400')
  } catch {
    return json({ configured: true, found: false }, 'no-store', 502)
  }
}
