import { type ReactNode, useEffect, useRef, useState } from 'react'

// Desktop: a centered window. Mobile: a bottom sheet that closes when dragged
// down, but only while its content is scrolled to the top.
export function WindowFrame({ title, kicker, actions, children, onClose, className = '' }: {
  title?: ReactNode
  kicker?: ReactNode
  actions?: ReactNode
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const start = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  const atTop = (target: EventTarget | null) => {
    let node = target as HTMLElement | null
    while (node && node !== panel.current) {
      if (node.scrollTop > 0) return false
      node = node.parentElement
    }
    return (panel.current?.scrollTop ?? 0) <= 0
  }

  return (
    <div className="window-backdrop" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`window ${className}`}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => { start.current = atTop(event.target) ? event.touches[0].clientY : null }}
        onTouchMove={(event) => {
          if (start.current === null) return
          const delta = event.touches[0].clientY - start.current
          setOffset(delta > 0 ? delta : 0)
        }}
        onTouchEnd={() => {
          if (offset > 90) onClose()
          start.current = null
          setOffset(0)
        }}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <header className="window-head">
          <div className="window-title">
            {kicker && <span className="window-kicker cond">{kicker}</span>}
            {title && <h2 className="cond">{title}</h2>}
          </div>
          {actions}
          <button type="button" className="close-button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {children}
      </div>
    </div>
  )
}
