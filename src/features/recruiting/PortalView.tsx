import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { fetchPortal } from '../../data/queries'
import type { PortalRow, Team } from '../../data/types'
import { Empty, ErrorBox, Loading, Pills } from '../../shared/ui'
import type { RecruitingFilters } from './Recruiting'
import { POSITION_GROUPS, averageOf, isWithdrawn, netText, portalNet, portalSummary, positionGroup, ratingText, type PositionGroup } from './logic'
import { EligibilityChip, Grid, SchoolBit, Stars, StatBox, TeamBanner, type Col } from './shared'

// The second line of a player on the phone: where he comes from and where he goes.
function mobileLine(row: PortalRow, mode: 'all' | 'in' | 'out') {
  const destination = isWithdrawn(row) ? 'Withdrew' : row.destination ?? 'Uncommitted'
  if (mode === 'in') return row.origin
  if (mode === 'out') return destination
  return `${row.origin ?? '—'} → ${destination}`
}

function useColumns(mode: 'all' | 'in' | 'out'): Array<Col<PortalRow>> {
  const { model, mobile } = useApp()
  const to = (row: PortalRow) => (isWithdrawn(row) ? <span className="muted">Withdrew from portal</span>
    : <SchoolBit team={model.team(row.destination_team_id)} name={row.destination} fallback={<span className="muted">Uncommitted</span>} />)
  const from = (row: PortalRow) => <SchoolBit team={model.team(row.origin_team_id)} name={row.origin} />
  const cols: Array<Col<PortalRow>> = [
    { key: 'player', head: 'PLAYER', width: 'minmax(0, 1.2fr)', cell: (row) => (
      <span className="rc-player">
        <strong className={`truncate${isWithdrawn(row) ? ' rc-struck' : ''}`}>{row.name}</strong>
        {mobile && <span className="muted small truncate">{[row.position, mobileLine(row, mode)].filter(Boolean).join(' · ')}</span>}
      </span>
    ) },
    { key: 'pos', head: 'POS', width: '60px', phone: false, cell: (row) => <span className="cond">{row.position ?? '—'}</span> },
  ]
  if (mode !== 'out') cols.push({ key: 'from', head: 'FROM', width: 'minmax(0, 1fr)', phone: false, cell: from })
  if (mode !== 'in') cols.push({ key: 'to', head: 'TO', width: 'minmax(0, 1fr)', phone: false, cell: to })
  cols.push(
    { key: 'stars', head: 'STARS', width: mobile ? '78px' : '90px', cell: (row) => <Stars stars={row.stars} /> },
    { key: 'rating', head: 'RATING', width: '70px', align: 'right', cell: (row) => <span className="num">{ratingText(row.rating)}</span> },
    { key: 'eligibility', head: 'ELIGIBILITY', width: '110px', phone: false, cell: (row) => <EligibilityChip value={row.eligibility} /> },
  )
  return cols
}

const rowClass = (row: PortalRow) => (isWithdrawn(row) ? 'rc-dim' : '')

function TeamPortal({ team, rows, filters }: { team: Team; rows: PortalRow[]; filters: RecruitingFilters }) {
  const { mobile } = useApp()
  const [side, setSide] = useState<'in' | 'out'>('in')
  const incoming = useMemo(() => rows.filter((row) => row.destination_team_id === team.id && !isWithdrawn(row)), [rows, team.id])
  const outgoing = useMemo(() => rows.filter((row) => row.origin_team_id === team.id), [rows, team.id])
  const outCount = outgoing.filter((row) => !isWithdrawn(row)).length
  const net = incoming.length - outCount
  const inCols = useColumns('in')
  const outCols = useColumns('out')
  const list = (title: string, count: number, body: React.ReactNode) => (
    <section className="tile"><header className="tile-head"><h2 className="cond">{title}</h2><span className="muted small">{count}</span></header>{body}</section>
  )
  return (
    <>
      <TeamBanner team={team} subtitle={`PORTAL ${filters.year} · NET ${netText(net)}`} onClear={filters.clearTeam} />
      <div className="rc-statrow">
        <StatBox label="Coming in" value={incoming.length} />
        <StatBox label="Leaving" value={outCount} />
        <StatBox label="Net" value={netText(net)} />
        <StatBox label="Average rating in" value={ratingText(averageOf(incoming.map((row) => row.rating)))} />
        <StatBox label="Average rating out" value={ratingText(averageOf(outgoing.filter((row) => !isWithdrawn(row)).map((row) => row.rating)))} />
      </div>
      {mobile && <Pills items={['COMING IN', 'LEAVING']} value={side === 'in' ? 'COMING IN' : 'LEAVING'} onChange={(value) => setSide(value === 'COMING IN' ? 'in' : 'out')} />}
      <div className="rc-pair">
        {(!mobile || side === 'in') && list('COMING IN', incoming.length, incoming.length ? <Grid cols={inCols} rows={incoming} rowKey={(row) => row.id} rowClass={rowClass} limit={mobile ? 25 : 60} /> : <Empty>Nobody has committed to {team.school} from the portal yet.</Empty>)}
        {(!mobile || side === 'out') && list('LEAVING', outgoing.length, outgoing.length ? <Grid cols={outCols} rows={outgoing} rowKey={(row) => row.id} rowClass={rowClass} limit={mobile ? 25 : 60} /> : <Empty>Nobody has left {team.school} through the portal.</Empty>)}
      </div>
    </>
  )
}

