import type { SeasonModel } from '../../data/model'
import type { Game, PickMode, PickRow } from '../../data/types'

export type Outcome = 'correct' | 'wrong' | 'push' | 'pending'

export const isLocked = (game: Game, now = Date.now()) =>
  game.status !== 'scheduled' || (game.start_time !== null && Date.parse(game.start_time) <= now)

// The slate: games with an AP Top 25 team at kickoff, the GameDay game and
// every game of a favorite team. Games already picked always stay visible.
export function slateFor(model: SeasonModel, periodKey: string, favorites: Set<number>, picks: PickRow[]) {
  const gameday = new Set(model.bundle.gameday.map((row) => row.game_id).filter((id): id is number => id !== null))
  const picked = new Set(picks.map((pick) => pick.game_id))
  return model.gamesIn(periodKey)
    .filter((game) => model.fbsIds.has(game.home_team_id) || model.fbsIds.has(game.away_team_id))
    .map((game) => ({
      game,
      ranked: [game.away_team_id, game.home_team_id].some((id) => model.apRankAtKickoff(id, game)),
      gameday: gameday.has(game.id),
      mine: favorites.has(game.home_team_id) || favorites.has(game.away_team_id),
    }))
    .filter((entry) => entry.ranked || entry.gameday || entry.mine || picked.has(entry.game.id))
    .sort((a, b) => Date.parse(a.game.start_time ?? '') - Date.parse(b.game.start_time ?? '') || a.game.id - b.game.id)
}

// The database grades picks during every update; until then the app grades
// finished games itself with the same rules.
export function outcomeOf(pick: PickRow, game: Game | undefined): Outcome {
  if (!game || game.status !== 'final' || game.home_points === null || game.away_points === null || pick.pick_team_id === null) return 'pending'
  if (pick.correct !== null && pick.locked) return pick.correct ? 'correct' : 'wrong'
  const home = pick.pick_team_id === game.home_team_id
  const margin = home ? game.home_points - game.away_points : game.away_points - game.home_points
  if (pick.mode === 'straight_up') return margin === 0 ? 'push' : margin > 0 ? 'correct' : 'wrong'
  if (pick.spread === null) return 'pending'
  const covered = margin + (home ? pick.spread : -pick.spread)
  return covered === 0 ? 'push' : covered > 0 ? 'correct' : 'wrong'
}

export type WeekLine = { key: string; label: string; short: string; w: number; l: number; pending: number; total: number }

export function weekLines(model: SeasonModel, picks: PickRow[], mode: PickMode) {
  const lines = new Map<string, WeekLine>()
  for (const pick of picks) {
    if (pick.mode !== mode || pick.pick_team_id === null) continue
    const game = model.gameById.get(pick.game_id)
    if (!game) continue
    const key = model.periodKeyOf(game)
    const period = model.periodByKey.get(key)
    const line = lines.get(key) ?? { key, label: period?.label ?? key, short: period?.short ?? key, w: 0, l: 0, pending: 0, total: 0 }
    const outcome = outcomeOf(pick, game)
    if (outcome === 'correct') line.w += 1
    else if (outcome === 'wrong') line.l += 1
    else line.pending += 1
    line.total += 1
    lines.set(key, line)
  }
  const order = new Map(model.periods.map((period, index) => [period.key, index]))
  return [...lines.values()].sort((a, b) => (order.get(b.key) ?? 0) - (order.get(a.key) ?? 0))
}

export function seasonLine(lines: WeekLine[]) {
  const w = lines.reduce((sum, line) => sum + line.w, 0)
  const l = lines.reduce((sum, line) => sum + line.l, 0)
  const graded = lines.filter((line) => line.w + line.l > 0 && !line.pending)
  const best = [...graded].sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l) || b.w - a.w)[0] ?? null
  return { w, l, rate: w + l ? w / (w + l) : null, best, last: graded[0] ?? null }
}

export const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
