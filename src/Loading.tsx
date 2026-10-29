import { Check, X } from 'lucide-react'
import { Bit } from './Bit'
import type { LoadProgress } from './lyricsSync'

/**
 * The wait while a quiz's songs are got ready. With `progress` (Tebak Lirik) it counts the songs
 * checked so far and how many fit; without it the bar just keeps moving. `need`: how many fitting
 * songs it takes to start (all that are wanted, unless play starts after the first few).
 */
export function Loading({ title, progress, need = progress?.want ?? 0, onCancel }: { title: string; progress?: LoadProgress | null; need?: number; onCancel?: () => void }) {
  const p = progress
  // done once enough fit, or once every song has been checked
  const share = p ? Math.min(1, Math.max(need ? p.found / need : 0, p.total ? p.checked / p.total : 0)) : 0
  return (
    <section className="countdown">
      <Bit size={130} mood="listen" />
      <div className="loading-card" role="status" aria-live="polite">
        <span className="loading-title">{title}</span>
        {p && (
          <span className="loading-count">
            <span>
              <b>{p.checked}</b>/{p.total}
            </span>
            <small>lagu dicek</small>
          </span>
        )}
        <div className={`load-bar${p ? '' : ' busy'}`} aria-hidden>
          <span style={p ? { transform: `scaleX(${share})` } : undefined} />
        </div>
        {p && (
          <span className="loading-stats">
            <span className="fit">
              <Check size={13} /> {p.found}
              {need < p.total && `/${need}`} siap
            </span>
            <span>{Math.round(share * 100)}%</span>
          </span>
        )}
        {p && <small className="loading-hint">Yang dipakai hanya lagu yang liriknya pas dengan potongan lagunya.</small>}
      </div>
      {onCancel && (
        <button className="ghost small" onClick={onCancel}>
          <X size={14} /> Batal
        </button>
      )}
    </section>
  )
}
