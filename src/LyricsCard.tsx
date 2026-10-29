/**
 * The lyrics while the song plays. Every line has its place from the start (a faint bar until it's
 * sung), so the card keeps its size instead of growing line by line; the last place is the line to
 * guess.
 */
export function LyricsCard({ lines, shown, live, blank, answer }: {
  lines: string[]
  /** How many lines have been sung so far. */
  shown: number
  /** The song is playing: the latest line is lit, the earlier ones fade. */
  live: boolean
  /** The music has stopped: the last place asks for the next line. */
  blank: boolean
  answer?: { text: string; right: boolean }
}) {
  return (
    <div className="lyrics-card">
      {lines.map((line, k) =>
        k < shown ? (
          <p key={`l${k}`} className={live ? (k === shown - 1 ? 'now' : 'past') : ''}>
            {line}
          </p>
        ) : (
          <p key={`h${k}`} className="todo" aria-hidden>
            <i style={{ width: `${Math.min(88, 24 + line.length * 1.5)}%` }} />
          </p>
        ),
      )}
      {answer ? (
        <p key="answer" className={`lyrics-answer ${answer.right ? 'correct' : 'missed'}`}>
          {answer.text}
        </p>
      ) : (
        <p key="blank" className={`lyrics-blank${blank ? ' on' : ''}`}>
          ???
        </p>
      )}
    </div>
  )
}
