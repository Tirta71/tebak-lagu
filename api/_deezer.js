// Deezer's public API (no key). Shared by the quiz functions; Deezer doesn't answer browsers
// directly, so the site asks it from the server.
export async function deezer(path) {
  const res = await fetch(`https://api.deezer.com${path}`)
  const j = await res.json()
  if (j.error) throw new Error(j.error.message ?? 'deezer')
  return j
}

/** A song for the quiz: its 30-second preview is what plays. */
export const song = (t) => ({
  id: t.id,
  title: t.title_short || t.title,
  artist: t.artist?.name ?? '',
  cover: t.album?.cover_medium ?? null,
  preview: t.preview,
  link: t.link,
})

export const json = (body, cache = 'no-store', status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

/** An editor's playlist for some words ("1980s hits"), preferring Deezer's own editors. */
export async function editorPlaylist(q) {
  const { data = [] } = await deezer(`/search/playlist?${new URLSearchParams({ q })}`)
  return data.find((p) => /deezer/i.test(p.user?.name ?? '') && p.nb_tracks >= 30) ?? data.find((p) => p.nb_tracks >= 30) ?? null
}
