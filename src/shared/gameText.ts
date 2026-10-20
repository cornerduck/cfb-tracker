import type { SeasonModel } from '../data/model'
import type { Game } from '../data/types'

// "W 31–24 @ #5 Texas" style text for one team's game.
export function gameText(model: SeasonModel, teamId: number, game: Game, withResult: boolean) {
  const home = game.home_team_id === teamId
  const opponentId = home ? game.away_team_id : game.home_team_id
  const rank = model.apRankAtKickoff(opponentId, game)
  const where = game.neutral_site || home ? 'vs' : '@'
  const opponent = `${rank ? `#${rank} ` : ''}${model.team(opponentId)?.school ?? 'TBD'}`
  if (!withResult || game.home_points === null || game.away_points === null) return { outcome: '', text: `${where} ${opponent}` }
  const pf = home ? game.home_points : game.away_points
  const pa = home ? game.away_points : game.home_points
  return { outcome: pf > pa ? 'W' : pf < pa ? 'L' : 'T', text: `${pf}–${pa} ${where} ${opponent}` }
}
