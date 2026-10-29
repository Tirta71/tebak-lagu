// Deezer's public API, for the game's audio and guesses (Deezer's API doesn't answer browsers
// directly). Its 30-second previews are free to play with credit to Deezer, no login needed.
//   /api/deezer?find=<title>&artist=<artist>  the best match that has a preview
//   /api/deezer?q=<words>                     songs for the guess box
import { norm, sameArtist } from './_match.js'

const json = (body, cache = 'no-store', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

const song = (t) => ({ id: t.id, title: t.title, artist: t.artist.name, cover: t.album.cover_medium, preview: t.preview, link: t.link })

async function search(q, limit) {
  const res = await fetch(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: String(limit) })}`)
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return j.data ?? []
}

export async function GET(request) {
  const params = new URL(request.url).searchParams
  try {
    const find = params.get('find')
    if (find) {
      const artist = params.get('artist') ?? ''
      const found = (await search(`${artist.split(',')[0]} ${find}`, 10)).filter((t) => t.preview)
      // same title and artist first, then same artist, then anything with a preview
      const best =
        found.find((t) => norm(t.title) === norm(find) && sameArtist(artist, t.artist.name)) ??
        found.find((t) => sameArtist(artist, t.artist.name) && norm(t.title).startsWith(norm(find))) ??
        null
      if (!best) return json({ error: 'no preview' }, 's-maxage=3600', 404)
      // preview links are signed and expire after a while, so keep this short
      return json(song(best), 's-maxage=600')
    }
    const q = params.get('q')?.trim().slice(0, 80)
    if (q) return json((await search(q, 8)).map(song).map(({ preview, ...rest }) => rest), 's-maxage=3600')
    return json({ error: 'ask with ?find= or ?q=' }, 'no-store', 400)
  } catch {
    return json({ error: 'Deezer did not answer' }, 'no-store', 502)
  }
}
