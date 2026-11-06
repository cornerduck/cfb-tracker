import { useApp } from '../app/context'
import type { WeeklyAward } from '../data/types'
import { Empty, Plate, PlayerAvatar } from '../shared/ui'
import { playerLine } from '../shared/stats'
import { WindowFrame } from './WindowFrame'

type Performance = {
  player_id: string
  player_name: string
  team_id: number
  game_id: number | null
  position: string
  line: Record<string, number>
}

const asPerformance = (value: unknown): Performance | null => {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.player_id !== 'string') return null
  return {
    player_id: row.player_id,
    player_name: String(row.player_name ?? ''),
    team_id: Number(row.team_id),
    game_id: typeof row.game_id === 'number' ? row.game_id : null,
    position: String(row.position ?? ''),
    line: (row.line ?? {}) as Record<string, number>,
  }
}

// The best individual performances of one week, Performance of the Week first.
// Each row opens the player profile; the back button returns to this list.
export function PerformancesWindow({ week }: { week: number }) {
  const { model, closeWindow, openWindow } = useApp()
  const award = model.bundle.awards.find((item: WeeklyAward) => item.week === week && item.award_type === 'performance')
  const details = (award?.details ?? {}) as Record<string, unknown>
  const listed = Array.isArray(details.top) ? details.top.map(asPerformance).filter((row): row is Performance => row !== null) : []
  // Awards saved before the list existed only know the winner.
  const winner = award?.player_id ? asPerformance({ ...details, player_id: award.player_id, game_id: award.game_id }) : null
  const rows = listed.length ? listed : winner ? [winner] : []
  const period = model.periods.find((item) => model.awardWeekFor(item) === week)

  return (
    <WindowFrame className="performances-window" title="TOP PERFORMANCES" kicker={period ? `${period.label} · ${model.year}` : undefined} onClose={closeWindow}>
      <div className="window-scroll">
        {rows.length ? (
          <ol className="perf-list">
            {rows.map((row, index) => {
              const team = model.team(row.team_id)
              const game = row.game_id ? model.gameById.get(row.game_id) : undefined
              const home = game?.home_team_id === row.team_id
              const opponent = game ? model.team(home ? game.away_team_id : game.home_team_id) : undefined
              const where = game ? (game.neutral_site || home ? 'vs' : '@') : ''
              return (
                <li key={`${row.player_id}-${row.game_id}`}>
                  <button
                    type="button"
                    className={`perf-row${index === 0 ? ' first' : ''}`}
                    onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id, season: model.year })}
                  >
                    <span className="cond num rank-num">{index + 1}</span>
                    <PlayerAvatar playerId={row.player_id} team={team} size={40} />
                    <span className="perf-main">
                      <span className="perf-name cond truncate">
                        {row.player_name.toUpperCase()}
                        {index === 0 && <span className="perf-badge cond">POTW</span>}
                      </span>
                      <span className="perf-line small truncate">{playerLine(row.position, row.line)}</span>
                    </span>
                    <span className="perf-team small muted">
                      <Plate team={team} size={22} />
                      <span className="truncate">{opponent ? `${where} ${opponent.school}` : team?.school}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : <Empty>No performances have been recorded for this week yet.</Empty>}
        {rows.length > 0 && !listed.length && <p className="small muted perf-foot">The full list appears after the next data update.</p>}
      </div>
    </WindowFrame>
  )
}
