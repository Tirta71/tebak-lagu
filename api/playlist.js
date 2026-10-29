// The songs on a Spotify playlist or album (the first 100), read from Spotify's public embed page,
// so any playlist link can be a game. /api/playlist?url=https://open.spotify.com/playlist/...
const json = (body, cache = 'no-store', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

export async function GET(request) {
  const link = new URL(request.url).searchParams.get('url') ?? ''
  const m = link.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album)\/([A-Za-z0-9]+)/)
  if (!m) return json({ error: 'Tempel link playlist atau album Spotify.' }, 'no-store', 400)
  try {
    const res = await fetch(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, { headers: { 'user-agent': 'Mozilla/5.0' } })
    const html = await res.text()
    const data = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1])
    const entity = data.props.pageProps.state.data.entity
    const tracks = (entity.trackList ?? [])
      .filter((t) => t.isPlayable !== false && t.uri?.startsWith('spotify:track:'))
      .map((t) => ({ uri: t.uri, title: t.title, artist: t.subtitle }))
    if (!tracks.length) return json({ error: 'Playlist itu tidak punya lagu yang bisa dipakai.' }, 'no-store', 404)
    return json({ name: entity.name ?? entity.title, tracks }, 's-maxage=3600, stale-while-revalidate=86400')
  } catch {
    return json({ error: 'Playlist tidak bisa dibaca. Pastikan playlist-nya publik.' }, 'no-store', 502)
  }
}
