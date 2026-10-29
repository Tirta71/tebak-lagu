// Deezer's public API (no key). Shared by the quiz functions; Deezer doesn't answer browsers
// directly, so the site asks it from the server.
export async function deezer(path, tries = 3) {
  const res = await fetch(`https://api.deezer.com${path}`)
  const j = await res.json()
  // Deezer allows about 50 requests per 5 seconds; when that's hit (error code 4), wait and try again
  if (j.error?.code === 4 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1500))
    return deezer(path, tries - 1)
  }
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
