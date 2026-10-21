import { Suspense, lazy, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { abbr, recordText, teamColor, type SeasonModel } from '../../data/model'
import { fetchGameDetail } from '../../data/queries'
import type { GamedayRow, GamedayStop, PlayerGameStat } from '../../data/types'
import { kickoffParts } from '../../shared/format'
import { statNumber } from '../../shared/stats'
import { Empty, Loading, imageUrl } from '../../shared/ui'
import { WindowFrame } from '../../windows/WindowFrame'
import { Pennant, showStartTime } from '../home/GameDayTile'
import { hostResult, isNeutral, placeKey, placeLabel, teamGameday, useGamedayStops } from './data'

const GameDayMap = lazy(() => import('./GameDayMap'))

const ordinal = (value: number) => {
  const rest = value % 100
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
  return `${value}${suffix}`
}

// The GameDay row for the selected week. The show is announced on Monday of
// game week, so a week without a row yet has no location (TBA).
export function currentGamedayRow(model: SeasonModel, periodWeek: number | null): GamedayRow | undefined {
  return model.bundle.gameday.find((item) => item.week === periodWeek)
}

function topLine(rows: PlayerGameStat[], category: string, teamName: (id: number) => string) {
  const best = rows.filter((row) => row.category === category).sort((a, b) => statNumber(b.stats, 'YDS') - statNumber(a.stats, 'YDS'))[0]
  if (!best) return null
  return `${best.player_name}, ${teamName(best.team_id)} · ${best.stats.YDS} yds${statNumber(best.stats, 'TD') ? ` · ${best.stats.TD} TD` : ''}`
}

export function GameDayWindow({ week }: { week?: number }) {
  const { model, period, timeZone, closeWindow, openWindow, mobile } = useApp()
  const navigate = useNavigate()
  const stopsQuery = useGamedayStops()
  const row = week !== undefined
    ? model.bundle.gameday.find((item) => item.week === week)
    : currentGamedayRow(model, period ? model.awardWeekFor(period) : null)
  const game = row?.game_id ? model.gameById.get(row.game_id) : undefined
  const host = model.team(row?.team_id ?? game?.home_team_id)
  const detail = useQuery({ queryKey: ['game-detail', game?.id], queryFn: () => fetchGameDetail(game!.id), enabled: game?.status === 'final', staleTime: 10 * 60_000 })
  const allStops = useMemo(() => stopsQuery.data ?? [], [stopsQuery.data])
  const stop: GamedayStop | undefined = allStops.find((item) => item.season === model.year && item.game_id === game?.id)
  const city = (row?.result.city as string | undefined) ?? stop?.city ?? host?.location?.city ?? host?.school ?? 'TBA'
  const state = (row?.result.state as string | undefined) ?? stop?.state ?? host?.location?.state ?? ''

  if (!row || !game) {
    return (
      <WindowFrame className="small-window" title="COLLEGE GAMEDAY" onClose={closeWindow}>
        <div className="window-scroll"><Empty>The show's next location is added on Monday of game week.</Empty></div>
      </WindowFrame>
    )
  }

  const order = model.gameOrder(game)
  const final = game.status === 'final'
  const away = model.team(game.away_team_id)
  const home = model.team(game.home_team_id)
  const kickoff = kickoffParts(game.start_time, timeZone)
  const show = showStartTime(game.start_time)
  const showParts = show ? kickoffParts(new Date(show).toISOString(), timeZone) : null
  const photo = host ? imageUrl('gameday', host.slug, ['jpg', 'jpeg', 'webp', 'png']) : null
  const period2 = model.periodByKey.get(model.periodKeyOf(game))
  const key = placeKey({ city, state })
  const thisDate = stop?.show_date ?? game.start_time?.slice(0, 10) ?? ''
  const before = allStops.filter((item) => (item.show_date ?? '') < thisDate)
  const visit = before.filter((item) => placeKey(item) === key).length + 1
  const seasonStops = allStops.filter((item) => item.season === model.year)
  const stopIndex = stop ? seasonStops.findIndex((item) => item.stop === stop.stop) + 1 : null
  const lastHere = before.filter((item) => placeKey(item) === key).at(-1)
  const hostLine = host ? teamGameday(before, host.id, host) : null
  const visitorTeam = game.home_team_id === host?.id ? away : home
  const visitorLine = visitorTeam ? teamGameday(before, visitorTeam.id, visitorTeam) : null
  const neutral = game.neutral_site
  const spread = model.spreads.get(game.id) ?? null
  const covered = final && spread !== null && game.home_points !== null && game.away_points !== null
    ? (() => {
      const value = game.home_points - game.away_points + spread
      return value === 0 ? 'PUSH' : value > 0 ? `${abbr(home)} COVERED` : `${abbr(away)} COVERED`
    })()
    : null
  const winnerOf = (item: GamedayStop) => {
    const result = hostResult(item)
    return result === 'W' ? item.host : result === 'L' ? item.visitor : null
  }

  const side = (teamId: number, which: 'left' | 'right') => {
    const team = model.team(teamId)
    const rank = model.apRankAtKickoff(teamId, game)
    const won = final && model.winnerId(game) === teamId
    const suffix = final ? (won ? ' · WON' : '') : teamId === game.home_team_id && !neutral ? ' · HOME' : ''
    return (
      <span className="gd-side">
        <Pennant team={team} side={which} />
        <span className="cond">{rank ? `#${rank} · ` : ''}{recordText(model.record(teamId, final ? order : order - 1))}{suffix}</span>
      </span>
    )
  }

  const facts = final ? (
    <div className="gd-final">
      <div className="gd-final-head cond"><span>FINAL</span><span className="muted">{[model.favoriteText(game), covered].filter(Boolean).join(' · ')}</span></div>
      {[game.away_team_id, game.home_team_id].map((teamId, index) => {
        const won = model.winnerId(game) === teamId
        const rank = model.apRankAtKickoff(teamId, game)
        return (
          <div key={teamId} className={`gd-final-row${won ? '' : ' lost'}`}>
            <span className="at-slot cond">{index === 1 ? (neutral ? 'vs' : '@') : ''}</span>
            <span className="cond grow">{rank ? `#${rank} ` : ''}{model.team(teamId)?.school.toUpperCase()}</span>
            <strong className="cond num">{index === 1 ? game.home_points : game.away_points}</strong>
          </div>
        )
      })}
      <div className="gd-final-lines small">
        {detail.data && (() => {
          const name = (id: number) => abbr(model.team(id))
          const passer = topLine(detail.data.playerStats, 'passing', name)
          const rusher = topLine(detail.data.playerStats, 'rushing', name)
          return <>{passer && <div><span className="muted">TOP PASSER · </span>{passer}</div>}{rusher && <div><span className="muted">TOP RUSHER · </span>{rusher}</div>}</>
        })()}
        {row.guest_picker && <div><span className="muted">GUEST PICKER · </span>{row.guest_picker}</div>}
      </div>
      <button type="button" className="outline-button cond gd-button" onClick={() => openWindow({ type: 'game', gameId: game.id })}>BOX SCORE AND ALL STATS →</button>
    </div>
  ) : (
    <div className="gd-facts">
      <div><span>Kickoff</span><strong className="cond">{kickoff.day} {kickoff.time}{game.tv ? ` · ${game.tv}` : ''}</strong></div>
      <div><span>Spread</span><strong className="cond">{model.favoriteText(game) ?? 'No line yet'}</strong></div>
      <div><span>Guest picker</span><strong className="cond">{row.guest_picker ?? 'TBA'}</strong></div>
      <div><span>Show starts</span><strong className="cond">{showParts ? `${showParts.day} ${showParts.time}` : 'TBA'}</strong></div>
      <div><span>Visit to {city}</span><strong className="cond">{stopsQuery.data ? ordinal(visit) : '…'}</strong></div>
      <div><span>Stops this season</span><strong className="cond">{stopIndex ? `${stopIndex} of ${seasonStops.length}` : '—'}</strong></div>
    </div>
  )

  const story = (
    <div className="gd-story">
      <h3 className="varsity">THE GAMEDAY STORY</h3>
      {!stopsQuery.data ? <Loading /> : (
        <>
          {host && hostLine && (
            <div><span className="muted">{host.school}</span><span>{neutral ? `${ordinal(hostLine.appearances + 1)} GameDay appearance · ${hostLine.w}–${hostLine.l} overall` : `Hosts for the ${ordinal(hostLine.homeShows + 1)} time · ${hostLine.homeW}–${hostLine.homeL} at home with GameDay in town`}</span></div>
          )}
          {visitorTeam && visitorLine && (
            <div><span className="muted">{visitorTeam.school}</span><span>{ordinal(visitorLine.appearances + 1)} GameDay appearance · {visitorLine.w}–{visitorLine.l} overall{neutral ? '' : `, ${visitorLine.awayW}–${visitorLine.awayL} on the road`}</span></div>
          )}
          <div><span className="muted">Last time</span><span>{lastHere ? `GameDay in ${lastHere.city}: ${lastHere.season} · ${winnerOf(lastHere) ? `${winnerOf(lastHere)} won` : `${lastHere.visitor} @ ${lastHere.host}`}` : `First GameDay in ${city}`}</span></div>
        </>
      )}
    </div>
  )

  const stopsPanel = (
    <div className="gd-stops">
      <div className="gd-stops-head">
        <h3 className="varsity">{model.year} STOPS SO FAR</h3>
        <button type="button" className="tile-link" onClick={() => { closeWindow(); navigate('/archive?view=gameday') }}>Full history →</button>
      </div>
      {!stopsQuery.data ? <Loading /> : (
        <>
          <div className="gd-map-box">
            <Suspense fallback={<Loading />}>
              <GameDayMap stops={seasonStops.filter((item) => (item.show_date ?? '') <= thisDate)} teams={[...model.teams.values()]} highlightKey={key} small />
            </Suspense>
          </div>
          {[...seasonStops].filter((item) => (item.show_date ?? '') <= thisDate || item.stop === stop?.stop).reverse().map((item) => {
            const result = hostResult(item)
            const itemHost = model.team(item.host_team_id)
            const current = item.stop === stop?.stop
            const neutralStop = isNeutral(item, itemHost)
            const itemGame = item.game_id ? model.gameById.get(item.game_id) : undefined
            const itemPeriod = itemGame ? model.periodByKey.get(model.periodKeyOf(itemGame)) : undefined
            return (
              <button key={item.stop} type="button" className={`gd-stop-row${current ? ' current' : ''}`} disabled={!itemGame} onClick={() => itemGame && openWindow({ type: 'game', gameId: itemGame.id })}>
                <span className="muted cond">{itemPeriod?.short ?? ''}</span>
                <span className="grow truncate">{placeLabel(item)}</span>
                <span className="muted small">{abbr(model.team(item.visitor_team_id)) || item.visitor} @ {abbr(itemHost) || item.host}</span>
                <strong className={`cond num gd-result ${current && !final ? 'this' : neutralStop ? 'neutral' : result === 'W' ? 'win' : result === 'L' ? 'loss' : ''}`}>
                  {current && !final ? 'THIS WEEK' : result ? (neutralStop ? `${Math.max(item.host_points!, item.visitor_points!)}–${Math.min(item.host_points!, item.visitor_points!)}` : `${result} ${item.host_points}–${item.visitor_points}`) : ''}
                </strong>
              </button>
            )
          })}
        </>
      )}
    </div>
  )

  return (
    <WindowFrame className="gd-window" onClose={closeWindow}>
      <div className={mobile ? 'window-scroll gd-scroll' : 'gd-scroll'}>
        <header className="gd-hero" style={{ background: teamColor(host), backgroundImage: photo ? `linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,.1) 70%), url(${photo})` : undefined }}>
          <div className="gd-hero-copy">
            <span className="varsity gd-kicker">COLLEGE GAMEDAY · {period2?.short ?? `WEEK ${game.week}`}{final ? ' · FINAL' : ''}</span>
            <h2 className="varsity gd-city">{city.toUpperCase()}</h2>
            <span className="varsity gd-state">{state.toUpperCase()}</span>
          </div>
          <div className="gd-matchup">
            {side(game.away_team_id, 'left')}
            <span className="varsity gd-at">{neutral ? 'VS' : '@'}</span>
            {side(game.home_team_id, 'right')}
          </div>
        </header>
        <div className="gd-body">
          <div className="gd-left">
            {facts}
            {story}
            {!final && <button type="button" className="outline-button cond gd-button" onClick={() => openWindow({ type: 'game', gameId: game.id })}>OPEN GAME WINDOW →</button>}
          </div>
          {stopsPanel}
        </div>
      </div>
    </WindowFrame>
  )
}
