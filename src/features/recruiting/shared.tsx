import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { confAbbr, confName } from '../../data/model'
import type { PortalEligibility, Team } from '../../data/types'
import { ConfPlate, Plate } from '../../shared/ui'
import { ELIGIBILITY_LABEL } from './logic'

export function Stars({ stars }: { stars: number | null }) {
  if (stars === null || stars <= 0) return <span className="muted">—</span>
  const shown = Math.min(5, stars)
  return (
    <span className="rc-stars" aria-label={`${shown} stars`}>
      <span>{'★'.repeat(shown)}</span><span className="rc-stars-off">{'★'.repeat(5 - shown)}</span>
    </span>
  )
}

export function EligibilityChip({ value }: { value: PortalEligibility | null }) {
  if (!value) return <span className="muted">—</span>
  return <span className={`rc-chip cond rc-chip--${value.toLowerCase()}`}>{ELIGIBILITY_LABEL[value]}</span>
}

// A school with its logo plate. A school outside FBS (no row in teams) shows its name only.
export function SchoolBit({ team, name, fallback = '—' }: { team: Team | undefined | null; name?: string | null; fallback?: ReactNode }) {
  if (team) return <span className="rc-school"><Plate team={team} size={22} /><span className="truncate">{team.school}</span></span>
  if (name) return <span className="rc-school muted"><span className="truncate">{name}</span></span>
  return <span className="muted">{fallback}</span>
}

export function TeamBit({ team }: { team: Team }) {
  const { model } = useApp()
  const conference = model.conferenceOf(team.id)
  return (
    <span className="rc-team">
      <Plate team={team} size={26} />
      <span className="rc-team-name truncate">{team.school}</span>
      {conference && <span className="conf-tag cond">{confAbbr(conference)}</span>}
    </span>
  )
}

export type Col<T> = {
  key: string
  head: ReactNode
  width: string
  align?: 'left' | 'right' | 'center'
  // false hides the column on the phone.
  phone?: boolean
  cell: (row: T) => ReactNode
}

// A table made of grid rows. A limit shows the first rows with a button for the rest.
export function Grid<T>({ cols, rows, rowKey, rowClass, limit, onRow }: {
  cols: Array<Col<T>>
  rows: T[]
  rowKey: (row: T) => string
  rowClass?: (row: T) => string
  limit?: number
  onRow?: (row: T) => void
}) {
  const { mobile } = useApp()
  const [all, setAll] = useState(false)
  const visible = cols.filter((col) => !mobile || col.phone !== false)
  const template = visible.map((col) => col.width).join(' ')
  const shown = limit && !all ? rows.slice(0, limit) : rows
  return (
    <div className="rc-grid">
      <div className="rc-row rc-row--head cond" style={{ gridTemplateColumns: template }}>
        {visible.map((col) => <span key={col.key} className={`rc-${col.align ?? 'left'}`}>{col.head}</span>)}
      </div>
      {shown.map((row) => (
        <div
          key={rowKey(row)}
          className={`rc-row${onRow ? ' rc-row--link' : ''} ${rowClass?.(row) ?? ''}`}
          style={{ gridTemplateColumns: template }}
          onClick={onRow ? () => onRow(row) : undefined}
        >
          {visible.map((col) => <span key={col.key} className={`rc-${col.align ?? 'left'}`}>{col.cell(row)}</span>)}
        </div>
      ))}
      {limit && rows.length > limit && !all && (
        <button type="button" className="rc-more cond" onClick={() => setAll(true)}>SHOW ALL {rows.length}</button>
      )}
    </div>
  )
}

export function StatBox({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rc-stat">
      <span className="muted small">{label}</span>
      <strong className="cond num">{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  )
}

// The banner of a picked team. The team picker applies to every sub-tab.
export function TeamBanner({ team, subtitle, onClear }: { team: Team; subtitle: ReactNode; onClear: () => void }) {
  const { model } = useApp()
  const navigate = useNavigate()
  const conference = model.conferenceOf(team.id)
  return (
    <header className="tile rc-banner">
      <Plate team={team} size={48} />
      <div className="rc-banner-copy">
        <span className="cond rc-banner-name">{team.school.toUpperCase()} {team.mascot?.toUpperCase()}</span>
        <span className="rc-banner-sub small muted">{conference && <ConfPlate conference={conference} small />}{conference && <span className="cond">{confName(conference).toUpperCase()}</span>}<span className="cond">{subtitle}</span></span>
      </div>
      <span className="grow" />
      <button type="button" className="outline-button cond" onClick={() => navigate(`/teams/${team.slug}`)}>OPEN TEAM PAGE →</button>
      <button type="button" className="icon-button" aria-label={`Clear ${team.school}`} onClick={onClear}>✕</button>
    </header>
  )
}

export function MeterRow({ label, value, max, text }: { label: ReactNode; value: number; max: number; text: string }) {
  return (
    <div className="rc-meter-row">
      <span className="cond rc-meter-label">{label}</span>
      <span className="meter"><span style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} /></span>
      <span className="cond num rc-meter-value">{text}</span>
    </div>
  )
}
