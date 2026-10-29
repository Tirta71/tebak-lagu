// Fetches lyrics for "Tebak Lirik" (continue-the-lyrics) quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>&duration=<sec>&album=<album>
// Returns synced context lines (with delays) + answer line + wrong options.
// Uses LRCLIB synced lyrics so lines match the Deezer 30s preview window.

const json = (body, cache = 'no-store', status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } })

const UA = { headers: { 'user-agent': 'TebakLagu/1.0 (https://tebak-lagu.vercel.app)' } }

function cleanTitle(t) {
  return t
    .replace(/\s*\((?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat\.?|ft\.?|with|prod\.?|remix|remaster|live|acoustic|radio edit|deluxe|bonus)[^]]*\]/gi, '')
    .replace(/\s*-\s*(?:feat\.?|ft\.?|remix|remaster|radio edit|acoustic|live|deluxe|bonus).*$/gi, '')
    .trim()
}

/** Parse LRC synced lyrics into [{time, text}]. */
function parseLrc(lrc) {
  const lines = []
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/)
    if (!m) continue
    const text = m[4].trim()
    if (!text) continue
    const time = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / (m[3].length === 2 ? 100 : 1000)
    lines.push({ time, text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** Deduplicate consecutive identical lines. */
function dedupSynced(lines) {
  return lines.filter((l, i) => i === 0 || l.text !== lines[i - 1].text)
}

function extractPlainLines(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('['))
}

function dedupPlain(lines) {
  return lines.filter((l, i) => i === 0 || l !== lines[i - 1])
}

/**
 * Pick question from synced lyrics, targeting the Deezer preview window.
 * Deezer previews are typically 30s starting around 30-60s into the song.
 * Returns { context: [{text, delay}], answer, wrongs, previewStart }
 */
function pickSyncedQuestion(syncedLines) {
  const lines = dedupSynced(syncedLines)
  if (lines.length < 8) return null

  // Deezer preview window: usually starts around 30s, try multiple windows
  const windows = [
    [25, 55], [30, 60], [20, 50], [35, 65], [40, 70], [15, 45], [45, 75]
  ]

  let bestWindow = null
  let bestCount = 0
  for (const [start, end] of windows) {
    const inWindow = lines.filter(l => l.time >= start && l.time <= end)
    if (inWindow.length > bestCount) {
      bestCount = inWindow.length
      bestWindow = [start, end]
    }
  }

  if (!bestWindow || bestCount < 5) {
    // fallback: pick densest 30s window
    for (let s = 0; s <= lines[lines.length - 1].time - 25; s += 5) {
      const inW = lines.filter(l => l.time >= s && l.time <= s + 30)
      if (inW.length > bestCount) {
        bestCount = inW.length
        bestWindow = [s, s + 30]
      }
    }
  }

  if (!bestWindow || bestCount < 5) return null

  const windowLines = lines.filter(l => l.time >= bestWindow[0] && l.time <= bestWindow[1])
  const contextLen = Math.min(3 + Math.floor(Math.random() * 3), windowLines.length - 2)
  if (contextLen < 2) return null

  const maxStart = windowLines.length - contextLen - 1
  if (maxStart < 0) return null
  const startIdx = Math.floor(Math.random() * (maxStart + 1))

  const contextSynced = windowLines.slice(startIdx, startIdx + contextLen)
  const answerLine = windowLines[startIdx + contextLen]
  if (!answerLine) return null

  // Build context with delays (time gap between consecutive lines)
  const context = contextSynced.map((l, i) => ({
    text: l.text,
    delay: i === 0 ? 0 : Math.max(0.5, Math.min(5, l.time - contextSynced[i - 1].time))
  }))

  // Wrong candidates from outside the context+answer area
  const usedTexts = new Set([...contextSynced.map(l => l.text), answerLine.text])
  const candidates = lines
    .filter(l => !usedTexts.has(l.text) && l.text.length > 5)
    .map(l => l.text)

  // shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }

  return {
    context,
    answer: answerLine.text,
    wrongs: candidates.slice(0, 6),
    previewStart: bestWindow[0]
  }
}

/** Fallback: pick from plain lyrics (no timing). */
function pickPlainQuestion(text) {
  const lines = dedupPlain(extractPlainLines(text))
  if (lines.length < 6) return null
  const contextLen = 3 + Math.floor(Math.random() * 3)
  const maxStart = lines.length - contextLen - 1
  if (maxStart < 1) return null
  const start = 1 + Math.floor(Math.random() * maxStart)
  const contextLines = lines.slice(start, start + contextLen)
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
  return {
    context: contextLines.map((text, i) => ({ text, delay: i === 0 ? 0 : 2.5 })),
    answer,
    wrongs: candidates.slice(0, 6)
  }
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
  return Math.abs(lrcDuration - deezerDuration) <= 10
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

/** Returns { syncedLyrics, plainLyrics } or null. */
async function fromLrclib(title, artist, duration) {
  const params = new URLSearchParams({ track_name: title, artist_name: artist })
  if (duration) params.set('duration', String(duration))
  const res = await fetch(`https://lrclib.net/api/get?${params}`, UA)
  if (!res.ok) return null
  const j = await res.json()
  if (j.trackName && similarity(j.trackName, title) < 0.5) return null
  if (j.artistName && similarity(j.artistName, artist) < 0.3) return null
  if (duration && j.duration && !durationMatch(j.duration, duration)) return null
  if (!j.syncedLyrics && !j.plainLyrics) return null
  return { syncedLyrics: j.syncedLyrics || null, plainLyrics: j.plainLyrics || null }
}

/** Returns { syncedLyrics, plainLyrics } or null. */
async function searchLrclib(title, artist, album, duration) {
  const params = new URLSearchParams({ q: `${title} ${artist}` })
  const res = await fetch(`https://lrclib.net/api/search?${params}`, UA)
  if (!res.ok) return null
  const arr = await res.json()
  if (!arr.length) return null
  let best = null, bestScore = 50
  for (const r of arr) {
    if (!r.syncedLyrics && !r.plainLyrics) continue
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
    let result = await fromLrclib(title, artist, duration)
    if (!result) result = await searchLrclib(title, artist, album, duration)
    if (!result) return json({ found: false }, 's-maxage=3600')

    // prefer synced lyrics for accurate timing
    let q = null
    if (result.syncedLyrics) {
      const parsed = parseLrc(result.syncedLyrics)
      if (parsed.length >= 8) q = pickSyncedQuestion(parsed)
    }
    // fallback to plain lyrics
    if (!q && result.plainLyrics) q = pickPlainQuestion(result.plainLyrics)
    if (!q && result.syncedLyrics) q = pickPlainQuestion(result.syncedLyrics)
    if (!q) return json({ found: false }, 's-maxage=3600')

    return json({
      found: true,
      context: q.context,
      answer: q.answer,
      wrongs: q.wrongs,
      synced: !!result.syncedLyrics
    }, 's-maxage=3600')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