export function PortalView({ filters, mobile }: { filters: RecruitingFilters; mobile: boolean }) {
  const { model } = useApp()
  const { year, team, conference, position } = filters
  const portal = useQuery({ queryKey: ['portal', year], queryFn: () => fetchPortal(year), staleTime: 10 * 60_000 })
  const cols = useColumns('all')
  const data = portal.data

  const rows = useMemo(() => (data ?? [])
    .filter((row) => !position || positionGroup(row.position) === position)
    .filter((row) => !conference || [row.origin_team_id, row.destination_team_id].some((id) => id !== null && model.conferenceOf(id)?.id === conference.id)), [data, position, conference, model])
  const summary = useMemo(() => portalSummary(rows), [rows])
  const net = useMemo(() => portalNet(data ?? [], model.fbsIds), [data, model])
  const best = useMemo(() => [...net].sort((a, b) => b.net - a.net || b.in - a.in).filter((row) => row.net > 0).slice(0, 6), [net])
  const worst = useMemo(() => [...net].sort((a, b) => a.net - b.net || b.out - a.out).filter((row) => row.net < 0).slice(0, 6), [net])

  if (portal.error) return <ErrorBox message={(portal.error as Error).message} onRetry={() => void portal.refetch()} />
  if (portal.isPending) return <Loading label="Loading the transfer portal…" />

  const filterRow = (
    <div className="rc-filters rc-filters--sub">
      <Pills items={['ALL', ...POSITION_GROUPS.map((group) => (group === 'ST / ATH' ? 'ST' : group))]} value={position ? (position === 'ST / ATH' ? 'ST' : position) : 'ALL'} onChange={(value) => filters.setParam({ pos: value === 'ALL' ? null : value === 'ST' ? 'ST / ATH' : value as PositionGroup })} />
    </div>
  )
  if (!data?.length) return <Empty>CFBD has no transfer portal entries for {year} yet.</Empty>
  if (team) return <>{filterRow}<TeamPortal team={team} rows={rows} filters={filters} /></>

  const netTable = (title: string, list: typeof best, empty: string) => (
    <section className="tile">
      <header className="tile-head"><h2 className="cond">{title}</h2><span className="muted small">By net</span></header>
      {list.length ? list.map((row) => (
        <div key={row.teamId} className="rc-net-row">
          <span className="grow truncate"><SchoolBit team={model.team(row.teamId)} /></span>
          <span className="cond num muted">{row.in} in</span>
          <span className="cond num muted">{row.out} out</span>
          <strong className={`cond num ${row.net > 0 ? 'win' : 'loss'}`}>{netText(row.net)}</strong>
        </div>
      )) : <Empty>{empty}</Empty>}
    </section>
  )
  return (
    <>
      {filterRow}
      <div className="rc-statrow">
        <StatBox label="Entries" value={summary.entries.toLocaleString('en-US')} />
        <StatBox label="Committed" value={summary.committed.toLocaleString('en-US')} />
        <StatBox label="Still in portal" value={summary.stillIn.toLocaleString('en-US')} />
        <StatBox label="Average rating" value={ratingText(summary.average)} hint="Sorted by rating" />
      </div>
      <div className="rc-split">
        <section className="tile">
          <header className="tile-head"><h2 className="cond">PORTAL {year}</h2><span className="muted small">Updated every Monday</span></header>
          {rows.length ? <Grid cols={cols} rows={rows} rowKey={(row) => row.id} rowClass={rowClass} limit={mobile ? 25 : 100} /> : <Empty>No entry matches the filter.</Empty>}
        </section>
        <div className="rc-side">
          {netTable('BEST PORTAL CLASSES', best, 'No team has a positive net yet.')}
          {netTable('BIGGEST LOSSES', worst, 'No team has a negative net yet.')}
        </div>
      </div>
    </>
  )
}
