import type { PlayerSeasonStat } from '../../data/types'
import { statNumber } from '../../shared/stats'

export type PlayerEntry = {
  id: string
  name: string
  teamId: number | null
  position: string
  cats: Record<string, Record<string, unknown>>
}

export function indexPlayers(rows: PlayerSeasonStat[]) {
  const players = new Map<string, PlayerEntry>()
  for (const row of rows) {
    const entry = players.get(row.player_id) ?? { id: row.player_id, name: row.player_name, teamId: row.team_id, position: '', cats: {} }
    if (row.position && !entry.position) entry.position = row.position
    entry.cats[row.category] = row.stats
    players.set(row.player_id, entry)
  }
  return players
}

export type Column = {
  key: string
  label: string
  value: (player: PlayerEntry) => number | null
  digits?: number
  // Rate columns rank only qualified players.
  rate?: boolean
}

export type Board = {
  key: string
  label: string
  categories: string[]
  include: (player: PlayerEntry) => boolean
  columns: Column[]
  sort: string
  // Minimum volume per team game for rate columns.
  qualifier?: { label: string; value: (player: PlayerEntry) => number; perGame: number }
}

const get = (category: string, key: string) => (player: PlayerEntry) => {
  const stats = player.cats[category]
  return stats && stats[key] !== undefined && stats[key] !== null ? statNumber(stats, key) : null
}
const div = (a: number | null, b: number | null) => (a === null || !b ? null : a / b)
const sum = (...values: Array<number | null>) => (values.every((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0))

const passRating = (player: PlayerEntry) => {
  const att = get('passing', 'ATT')(player)
  if (!att) return null
  const yds = get('passing', 'YDS')(player) ?? 0
  const td = get('passing', 'TD')(player) ?? 0
  const comp = get('passing', 'COMPLETIONS')(player) ?? 0
  const int = get('passing', 'INT')(player) ?? 0
  return (8.4 * yds + 330 * td + 100 * comp - 200 * int) / att
}

export const BOARDS: Board[] = [
  {
    key: 'passing', label: 'PASSING', categories: ['passing'], sort: 'YDS',
    include: (player) => Boolean(get('passing', 'ATT')(player)),
    qualifier: { label: 'pass attempts', value: (player) => get('passing', 'ATT')(player) ?? 0, perGame: 15 },
    columns: [
      { key: 'ATT', label: 'ATT', value: get('passing', 'ATT') },
      { key: 'PCT', label: 'COMP%', value: (player) => div(get('passing', 'COMPLETIONS')(player), get('passing', 'ATT')(player)) === null ? null : 100 * div(get('passing', 'COMPLETIONS')(player), get('passing', 'ATT')(player))!, digits: 1, rate: true },
      { key: 'YDS', label: 'YDS', value: get('passing', 'YDS') },
      { key: 'YPA', label: 'Y/A', value: (player) => div(get('passing', 'YDS')(player), get('passing', 'ATT')(player)), digits: 1, rate: true },
      { key: 'TD', label: 'TD', value: get('passing', 'TD') },
      { key: 'INT', label: 'INT', value: get('passing', 'INT') },
      { key: 'RTG', label: 'RTG', value: passRating, digits: 1, rate: true },
    ],
  },
  {
    key: 'rushing', label: 'RUSHING', categories: ['rushing'], sort: 'YDS',
    include: (player) => Boolean(get('rushing', 'CAR')(player)),
    qualifier: { label: 'carries', value: (player) => get('rushing', 'CAR')(player) ?? 0, perGame: 6.25 },
    columns: [
      { key: 'CAR', label: 'CAR', value: get('rushing', 'CAR') },
      { key: 'YDS', label: 'YDS', value: get('rushing', 'YDS') },
      { key: 'YPC', label: 'AVG', value: (player) => div(get('rushing', 'YDS')(player), get('rushing', 'CAR')(player)), digits: 1, rate: true },
      { key: 'TD', label: 'TD', value: get('rushing', 'TD') },
      { key: 'LONG', label: 'LONG', value: get('rushing', 'LONG') },
    ],
  },
  {
    key: 'receiving', label: 'RECEIVING', categories: ['receiving'], sort: 'YDS',
    include: (player) => Boolean(get('receiving', 'REC')(player)),
    qualifier: { label: 'receptions', value: (player) => get('receiving', 'REC')(player) ?? 0, perGame: 1.875 },
    columns: [
      { key: 'REC', label: 'REC', value: get('receiving', 'REC') },
      { key: 'YDS', label: 'YDS', value: get('receiving', 'YDS') },
      { key: 'YPR', label: 'AVG', value: (player) => div(get('receiving', 'YDS')(player), get('receiving', 'REC')(player)), digits: 1, rate: true },
      { key: 'TD', label: 'TD', value: get('receiving', 'TD') },
      { key: 'LONG', label: 'LONG', value: get('receiving', 'LONG') },
    ],
  },
  {
    key: 'defense', label: 'DEFENSE', categories: ['defensive', 'interceptions'], sort: 'TOT',
    include: (player) => Boolean(player.cats.defensive || player.cats.interceptions),
    columns: [
      { key: 'TOT', label: 'TKL', value: get('defensive', 'TOT') },
      { key: 'SOLO', label: 'SOLO', value: get('defensive', 'SOLO') },
      { key: 'TFL', label: 'TFL', value: get('defensive', 'TFL'), digits: 1 },
      { key: 'SACKS', label: 'SACKS', value: get('defensive', 'SACKS'), digits: 1 },
      { key: 'QBH', label: 'QB HUR', value: get('defensive', 'QB HUR') },
      { key: 'PD', label: 'PD', value: get('defensive', 'PD') },
      { key: 'INT', label: 'INT', value: get('interceptions', 'INT') },
    ],
  },
  {
    key: 'kicking', label: 'KICKING', categories: ['kicking'], sort: 'FGM',
    include: (player) => Boolean(get('kicking', 'FGA')(player) || get('kicking', 'XPA')(player)),
    qualifier: { label: 'field goal attempts', value: (player) => get('kicking', 'FGA')(player) ?? 0, perGame: 0.75 },
    columns: [
      { key: 'FGM', label: 'FGM', value: get('kicking', 'FGM') },
      { key: 'FGA', label: 'FGA', value: get('kicking', 'FGA') },
      { key: 'PCT', label: 'FG%', value: (player) => { const value = div(get('kicking', 'FGM')(player), get('kicking', 'FGA')(player)); return value === null ? null : value * 100 }, digits: 1, rate: true },
      { key: 'LONG', label: 'LONG', value: get('kicking', 'LONG') },
      { key: 'XPM', label: 'XPM', value: get('kicking', 'XPM') },
      { key: 'PTS', label: 'PTS', value: get('kicking', 'PTS') },
    ],
  },
  {
    key: 'returns', label: 'RETURNS', categories: ['kickReturns', 'puntReturns'], sort: 'YDS',
    include: (player) => Boolean(player.cats.kickReturns || player.cats.puntReturns),
    qualifier: { label: 'returns', value: (player) => (get('kickReturns', 'NO')(player) ?? 0) + (get('puntReturns', 'NO')(player) ?? 0), perGame: 1.2 },
    columns: [
      { key: 'KR', label: 'KR', value: get('kickReturns', 'NO') },
      { key: 'KRAVG', label: 'KR AVG', value: (player) => div(get('kickReturns', 'YDS')(player), get('kickReturns', 'NO')(player)), digits: 1, rate: true },
      { key: 'PR', label: 'PR', value: get('puntReturns', 'NO') },
      { key: 'PRAVG', label: 'PR AVG', value: (player) => div(get('puntReturns', 'YDS')(player), get('puntReturns', 'NO')(player)), digits: 1, rate: true },
      { key: 'YDS', label: 'YDS', value: (player) => sum(get('kickReturns', 'YDS')(player), get('puntReturns', 'YDS')(player)) },
      { key: 'TD', label: 'TD', value: (player) => sum(get('kickReturns', 'TD')(player), get('puntReturns', 'TD')(player)) },
    ],
  },
  {
    key: 'total', label: 'TOTAL OFFENSE', categories: ['passing', 'rushing', 'receiving'], sort: 'TOTAL',
    include: (player) => Boolean(player.cats.passing || player.cats.rushing || player.cats.receiving),
    columns: [
      { key: 'PASS', label: 'PASS', value: get('passing', 'YDS') },
      { key: 'RUSH', label: 'RUSH', value: get('rushing', 'YDS') },
      { key: 'REC', label: 'REC', value: get('receiving', 'YDS') },
      { key: 'TOTAL', label: 'TOTAL', value: (player) => sum(get('passing', 'YDS')(player), get('rushing', 'YDS')(player), get('receiving', 'YDS')(player)) },
      { key: 'TD', label: 'TD', value: (player) => sum(get('passing', 'TD')(player), get('rushing', 'TD')(player), get('receiving', 'TD')(player)) },
    ],
  },
]

export const LEADERS: Array<{ label: string; category: string; key: string; digits?: number }> = [
  { label: 'PASSING YARDS', category: 'passing', key: 'YDS' },
  { label: 'RUSHING YARDS', category: 'rushing', key: 'YDS' },
  { label: 'RECEIVING YARDS', category: 'receiving', key: 'YDS' },
  { label: 'TACKLES', category: 'defensive', key: 'TOT' },
  { label: 'SACKS', category: 'defensive', key: 'SACKS', digits: 1 },
  { label: 'INTERCEPTIONS', category: 'interceptions', key: 'INT' },
]

export const leaderOf = (players: Iterable<PlayerEntry>, category: string, key: string) => {
  let best: { player: PlayerEntry; value: number } | null = null
  for (const player of players) {
    const value = get(category, key)(player)
    if (value !== null && (!best || value > best.value)) best = { player, value }
  }
  return best
}

export const formatValue = (value: number | null, digits = 0) => {
  if (value === null || !Number.isFinite(value)) return '—'
  if (digits) return value.toFixed(digits)
  return Math.round(value).toLocaleString('en-US')
}
