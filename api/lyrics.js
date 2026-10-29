// Fetches lyrics for "Tebak Lirik" (continue-the-lyrics) quiz mode.
//   /api/lyrics?title=<title>&artist=<artist>&duration=<sec>&album=<album>
// Returns ALL synced lyrics lines with timestamps so the client can
// reveal them in real-time synced to the Deezer audio preview.

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

/**
 * Find the densest 30s windows for picking context+answer.
 * Returns sorted list of candidate windows [{start, end, count}].
 */
function findDenseWindows(lines) {
  const windows = []
  const maxT = lines[lines.length - 1].time
  for (let s = 0; s <= maxT - 20; s += 5) {
    const e = s + 30
    const inW = lines.filter(l => l.time >= s && l.time < e)
    if (inW.length >= 5) windows.push({ start: s, end: e, count: inW.length })
  }
  return windows.sort((a, b) => b.count - a.count)
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

    // only use synced lyrics for proper audio sync
    if (!result.syncedLyrics) return json({ found: false }, 's-maxage=3600')

    const allLines = dedupSynced(parseLrc(result.syncedLyrics))
    if (allLines.length < 8) return json({ found: false }, 's-maxage=3600')

    // find best windows for question picking
    const windows = findDenseWindows(allLines)
    if (!windows.length) return json({ found: false }, 's-maxage=3600')

    // pick context + answer from a good window
    let picked = null
    for (const w of windows) {
      const windowLines = allLines.filter(l => l.time >= w.start && l.time < w.end)
      const contextLen = Math.min(3 + Math.floor(Math.random() * 3), windowLines.length - 2)
      if (contextLen < 3) continue
      const maxStart = windowLines.length - contextLen - 1
      if (maxStart < 0) continue
      const si = Math.floor(Math.random() * (maxStart + 1))
      const ctxLines = windowLines.slice(si, si + contextLen)
      const ansLine = windowLines[si + contextLen]
      if (!ansLine) continue

      // wrongs from outside context
      const usedTexts = new Set([...ctxLines.map(l => l.text), ansLine.text])
      const cands = allLines.filter(l => !usedTexts.has(l.text) && l.text.length > 5).map(l => l.text)
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[cands[i], cands[j]] = [cands[j], cands[i]]
      }
      if (cands.length < 3) continue

      picked = {
        contextLines: ctxLines,
        answer: ansLine,
        wrongs: cands.slice(0, 6),
        windowStart: w.start
      }
      break
    }

    if (!picked) return json({ found: false }, 's-maxage=3600')

    // return ALL synced lines + the question info
    // client will use timestamps to sync with audio
    return json({
      found: true,
      lines: allLines,
      contextIdx: allLines.indexOf(picked.contextLines[0]),
      contextLen: picked.contextLines.length,
      answerIdx: allLines.indexOf(picked.answer),
      answer: picked.answer.text,
      wrongs: picked.wrongs,
      synced: true
    }, 's-maxage=3600')
  } catch {
    return json({ found: false }, 'no-store')
  }
}
