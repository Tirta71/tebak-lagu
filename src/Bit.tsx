/**
 * Bit, the robot from Tirta's portfolio, as the game's host: a rounded screen-face with two eyes,
 * an antenna and headphones. `mood` changes the eyes (listening, happy, sad).
 */
export function Bit({ size = 160, mood = 'idle' }: { size?: number; mood?: 'idle' | 'listen' | 'happy' | 'sad' }) {
  return (
    <svg className={`bit bit-${mood}`} width={size} height={size} viewBox="0 0 160 160" aria-hidden>
      <defs>
        <linearGradient id="bit-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f6ff" />
          <stop offset="1" stopColor="#cfd5ec" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <path d="M80 34V20" stroke="#cfd5ec" strokeWidth="5" strokeLinecap="round" />
      <circle className="bit-tip" cx="80" cy="15" r="8" fill="#9d8cff" />
      {/* headphone band and cups */}
      <path d="M26 86a54 54 0 0 1 108 0" fill="none" stroke="#5b5cf0" strokeWidth="9" strokeLinecap="round" />
      <rect x="14" y="74" width="22" height="40" rx="10" fill="#6d6ef7" />
      <rect x="124" y="74" width="22" height="40" rx="10" fill="#6d6ef7" />
      {/* head and screen */}
      <rect x="30" y="38" width="100" height="88" rx="28" fill="url(#bit-body)" />
      <rect x="42" y="52" width="76" height="58" rx="18" fill="#0b1222" />
      {mood === 'happy' ? (
        <g stroke="#34e0c4" strokeWidth="6" strokeLinecap="round" fill="none">
          <path d="M58 84q8-10 16 0" />
          <path d="M86 84q8-10 16 0" />
        </g>
      ) : mood === 'sad' ? (
        <g stroke="#ff7a90" strokeWidth="6" strokeLinecap="round">
          <path d="M58 80h16" />
          <path d="M86 80h16" />
        </g>
      ) : (
        <g className="bit-eyes" fill="#34e0c4">
          <rect x="60" y="68" width="12" height="22" rx="6" />
          <rect x="88" y="68" width="12" height="22" rx="6" />
        </g>
      )}
      <ellipse cx="80" cy="138" rx="34" ry="5" fill="#000" opacity="0.25" />
    </svg>
  )
}

/** Bars that bounce while the song plays. */
export function Equalizer({ on }: { on: boolean }) {
  return (
    <span className={`eq${on ? ' on' : ''}`} aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </span>
  )
}
