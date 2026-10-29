// Fetches lyrics for a song, for the "Tebak Lirik" quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>&start=<seconds>
// Returns timed lyric lines that sync with the audio preview.
// Tries LRCLIB first (has synced LRC), then lyrics.ovh (plain text fallback).

const json = (body, cache = 'no-store', status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

const UA = { headers: { 'user-agent': 'TebakLagu/1.0 (https://tebak-lagu.vercel.app)' } }

/** Strip feat/remix/remaster/version noise from a Deezer title. */
function cleanTitle(t) {
  return t
    .replace(/\s*\((?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^]]*\]/gi, '')
    .replace(/\s*-\s*(?:feat\.?|ft\.?|remix|remaster|radio edit|acoustic|live|deluxe|bonus).*$/gi, '')
    .trim()
}

/** Parse "[mm:ss.xx] text" lines into {time, text} pairs. */
function parseLrc(lrc) {
  const out = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+)(?:[.:]\d+)?\]\s*(.*)$/)
    if (!m) continue
    const text = m[3].trim()
    if (!text) continue
    out.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]), text })
  }
  return out
}

/** Pick 8-12 consecutive timed lines starting near `start` seconds. */
function pickTimedLines(parsed, start) {
  const want = Math.min(parsed.length, 8 + Math.floor(Math.random() * 5))
  if (parsed.length <= want) return parsed.map((l) => ({ time: l.time, text: l.text }))
  // find the line closest to start time
  let best = 0
  for (let i = 0; i < parsed.length; i++) {
    if (Math.abs(parsed[i].time - start) < Math.abs(parsed[best].time - start)) best = i
  }
  // clamp so we have enough lines after
  const i = Math.min(best, parsed.length - want)
  return parsed.slice(i, i + want).map((l) => ({ time: l.time, text: l.text }))
}

/** Pick 8-12 consecutive plain lines from roughly the middle. */
function pickPlainLines(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('['))
  if (lines.length < 4) return null
  const want = Math.min(lines.length, 8 + Math.floor(Math.random() * 5))
  const start = Math.max(0, Math.floor(lines.length * 0.2))
  const end = Math.max(start + want, lines.length - 2)
  const i = start + Math.floor(Math.random() * Math.max(1, end - start - want))
  return lines.slice(i, i + want).map((text) => ({ time: null, text }))
}

async function fromLrclib(title, artist) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist })
  const res = await fetch(`https://lrclib.net/api/get?${params}`, UA)
  if (!res.ok) return null
  const j = await res.json()
  return { synced: j.syncedLyrics || null, plain: j.plainLyrics || null }
}

async function searchLrclib(title, artist) {
  const params = new URLSearchParams({ q: `${title} ${artist}` })
  const res = await fetch(`https://lrclib.net/api/search?${params}`, UA)
  if (!res.ok) return null
  const arr = await res.json()
  if (!arr.length) return null
  const hit = arr[0]
  return { synced: hit.syncedLyrics || null, plain: hit.plainLyrics || null }
}

async function fromLyricsOvh(title, artist) {
  const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`)
  if (!res.ok) return null
  const j = await res.json()
  return j.lyrics || null
}

export async function GET(request) {
  const p = new URL(request.url).searchParams
  const rawTitle = p.get('title') ?? ''
  const rawArtist = p.get('artist') ?? ''
  const start = parseFloat(p.get('start') ?? '0') || 0
  if (!rawTitle) return json({ error: 'title required' }, 'no-store', 400)

  const title = cleanTitle(rawTitle)
  const artist = rawArtist.split(',')[0].trim()

  try {
    // 1. LRCLIB exact match
    let lrc = await fromLrclib(title, artist)
    // 2. LRCLIB search (fuzzy)
    if (!lrc?.synced && !lrc?.plain) lrc = await searchLrclib(title, artist)

    if (lrc) {
      // prefer synced lyrics for timed reveal
      if (lrc.synced) {
        const parsed = parseLrc(lrc.synced)
        if (parsed.length >= 4) {
          const lines = pickTimedLines(parsed, start)
          return json({ found: true, synced: true, lines }, 's-maxage=3600')
        }
      }
      if (lrc.plain) {
        const lines = pickPlainLines(lrc.plain)
        if (lines && lines.length >= 4) return json({ found: true, synced: false, lines }, 's-maxage=3600')
      }
    }

    // 3. lyrics.ovh fallback (plain only)
    const ovh = await fromLyricsOvh(title, artist)
    if (ovh) {
      const lines = pickPlainLines(ovh)
      if (lines && lines.length >= 4) return json({ found: true, synced: false, lines }, 's-maxage=3600')
    }

    return json({ found: false }, 's-maxage=3600')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
