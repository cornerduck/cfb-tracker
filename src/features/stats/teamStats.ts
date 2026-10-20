import type { SeasonModel } from '../../data/model'
import type { TeamSeasonStatRow } from '../../data/queries'
import { statNumber } from '../../shared/stats'

// Per-game team numbers derived from the CFBD season totals plus the scores
// stored with every game. Ranks are computed across all FBS teams.

export type TeamMetric = {
  key: string
  label: string
  short: string
  lowerBetter?: boolean
  format: 'one' | 'int' | 'pct' | 'signed'
  value: (stats: Record<string, unknown>, games: { count: number; pf: number; pa: number }) => number | null
}

const perGame = (key: string) => (stats: Record<string, unknown>, games: { count: number }) =>
  stats[key] === undefined || !games.count ? null : statNumber(stats, key) / games.count
const ratio = (made: string, tries: string) => (stats: Record<string, unknown>) =>
  statNumber(stats, tries) ? statNumber(stats, made) / statNumber(stats, tries) : null
const total = (key: string) => (stats: Record<string, unknown>) => (stats[key] === undefined ? null : statNumber(stats, key))
const takeaways = (stats: Record<string, unknown>) =>
  stats.turnoversOpponent !== undefined ? statNumber(stats, 'turnoversOpponent') : statNumber(stats, 'interceptions') + statNumber(stats, 'fumblesRecovered')

export const METRICS: Record<string, TeamMetric> = {
  ppg: { key: 'ppg', label: 'Points / game', short: 'PTS/G', format: 'one', value: (_, games) => (games.count ? games.pf / games.count : null) },
  ypg: { key: 'ypg', label: 'Yards / game', short: 'YDS/G', format: 'int', value: perGame('totalYards') },
  pass: { key: 'pass', label: 'Pass yds / game', short: 'PASS/G', format: 'int', value: perGame('netPassingYards') },
  rush: { key: 'rush', label: 'Rush yds / game', short: 'RUSH/G', format: 'int', value: perGame('rushingYards') },
  ypp: {
    key: 'ypp', label: 'Yards / play', short: 'Y/P', format: 'one',
    value: (stats) => {
      const plays = statNumber(stats, 'passAttempts') + statNumber(stats, 'rushingAttempts')
      return plays ? statNumber(stats, 'totalYards') / plays : null
    },
  },
  third: { key: 'third', label: '3rd down %', short: '3RD %', format: 'pct', value: ratio('thirdDownConversions', 'thirdDowns') },
  margin: {
    key: 'margin', label: 'Turnover margin', short: 'TO +/-', format: 'signed',
    value: (stats) => (stats.turnovers === undefined ? null : takeaways(stats) - statNumber(stats, 'turnovers')),
  },
  papg: { key: 'papg', label: 'Points allowed / game', short: 'PTS/G', lowerBetter: true, format: 'one', value: (_, games) => (games.count ? games.pa / games.count : null) },
  yapg: { key: 'yapg', label: 'Yards allowed / game', short: 'YDS/G', lowerBetter: true, format: 'int', value: perGame('totalYardsOpponent') },
  passA: { key: 'passA', label: 'Pass yds allowed / game', short: 'PASS/G', lowerBetter: true, format: 'int', value: perGame('netPassingYardsOpponent') },
  rushA: { key: 'rushA', label: 'Rush yds allowed / game', short: 'RUSH/G', lowerBetter: true, format: 'int', value: perGame('rushingYardsOpponent') },
  sacks: { key: 'sacks', label: 'Sacks', short: 'SACKS', format: 'int', value: total('sacks') },
  tfl: { key: 'tfl', label: 'Tackles for loss', short: 'TFL', format: 'int', value: total('tacklesForLoss') },
  takeaways: { key: 'takeaways', label: 'Takeaways', short: 'TAKE', format: 'int', value: (stats) => (stats.interceptions === undefined && stats.turnoversOpponent === undefined ? null : takeaways(stats)) },
  thirdA: { key: 'thirdA', label: '3rd down % allowed', short: '3RD %', lowerBetter: true, format: 'pct', value: ratio('thirdDownConversionsOpponent', 'thirdDownsOpponent') },
  kr: { key: 'kr', label: 'Kick return avg', short: 'KR AVG', format: 'one', value: ratio('kickReturnYards', 'kickReturns') },
  pr: { key: 'pr', label: 'Punt return avg', short: 'PR AVG', format: 'one', value: ratio('puntReturnYards', 'puntReturns') },
  retTd: { key: 'retTd', label: 'Return touchdowns', short: 'RET TD', format: 'int', value: (stats) => (stats.kickReturnTDs === undefined && stats.puntReturnTDs === undefined ? null : statNumber(stats, 'kickReturnTDs') + statNumber(stats, 'puntReturnTDs')) },
  pen: { key: 'pen', label: 'Penalties / game', short: 'PEN/G', lowerBetter: true, format: 'one', value: perGame('penalties') },
  penYds: { key: 'penYds', label: 'Penalty yds / game', short: 'PEN YDS/G', lowerBetter: true, format: 'one', value: perGame('penaltyYards') },
}

export const formatMetric = (metric: TeamMetric, value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—'
  if (metric.format === 'pct') return `${Math.round(value * 100)}%`
  if (metric.format === 'int') return String(Math.round(value))
  if (metric.format === 'signed') return value > 0 ? `+${Math.round(value)}` : String(Math.round(value))
  return value.toFixed(1)
}

export type TeamStatLine = { teamId: number; games: number; values: Record<string, number | null>; ranks: Record<string, number | null> }

export function buildTeamStats(model: SeasonModel, rows: TeamSeasonStatRow[]) {
  const byTeam = new Map<number, Record<string, unknown>>()
  for (const row of rows) byTeam.set(row.team_id, { ...(byTeam.get(row.team_id) ?? {}), ...row.stats })
  const lines: TeamStatLine[] = []
  for (const teamId of model.fbsIds) {
    const results = model.resultsThrough(teamId)
    const games = { count: results.length, pf: results.reduce((sum, r) => sum + r.pf, 0), pa: results.reduce((sum, r) => sum + r.pa, 0) }
    const stats = byTeam.get(teamId) ?? {}
    if (!games.count && !byTeam.has(teamId)) continue
    const values: Record<string, number | null> = {}
    for (const metric of Object.values(METRICS)) values[metric.key] = metric.value(stats, games)
    lines.push({ teamId, games: games.count, values, ranks: {} })
  }
  for (const metric of Object.values(METRICS)) {
    const ranked = lines.filter((line) => line.values[metric.key] !== null)
      .sort((a, b) => (metric.lowerBetter ? 1 : -1) * ((a.values[metric.key] as number) - (b.values[metric.key] as number)))
    let last: number | null = null
    let lastRank = 0
    ranked.forEach((line, index) => {
      const value = line.values[metric.key] as number
      const rank = last !== null && Math.abs(value - last) < 1e-9 ? lastRank : index + 1
      line.ranks[metric.key] = rank
      last = value
      lastRank = rank
    })
  }
  return new Map(lines.map((line) => [line.teamId, line]))
}
