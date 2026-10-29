// Fetches lyrics for "Tebak Lirik" (continue-the-lyrics) quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>&duration=<sec>&album=<album>
// Returns the song's timed lyrics lines ({time, text}); only timed lyrics, so they can follow the music.

const json = (body, cache = 'no-store', status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

const UA = { headers: { 'user-agent': 'TebakLagu/1.0 (https://tebak-lagu.vercel.app)' } }

/** LRCLIB answers 503/429 when busy; wait a moment and ask again. */
async function lrclib(url, tries = 3) {
  const res = await fetch(url, UA)
  if ((res.status === 503 || res.status === 429) && tries > 1) {
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 800))
    return lrclib(url, tries - 1)
  }
  // still busy: fail (uncached) rather than answer "no lyrics" for an hour
  if (res.status >= 500 || res.status === 429) throw new Error('lrclib busy')
  return res
}

function cleanTitle(t) {
  return t
    .replace(/\s*\((?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^]]*\]/gi, '')
    .replace(/\s*-\s*(?:feat\.?|ft\.?|remix|remaster|radio edit|acoustic|live|deluxe|bonus).*$/gi, '')
    .trim()
}

function parseLrc(lrc) {
  const lines = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/)
    if (!m) continue
    const text = m[4].trim()
    if (!text) continue
    const time = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / (m[3].length === 2 ? 100 : 1000)
    lines.push({ time: Math.round(time * 100) / 100, text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

function dedupSynced(lines) {
  return lines.filter((l, i) => i === 0 || l.text !== lines[i - 1].text)
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.8
  const wa = new Set(na.split(' ')), wb = new Set(nb.split(' '))
  let overlap = 0
  for (const w of wa) if (wb.has(w)) overlap++
  return overlap / Math.max(wa.size, wb.size)
}

function durationMatch(lrcDuration, deezerDuration) {
  if (!deezerDuration || !lrcDuration) return true
  // a different edit of the song would shift every line, so the lengths must agree closely
  return Math.abs(lrcDuration - deezerDuration) <= 4
}

function scoreResult(r, title, artist, album, duration) {
  let score = 0
  const titleSim = similarity(r.trackName || '', title)
  const artistSim = similarity(r.artistName || '', artist)
  if (titleSim < 0.6 || artistSim < 0.4) return -1
  score += titleSim * 40 + artistSim * 30
  if (r.syncedLyrics) score += 10
  if (album && r.albumName) score += similarity(r.albumName, album) * 15
  if (duration && r.duration) {
    if (durationMatch(r.duration, duration)) score += 15
    else return -1
  }
  return score
}

async function fromLrclib(title, artist, duration) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist })
  if (duration) params.set('duration', String(duration))
  const res = await lrclib(`https://lrclib.net/api/get?${params}`)
  if (!res.ok) return null
  const j = await res.json()
  if (j.trackName && similarity(j.trackName, title) < 0.5) return null
  if (j.artistName && similarity(j.artistName, artist) < 0.3) return null
  if (duration && j.duration && !durationMatch(j.duration, duration)) return null
  if (!j.syncedLyrics && !j.plainLyrics) return null
  return { syncedLyrics: j.syncedLyrics || null, plainLyrics: j.plainLyrics || null }
}

async function searchLrclib(title, artist, album, duration) {
  const params = new URLSearchParams({ q: `${title} ${artist}` })
  const res = await lrclib(`https://lrclib.net/api/search?${params}`)
  if (!res.ok) return null
  const arr = await res.json()
  if (!arr.length) return null
  let best = null, bestScore = 50
  for (const r of arr) {
    if (!r.syncedLyrics) continue
    const s = scoreResult(r, title, artist, album, duration)
    if (s > bestScore) {
      best = { syncedLyrics: r.syncedLyrics || null, plainLyrics: r.plainLyrics || null }
      bestScore = s
    }
  }
  return best
}

export async function GET(request) {
  const p = new URL(request.url).searchParams
  const rawTitle = p.get('title') ?? ''
  const rawArtist = p.get('artist') ?? ''
  const duration = Number(p.get('duration')) || 0
  const album = p.get('album') ?? ''
  if (!rawTitle) return json({ error: 'title required' }, 'no-store', 400)

  const title = cleanTitle(rawTitle)
  const artist = rawArtist.split(',')[0].trim()

  try {
    // ask both at once (LRCLIB is slow); the exact match wins, and only timed lyrics count
    let busy = false
    const failed = () => { busy = true; return null }
    const [exact, searched] = await Promise.all([
      fromLrclib(title, artist, duration).catch(failed),
      searchLrclib(title, artist, album, duration).catch(failed),
    ])
    const synced = exact?.syncedLyrics || searched?.syncedLyrics
    // LRCLIB being busy isn't "no lyrics": don't cache that
    if (!synced) return json({ found: false }, busy ? 'no-store' : 's-maxage=3600')

    const lines = dedupSynced(parseLrc(synced))
    if (lines.length < 8) return json({ found: false }, 's-maxage=3600')
    // the client picks which lines to ask, from the part of the song the preview plays
    return json({ found: true, synced: true, lines }, 's-maxage=86400')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
