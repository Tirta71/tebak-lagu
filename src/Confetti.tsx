import { useEffect, useRef } from 'react'

/** A short burst of confetti over the whole page, drawn on a canvas, then gone. */
export function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const g = c.getContext('2d')!
    const w = (c.width = innerWidth)
    const h = (c.height = innerHeight)
    const colors = ['#9d8cff', '#ff8ab4', '#34e0a1', '#f5a524', '#6fd0ff']
    const bits = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.4,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      s: 5 + Math.random() * 6,
      c: colors[(Math.random() * colors.length) | 0],
    }))
    let frame = 0
    let id = 0
    const draw = () => {
      g.clearRect(0, 0, w, h)
      for (const b of bits) {
        b.vy += 0.35
        b.vx *= 0.99
        b.x += b.vx
        b.y += b.vy
        b.r += b.vr
        g.save()
        g.translate(b.x, b.y)
        g.rotate(b.r)
        g.fillStyle = b.c
        g.globalAlpha = Math.max(0, 1 - frame / 160)
        g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2)
        g.restore()
      }
      if (++frame < 160) id = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(id)
  }, [])
  return <canvas ref={canvas} className="confetti" aria-hidden />
}
