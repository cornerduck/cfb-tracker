import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../app/context'
import { fetchPlayerCareer, fetchPlayerGames, fetchPlayerSeason } from '../data/queries'
import { abbr, teamColor } from '../data/model'
import type { PlayerGameStat, PlayerSeasonStat } from '../data/types'
import { statNumber } from '../shared/stats'
import { Empty, ErrorBox, Loading, Plate, Tabs, imageUrl } from '../shared/ui'
import { WindowFrame } from './WindowFrame'
import { gameText } from '../shared/gameText'
import { nextLine } from '../features/home/Home'

const SEASON_COLUMNS: Record<string, string[]> = {
  passing: ['COMPLETIONS', 'ATT', 'PCT', 'YDS', 'YPA', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'YPC', 'TD', 'LONG'],
  receiving: ['REC', 'YDS', 'YPR', 'TD', 'LONG'],
  defensive: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HUR'],
  interceptions: ['INT', 'YDS', 'TD'],
  kicking: ['FGM', 'FGA', 'PCT', 'LONG', 'XPM', 'PTS'],
  punting: ['NO', 'YDS', 'YPP', 'LONG'],
}

const DEFAULT_ORDER = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'punting']

// The category that matters most for a position. It decides the chart, the
// order of the game log lines and the order of the season tables.
function focusCategory(position: string, available: string[]) {
  const pos = position.toUpperCase()
  let wanted: string | null = null
  if (pos === 'QB') wanted = 'passing'
  else if (['RB', 'FB', 'HB'].includes(pos)) wanted = 'rushing'
  else if (['WR', 'TE'].includes(pos)) wanted = 'receiving'
  else if (['K', 'PK'].includes(pos)) wanted = 'kicking'
  else if (pos === 'P') wanted = 'punting'
  else if (pos) wanted = 'defensive'
  if (wanted && available.includes(wanted)) return wanted
  return DEFAULT_ORDER.find((category) => available.includes(category)) ?? 'passing'
}

const orderedCategories = (focus: string) => [focus, ...DEFAULT_ORDER.filter((category) => category !== focus)]

type CareerColumn = { label: string; sum?: string; max?: string; calc?: (totals: Record<string, number>) => number | null; digits?: number }
const ratio = (a: number, b: number, scale = 1) => (b ? (a / b) * scale : null)
const CAREER_COLUMNS: Record<string, CareerColumn[]> = {
  passing: [
    { label: 'CMP', sum: 'COMPLETIONS' }, { label: 'ATT', sum: 'ATT' },
    { label: 'PCT', calc: (t) => ratio(t.COMPLETIONS, t.ATT, 100), digits: 1 },
    { label: 'YDS', sum: 'YDS' }, { label: 'YPA', calc: (t) => ratio(t.YDS, t.ATT), digits: 1 },
    { label: 'TD', sum: 'TD' }, { label: 'INT', sum: 'INT' },
  ],
  rushing: [
    { label: 'CAR', sum: 'CAR' }, { label: 'YDS', sum: 'YDS' },
    { label: 'YPC', calc: (t) => ratio(t.YDS, t.CAR), digits: 1 },
    { label: 'TD', sum: 'TD' }, { label: 'LONG', max: 'LONG' },
  ],
  receiving: [
    { label: 'REC', sum: 'REC' }, { label: 'YDS', sum: 'YDS' },
    { label: 'YPR', calc: (t) => ratio(t.YDS, t.REC), digits: 1 },
    { label: 'TD', sum: 'TD' }, { label: 'LONG', max: 'LONG' },
  ],
  defensive: [
    { label: 'TOT', sum: 'TOT' }, { label: 'SOLO', sum: 'SOLO' }, { label: 'SACKS', sum: 'SACKS' },
    { label: 'TFL', sum: 'TFL' }, { label: 'PD', sum: 'PD' }, { label: 'QB HUR', sum: 'QB HUR' },
  ],
  interceptions: [{ label: 'INT', sum: 'INT' }, { label: 'YDS', sum: 'YDS' }, { label: 'TD', sum: 'TD' }],
  kicking: [
    { label: 'FGM', sum: 'FGM' }, { label: 'FGA', sum: 'FGA' },
    { label: 'PCT', calc: (t) => ratio(t.FGM, t.FGA, 100), digits: 1 },
    { label: 'LONG', max: 'LONG' }, { label: 'XPM', sum: 'XPM' }, { label: 'PTS', sum: 'PTS' },
  ],
  punting: [{ label: 'NO', sum: 'NO' }, { label: 'YDS', sum: 'YDS' }, { label: 'LONG', max: 'LONG' }],
}

const columnValue = (column: CareerColumn, stats: Record<string, unknown>) => {
  if (column.sum) return statNumber(stats, column.sum)
  if (column.max) return statNumber(stats, column.max)
  const totals: Record<string, number> = {}
  for (const key of Object.keys(stats)) totals[key] = statNumber(stats, key)
  return column.calc ? column.calc(totals) : null
}
const show = (value: number | null, digits = 0) => (value === null || !Number.isFinite(value) ? '–' : digits ? value.toFixed(digits) : Math.round(value).toLocaleString('en-US'))

