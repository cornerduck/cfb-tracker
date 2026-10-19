import type { Game } from '../data/types'
import { type SeasonModel, type UpsetTier, shortName } from '../data/model'
import { kickoffParts } from './format'
import { Flame, Plate } from './ui'

export const UPSET_LABEL: Record<UpsetTier, string> = { upset: 'UPSET', big: 'BIG UPSET', stunner: 'STUNNER' }

export function gameStatusText(model: SeasonModel, game: Game, timeZone: string, withDate = true) {
  if (game.status === 'final') return `FINAL${model.isOvertime(game) ? ' / OT' : ''}${game.tv ? ` · ${game.tv}` : ''}`
  if (game.status === 'in_progress') {
    const quarter = game.period ? (game.period > 4 ? 'OT' : `Q${game.period}`) : 'LIVE'
    return `${quarter}${game.clock ? ` ${game.clock}` : ''}${game.tv ? ` · ${game.tv}` : ''}`
  }
  const kickoff = kickoffParts(game.start_time, timeZone)
  return [withDate ? `${kickoff.day} ${kickoff.date}` : null, kickoff.time, game.tv].filter(Boolean).join(' · ')
}

type Props = {
  model: SeasonModel
  game: Game
  timeZone: string
  onOpen: (gameId: number) => void
  compact?: boolean
  seeds?: boolean
  header?: string | null
  withDate?: boolean
}

export function GameTile({ model, game, timeZone, onOpen, compact = false, seeds = false, header = null, withDate = true }: Props) {
  const winner = model.winnerId(game)
  const upset = model.upset(game)
  const played = game.status !== 'scheduled'
  const sides = [
    { teamId: game.away_team_id, points: game.away_points, seed: game.away_seed, home: false },
    { teamId: game.home_team_id, points: game.home_points, seed: game.home_seed, home: true },
  ]
  return (
    <button type="button" className={`game-tile${compact ? ' game-tile--compact' : ''}${game.status === 'in_progress' ? ' is-live' : ''}`} onClick={() => onOpen(game.id)}>
      {header && <span className="game-tile-header cond">{header}</span>}
      {sides.map((side) => {
        const team = model.team(side.teamId)
        const rank = model.apRankAtKickoff(side.teamId, game)
        const won = winner === side.teamId
        const lost = winner !== null && !won
        const flame = game.status === 'final' ? model.flame(side.teamId, Infinity, game.id) : null
        return (
          <span key={side.teamId} className={`game-row${won ? ' won' : ''}${lost ? ' lost' : ''}`}>
            <span className="at-slot cond">{side.home ? (game.neutral_site ? 'vs' : '@') : ''}</span>
            <Plate team={team} size={compact ? 20 : 24} />
            <span className="game-rank cond num">{seeds && side.seed ? `(${side.seed})` : rank ?? ''}</span>
            <span className="game-team cond">{compact ? shortName(team).toUpperCase() : (team?.school ?? 'TBD').toUpperCase()}</span>
            <Flame count={flame} />
            <span className="grow" />
            {played && <span className="game-score cond num">{side.points ?? ''}</span>}
          </span>
        )
      })}
      <span className="game-foot cond">
        <span>{gameStatusText(model, game, timeZone, withDate)}</span>
        {!compact && <span className="num">{model.favoriteText(game) ?? ''}</span>}
      </span>
      {upset && <span className={`stamp stamp--${upset.tier} cond`}>{UPSET_LABEL[upset.tier]}</span>}
    </button>
  )
}
