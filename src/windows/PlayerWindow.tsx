import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../app/context'
import { fetchPlayerGames, fetchPlayerSeason } from '../data/queries'
import { abbr, teamColor } from '../data/model'
import type { PlayerGameStat } from '../data/types'
import { dayMonth } from '../shared/format'
import { statNumber } from '../shared/stats'
import { Empty, ErrorBox, Loading, Tabs, imageUrl } from '../shared/ui'
import { WindowFrame } from './WindowFrame'
import { gameText } from '../features/rankings/Rankings'
import { nextLine } from '../features/home/Home'

const SEASON_COLUMNS: Record<string, string[]> = {
  passing: ['COMPLETIONS', 'ATT', 'PCT', 'YDS', 'YPA', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'YPC', 'TD', 'LONG'],
  receiving: ['REC', 'YDS', 'YPR', 'TD', 'LONG'],
  defensive: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HUR'],
  interceptions: ['INT', 'YDS', 'TD'],
}

export function PlayerWindow({ playerId, name, teamId }: { playerId: string; name?: string; teamId?: number | null }) {
  const { model, timeZone, openWindow, closeWindow } = useApp()
  const [tab, setTab] = useState<'THIS WEEK' | 'SEASON'>('SEASON')
  const season = useQuery({ queryKey: ['player-season', model.year, playerId], queryFn: () => fetchPlayerSeason(model.year, [playerId]), staleTime: 10 * 60_000 })
  const games = useQuery({ queryKey: ['player-games', playerId], queryFn: () => fetchPlayerGames(playerId), staleTime: 10 * 60_000 })

  const seasonRows = season.data ?? []
  const gameRows = useMemo(() => (games.data ?? []).filter((row) => model.gameById.has(row.game_id)), [games.data, model])
  const playerName = name || seasonRows[0]?.player_name || gameRows[0]?.player_name || 'Player'
  const team = model.team(teamId ?? seasonRows[0]?.team_id ?? gameRows[0]?.team_id)
  const position = seasonRows.find((row) => row.position)?.position ?? ''
  const photo = imageUrl('players', playerId, ['jpg', 'jpeg', 'webp', 'png'])

  const byGame = new Map<number, PlayerGameStat[]>()
  for (const row of gameRows) byGame.set(row.game_id, [...(byGame.get(row.game_id) ?? []), row])
  const log = [...byGame.entries()].map(([gameId, rows]) => ({ game: model.gameById.get(gameId)!, rows }))
    .sort((a, b) => Date.parse(a.game.start_time ?? '') - Date.parse(b.game.start_time ?? ''))
  const main = (['passing', 'rushing', 'receiving', 'defensive'] as const).find((category) => gameRows.some((row) => row.category === category)) ?? 'passing'
  const chartKey = main === 'defensive' ? 'TOT' : 'YDS'
  const chart = log.map((entry) => ({ entry, value: statNumber(entry.rows.find((row) => row.category === main)?.stats, chartKey) }))
  const max = Math.max(1, ...chart.map((item) => item.value))
  const latest = log.at(-1)
  const ranked = model.bundle.heismanTracker.find((row) => row.player_id === playerId)

  const lineFor = (rows: PlayerGameStat[]) => rows.map((row) => {
    const stats = row.stats
    if (row.category === 'passing') return `${stats['C/ATT']} · ${stats.YDS} yds · ${stats.TD} TD · ${stats.INT} INT`
    if (row.category === 'rushing') return `${stats.CAR} car · ${stats.YDS} yds · ${stats.TD} TD`
    if (row.category === 'receiving') return `${stats.REC} rec · ${stats.YDS} yds · ${stats.TD} TD`
    if (row.category === 'defensive') return `${stats.TOT} tkl${statNumber(stats, 'SACKS') ? ` · ${stats.SACKS} sacks` : ''}`
    return null
  }).filter(Boolean).join(' · ')

  return (
    <WindowFrame className="player-window" onClose={closeWindow}>
      <div className="player-hero" style={{ background: `linear-gradient(90deg, ${teamColor(team)}55, transparent 70%)` }}>
        <span className="player-photo" style={photo ? { backgroundImage: `url(${photo})` } : { background: teamColor(team) }}>{!photo && <span className="cond">{abbr(team)}</span>}</span>
        <div>
          <h2 className="cond">{playerName.toUpperCase()}</h2>
          <p className="muted">{[position, team?.school, model.year].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="grow" />
        {ranked && <div className="player-score"><span className="muted small cond">HEISMAN TRACKER</span><strong className="cond num">#{ranked.rank} · {(ranked.score * 100).toFixed(1)}</strong></div>}
      </div>
      <Tabs items={['THIS WEEK', 'SEASON'] as const} value={tab} onChange={setTab} />
      <div className="window-scroll">
        {season.error || games.error ? <ErrorBox message={((season.error ?? games.error) as Error).message} /> : season.isLoading || games.isLoading ? <Loading /> : (
          <>
            {tab === 'THIS WEEK' ? (
              latest ? (
                <div className="player-week">
                  <p className="cond muted">{model.periodByKey.get(model.periodKeyOf(latest.game))?.label.toUpperCase()} · {dayMonth(latest.game.start_time, timeZone).toUpperCase()}</p>
                  <button type="button" className="log-row" onClick={() => openWindow({ type: 'game', gameId: latest.game.id })}>
                    <span>{(() => { const text = gameText(model, latest.rows[0].team_id, latest.game, true); return `${text.outcome} ${text.text}` })()}</span>
                    <span className="num secondary">{lineFor(latest.rows)}</span>
                  </button>
                </div>
              ) : <Empty>No games yet.</Empty>
            ) : (
              <div className="season-tables">
                {seasonRows.length ? Object.entries(SEASON_COLUMNS).map(([category, columns]) => {
                  const row = seasonRows.find((item) => item.category === category)
                  if (!row) return null
                  const present = columns.filter((column) => row.stats[column] !== undefined)
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
            )}
            {chart.length > 0 && (
              <div className="chart-box">
                <h3 className="cond">{main === 'defensive' ? 'TACKLES' : main.toUpperCase()} BY GAME</h3>
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
      </div>
    </WindowFrame>
  )
}
