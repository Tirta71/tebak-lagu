// Fetches lyrics for "Tebak Lirik" (continue-the-lyrics) quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>&duration=<sec>&album=<album>
// Returns context lines (shown to player) + answer (the next line to guess)
// + extra wrong-option lines from the same song.

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

/** Extract all non-empty, non-tag lyric lines from raw text. */
function extractLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('['))
}

/** Deduplicate consecutive identical lines (chorus repeats). */
function dedup(lines) {
  return lines.filter((l, i) => i === 0 || l !== lines[i - 1])
}

function pickQuestion(allLines) {
  const lines = dedup(allLines)
  if (lines.length < 6) return null
  const contextLen = 3 + Math.floor(Math.random() * 3)
  const maxStart = lines.length - contextLen - 1
  if (maxStart < 1) return null
  const start = 1 + Math.floor(Math.random() * maxStart)
  const context = lines.slice(start, start + contextLen)
  const answer = lines[start + contextLen]
  const usedIdxs = new Set()
  for (let k = start; k <= start + contextLen; k++) usedIdxs.add(k)
  const candidates = []
  for (let k = 0; k < lines.length; k++) {
    if (!usedIdxs.has(k) && lines[k] !== answer && lines[k].length > 5) candidates.push(lines[k])
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  return { context, answer, wrongs: candidates.slice(0, 6) }
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

/** Check if LRCLIB duration is close to Deezer duration (within 10s). */
function durationMatch(lrcDuration, deezerDuration) {
  if (!deezerDuration || !lrcDuration) return true
  return Math.abs(lrcDuration - deezerDuration) <= 10
}

/** Score a LRCLIB result against our target. Higher = better match. */
function scoreResult(r, title, artist, album, duration) {
  let score = 0
  const titleSim = similarity(r.trackName || '', title)
  const artistSim = similarity(r.artistName || '', artist)
  if (titleSim < 0.6 || artistSim < 0.4) return -1
  score += titleSim * 40 + artistSim * 30
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
  const res = await fetch(`https://lrclib.net/api/get?${params}`, UA)
  if (!res.ok) return null
  const j = await res.json()
  if (j.trackName && similarity(j.trackName, title) < 0.5) return null
  if (j.artistName && similarity(j.artistName, artist) < 0.3) return null
  if (duration && j.duration && !durationMatch(j.duration, duration)) return null
  return j.plainLyrics || j.syncedLyrics || null
}

async function searchLrclib(title, artist, album, duration) {
  const params = new URLSearchParams({ q: `${title} ${artist}` })
  const res = await fetch(`https://lrclib.net/api/search?${params}`, UA)
  if (!res.ok) return null
  const arr = await res.json()
  if (!arr.length) return null
  let best = null, bestScore = 50
  for (const r of arr) {
    const lyrics = r.plainLyrics || r.syncedLyrics
    if (!lyrics) continue
    const s = scoreResult(r, title, artist, album, duration)
    if (s > bestScore) { best = lyrics; bestScore = s }
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
    let text = await fromLrclib(title, artist, duration)
    if (!text) text = await searchLrclib(title, artist, album, duration)
    if (!text) return json({ found: false }, 's-maxage=3600')

    const allLines = extractLines(text)
    const q = pickQuestion(allLines)
    if (!q) return json({ found: false }, 's-maxage=3600')

    return json({ found: true, context: q.context, answer: q.answer, wrongs: q.wrongs }, 's-maxage=3600')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