function CareerTable({ category, rows }: { category: string; rows: PlayerSeasonStat[] }) {
  const { model } = useApp()
  const columns = CAREER_COLUMNS[category]
  if (!columns || !rows.length) return null
  const totals: Record<string, number> = {}
  for (const row of rows) {
    for (const column of columns) {
      if (column.sum) totals[column.sum] = (totals[column.sum] ?? 0) + statNumber(row.stats, column.sum)
      if (column.max) totals[column.max] = Math.max(totals[column.max] ?? 0, statNumber(row.stats, column.max))
    }
  }
  const careerCell = (column: CareerColumn) => (column.calc ? column.calc(totals) : totals[column.sum ?? column.max ?? ''] ?? null)
  return (
    <table className="stat-table career-table">
      <caption className="cond">{category.toUpperCase()}</caption>
      <thead><tr><th className="cond">YEAR</th><th className="cond">TEAM</th>{columns.map((column) => <th key={column.label} className="cond num">{column.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.season}>
            <td className="num">{row.season}</td>
            <td className="cond">{abbr(model.team(row.team_id))}</td>
            {columns.map((column) => <td key={column.label} className="num">{show(columnValue(column, row.stats), column.digits)}</td>)}
          </tr>
        ))}
        {rows.length > 1 && (
          <tr className="career-total">
            <td className="cond">CAREER</td><td />
            {columns.map((column) => <td key={column.label} className="num strong">{show(careerCell(column), column.digits)}</td>)}
          </tr>
        )}
      </tbody>
    </table>
  )
}

