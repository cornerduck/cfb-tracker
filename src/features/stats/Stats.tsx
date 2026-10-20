import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { fetchPlayerSeason, fetchPlayerSeasonCategory, fetchTeamSeasonStats } from '../../data/queries'
import { confAbbr, recordText, teamColor } from '../../data/model'
import type { HeismanRow, PlayerSeasonStat } from '../../data/types'
import { playerLine } from '../../shared/stats'
import { ConfTag, Empty, ErrorBox, Loading, Movement, Pills, Plate, PlayerAvatar, Tabs, Tile } from '../../shared/ui'
import { BOARDS, LEADERS, formatValue, indexPlayers, leaderOf, type PlayerEntry } from './playerStats'
import { METRICS, buildTeamStats, formatMetric } from './teamStats'

const VIEWS = ['PLAYERS', 'TEAMS', 'HEISMAN TRACKER'] as const
type View = typeof VIEWS[number]
const VIEW_PARAM: Record<View, string> = { PLAYERS: 'players', TEAMS: 'teams', 'HEISMAN TRACKER': 'heisman' }

const ALL_CATEGORIES = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'kickReturns', 'puntReturns']

export function useSeasonPlayers(year: number) {
  const queries = useQueries({
    queries: ALL_CATEGORIES.map((category) => ({
      queryKey: ['player-season-category', year, category],
      queryFn: () => fetchPlayerSeasonCategory(year, category),
      staleTime: 30 * 60_000,
    })),
  })
  const pending = queries.some((query) => query.isPending)
  const error = queries.find((query) => query.error)?.error as Error | undefined
  const dataKey = queries.map((query) => query.dataUpdatedAt).join(',')
  const players = useMemo(() => {
    if (pending) return null
    return indexPlayers(queries.flatMap((query) => query.data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, dataKey])
  return { players, error, retry: () => queries.forEach((query) => void query.refetch()) }
}

export function useTeamStats() {
  const { model } = useApp()
  const query = useQuery({ queryKey: ['team-season-stats', model.year], queryFn: () => fetchTeamSeasonStats(model.year), staleTime: 30 * 60_000 })
  const lines = useMemo(() => (query.data ? buildTeamStats(model, query.data) : null), [model, query.data])
  return { lines, error: query.error as Error | null, retry: () => void query.refetch() }
}

function ConferenceSelect({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const conferences = useApp().model.conferenceList()
  return (
    <select className="select cond" aria-label="Conference" value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">ALL CONFERENCES</option>
      {conferences.map((conference) => <option key={conference.id} value={conference.id}>{confAbbr(conference)}</option>)}
    </select>
  )
}

function Players() {
  const { model, openWindow, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const board = BOARDS.find((item) => item.key === params.get('board')) ?? BOARDS[0]
  const setBoard = (label: string) => {
    const next = BOARDS.find((item) => item.label === label)!
    setParams({ view: 'players', board: next.key }, { replace: true })
  }
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null)
  const [conferenceId, setConferenceId] = useState<number | null>(null)
  const [teamId, setTeamId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const { players, error, retry } = useSeasonPlayers(model.year)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => { setSort(null); setLimit(50) }, [board.key, conferenceId, teamId, query])

  const sortKey = sort?.key ?? board.sort
  const column = board.columns.find((item) => item.key === sortKey) ?? board.columns[0]
  const rows = useMemo(() => {
    if (!players) return []
    const needle = query.trim().toLowerCase()
    const games = (player: PlayerEntry) => (player.teamId ? model.resultsThrough(player.teamId).length : 0)
    return [...players.values()]
      .filter((player) => board.include(player))
      .filter((player) => player.teamId === null || model.fbsIds.has(player.teamId))
      .filter((player) => !conferenceId || (player.teamId !== null && model.teamSeasons.get(player.teamId)?.conference_id === conferenceId))
      .filter((player) => !teamId || player.teamId === teamId)
      .filter((player) => !needle || player.name.toLowerCase().includes(needle))
      .filter((player) => !column.rate || !board.qualifier || board.qualifier.value(player) >= board.qualifier.perGame * games(player))
      .map((player) => ({ player, value: column.value(player) }))
      .filter((row) => row.value !== null)
      .sort((a, b) => (sort?.asc ? 1 : -1) * ((a.value as number) - (b.value as number)))
  }, [players, board, column, conferenceId, teamId, query, sort, model])

  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + 50)
    }, { rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [rows.length])

  const teams = (conferenceId ? model.teamsIn(conferenceId) : [...model.fbsIds]).map((id) => model.team(id)!).filter(Boolean).sort((a, b) => a.school.localeCompare(b.school))
  const visibleColumns = mobile ? board.columns.filter((item) => item.key === sortKey || item.key === board.sort || ['TD', 'INT', 'RTG', 'AVG'].includes(item.key)).slice(0, 3) : board.columns

  const table = (
    <section className="tile stat-board">
      {error ? <ErrorBox message={error.message} onRetry={retry} /> : !players ? <Loading label="Loading player statistics…" /> : (
        <div className={mobile ? '' : 'scroll-y stat-scroll'}>
          <table className="stat-table-big">
            <thead>
              <tr>
                <th className="rk">RK</th>
                <th className="player-col">PLAYER</th>
                {!mobile && <th>CONF</th>}
                {visibleColumns.map((item) => (
                  <th key={item.key} className={item.key === sortKey ? 'sorted' : ''}>
                    <button type="button" className="cond" onClick={() => setSort({ key: item.key, asc: item.key === sortKey ? !sort?.asc : false })}>
                      {item.label}{item.key === sortKey ? (sort?.asc ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map(({ player }, index) => {
                const team = model.team(player.teamId)
                const conference = player.teamId ? model.conferenceOf(player.teamId) : null
                const rank = index > 0 && column.value(rows[index - 1].player) === column.value(player) ? null : index + 1
                return (
                  <tr key={player.id} onClick={() => openWindow({ type: 'player', playerId: player.id, name: player.name, teamId: player.teamId })}>
                    <td className="rk num">{rank ?? ''}</td>
                    <td className="player-col">
                      <span className="player-cell">
                        <PlayerAvatar playerId={player.id} team={team} size={30} />
                        <span className="player-copy"><strong className="truncate">{player.name}</strong><small className="muted truncate">{[team?.school, player.position].filter(Boolean).join(' · ')}</small></span>
                      </span>
                    </td>
                    {!mobile && <td>{conference && <ConfTag code={confAbbr(conference)} />}</td>}
                    {visibleColumns.map((item) => <td key={item.key} className={`num${item.key === sortKey ? ' sorted' : ''}`}>{formatValue(item.value(player), item.digits)}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <Empty>No players match these filters yet.</Empty>}
          {rows.length > limit && <div ref={sentinel} className="sentinel"><Loading label="Loading more…" /></div>}
        </div>
      )}
    </section>
  )

  const leaders = (
    <aside className="side-stack scroll-y">
      <Tile title="NATIONAL LEADERS">
        {players ? LEADERS.map((item) => {
          const best = leaderOf([...players.values()].filter((player) => player.teamId !== null && model.fbsIds.has(player.teamId)), item.category, item.key)
          if (!best) return null
          const team = model.team(best.player.teamId)
          return (
            <button key={item.label} type="button" className="leader-row" onClick={() => openWindow({ type: 'player', playerId: best.player.id, name: best.player.name, teamId: best.player.teamId })}>
              <PlayerAvatar playerId={best.player.id} team={team} size={30} />
              <span className="grow leader-copy"><small className="cond muted">{item.label}</small><span className="truncate">{best.player.name} · {team?.school}</span></span>
              <strong className="cond num">{formatValue(best.value, item.digits)}</strong>
            </button>
          )
        }) : <Loading />}
      </Tile>
      <Tile title="QUALIFYING">
        <p className="muted small">Percentages and averages only rank players with enough volume per team game: 15 pass attempts, 6.25 carries, 1.875 receptions, 0.75 field goal attempts or 1.2 returns. Totals like yards and touchdowns have no minimum.</p>
      </Tile>
    </aside>
  )

  return (
    <>
      <div className="filter-row">
        <Pills items={BOARDS.map((item) => item.label)} value={board.label} onChange={setBoard} />
        <span className="grow" />
        <input className="text-input" placeholder="Find a player" aria-label="Find a player" value={query} onChange={(event) => setQuery(event.target.value)} />
        <ConferenceSelect value={conferenceId} onChange={(value) => { setConferenceId(value); setTeamId(null) }} />
        <select className="select cond" aria-label="Team" value={teamId ?? ''} onChange={(event) => setTeamId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">ALL TEAMS</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.school.toUpperCase()}</option>)}
        </select>
      </div>
      {mobile ? <div className="stats-mobile">{table}{leaders}</div> : <div className="rankings-layout">{table}{leaders}</div>}
    </>
  )
}

const TEAM_GROUPS = {
  OFFENSE: ['ppg', 'ypg', 'pass', 'rush', 'ypp', 'third', 'margin'],
  DEFENSE: ['papg', 'yapg', 'passA', 'rushA', 'sacks', 'takeaways', 'thirdA'],
  'SPECIAL TEAMS': ['kr', 'pr', 'retTd', 'pen', 'penYds'],
} as const
type TeamGroup = keyof typeof TEAM_GROUPS

const TEAM_LEADERS: Array<{ label: string; metric: string }> = [
  { label: 'SCORING OFFENSE', metric: 'ppg' },
  { label: 'SCORING DEFENSE', metric: 'papg' },
  { label: 'TOTAL OFFENSE', metric: 'ypg' },
  { label: 'TOTAL DEFENSE', metric: 'yapg' },
  { label: 'TURNOVER MARGIN', metric: 'margin' },
  { label: 'SACKS', metric: 'sacks' },
]

function Teams() {
  const { model, mobile } = useApp()
  const navigate = useNavigate()
  const [group, setGroup] = useState<TeamGroup>('OFFENSE')
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null)
  const [conferenceId, setConferenceId] = useState<number | null>(null)
  const { lines, error, retry } = useTeamStats()
  const metrics = TEAM_GROUPS[group].map((key) => METRICS[key])
  const sortKey = sort?.key ?? metrics[0].key
  const sortMetric = METRICS[sortKey]
  const rows = useMemo(() => {
    if (!lines) return []
    const direction = sort ? (sort.asc ? 1 : -1) : (sortMetric.lowerBetter ? 1 : -1)
    return [...lines.values()]
      .filter((line) => !conferenceId || model.teamSeasons.get(line.teamId)?.conference_id === conferenceId)
      .filter((line) => line.values[sortKey] !== null)
      .sort((a, b) => direction * ((a.values[sortKey] as number) - (b.values[sortKey] as number)))
  }, [lines, sort, sortKey, sortMetric, conferenceId, model])
  const visible = mobile ? metrics.filter((metric) => metric.key === sortKey || metric.key === metrics[0].key || metric.key === metrics[1].key).slice(0, 3) : metrics

  const table = (
    <section className="tile stat-board">
      {error ? <ErrorBox message={error.message} onRetry={retry} /> : !lines ? <Loading label="Loading team statistics…" /> : (
        <div className={mobile ? '' : 'scroll-y stat-scroll'}>
          <table className="stat-table-big">
            <thead>
              <tr>
                <th className="rk">RK</th>
                <th className="player-col">TEAM</th>
                {!mobile && <th>CONF</th>}
                {visible.map((metric) => (
                  <th key={metric.key} className={metric.key === sortKey ? 'sorted' : ''}>
                    <button type="button" className="cond" onClick={() => setSort({ key: metric.key, asc: metric.key === sortKey ? !(sort?.asc ?? metric.lowerBetter) : Boolean(metric.lowerBetter) })}>
                      {metric.short}{metric.key === sortKey ? ((sort?.asc ?? sortMetric.lowerBetter) ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((line, index) => {
                const team = model.team(line.teamId)
                const conference = model.conferenceOf(line.teamId)
                return (
                  <tr key={line.teamId} onClick={() => team && navigate(`/teams/${team.slug}?tab=stats`)}>
                    <td className="rk num">{index + 1}</td>
                    <td className="player-col"><span className="player-cell"><Plate team={team} size={26} /><strong className="truncate">{team?.school}</strong></span></td>
                    {!mobile && <td>{conference && <ConfTag code={confAbbr(conference)} />}</td>}
                    {visible.map((metric) => <td key={metric.key} className={`num${metric.key === sortKey ? ' sorted' : ''}`}>{formatMetric(metric, line.values[metric.key])}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <Empty>Team statistics appear after the first weekly update.</Empty>}
        </div>
      )}
    </section>
  )
  const leaders = (
    <aside className="side-stack scroll-y">
      <Tile title="TEAM LEADERS">
        {lines ? TEAM_LEADERS.map((item) => {
          const metric = METRICS[item.metric]
          const best = [...lines.values()].find((line) => line.ranks[item.metric] === 1)
          if (!best) return null
          const team = model.team(best.teamId)
          return (
            <button key={item.label} type="button" className="leader-row" onClick={() => team && navigate(`/teams/${team.slug}?tab=stats`)}>
              <Plate team={team} size={26} />
              <span className="grow leader-copy"><small className="cond muted">{item.label}</small><span className="truncate">{team?.school}</span></span>
              <strong className="cond num">{formatMetric(metric, best.values[item.metric])}</strong>
            </button>
          )
        }) : <Loading />}
      </Tile>
    </aside>
  )
  return (
    <>
      <div className="filter-row">
        <Pills items={Object.keys(TEAM_GROUPS) as TeamGroup[]} value={group} onChange={(value) => { setGroup(value); setSort(null) }} />
        <span className="grow" />
        <ConferenceSelect value={conferenceId} onChange={setConferenceId} />
      </div>
      {mobile ? <div className="stats-mobile">{table}{leaders}</div> : <div className="rankings-layout">{table}{leaders}</div>}
    </>
  )
}

export function playerStatLine(rows: PlayerSeasonStat[], playerId: string) {
  const own = rows.filter((row) => row.player_id === playerId)
  const position = own.find((row) => row.position)?.position ?? ''
  const line: Record<string, number> = {}
  for (const row of own) {
    const stats = row.stats as Record<string, number>
    if (row.category === 'passing') Object.assign(line, { pass_yds: stats.YDS, pass_td: stats.TD, int: stats.INT })
    if (row.category === 'rushing') Object.assign(line, { rush_yds: stats.YDS, rush_td: stats.TD })
    if (row.category === 'receiving') Object.assign(line, { rec: stats.REC, rec_yds: stats.YDS, rec_td: stats.TD })
    if (row.category === 'defensive') Object.assign(line, { tackles: stats.TOT, sacks: stats.SACKS })
    if (row.category === 'interceptions') Object.assign(line, { def_int: stats.INT })
  }
  return { position, text: playerLine('', line) }
}

function Heisman() {
  const { model, period, openWindow, mobile } = useApp()
  const week = period ? model.awardWeekFor(period) : 0
  const weeks = useMemo(() => [...new Set(model.bundle.heismanWeekly.map((row) => row.week ?? 0))].sort((a, b) => a - b), [model])
  const shownWeek = weeks.filter((item) => item <= week).at(-1) ?? null
  const byWeek = (value: number | null) => model.bundle.heismanWeekly.filter((row) => row.week === value).sort((a, b) => a.rank - b.rank)
  const current: HeismanRow[] = shownWeek !== null ? byWeek(shownWeek) : [...model.bundle.heismanTracker].sort((a, b) => a.rank - b.rank)
  const previousWeek = shownWeek !== null ? weeks.filter((item) => item < shownWeek).at(-1) ?? null : null
  const previous = new Map(byWeek(previousWeek).map((row) => [row.player_id, row.rank]))
  const top10 = current.slice(0, 10)
  const ids = top10.map((row) => row.player_id)
  const stats = useQuery({ queryKey: ['player-season', model.year, ids.join(',')], queryFn: () => fetchPlayerSeason(model.year, ids), enabled: ids.length > 0, staleTime: 10 * 60_000 })
  const weekLabel = (value: number) => (value > model.lastRegularWeek ? 'the postseason' : `week ${value}`)

  const field = useMemo(() => {
    const entries = new Map<string, { row: HeismanRow; peak: number; weeks: number; last: number }>()
    for (const row of model.bundle.heismanWeekly) {
      if (shownWeek === null || (row.week ?? 0) > shownWeek || row.rank > 10) continue
      const entry = entries.get(row.player_id) ?? { row, peak: row.rank, weeks: 0, last: row.week ?? 0 }
      entry.peak = Math.min(entry.peak, row.rank)
      entry.weeks += 1
      if ((row.week ?? 0) >= entry.last) { entry.last = row.week ?? 0; entry.row = row }
      entries.set(row.player_id, entry)
    }
    const now = new Map(top10.map((row) => [row.player_id, row.rank]))
    return [...entries.values()].sort((a, b) => (now.get(a.row.player_id) ?? 99) - (now.get(b.row.player_id) ?? 99) || a.peak - b.peak || b.weeks - a.weeks)
      .map((entry) => ({ ...entry, now: now.get(entry.row.player_id) ?? null }))
  }, [model, shownWeek, top10])

  if (!top10.length) return <Empty>The Heisman tracker starts after the first week of games.</Empty>
  const maxScore = Math.max(...top10.map((row) => row.score), 0.0001)

  const list = (
    <Tile title={`TOP 10 · ${shownWeek !== null ? `AFTER ${weekLabel(shownWeek).toUpperCase()}` : 'LATEST'}`} className={`heisman-board${mobile ? '' : ' scroll-y'}`}>
      {top10.map((row) => {
        const team = model.team(row.team_id)
        const line = playerStatLine(stats.data ?? [], row.player_id)
        return (
          <button key={row.player_id} type="button" className={`ht-row${row.rank === 1 ? ' first' : ''}`} onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
            <span className="cond num ht-rank">{row.rank}</span>
            <Movement current={row.rank} previous={previous.get(row.player_id) ?? null} isNew={previousWeek !== null && !previous.has(row.player_id)} />
            <PlayerAvatar playerId={row.player_id} team={team} size={38} />
            <span className="ht-copy">
              <strong className="cond truncate">{row.player_name}</strong>
              <small className="muted truncate">{[line.position, team?.school, team && recordText(model.record(team.id))].filter(Boolean).join(' · ')}</small>
            </span>
            {!mobile && <span className="muted small ht-line truncate">{line.text}</span>}
            {!mobile && <span className="ht-bar"><span style={{ width: `${(row.score / maxScore) * 100}%`, background: `linear-gradient(90deg, var(--text) 70%, ${teamColor(team)} 70%)` }} /></span>}
            <strong className="cond num ht-score">{(row.score * 100).toFixed(1)}</strong>
          </button>
        )
      })}
    </Tile>
  )
  const side = (
    <Tile title="SEASON FIELD" className={mobile ? '' : 'scroll-y'}>
      <p className="muted small">Everyone who has been in the top 10 this season</p>
      <div className="field-row field-head cond"><span>PLAYER</span><span>PEAK</span><span>WKS</span><span>NOW</span></div>
      {field.map((entry) => {
        const team = model.team(entry.row.team_id)
        return (
          <button key={entry.row.player_id} type="button" className="field-row" onClick={() => openWindow({ type: 'player', playerId: entry.row.player_id, name: entry.row.player_name, teamId: entry.row.team_id })}>
            <span className="field-player"><PlayerAvatar playerId={entry.row.player_id} team={team} size={22} /><span className="truncate">{entry.row.player_name} · {team?.school}</span></span>
            <strong className="cond num">#{entry.peak}</strong>
            <span className="muted num">{entry.weeks}</span>
            {entry.now ? <strong className="cond num">#{entry.now}</strong> : <span className="muted small cond">OUT WK {entry.last + 1 > model.lastRegularWeek ? 'POST' : entry.last + 1}</span>}
          </button>
        )
      })}
    </Tile>
  )
  return mobile ? <div className="stats-mobile">{list}{side}</div> : <div className="heisman-layout">{list}{side}</div>
}

export function Stats() {
  const { model, currentPeriod: period, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const view = (Object.keys(VIEW_PARAM) as View[]).find((item) => VIEW_PARAM[item] === params.get('view')) ?? 'PLAYERS'
  const setView = (next: View) => setParams({ view: VIEW_PARAM[next] }, { replace: true })
  const through = period ? (period.kind === 'week' ? `through week ${period.week}` : `through ${period.label.toLowerCase()}`) : ''
  return (
    <div className="stats">
      <div className="page-head page-head--tabs">
        <h1 className="cond">STATS</h1>
        <Tabs items={VIEWS} value={view} onChange={setView} labels={mobile ? { 'HEISMAN TRACKER': 'HEISMAN' } : undefined} />
        <span className="grow" />
        {!mobile && <span className="muted small">{view === 'HEISMAN TRACKER' ? 'Stat-based · updated every Monday' : `${model.year} season · ${through}`}</span>}
      </div>
      {view === 'PLAYERS' ? <Players /> : view === 'TEAMS' ? <Teams /> : <Heisman />}
    </div>
  )
}
