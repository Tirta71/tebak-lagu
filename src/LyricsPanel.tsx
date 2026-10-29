import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { norm } from '../api/_match.js'

type Genius = { configured?: boolean; found?: boolean; id?: number; url?: string }

/** The page Genius's embed runs in: its script writes the lyrics in as the page loads, with Genius's own credit and links. */
function geniusPage(id: number, url: string, title: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:4px 2px;background:#0d1020;color:#eef0ff;font:14px/1.7 'Plus Jakarta Sans',system-ui,sans-serif}a{color:#8b8cff}</style></head>
<body><div id="rg_embed_link_${id}" class="rg_embed_link" data-song-id="${id}">Baca lirik “${esc(title)}” di <a href="${esc(url)}">Genius</a></div>
<script crossorigin src="https://genius.com/songs/${id}/embed.js"></script></body></html>`
}

/**
 * The song's lyrics on the answer card, as Genius's own embed: Genius shows them, with its credit
 * and links; the game only finds the song on Genius and keeps no lyrics itself. The embed runs in
 * a sandboxed frame so its script can't touch the game. Without a Genius token, or for a song
 * Genius doesn't have, there are links to the lyrics on Spotify and Genius instead.
 */
export function LyricsPanel({ title, artist, spotify }: { title: string; artist: string; spotify: string }) {
  const [genius, setGenius] = useState<Genius | null>(null)
  useEffect(() => {
    let alive = true
    setGenius(null)
    fetch(`/api/genius?${new URLSearchParams({ title, artist })}`)
      .then((r) => r.json())
      .catch(() => ({ found: false }))
      .then((j: Genius) => alive && setGenius(j))
    return () => {
      alive = false
    }
  }, [title, artist])

  if (!genius) return <p className="lyrics-note">Mencari lirik…</p>
  if (!genius.found || !genius.id || !genius.url) {
    const search = `https://genius.com/search?q=${encodeURIComponent(`${artist.split(',')[0]} ${norm(title)}`)}`
    return (
      <p className="lyrics-note">
        <FileText size={14} /> Lirik:{' '}
        <a href={spotify} target="_blank" rel="noreferrer">
          Spotify
        </a>{' '}
        ·{' '}
        <a href={search} target="_blank" rel="noreferrer">
          Genius
        </a>
      </p>
    )
  }
  return (
    <details className="lyrics" open>
      <summary>
        <FileText size={14} /> Lirik · Genius
      </summary>
      <iframe
        className="lyrics-frame"
        title={`Lirik ${title} dari Genius`}
        srcDoc={geniusPage(genius.id, genius.url, title)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        loading="lazy"
      />
    </details>
  )
}

