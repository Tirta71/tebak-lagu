import { useRef, useState } from 'react'
import { ArrowLeft, KeyRound, Plus } from 'lucide-react'
import { Bit } from './Bit'
import { AVATARS } from './local'

const LENGTH = 5

/** Five boxes for a room code; it joins by itself once all five are filled. */
function CodeBoxes({ onDone }: { onDone: (code: string) => void }) {
  const [chars, setChars] = useState<string[]>(Array(LENGTH).fill(''))
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  const set = (i: number, text: string) => {
    const letters = text.toUpperCase().replace(/[^A-Z]/g, '')
    const next = [...chars]
    // typing or pasting several letters fills the following boxes too
    letters.split('').forEach((c, k) => i + k < LENGTH && (next[i + k] = c))
    if (!letters) next[i] = ''
    setChars(next)
    const to = Math.min(i + Math.max(letters.length, 0), LENGTH - 1)
    if (letters) boxes.current[to]?.focus()
    if (next.every(Boolean)) onDone(next.join(''))
  }

  return (
    <div className="code-boxes">
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => void (boxes.current[i] = el)}
          value={c}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label={`Huruf ${i + 1} kode room`}
          onChange={(e) => set(i, e.target.value.slice(-LENGTH))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !c && i > 0) boxes.current[i - 1]?.focus()
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}

/** Playing together: start a room, or join one with its code. */
export function PartyHome({ onCreate, onJoin, onBack }: { onCreate: () => void; onJoin: (code: string) => void; onBack: () => void }) {
  return (
    <section className="party-home">
      <header className="page-head">
        <button className="ghost small" onClick={onBack}>
          <ArrowLeft size={14} /> Beranda
        </button>
        <h1>
          Main bareng <span>teman</span>
        </h1>
      </header>

      <div className="party-cards">
        <div className="party-card create">
          <div className="party-art" aria-hidden>
            <Bit size={110} mood="happy" />
            <span className="orbit">
              {AVATARS.slice(5, 9).map((a) => (
                <i key={a}>{a}</i>
              ))}
            </span>
          </div>
          <h2>
            Buat <span>room</span>
          </h2>
          <p>Atur permainan, pilih kuis, lalu ajak teman masuk dengan kode room.</p>
          <button className="primary wide" onClick={onCreate}>
            <Plus size={17} /> Buat room
          </button>
        </div>

        <div className="party-card join-card">
          <div className="party-art" aria-hidden>
            <span className="ticket">
              <KeyRound size={34} />
              <b>ABCDE</b>
            </span>
          </div>
          <h2>
            Gabung pakai <span>kode</span>
          </h2>
          <CodeBoxes onDone={onJoin} />
          <p>Ketik 5 huruf kode room dari temanmu, kamu langsung masuk ke lobinya.</p>
        </div>
      </div>
    </section>
  )
}
