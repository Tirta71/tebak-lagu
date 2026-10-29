// The songs for one quiz, all with a preview to play:
//   ?kind=genre&id=132        Deezer's chart for a genre
//   ?kind=artist&id=1619043   an artist's top songs
//   ?kind=decade&id=1990      an editor's hits playlist for the decade
//   ?kind=indonesia           an editor's Indonesian hits playlist
//   ?kind=playlist&url=<spotify playlist link>  a Spotify playlist, each song found on Deezer
import { deezer, editorPlaylist, json, song } from './_deezer.js'
import { GET as spotifyPlaylist } from './playlist.js'
import { GET as findOnDeezer } from './deezer.js'

const usable = (list) => {
  const seen = new Set()
  return list.filter((t) => t.preview && !seen.has(t.title.toLowerCase()) && seen.add(t.title.toLowerCase()))
}

async function fromPlaylist(id) {
  const { data = [] } = await deezer(`/playlist/${id}/tracks?limit=100`)
  return data.map(song)
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A Spotify playlist: look up shuffled songs on Deezer, a few at a time, until there are enough. */
async function fromSpotify(url, want) {
  const res = await spotifyPlaylist(new Request(`http://x/api/playlist?${new URLSearchParams({ url })}`))
  const j = await res.json()
  if (!res.ok) throw Object.assign(new Error(j.error), { user: true })
  const found = []
  const queue = shuffle(j.tracks)
  while (found.length < want && queue.length) {
    const batch = queue.splice(0, 6)
    const hits = await Promise.all(batch.map((t) => findOnDeezer(new Request(`http://x/api/deezer?${new URLSearchParams({ find: t.title, artist: t.artist })}`)).then((r) => (r.ok ? r.json() : null))))
    found.push(...hits.filter(Boolean))
  }
  return { name: j.name, tracks: found }
}

export async function GET(request) {
  const p = new URL(request.url).searchParams
  const kind = p.get('kind')
  const id = p.get('id')
  try {
    let name = ''
    let tracks = []
    if (kind === 'genre') {
      const [{ data }, genre] = await Promise.all([deezer(`/chart/${Number(id)}/tracks?limit=100`), deezer(`/genre/${Number(id)}`)])
      name = genre.name
      tracks = data.map(song)
    } else if (kind === 'artist') {
      const [{ data }, a] = await Promise.all([deezer(`/artist/${Number(id)}/top?limit=50`), deezer(`/artist/${Number(id)}`)])
      name = a.name
      // the artist's top list also has songs they only feature on; keep the ones credited to them,
      // or a different name under one option gives the answer away
      tracks = data.filter((t) => t.artist?.id === a.id).map(song)
    } else if (kind === 'decade' || kind === 'indonesia') {
      const pl = await editorPlaylist(kind === 'decade' ? `${Number(id)}s hits` : 'Top Indonesia')
      if (!pl) return json({ error: 'Playlist-nya tidak ketemu.' }, 'no-store', 404)
      name = kind === 'decade' ? `Hits ${String(id).slice(2)}an` : 'Hits Indonesia'
      tracks = await fromPlaylist(pl.id)
    } else if (kind === 'playlist') {
      const r = await fromSpotify(p.get('url') ?? '', 18)
      name = r.name
      tracks = r.tracks
    } else return json({ error: 'kind?' }, 'no-store', 400)
    tracks = usable(tracks)
    if (tracks.length < 4) return json({ error: 'Lagu dengan cuplikan terlalu sedikit untuk kuis ini.' }, 'no-store', 404)
    // preview links are signed and expire, so only a short cache
    return json({ name, tracks }, 's-maxage=600')
  } catch (err) {
    return json({ error: err.user ? err.message : 'Deezer tidak menjawab. Coba lagi.' }, 'no-store', 502)
  }
}
