import type { ReactNode } from 'react'
import { useApp } from '../../app/context'
import type { RosterPlayer } from '../../data/types'
import { ConfPlate, PlayerAvatar, Plate } from '../../shared/ui'
import { sizeText } from './logic'

export function PlayerLine({ player, statsText, trailing, leading }: {
  player: RosterPlayer
  statsText: string
  trailing: ReactNode
  leading: ReactNode
}) {
  const { model, openWindow } = useApp()
  const team = model.team(player.team_id)
  const size = sizeText(player.height, player.weight)
  return (
    <div className="draft-row">
      {leading}
      <PlayerAvatar playerId={player.player_id} team={team} size={34} />
      <div className="draft-copy">
        <button type="button" className="draft-name" onClick={() => openWindow({ type: 'player', playerId: player.player_id, name: player.full_name, teamId: player.team_id })}>{player.full_name}</button>
        <span className="draft-meta muted">
          {player.position && <span className="draft-pos cond">{player.position}</span>}
          <Plate team={team} size={18} />
          <span className="truncate">{team?.school}</span>
          <ConfPlate conference={model.conferenceOf(player.team_id)} small />
          {size && <span className="num">{size}</span>}
        </span>
        <span className="draft-stats cond num">{statsText || 'No stats this season'}</span>
      </div>
      {trailing}
    </div>
  )
}
