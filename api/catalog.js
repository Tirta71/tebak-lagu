// What the home page offers: featured artists, genres and decades (with pictures), plus artist
// search. /api/catalog  ·  /api/catalog?artist=<name>
import { deezer, json } from './_deezer.js'
import { norm } from './_match.js'

// a mix of Indonesian and international names; each is looked up on Deezer for its id and picture
const FEATURED = ['Tulus', 'Hindia', 'Nadin Amizah', 'Bernadya', 'Sheila On 7', 'Raisa', 'Pamungkas', 'NIKI', 'Taylor Swift', 'Lana Del Rey', 'Laufey', 'Olivia Rodrigo', 'Billie Eilish', 'The Weeknd', 'Bruno Mars', 'aespa', 'NewJeans', 'BTS']
const SKIP_GENRES = new Set([0, 95]) // "All" and kids' music
export const DECADES = [1970, 1980, 1990, 2000, 2010, 2020]

const artist = (a) => ({ id: a.id, name: a.name, picture: a.picture_medium, fans: a.nb_fan })

async function findArtist(name) {
  const { data = [] } = await deezer(`/search/artist?${new URLSearchParams({ q: name })}`)
  return data.find((a) => norm(a.name) === norm(name)) ?? data[0] ?? null
}

export async function GET(request) {
  const q = new URL(request.url).searchParams.get('artist')?.trim()
  try {
    if (q) {
      const { data = [] } = await deezer(`/search/artist?${new URLSearchParams({ q, limit: '8' })}`)
      return json({ artists: data.map(artist) }, 's-maxage=86400')
    }
    const [genres, ...found] = await Promise.all([deezer('/genre'), ...FEATURED.map(findArtist)])
    return json(
      {
        artists: found.filter(Boolean).map(artist),
        genres: genres.data.filter((g) => !SKIP_GENRES.has(g.id)).map((g) => ({ id: g.id, name: g.name, picture: g.picture_medium })),
        decades: DECADES,
      },
      's-maxage=86400, stale-while-revalidate=604800',
    )
  } catch {
    return json({ error: 'Deezer tidak menjawab.' }, 'no-store', 502)
  }
}
