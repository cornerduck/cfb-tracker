import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { confAbbr } from '../../data/model'
import { fetchRecruitingHistory, fetchRecruitingTeams, fetchRecruits } from '../../data/queries'
import type { RecruitRow, RecruitingTeamRow, Team } from '../../data/types'
import { Empty, ErrorBox, Loading, Movement } from '../../shared/ui'
import type { RecruitingFilters } from './Recruiting'
import { POSITION_GROUPS, averageOf, bestClassByPosition, hometownText, positionBreakdown, pointsText, ratingText, rankChanges, sizeText, starBuckets } from './logic'
import { Grid, MeterRow, SchoolBit, Stars, StatBox, TeamBanner, TeamBit, type Col } from './shared'

const SORTS = ['NATIONAL RANK', 'RATING', 'POSITION', 'STARS'] as const
type Sort = typeof SORTS[number]

function sortRecruits(list: RecruitRow[], sort: Sort) {
  const rank = (row: RecruitRow) => row.national_rank ?? Infinity
  return [...list].sort((a, b) => {
    if (sort === 'RATING') return (b.rating ?? -1) - (a.rating ?? -1) || rank(a) - rank(b)
    if (sort === 'STARS') return (b.stars ?? -1) - (a.stars ?? -1) || (b.rating ?? -1) - (a.rating ?? -1)
    if (sort === 'POSITION') return (a.position ?? '~').localeCompare(b.position ?? '~') || rank(a) - rank(b)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}

function TeamClass({ team, filters }: { team: Team; filters: RecruitingFilters }) {
  const { mobile } = useApp()
  const { year } = filters
  const [sort, setSort] = useState<Sort>('NATIONAL RANK')
  const teams = useQuery({ queryKey: ['recruiting-teams', year], queryFn: () => fetchRecruitingTeams(year), staleTime: 10 * 60_000 })
  const recruits = useQuery({ queryKey: ['recruits', year], queryFn: () => fetchRecruits(year), staleTime: 10 * 60_000 })
  const history = useQuery({ queryKey: ['recruiting-history', team.id], queryFn: () => fetchRecruitingHistory(team.id), staleTime: 10 * 60_000 })
  const row = teams.data?.find((item) => item.team_id === team.id)
  const commits = useMemo(() => sortRecruits((recruits.data ?? []).filter((item) => item.committed_team_id === team.id), sort), [recruits.data, team.id, sort])
  const buckets = starBuckets(commits)
  const positions = positionBreakdown(commits)
  const rankText = row?.rank ? `CLASS RANK #${row.rank} · ${pointsText(row.points)} POINTS` : `CLASS OF ${year}`

  const cols: Array<Col<RecruitRow>> = [
    { key: 'nat', head: 'NAT', width: mobile ? '40px' : '56px', align: 'right', cell: (item) => <span className="cond num">{item.national_rank ?? '—'}</span> },
    { key: 'player', head: 'PLAYER', width: 'minmax(0, 1fr)', cell: (item) => (
      <span className="rc-player"><strong className="truncate">{item.name}</strong>{mobile && <span className="muted small truncate">{[item.position, hometownText(item)].filter(Boolean).join(' · ')}</span>}</span>
    ) },
    { key: 'pos', head: 'POS', width: '60px', phone: false, cell: (item) => <span className="cond">{item.position ?? '—'}</span> },
    { key: 'stars', head: 'STARS', width: mobile ? '78px' : '90px', cell: (item) => <Stars stars={item.stars} /> },
    { key: 'rating', head: 'RATING', width: '70px', align: 'right', cell: (item) => <span className="num">{ratingText(item.rating)}</span> },
    { key: 'posrk', head: 'POS RK', width: '60px', align: 'right', phone: false, cell: (item) => <span className="num">{item.position_rank ?? '—'}</span> },
    { key: 'home', head: 'HOMETOWN', width: 'minmax(0, 1fr)', phone: false, cell: (item) => <span className="truncate">{hometownText(item)}</span> },
    { key: 'size', head: 'HT / WT', width: '90px', phone: false, cell: (item) => <span className="num muted">{sizeText(item.height, item.weight)}</span> },
  ]
  const maxStars = Math.max(1, ...buckets.map((item) => item.value))
  const maxPos = Math.max(1, ...positions.map((item) => item.commits))
  return (
    <>
      <TeamBanner team={team} subtitle={rankText} onClear={filters.clearTeam} />
      <div className="rc-statrow">
        <StatBox label="National class rank" value={row?.rank ? `#${row.rank}` : '—'} />
        <StatBox label="Class points" value={pointsText(row?.points ?? null)} />
        <StatBox label="Commits" value={commits.length} />
        <StatBox label="Average rating" value={ratingText(averageOf(commits.map((item) => item.rating)))} />
      </div>
      {teams.error || recruits.error ? <ErrorBox message={((teams.error ?? recruits.error) as Error).message} onRetry={() => { void teams.refetch(); void recruits.refetch() }} />
        : recruits.isPending ? <Loading label="Loading the class…" /> : (
          <div className="rc-split">
            <section className="tile">
              <header className="tile-head">
                <h2 className="cond">CLASS OF {year} · {team.school.toUpperCase()}</h2>
                <select className="select cond" aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  {SORTS.map((item) => <option key={item} value={item}>SORT: {item}</option>)}
                </select>
              </header>
              {commits.length ? <Grid cols={cols} rows={commits} rowKey={(item) => item.id} limit={mobile ? 25 : undefined} />
                : <Empty>No commits in this class yet.</Empty>}
            </section>
            <div className="rc-side">
              <section className="tile">
                <header className="tile-head"><h2 className="cond">CLASS BY STARS</h2><span className="muted small">{commits.length} commits</span></header>
                {buckets.map((item) => <MeterRow key={item.label} label={item.label} value={item.value} max={maxStars} text={String(item.value)} />)}
              </section>
              <section className="tile">
                <header className="tile-head"><h2 className="cond">BY POSITION GROUP</h2><span className="muted small">Commits · avg rating</span></header>
                {positions.map((item) => <MeterRow key={item.group} label={item.group} value={item.commits} max={maxPos} text={`${item.commits} · ${ratingText(item.average)}`} />)}
              </section>
              <section className="tile">
                <header className="tile-head"><h2 className="cond">CLASS RANK BY YEAR</h2></header>
                {history.isPending ? <Loading /> : history.data?.length ? history.data.map((item) => (
                  <div key={item.class_year} className="rc-year-row">
                    <span className="cond">{item.class_year}</span>
                    <strong className="cond num">{item.rank ? `#${item.rank}` : '—'}</strong>
                    <span className="muted num">{pointsText(item.points)}</span>
                  </div>
                )) : <Empty>No ranking stored yet.</Empty>}
              </section>
            </div>
          </div>
        )}
    </>
  )
}

export function RankingsView({ filters, mobile }: { filters: RecruitingFilters; mobile: boolean }) {
  const { model, favorites, liveYear } = useApp()
  const { year, conference, mine, team } = filters
  const teams = useQuery({ queryKey: ['recruiting-teams', year], queryFn: () => fetchRecruitingTeams(year), staleTime: 10 * 60_000, enabled: !team })
  const previous = useQuery({ queryKey: ['recruiting-teams', year - 1], queryFn: () => fetchRecruitingTeams(year - 1), staleTime: 10 * 60_000, enabled: !team })
  const recruits = useQuery({ queryKey: ['recruits', year], queryFn: () => fetchRecruits(year), staleTime: 10 * 60_000, enabled: !team })
  const changes = useMemo(() => rankChanges(teams.data ?? [], previous.data ?? []), [teams.data, previous.data])

  const all = useMemo(() => (teams.data ?? [])
    .filter((row) => model.team(row.team_id))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.commits - a.commits || a.team_id - b.team_id), [teams.data, model])
  const rows = useMemo(() => all
    .filter((row) => !mine || favorites.has(row.team_id))
    .filter((row) => !conference || model.conferenceOf(row.team_id)?.id === conference.id), [all, mine, favorites, conference, model])

  const byConference = useMemo(() => {
    const groups = new Map<number, { name: string; points: number[] }>()
    for (const row of all) {
      const item = model.conferenceOf(row.team_id)
      if (!item || row.points === null) continue
      const entry = groups.get(item.id) ?? { name: confAbbr(item), points: [] }
      entry.points.push(row.points)
      groups.set(item.id, entry)
    }
    return [...groups.values()].map((entry) => ({ name: entry.name, value: entry.points.reduce((sum, value) => sum + value, 0) / entry.points.length })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [all, model])
  const best = useMemo(() => bestClassByPosition(recruits.data ?? [], model.fbsIds), [recruits.data, model])

  if (team) return <TeamClass team={team} filters={filters} />
  if (teams.error) return <ErrorBox message={(teams.error as Error).message} onRetry={() => void teams.refetch()} />
  if (teams.isPending) return <Loading label="Loading the class rankings…" />

  const cols: Array<Col<RecruitingTeamRow>> = [
    { key: 'rank', head: 'RANK', width: mobile ? '36px' : '52px', align: 'right', cell: (row) => <span className="cond num rc-rank">{row.rank ?? '—'}</span> },
    { key: 'team', head: 'TEAM', width: 'minmax(0, 1fr)', cell: (row) => <TeamBit team={model.team(row.team_id)!} /> },
    { key: 'points', head: 'POINTS', width: '70px', align: 'right', cell: (row) => <span className="num">{pointsText(row.points)}</span> },
    { key: 'commits', head: 'COMMITS', width: '70px', align: 'right', phone: false, cell: (row) => <span className="num">{row.commits}</span> },
    { key: 'rating', head: 'AVG RATING', width: '90px', align: 'right', phone: false, cell: (row) => <span className="num">{ratingText(row.average_rating)}</span> },
    { key: '5', head: '5★', width: '40px', align: 'right', phone: false, cell: (row) => <span className="num">{row.five_stars}</span> },
    { key: '4', head: '4★', width: '40px', align: 'right', phone: false, cell: (row) => <span className="num">{row.four_stars}</span> },
    { key: '3', head: '3★', width: '40px', align: 'right', phone: false, cell: (row) => <span className="num">{row.three_stars}</span> },
    { key: 'vs', head: `VS ${year - 1}`, width: '64px', align: 'right', cell: (row) => {
      const change = changes.get(row.team_id)
      return change === null || change === undefined ? <span className="muted">—</span>
        : <Movement current={row.rank ?? 0} previous={(row.rank ?? 0) + change} />
    } },
  ]
  const maxPoints = Math.max(1, ...byConference.map((item) => item.value))
  return (
    <div className="rc-split">
      <section className="tile">
        <header className="tile-head">
          <h2 className="cond">CLASS OF {year}</h2>
          <span className="muted small">{year >= liveYear + 1 ? 'Commits so far · updated every Monday' : 'Final class'}</span>
        </header>
        {rows.length ? <Grid cols={cols} rows={rows} rowKey={(row) => String(row.team_id)} limit={mobile ? 25 : 60} />
          : all.length ? <Empty>{mine && !favorites.size ? 'No favorite teams yet. Tap a star on a team to add one.' : 'No team matches the filter.'}</Empty>
            : <Empty>There is no team ranking for the class of {year} yet. CFBD publishes it once the class takes shape, and the Monday update picks it up then. {year > 2000 && <button type="button" className="tile-link rc-inline" onClick={() => filters.setYear(year - 1)}>Show the class of {year - 1}</button>}</Empty>}
      </section>
      {all.length > 0 && <div className="rc-side">
        <section className="tile">
          <header className="tile-head"><h2 className="cond">POINTS BY CONFERENCE</h2><span className="muted small">Average per team</span></header>
          {byConference.length ? byConference.map((item) => <MeterRow key={item.name} label={item.name} value={item.value} max={maxPoints} text={item.value.toFixed(1)} />) : <Empty>No points yet.</Empty>}
        </section>
        <section className="tile">
          <header className="tile-head"><h2 className="cond">BEST CLASS BY POSITION</h2><span className="muted small">Avg rating · min 2 commits</span></header>
          {recruits.isPending ? <Loading /> : POSITION_GROUPS.map((group) => {
            const entry = best.get(group)
            return (
              <div key={group} className="rc-best-row">
                <span className="cond rc-meter-label">{group}</span>
                <span className="grow truncate">{entry ? <SchoolBit team={model.team(entry.teamId)} /> : <span className="muted">—</span>}</span>
                <span className="cond num">{entry ? ratingText(entry.rating) : ''}</span>
              </div>
            )
          })}
        </section>
      </div>}
    </div>
  )
}
