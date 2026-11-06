import { type SeasonModel, confAbbr } from '../../data/model'
import type { Game } from '../../data/types'

export type WatchTier = 'MUST WATCH' | 'WORTH IT' | 'BACKGROUND'
export type WatchReason = { label: string; kind?: 'mine' | 'gameday' }
export type RatedGame = { game: Game; score: number; tier: WatchTier; reasons: WatchReason[]; mine: boolean }

// The rating shown in the Watch Guide. Everything comes from data the app
// already has, so it costs no API calls.
export const WATCH_RULES = [
  { label: 'Ranked teams (higher ranks, more points)', pts: 'up to 35' },
  { label: 'Close spread (pick em = full points)', pts: 'up to 25' },
  { label: 'Unbeaten team plays', pts: '10' },
  { label: 'Conference race at stake', pts: '10' },
  { label: 'College GameDay on site', pts: '10' },
  { label: 'Top 5 team plays', pts: '10' },
] as const

export const WATCH_TIERS: Array<{ tier: WatchTier; range: string }> = [
  { tier: 'MUST WATCH', range: '75 to 100' },
  { tier: 'WORTH IT', range: '50 to 74' },
  { tier: 'BACKGROUND', range: '20 to 49' },
]

// Games under this rating are hidden unless one of your teams plays.
export const WATCH_MIN = 20

export const tierFor = (score: number): WatchTier => score >= 75 ? 'MUST WATCH' : score >= 50 ? 'WORTH IT' : 'BACKGROUND'

const upper = (value: string) => value.toUpperCase()

export function rateGame(model: SeasonModel, game: Game, favorites: Set<number>, gamedayGameId: number | null): RatedGame {
  const ids = [game.away_team_id, game.home_team_id]
  const ranks = ids.map((id) => model.rankAtKickoff(id, game))
  const before = model.gameOrder(game) - 0.5
  const reasons: WatchReason[] = []
  let score = 0

  // Ranked teams: up to 17.5 points each, more for a higher rank.
  for (const rank of ranks) if (rank) score += ((26 - rank) / 25) * 17.5
  if (ranks[0] && ranks[1]) {
    const worst = Math.max(ranks[0], ranks[1])
    if (worst <= 5) reasons.push({ label: `#${Math.min(ranks[0], ranks[1])} VS #${worst}` })
    else reasons.push({ label: worst <= 10 ? 'TOP 10 MATCHUP' : worst <= 15 ? 'TOP 15 MATCHUP' : 'RANKED MATCHUP' })
  }

  // Spread: a pick em gets the full 25, nothing from 14 points on.
  const spread = model.spreads.get(game.id)
  if (spread !== null && spread !== undefined) {
    const size = Math.abs(spread)
    score += Math.max(0, 25 * (1 - Math.max(0, size - 1) / 13))
    if (size === 0) reasons.push({ label: "PICK 'EM" })
    else if (size <= 7) reasons.push({ label: `SPREAD ${Number.isInteger(size) ? size : size.toFixed(1)}` })
  }

  // An unbeaten team (at least three wins) puts its record on the line.
  const unbeaten = ids.filter((id) => {
    const record = model.record(id, before)
    return record.l === 0 && record.w >= 3
  })
  if (unbeaten.length) {
    score += 10
    for (const id of unbeaten) reasons.push({ label: `${upper(model.team(id)?.school ?? '')} UNBEATEN` })
  }

  // Conference race: a conference game between two teams with at most one conference loss.
  const conference = model.conferenceOf(game.home_team_id)
  if (game.conference_game && conference && ids.every((id) => {
    const record = model.confRecord(id, before)
    return record.l <= 1 && record.w >= 2
  })) {
    score += 10
    reasons.push({ label: `${confAbbr(conference)} RACE` })
  }

  if (gamedayGameId === game.id) {
    score += 10
    reasons.push({ label: 'COLLEGE GAMEDAY', kind: 'gameday' })
  }

  if (ranks.some((rank) => rank !== null && rank <= 5)) {
    score += 10
    if (!(ranks[0] && ranks[1] && Math.max(ranks[0], ranks[1]) <= 10)) reasons.push({ label: 'TOP 5 TEAM' })
  }

  const mine = ids.some((id) => favorites.has(id))
  if (mine) reasons.unshift({ label: '★ YOUR TEAM', kind: 'mine' })

  const rounded = Math.min(100, Math.round(score))
  return { game, score: rounded, tier: tierFor(rounded), reasons, mine }
}

// Kickoff windows: a new window starts when a game kicks off more than two
// hours after the first game of the current window.
export function watchWindows(rated: RatedGame[]) {
  const sorted = [...rated].filter((item) => item.game.start_time)
    .sort((a, b) => Date.parse(a.game.start_time!) - Date.parse(b.game.start_time!))
  const windows: Array<{ start: string; games: RatedGame[] }> = []
  for (const item of sorted) {
    const current = windows.at(-1)
    if (current && Date.parse(item.game.start_time!) - Date.parse(current.start) <= 2 * 3600_000) current.games.push(item)
    else windows.push({ start: item.game.start_time!, games: [item] })
  }
  for (const window of windows) window.games.sort((a, b) => b.score - a.score || Number(b.mine) - Number(a.mine))
  return windows
}
