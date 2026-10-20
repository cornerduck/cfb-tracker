import { useState, type ReactNode } from 'react'
import type { Team } from '../data/types'
import { abbr, teamColor } from '../data/model'

const imageFiles = new Set(typeof __IMAGE_FILES__ === 'undefined' ? [] : __IMAGE_FILES__)

export const imageUrl = (folder: string, name: string | number, extensions = ['png', 'jpg', 'jpeg', 'webp', 'svg']) => {
  for (const extension of extensions) {
    const path = `${folder}/${name}.${extension}`
    if (imageFiles.has(path)) return `${import.meta.env.BASE_URL}images/${path}`
  }
  return null
}

// Every logo sits on a rounded light plate. Without a logo file the plate
// shows the team abbreviation in the team color.
export function Plate({ team, size = 24, dark = false }: { team: Team | undefined | null; size?: number; dark?: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = team ? imageUrl('logos', team.slug, ['png', 'webp', 'svg']) : null
  const text = abbr(team)
  const fontSize = Math.max(7, Math.min(size * 0.46, 16) - Math.max(0, text.length - 3) * size * 0.08)
  return (
    <span
      className={`plate${dark ? ' plate--dark' : ''}`}
      style={{ width: size, height: size, borderRadius: Math.max(4, size * 0.2), color: teamColor(team), fontSize }}
      aria-hidden="true"
    >
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="plate-text">{text}</span>}
    </span>
  )
}

// Player photo on a team-colored base. Without a photo file the team logo
// plate is shown instead.
export function PlayerAvatar({ playerId, team, size = 36, round = true }: { playerId: string | null | undefined; team: Team | undefined | null; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = playerId ? imageUrl('players', playerId, ['png', 'jpg', 'jpeg', 'webp']) : null
  if (!src || failed) return <Plate team={team} size={size} />
  return (
    <span className="pavatar" style={{ width: size, height: size, borderRadius: round ? '50%' : Math.max(4, size * 0.2), background: `linear-gradient(to bottom, ${teamColor(team)}, ${teamColor(team)}99)` }} aria-hidden="true">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}

export function Flame({ count, size = 12 }: { count: number | null; size?: number }) {
  if (!count) return null
  return (
    <span className="flame num" title={`${count}-game win streak`}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg>
      {count}
    </span>
  )
}

export function Movement({ current, previous, isNew }: { current: number; previous: number | null; isNew?: boolean }) {
  if (isNew || previous === null) return <span className="move move--new cond">NEW</span>
  const diff = previous - current
  if (!diff) return <span className="move move--flat">—</span>
  return <span className={`move cond num ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'}{Math.abs(diff)}</span>
}

export function ConfTag({ code }: { code: string }) {
  return <span className="conf-tag cond">{code}</span>
}

export function Tile({ title, action, children, className = '', onAction }: {
  title?: ReactNode
  action?: ReactNode
  onAction?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`tile ${className}`}>
      {(title || action) && (
        <header className="tile-head">
          {title && <h2 className="cond">{title}</h2>}
          {action && <button type="button" className="tile-link" onClick={onAction}>{action}</button>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="outline-button cond" onClick={onRetry}>RETRY</button>}
    </div>
  )
}

export function Tabs<T extends string>({ items, value, onChange, labels }: {
  items: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, ReactNode>>
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button key={item} type="button" role="tab" aria-selected={value === item} className={`tab cond${value === item ? ' active' : ''}`} onClick={() => onChange(item)}>
          {labels?.[item] ?? item}
        </button>
      ))}
    </div>
  )
}

export function Pills<T extends string>({ items, value, onChange }: { items: readonly T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="pills">
      {items.map((item) => (
        <button key={item} type="button" className={`pill cond${value === item ? ' active' : ''}`} aria-pressed={value === item} onClick={() => onChange(item)}>{item}</button>
      ))}
    </div>
  )
}

export function StarButton({ active, onClick, label, disabled }: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" className={`star-button${active ? ' active' : ''}`} aria-pressed={active} aria-label={label} disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick() }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" /></svg>
    </button>
  )
}
