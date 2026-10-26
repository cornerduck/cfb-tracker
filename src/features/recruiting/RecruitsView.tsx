import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { confAbbr } from '../../data/model'
import { fetchRecruits } from '../../data/queries'
import type { RecruitRow } from '../../data/types'
import { Empty, ErrorBox, Loading, Pills } from '../../shared/ui'
import type { RecruitingFilters } from './Recruiting'
import { POSITION_GROUPS, hometownText, positionGroup, ratingText, type PositionGroup } from './logic'
import { Grid, MeterRow, SchoolBit, Stars, TeamBanner, type Col } from './shared'

const TOP = 300

export function RecruitsView({ filters, mobile }: { filters: RecruitingFilters; mobile: boolean }) {
  const { model, liveYear } = useApp()
  const { year, team, position, state } = filters
  const recruits = useQuery({ queryKey: ['recruits', year], queryFn: () => fetchRecruits(year), staleTime: 10 * 60_000 })
  const data = recruits.data

  const states = useMemo(() => [...new Set((data ?? []).map((row) => row.state_province).filter((value): value is string => Boolean(value)))].sort(), [data])
  const rows = useMemo(() => (data ?? [])
    .filter((row) => !position || positionGroup(row.position) === position)
    .filter((row) => !state || row.state_province === state)
    .filter((row) => !team || row.committed_team_id === team.id), [data, position, state, team])

  // The tiles look at the 300 best recruits of the whole class, whatever the filters say.
  const tiles = useMemo(() => {
    const top = (data ?? []).filter((row) => row.national_rank !== null && row.national_rank <= TOP)
    const byState = new Map<string, number>()
    const byConference = new Map<string, number>()
    for (const row of top) {
      if (row.state_province) byState.set(row.state_province, (byState.get(row.state_province) ?? 0) + 1)
      const label = row.committed_team_id === null ? 'UNCOMMITTED'
        : model.fbsIds.has(row.committed_team_id) ? (confAbbr(model.conferenceOf(row.committed_team_id)) || 'OTHER') : 'OTHER'
      byConference.set(label, (byConference.get(label) ?? 0) + 1)
    }
    const order = (map: Map<string, number>, limit: number) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
    return { count: top.length, states: order(byState, 8), conferences: order(byConference, 8) }
  }, [data, model])

  if (recruits.error) return <ErrorBox message={(recruits.error as Error).message} onRetry={() => void recruits.refetch()} />
  if (recruits.isPending) return <Loading label="Loading the recruits…" />

  const cols: Array<Col<RecruitRow>> = [
    { key: 'rank', head: 'RANK', width: mobile ? '36px' : '52px', align: 'right', cell: (row) => <span className="cond num rc-rank">{row.national_rank ?? '—'}</span> },
    { key: 'player', head: 'PLAYER', width: 'minmax(0, 1.2fr)', cell: (row) => (
      <span className="rc-player"><strong className="truncate">{row.name}</strong>{mobile && <span className="muted small truncate">{[row.position, hometownText(row), model.team(row.committed_team_id)?.school ?? row.committed_to].filter(Boolean).join(' · ')}</span>}</span>
    ) },
    { key: 'pos', head: 'POS', width: '60px', phone: false, cell: (row) => <span className="cond">{row.position ?? '—'}</span> },
    { key: 'stars', head: 'STARS', width: mobile ? '78px' : '90px', cell: (row) => <Stars stars={row.stars} /> },
    { key: 'rating', head: 'RATING', width: '70px', align: 'right', cell: (row) => <span className="num">{ratingText(row.rating)}</span> },
    { key: 'home', head: 'HOMETOWN', width: 'minmax(0, 1fr)', phone: false, cell: (row) => <span className="truncate">{hometownText(row)}</span> },
    { key: 'team', head: 'COMMITTED TO', width: 'minmax(0, 1fr)', phone: false, cell: (row) => (
      <SchoolBit team={model.team(row.committed_team_id)} name={row.committed_to} fallback={<span className="muted">Uncommitted</span>} />
    ) },
  ]
  const maxState = Math.max(1, ...tiles.states.map(([, value]) => value))
  const maxConference = Math.max(1, ...tiles.conferences.map(([, value]) => value))
  return (
    <>
      {team && <TeamBanner team={team} subtitle={`${rows.length} RECRUITS IN THE CLASS OF ${year}`} onClear={filters.clearTeam} />}
      <div className="rc-filters rc-filters--sub">
        <Pills items={['ALL', ...POSITION_GROUPS.map((group) => (group === 'ST / ATH' ? 'ST' : group))]} value={position ? (position === 'ST / ATH' ? 'ST' : position) : 'ALL'} onChange={(value) => filters.setParam({ pos: value === 'ALL' ? null : value === 'ST' ? 'ST / ATH' : value as PositionGroup })} />
        <span className="grow" />
        <select className="select cond rc-select" aria-label="State" value={state ?? ''} onChange={(event) => filters.setParam({ state: event.target.value || null })}>
          <option value="">ALL STATES</option>
          {states.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="rc-split">
        <section className="tile">
          <header className="tile-head">
            <h2 className="cond">TOP RECRUITS · CLASS OF {year}</h2>
            <span className="muted small">{year >= liveYear + 1 ? 'Ranked nationally · updated every Monday' : 'Ranked nationally'}</span>
          </header>
          {rows.length ? <Grid cols={cols} rows={rows} rowKey={(row) => row.id} limit={mobile ? 25 : 100} />
            : <Empty>{data?.length ? 'No recruit matches the filter.' : `CFBD has no recruits for the class of ${year} yet.`}</Empty>}
        </section>
        <div className="rc-side">
          <section className="tile">
            <header className="tile-head"><h2 className="cond">TOP {TOP} BY STATE</h2><span className="muted small">Players</span></header>
            {tiles.states.length ? tiles.states.map(([name, value]) => <MeterRow key={name} label={name} value={value} max={maxState} text={String(value)} />) : <Empty>No ranked recruits yet.</Empty>}
          </section>
          <section className="tile">
            <header className="tile-head"><h2 className="cond">TOP {TOP} BY CONFERENCE</h2><span className="muted small">Committed to</span></header>
            {tiles.conferences.length ? tiles.conferences.map(([name, value]) => <MeterRow key={name} label={name} value={value} max={maxConference} text={String(value)} />) : <Empty>No ranked recruits yet.</Empty>}
          </section>
        </div>
      </div>
    </>
  )
}
