// A song's lyrics from Musixmatch's official API, shown on the answer card. Needs a free API key from
// https://developer.musixmatch.com in MUSIXMATCH_API_KEY. The free plan gives part of the lyrics,
// for non-commercial use, and asks that its copyright line and tracking pixel are shown with them;
// nothing is stored or cached here.
//   /api/lyrics?title=<title>&artist=<artist>
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function GET(request, env = process.env) {
  const key = env.MUSIXMATCH_API_KEY
  if (!key) return json({ configured: false })
  const params = new URL(request.url).searchParams
  const title = params.get('title') ?? ''
  const artist = (params.get('artist') ?? '').split(',')[0]
  if (!title) return json({ error: 'ask with ?title=&artist=' }, 400)
  try {
    const res = await fetch(`https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?${new URLSearchParams({ q_track: title, q_artist: artist, apikey: key })}`)
    const j = await res.json()
    const lyrics = j.message?.header?.status_code === 200 ? j.message.body?.lyrics : null
    if (!lyrics?.lyrics_body || lyrics.restricted) return json({ configured: true, found: false })
    return json({
      configured: true,
      found: true,
      text: lyrics.lyrics_body,
      copyright: lyrics.lyrics_copyright ?? null,
      pixel: lyrics.pixel_tracking_url ?? null,
    })
  } catch {
    return json({ configured: true, found: false, error: true }, 502)
  }
}
