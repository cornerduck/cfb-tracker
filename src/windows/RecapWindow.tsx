import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { type SeasonModel, abbr } from '../data/model'
import { fetchPicks } from '../data/queries'
import type { Game } from '../data/types'
import { UPSET_LABEL } from '../shared/GameTile'
import { playerLine } from '../shared/stats'
import { Empty, Plate, PlayerAvatar } from '../shared/ui'
import { WindowFrame } from './WindowFrame'
import { recapPeriods } from './recap'

type Top = { player_id: string; player_name: string; team_id: number; position: string; line: Record<string, number> }

const label = (model: SeasonModel, game: Game, teamId: number) => {
  const rank = model.rankAtKickoff(teamId, game)
  return `${rank ? `#${rank} ` : ''}${abbr(model.team(teamId))}`
}

function Section({ title, action, onAction, className = '', children }: {
  title: string
  action?: string
  onAction?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`recap-card ${className}`}>
      <div className="recap-card-head">
        <h3 className="cond">{title}</h3>
        {action && <button type="button" className="tile-link cond" onClick={onAction}>{action}</button>}
      </div>
      {children}
    </section>
  )
}

export function RecapWindow({ periodKey }: { periodKey: string }) {
  const { model, closeWindow, openWindow, favorites, account, timeZone, mobile } = useApp()
  const navigate = useNavigate()
  const periods = useMemo(() => recapPeriods(model), [model])
  const [key, setKey] = useState(periodKey)
  const index = periods.findIndex((item) => item.key === key)
  const period = periods[index] ?? periods.at(-1)
  const picks = useQuery({ queryKey: ['picks', model.year], queryFn: () => fetchPicks(model.year), staleTime: 60_000, enabled: Boolean(account.session) })

  const data = useMemo(() => {
    if (!period) return null
    const week = model.awardWeekFor(period)
    const games = model.gamesIn(period.key)
    const finals = games.filter((game) => game.status === 'final' && game.home_points !== null && game.away_points !== null)
    const awards = model.bundle.awards.filter((award) => award.week === week)
    const gameOfWeek = model.gameById.get(awards.find((award) => award.award_type === 'game')?.game_id ?? -1) ?? null
    const performance = awards.find((award) => award.award_type === 'performance')
    const top = Array.isArray(performance?.details.top) ? (performance.details.top as Top[]) : []

    const rankedLost = finals.filter((game) => {
      const winner = model.winnerId(game)
      return [game.home_team_id, game.away_team_id].some((id) => id !== winner && model.rankAtKickoff(id, game) !== null)
    }).length
    const upsets = finals.map((game) => ({ game, upset: model.upset(game)! })).filter((item) => item.upset)
      .sort((a, b) => (b.upset.winnerSpread ?? 99) - (a.upset.winnerSpread ?? 99))
    const points = finals.reduce((sum, game) => sum + game.home_points! + game.away_points!, 0)

    const mine = [...favorites].map((teamId) => {
      const game = finals.find((item) => item.home_team_id === teamId || item.away_team_id === teamId)
      if (!game) return null
      const next = model.teamGames(teamId).filter((item) => model.gameOrder(item) > model.gameOrder(game) && item.status !== 'final')
        .sort((a, b) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? ''))[0]
      return { teamId, game, next }
    }).filter((item): item is NonNullable<typeof item> => item !== null)

    const heisman = model.bundle.heismanWeekly.filter((row) => row.week === week).sort((a, b) => a.rank - b.rank).slice(0, 5)
    const before = new Map(model.bundle.heismanWeekly.filter((row) => row.week === week - 1).map((row) => [row.player_id, row.rank]))

    // The AP Poll released after this week's games, compared with the one before.
    const release = model.pollReleases('AP').find((item) => item.order > period.order && item.order < period.order + 1) ?? null
    const previous = release ? model.previousRelease(release) : null
    const moves = release && previous ? release.ranked.map((row) => {
      const old = previous.byTeam.get(row.team_id)?.rank ?? null
      return { teamId: row.team_id, rank: row.rank, delta: old === null ? null : old - row.rank }
    }) : []
    const risers = moves.filter((item) => item.delta !== null && item.delta > 0).sort((a, b) => b.delta! - a.delta!).slice(0, 3)
    const fallers = moves.filter((item) => item.delta !== null && item.delta < 0).sort((a, b) => a.delta! - b.delta!).slice(0, 3)
    const added = moves.filter((item) => item.delta === null)
    const dropped = previous && release ? previous.ranked.filter((row) => !release.byTeam.has(row.team_id)).map((row) => row.team_id) : []

    const gameday = model.bundle.gameday.find((row) => row.week === week) ?? null
    const nextGameday = model.bundle.gameday.find((row) => row.week === week + 1) ?? null

    return { week, finals, gameOfWeek, top, rankedLost, upsets, points, mine, heisman, before, release, risers, fallers, added, dropped, gameday, nextGameday }
  }, [model, period, favorites])

  const pickem = useMemo(() => {
    if (!period || !picks.data || !account.session) return null
    const own = picks.data.filter((pick) => pick.user_id === account.session!.user.id && pick.correct !== null)
    const ids = new Set(model.gamesIn(period.key).map((game) => game.id))
    const week = own.filter((pick) => ids.has(pick.game_id))
    return {
      correct: week.filter((pick) => pick.correct).length,
      total: week.length,
      seasonCorrect: own.filter((pick) => pick.correct).length,
      seasonTotal: own.length,
    }
  }, [period, picks.data, account.session, model])

  if (!period || !data) {
    return <WindowFrame className="recap-window" title="WEEK RECAP" onClose={closeWindow}><div className="window-scroll"><Empty>The first recap appears after the first week of games.</Empty></div></WindowFrame>
  }

  const openGame = (gameId: number) => openWindow({ type: 'game', gameId })
  const openPlayer = (playerId: string, name: string, teamId: number) => openWindow({ type: 'player', playerId, name, teamId, season: model.year })
  const openTeam = (teamId: number) => {
    const team = model.team(teamId)
    if (team) navigate(`/teams/${team.slug}`)
  }
  const previousPeriod = index > 0 ? periods[index - 1] : null
  const nextPeriod = index >= 0 && index < periods.length - 1 ? periods[index + 1] : null
  const gotw = data.gameOfWeek
  const gotwWinner = gotw ? model.winnerId(gotw) : null
  const gotwUpset = gotw ? model.upset(gotw) : null
  const gamedayGame = data.gameday?.game_id ? model.gameById.get(data.gameday.game_id) : undefined
  const gamedayCity = (data.gameday?.result.city as string | undefined) ?? model.team(data.gameday?.team_id)?.location?.city ?? null
  const gamedayHome = gamedayGame && data.gameday?.team_id ? model.winnerId(gamedayGame) : null
  const nextGamedayGame = data.nextGameday?.game_id ? model.gameById.get(data.nextGameday.game_id) : undefined
  const startText = data.finals[0]?.start_time
    ? new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(data.finals.find((game) => new Date(game.start_time!).getUTCDay() === 6)?.start_time ?? data.finals[0].start_time!)).toUpperCase()
    : ''

  return (
    <WindowFrame
      className="recap-window"
      kicker={mobile ? startText : `${startText ? `${startText} · ` : ''}${model.year} SEASON`}
      title={`${period.label.toUpperCase()} RECAP`}
      actions={(
        <div className="recap-nav">
          {previousPeriod && <button type="button" className="outline-button cond" onClick={() => setKey(previousPeriod.key)}>‹ {previousPeriod.short.toUpperCase()}</button>}
          {nextPeriod && <button type="button" className="outline-button cond" onClick={() => setKey(nextPeriod.key)}>{nextPeriod.short.toUpperCase()} ›</button>}
        </div>
      )}
      onClose={closeWindow}
    >
      <div className="window-scroll recap-body">
        <div className="recap-grid recap-grid--wide">
          <Section title="GAME OF THE WEEK">
            {gotw ? (
              <button type="button" className="recap-gotw" onClick={() => openGame(gotw.id)}>
                {[gotw.away_team_id, gotw.home_team_id].map((teamId) => {
                  const points = teamId === gotw.home_team_id ? gotw.home_points : gotw.away_points
                  return (
                    <span key={teamId} className={`recap-gotw-team${gotwWinner === teamId ? '' : ' lost'}`}>
                      <Plate team={model.team(teamId)} size={40} />
                      <span className="cond truncate">{label(model, gotw, teamId)}</span>
                      <span className="cond num recap-gotw-points">{points}</span>
                    </span>
                  )
                })}
                <span className="recap-tags">
                  {data.gameday?.game_id === gotw.id && <span className="watch-reason watch-reason--gameday cond">COLLEGE GAMEDAY</span>}
                  {gotwUpset && <span className="watch-reason cond recap-upset-tag">{UPSET_LABEL[gotwUpset.tier]}</span>}
                  {model.isOvertime(gotw) && <span className="watch-reason cond">OT</span>}
                </span>
              </button>
            ) : <Empty>No game of the week yet.</Empty>}
          </Section>
          <Section title={`${period.label.toUpperCase()} IN NUMBERS`}>
            <div className="numbers-grid">
              <div><span>Ranked teams lost</span><strong className="cond num">{data.rankedLost}</strong></div>
              <div><span>Upsets</span><strong className="cond num">{data.upsets.length}</strong></div>
              <div><span>Overtime games</span><strong className="cond num">{data.finals.filter((game) => model.isOvertime(game)).length}</strong></div>
              <div><span>Avg. points</span><strong className="cond num">{data.finals.length ? (data.points / data.finals.length).toFixed(1) : '–'}</strong></div>
            </div>
          </Section>
        </div>

        <div className="recap-grid">
          <Section title="UPSETS">
            {data.upsets.length ? data.upsets.slice(0, 3).map(({ game, upset }) => (
              <button key={game.id} type="button" className="recap-row" onClick={() => openGame(game.id)}>
                <span className={`recap-tier recap-tier--${upset.tier} cond`}>{UPSET_LABEL[upset.tier]}</span>
                <span className="recap-main">
                  <span className="cond num recap-title">{label(model, game, game.away_team_id)} {game.away_points} {game.neutral_site ? 'vs' : '@'} {label(model, game, game.home_team_id)} {game.home_points}</span>
                  <span className="small muted">{upset.winnerSpread ? `${model.team(upset.winnerId)?.school} +${upset.winnerSpread}` : 'FCS over FBS'}</span>
                </span>
              </button>
            )) : <p className="muted small">No upsets this week.</p>}
          </Section>
          <Section title="TOP PERFORMANCES" action={data.top.length ? `ALL ${data.top.length} ›` : undefined} onAction={() => openWindow({ type: 'performances', week: data.week, season: model.year })}>
            {data.top.length ? data.top.slice(0, 5).map((row, position) => (
              <button key={`${row.player_id}-${position}`} type="button" className="recap-row" onClick={() => openPlayer(row.player_id, row.player_name, row.team_id)}>
                <span className="cond num recap-rank">{position + 1}</span>
                <PlayerAvatar playerId={row.player_id} team={model.team(row.team_id)} size={32} />
                <span className="recap-main">
                  <span className="cond recap-title truncate">{row.player_name.toUpperCase()}</span>
                  <span className="small muted truncate">{playerLine(row.position, row.line)}</span>
                </span>
                <span className="cond small muted">{abbr(model.team(row.team_id))}</span>
              </button>
            )) : <p className="muted small">The top performances appear with the weekly awards.</p>}
          </Section>
        </div>

        <div className="recap-grid">
          <Section title="★ YOUR TEAMS" className="recap-card--mine">
            {data.mine.length ? data.mine.map(({ teamId, game, next }) => {
              const won = model.winnerId(game) === teamId
              const own = teamId === game.home_team_id ? game.home_points : game.away_points
              const other = teamId === game.home_team_id ? game.away_points : game.home_points
              const record = model.record(teamId, model.gameOrder(game))
              const opponent = teamId === game.home_team_id ? game.away_team_id : game.home_team_id
              return (
                <button key={teamId} type="button" className="recap-row" onClick={() => openTeam(teamId)}>
                  <Plate team={model.team(teamId)} size={36} />
                  <span className="recap-main">
                    <span className="cond recap-title truncate">{(model.team(teamId)?.school ?? '').toUpperCase()} <span className="muted num">{record.w}-{record.l}</span></span>
                    <span className="small muted truncate">
                      {next ? `Next: ${new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(next.start_time ?? ''))} ${next.home_team_id === teamId ? 'vs' : '@'} ${model.team(next.home_team_id === teamId ? next.away_team_id : next.home_team_id)?.school ?? 'TBD'}` : `vs ${model.team(opponent)?.school ?? ''}`}
                    </span>
                  </span>
                  <span className={`cond num recap-result ${won ? 'win' : 'loss'}`}>{won ? 'W' : 'L'} {own}-{other}</span>
                </button>
              )
            }) : <p className="muted small">None of your teams played this week.</p>}
          </Section>
          <Section title="HEISMAN RACE" action="FULL TRACKER ›" onAction={() => navigate('/stats?view=heisman')}>
            {data.heisman.length ? data.heisman.map((row) => {
              const old = data.before.get(row.player_id)
              const delta = old === undefined ? null : old - row.rank
              return (
                <button key={row.player_id} type="button" className="recap-row" onClick={() => row.team_id && openPlayer(row.player_id, row.player_name, row.team_id)}>
                  <span className="cond num recap-rank">{row.rank}</span>
                  <PlayerAvatar playerId={row.player_id} team={model.team(row.team_id)} size={32} />
                  <span className="recap-main">
                    <span className="cond recap-title truncate">{row.player_name.toUpperCase()}</span>
                    <span className="small muted truncate">{model.team(row.team_id)?.school ?? ''}</span>
                  </span>
                  <span className="cond num recap-score">{row.score.toFixed(1)}</span>
                  <span className={`cond num recap-move${delta === null ? ' new' : delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>{delta === null ? 'NEW' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–'}</span>
                </button>
              )
            }) : <p className="muted small">The Heisman race for this week follows on Sunday.</p>}
          </Section>
        </div>

        <div className="recap-grid recap-grid--three">
          <Section title="AP POLL MOVES">
            {data.release ? (
              <>
                <div className="recap-moves">
                  {[...data.risers, ...data.fallers, ...data.added.slice(0, 2)].map((item) => (
                    <button key={item.teamId} type="button" className="recap-move-row" onClick={() => openTeam(item.teamId)}>
                      <span className="cond num muted">{item.rank}</span>
                      <Plate team={model.team(item.teamId)} size={22} />
                      <span className="cond truncate">{(model.team(item.teamId)?.school ?? '').toUpperCase()}</span>
                      <span className={`cond num recap-move${item.delta === null ? ' new' : item.delta > 0 ? ' up' : ' down'}`}>{item.delta === null ? 'NEW' : item.delta > 0 ? `▲${item.delta}` : `▼${-item.delta}`}</span>
                    </button>
                  ))}
                </div>
                {data.dropped.length > 0 && <p className="small muted">Dropped out: {data.dropped.map((teamId) => model.team(teamId)?.school).filter(Boolean).join(', ')}</p>}
              </>
            ) : <p className="muted small">The new AP Poll comes out on Monday.</p>}
          </Section>
          <Section title="YOUR PICK'EM">
            {pickem && pickem.total ? (
              <>
                <span className="cond num recap-big">{pickem.correct}<span className="muted"> / {pickem.total}</span></span>
                <span className="small muted">Season {pickem.seasonCorrect}-{pickem.seasonTotal - pickem.seasonCorrect} · {Math.round((pickem.seasonCorrect / pickem.seasonTotal) * 100)}%</span>
              </>
            ) : <p className="muted small">No graded picks this week.</p>}
          </Section>
          <Section title="GAMEDAY">
            {data.gameday ? (
              <>
                <span className="cond recap-city">{(gamedayCity ?? 'TBA').toUpperCase()}</span>
                {gamedayGame && data.gameday.team_id && gamedayGame.status === 'final' && (
                  <span className={`cond num recap-result ${gamedayHome === data.gameday.team_id ? 'win' : 'loss'}`}>
                    HOST {gamedayHome === data.gameday.team_id ? 'W' : 'L'} {Math.max(gamedayGame.home_points ?? 0, gamedayGame.away_points ?? 0)}-{Math.min(gamedayGame.home_points ?? 0, gamedayGame.away_points ?? 0)}
                  </span>
                )}
                {nextGamedayGame && <span className="small muted">Next: {label(model, nextGamedayGame, nextGamedayGame.away_team_id)} @ {label(model, nextGamedayGame, nextGamedayGame.home_team_id)}</span>}
              </>
            ) : <p className="muted small">No GameDay location stored for this week.</p>}
          </Section>
        </div>
      </div>
    </WindowFrame>
  )
}