export function PlayerWindow({ playerId, name, teamId }: { playerId: string; name?: string; teamId?: number | null }) {
  const { model, timeZone, openWindow, closeWindow } = useApp()
  const [tab, setTab] = useState<'SEASON' | 'CAREER'>('SEASON')
  const season = useQuery({ queryKey: ['player-season', model.year, playerId], queryFn: () => fetchPlayerSeason(model.year, [playerId]), staleTime: 10 * 60_000 })
  const games = useQuery({ queryKey: ['player-games', playerId], queryFn: () => fetchPlayerGames(playerId), staleTime: 10 * 60_000 })
  const career = useQuery({ queryKey: ['player-career', playerId], queryFn: () => fetchPlayerCareer(playerId), enabled: tab === 'CAREER', staleTime: 10 * 60_000 })

  const seasonRows = season.data ?? []
  const gameRows = useMemo(() => (games.data ?? []).filter((row) => model.gameById.has(row.game_id)), [games.data, model])
  const playerName = name || seasonRows[0]?.player_name || gameRows[0]?.player_name || 'Player'
  const team = model.team(teamId ?? seasonRows[0]?.team_id ?? gameRows[0]?.team_id)
  const position = seasonRows.find((row) => row.position)?.position ?? career.data?.find((row) => row.position)?.position ?? ''
  const photo = imageUrl('players', playerId, ['png', 'jpg', 'jpeg', 'webp'])

  const byGame = new Map<number, PlayerGameStat[]>()
  for (const row of gameRows) byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row])
  const log = [...byGame.entries()].map(([gameId, rows]) => ({ game: model.gameById.get(gameId)!, rows }))
    .sort((a, b) => Date.parse(a.game.start_time ?? '') - Date.parse(b.game.start_time ?? ''))

  const available = [...new Set([...seasonRows.map((row) => row.category), ...gameRows.map((row) => row.category)])]
  const focus = focusCategory(position, available)
  const order = orderedCategories(focus)
  const rank = (category: string) => { const index = order.indexOf(category); return index < 0 ? order.length : index }
  const chartKey = focus === 'defensive' ? 'TOT' : focus === 'kicking' ? 'PTS' : 'YDS'
  const chartTitle = focus === 'defensive' ? 'TACKLES' : focus === 'kicking' ? 'POINTS' : focus.toUpperCase()
  const chart = log.map((entry) => ({ entry, value: statNumber(entry.rows.find((row) => row.category === focus)?.stats, chartKey) }))
  const max = Math.max(1, ...chart.map((item) => item.value))
  const ranked = model.bundle.heismanTracker.find((row) => row.player_id === playerId)

  // One line per game, always in the same order for a position.
  const lineFor = (rows: PlayerGameStat[]) => [...rows].sort((a, b) => rank(a.category) - rank(b.category)).map((row) => {
    const stats = row.stats
    if (row.category === 'passing') return `${stats['C/ATT']} · ${stats.YDS} yds · ${stats.TD} TD · ${stats.INT} INT`
    if (row.category === 'rushing') return `${stats.CAR} car · ${stats.YDS} yds · ${stats.TD} TD`
    if (row.category === 'receiving') return `${stats.REC} rec · ${stats.YDS} yds · ${stats.TD} TD`
    if (row.category === 'defensive') return `${stats.TOT} tkl${statNumber(stats, 'SACKS') ? ` · ${stats.SACKS} sacks` : ''}`
    if (row.category === 'kicking') return `${stats.FG ?? '–'} FG · ${stats.XP ?? '–'} XP · ${stats.PTS ?? 0} pts`
    if (row.category === 'punting') return `${stats.NO ?? 0} punts · ${stats.YDS ?? 0} yds`
    return null
  }).filter(Boolean).join(' · ')

  const careerByCategory = useMemo(() => {
    const grouped = new Map<string, PlayerSeasonStat[]>()
    for (const row of career.data ?? []) grouped.set(row.category, [...(grouped.get(row.category) ?? []), row])
    return grouped
  }, [career.data])

  return (
    <WindowFrame className="player-window" onClose={closeWindow}>
      <div className="player-hero" style={{ background: `linear-gradient(90deg, ${teamColor(team)}55, transparent 70%)` }}>
        {photo
          ? <span className="player-photo" style={{ background: `url(${photo}) center top / cover no-repeat, linear-gradient(to bottom, ${teamColor(team)}, ${teamColor(team)}99)` }} />
          : <Plate team={team} size={84} />}
        <div>
          <h2 className="cond">{playerName.toUpperCase()}</h2>
          <p className="muted">{[position, team?.school, model.year].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="grow" />
        {ranked && <div className="player-score"><span className="muted small cond">HEISMAN TRACKER</span><strong className="cond num">#{ranked.rank} · {(ranked.score * 100).toFixed(1)}</strong></div>}
      </div>
      <Tabs items={['SEASON', 'CAREER'] as const} value={tab} onChange={setTab} />
      <div className="window-scroll">
        {season.error || games.error ? <ErrorBox message={((season.error ?? games.error) as Error).message} /> : season.isLoading || games.isLoading ? <Loading /> : (
          <>
            {tab === 'CAREER' ? (
              career.error ? <ErrorBox message={(career.error as Error).message} /> : career.isLoading ? <Loading /> : (
                <div className="season-tables">
                  {order.filter((category) => careerByCategory.has(category)).map((category) => <CareerTable key={category} category={category} rows={careerByCategory.get(category)!} />)}
                  {!careerByCategory.size && <Empty>No career statistics stored yet.</Empty>}
                  {careerByCategory.size > 0 && <p className="muted small">Shows every season stored in STRDYS, not necessarily the whole college career.</p>}
                </div>
              )
            ) : (
              <>
                <div className="season-tables">
                  {seasonRows.length ? order.filter((category) => SEASON_COLUMNS[category]).map((category) => {
                    const row = seasonRows.find((item) => item.category === category)
                    if (!row) return null
                    const present = SEASON_COLUMNS[category].filter((column) => row.stats[column] !== undefined)
                    if (!present.length) return null
                    return (
                      <table key={category} className="stat-table">
                        <caption className="cond">{category.toUpperCase()}</caption>
                        <thead><tr>{present.map((column) => <th key={column} className="cond num">{column === 'COMPLETIONS' ? 'CMP' : column}</th>)}</tr></thead>
                        <tbody><tr>{present.map((column) => <td key={column} className="num">{row.stats[column]}</td>)}</tr></tbody>
                      </table>
                    )
                  }) : <Empty>Season statistics arrive with the Monday update.</Empty>}
                </div>
                {chart.length > 0 && (
                  <div className="chart-box">
                    <h3 className="cond">{chartTitle} BY GAME</h3>
                    <div className="bar-chart">
                      {chart.map(({ entry, value }) => (
                        <button key={entry.game.id} type="button" className="bar" title={`${value}`} onClick={() => openWindow({ type: 'game', gameId: entry.game.id })}>
                          <span className="bar-value num small">{value}</span>
                          <span className="bar-fill" style={{ height: `${(value / max) * 100}%`, background: teamColor(team) }} />
                          <span className="bar-label cond small">{abbr(model.team(entry.game.home_team_id === entry.rows[0].team_id ? entry.game.away_team_id : entry.game.home_team_id))}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {team && nextLine(model, team.id, timeZone) && <p className="next-game"><span className="cond muted">NEXT GAME</span> {nextLine(model, team.id, timeZone)}</p>}
                <h3 className="cond">GAME LOG</h3>
                {log.length ? [...log].reverse().map((entry) => {
                  const text = gameText(model, entry.rows[0].team_id, entry.game, true)
                  return (
                    <button key={entry.game.id} type="button" className="log-row" onClick={() => openWindow({ type: 'game', gameId: entry.game.id })}>
                      <span className="cond muted log-week">{model.periodByKey.get(model.periodKeyOf(entry.game))?.short}</span>
                      <span className={text.outcome === 'W' ? 'win' : text.outcome === 'L' ? 'loss' : ''}>{text.outcome}</span>
                      <span className="grow truncate">{text.text}</span>
                      <span className="num secondary small">{lineFor(entry.rows)}</span>
                    </button>
                  )
                }) : <Empty>No games yet.</Empty>}
              </>
            )}
          </>
        )}
      </div>
    </WindowFrame>
  )
}
