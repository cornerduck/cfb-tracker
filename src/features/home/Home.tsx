import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { fetchPlayerSeason } from '../../data/queries'
import { type SeasonModel, recordText } from '../../data/model'
import type { Game, WeeklyAward } from '../../data/types'
import { GameTile } from '../../shared/GameTile'
import { shortDateTime } from '../../shared/format'
import { Empty, Flame, Movement, Plate, PlayerAvatar, Tile } from '../../shared/ui'
import { playerLine } from '../../shared/stats'
import { GameDayTile } from './GameDayTile'
import { OffseasonHome, offseasonState } from './Offseason'

const AWARD_ORDER: WeeklyAward['award_type'][] = ['upset', 'game', 'blowout', 'performance']
const AWARD_LABEL: Record<WeeklyAward['award_type'], string> = {
  upset: 'UPSET OF THE WEEK',
  game: 'GAME OF THE WEEK',
  blowout: 'BLOWOUT OF THE WEEK',
  performance: 'PERFORMANCE OF THE WEEK',
}
const AWARD_COLOR: Record<WeeklyAward['award_type'], string> = {
  upset: '#F08A3C',
  game: '#F2F3F5',
  blowout: '#8E949C',
  performance: '#4CC38A',
}

export function resultLine(model: SeasonModel, teamId: number, game: Game) {
  const home = game.home_team_id === teamId
  const pf = home ? game.home_points : game.away_points
  const pa = home ? game.away_points : game.home_points
  const opponentId = home ? game.away_team_id : game.home_team_id
  const rank = model.apRankAtKickoff(opponentId, game)
  const where = game.neutral_site ? 'vs' : home ? 'vs' : '@'
  const outcome = pf === null || pa === null ? '' : pf > pa ? 'W' : pf < pa ? 'L' : 'T'
  return {
    outcome,
    score: pf === null || pa === null ? '' : `${pf}–${pa}`,
    text: `${where} ${rank ? `#${rank} ` : ''}${model.team(opponentId)?.school ?? 'TBD'}`,
  }
}

export function nextLine(model: SeasonModel, teamId: number, timeZone: string) {
  const game = model.nextGame(teamId)
  if (!game) return null
  const home = game.home_team_id === teamId
  const opponentId = home ? game.away_team_id : game.home_team_id
  const rank = model.apRankAtKickoff(opponentId, game)
  return `${shortDateTime(game.start_time, timeZone)} ${game.neutral_site || home ? 'vs' : '@'} ${rank ? `#${rank} ` : ''}${model.team(opponentId)?.school ?? 'TBD'}`
}

function AwardCard({ award, model }: { award: WeeklyAward; model: SeasonModel }) {
  const { openWindow } = useApp()
  const game = award.game_id ? model.gameById.get(award.game_id) : undefined
  const details = award.details as Record<string, unknown>
  const isPlayer = award.award_type === 'performance'
  let sub = ''
  if (award.award_type === 'upset' && game) {
    const winner = model.team(Number(details.winner_team_id))
    const spread = details.winner_spread
    sub = typeof spread === 'number' ? `${winner?.school ?? ''} won as a ${spread}-point underdog` : `${winner?.school ?? ''} beat an FBS team`
  } else if (award.award_type === 'game') {
    sub = details.overtime ? 'Decided in overtime' : `Decided by ${details.margin} point${details.margin === 1 ? '' : 's'}`
  } else if (award.award_type === 'blowout') {
    sub = `Margin of ${details.margin} points`
  } else if (isPlayer) {
    sub = playerLine(String(details.position ?? ''), (details.line ?? {}) as Record<string, number>)
  }
  const stunner = award.award_type === 'upset' && details.tier === 'stunner'
  const open = () => {
    if (isPlayer && award.player_id) openWindow({ type: 'player', playerId: award.player_id, name: String(details.player_name ?? ''), teamId: Number(details.team_id) })
    else if (game) openWindow({ type: 'game', gameId: game.id })
  }
  return (
    <button type="button" className="award-card" onClick={open}>
      <span className="award-bar" style={{ background: AWARD_COLOR[award.award_type] }} />
      <span className="award-label cond">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
        {AWARD_LABEL[award.award_type]}
      </span>
      {isPlayer ? (
        <span className="award-result cond">
          <Plate team={model.team(Number(details.team_id))} size={30} />
          <span className="truncate">{String(details.player_name ?? '').toUpperCase()}</span>
        </span>
      ) : game ? (
        <span className="award-result cond num">
          <Plate team={model.team(game.away_team_id)} size={30} />{game.away_points}
          <span className="award-at">{game.neutral_site ? 'vs' : '@'}</span>
          {model.apRankAtKickoff(game.home_team_id, game) && <span className="award-rank">#{model.apRankAtKickoff(game.home_team_id, game)}</span>}
          <Plate team={model.team(game.home_team_id)} size={30} />{game.home_points}
        </span>
      ) : null}
      <span className="award-sub">{sub}</span>
      {stunner && <span className="stamp stamp--stunner stamp--corner cond">STUNNER</span>}
    </button>
  )
}

export function Home() {
  const { model, seasons } = useApp()
  const [params] = useSearchParams()
  // ?offseason=preview shows the offseason screen at any time.
  const state = useMemo(() => offseasonState(model, seasons, Date.now(), params.get('offseason') === 'preview'), [model, seasons, params])
  return state ? <OffseasonHome state={state} /> : <SeasonHome />
}

function SeasonHome() {
  const app = useApp()
  const { model, period, timeZone, favorites, openWindow, mobile } = app
  const navigate = useNavigate()
  const order = period?.order ?? 0

  const awards = useMemo(() => {
    if (!period) return []
    const week = model.awardWeekFor(period)
    return AWARD_ORDER.map((type) => model.bundle.awards.find((award) => award.week === week && award.award_type === type))
      .filter((award): award is WeeklyAward => Boolean(award))
  }, [model, period])

  const poll = model.pollAfter('AP', order)
  const previous = poll ? model.previousRelease(poll) : null
  const top5 = poll?.ranked.slice(0, 5) ?? []

  const heisman = useMemo(() => {
    const week = period ? model.awardWeekFor(period) : 0
    const weekly = model.bundle.heismanWeekly.filter((row) => row.week === week)
    const rows = weekly.length ? weekly : model.bundle.heismanTracker
    return [...rows].sort((a, b) => a.rank - b.rank).slice(0, 4)
  }, [model, period])
  const heismanStats = useQuery({
    queryKey: ['player-season', model.year, heisman.map((row) => row.player_id).join(',')],
    queryFn: () => fetchPlayerSeason(model.year, heisman.map((row) => row.player_id)),
    enabled: heisman.length > 0,
    staleTime: 10 * 60_000,
  })
  const leaderStats = (playerId: string) => {
    const rows = (heismanStats.data ?? []).filter((row) => row.player_id === playerId)
    const position = rows.find((row) => row.position)?.position ?? ''
    const line: Record<string, number> = {}
    for (const row of rows) {
      const stats = row.stats as Record<string, number>
      if (row.category === 'passing') Object.assign(line, { pass_yds: stats.YDS, pass_td: stats.TD, int: stats.INT })
      if (row.category === 'rushing') Object.assign(line, { rush_yds: stats.YDS, rush_td: stats.TD })
      if (row.category === 'receiving') Object.assign(line, { rec: stats.REC, rec_yds: stats.YDS, rec_td: stats.TD })
    }
    return { position, line }
  }

  // The games of the week ranked by interest: upsets, ranked teams and ranked against ranked.
  const weekGames = useMemo(() => {
    if (!period) return { finals: [] as Game[], upcoming: [] as Game[] }
    const weight = (game: Game) => {
      const upset = model.upset(game)
      const ranks = [game.home_team_id, game.away_team_id].map((id) => model.apRankAtKickoff(id, game))
      return (upset ? 60 + (upset.winnerSpread ?? 25) : 0) +
        ranks.reduce<number>((sum, rank) => sum + (rank ? 26 - rank : 0), 0) +
        (ranks.every(Boolean) ? 20 : 0)
    }
    const sorted = [...model.gamesIn(period.key)].sort((a, b) => weight(b) - weight(a))
    return { finals: sorted.filter((game) => game.status !== 'scheduled'), upcoming: sorted.filter((game) => game.status === 'scheduled') }
  }, [model, period])
  // While the awards of the week are missing, the strip shows the four best games still to be played.
  const preview = useMemo(() => (awards.length ? [] : weekGames.upcoming.slice(0, 4)), [awards, weekGames])
  const showingPreview = preview.length > 0
  const results = useMemo(() => {
    if (weekGames.finals.length) return weekGames.finals.slice(0, 4)
    return weekGames.upcoming.slice(showingPreview ? 4 : 0, showingPreview ? 8 : 4)
  }, [weekGames, showingPreview])
  const resultsTitle = weekGames.finals.length || !showingPreview ? 'BIGGEST RESULTS' : 'MORE GAMES TO WATCH'
  const previewTile = (game: Game, index: number) => (
    <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={(gameId) => openWindow({ type: 'game', gameId })} header={index === 0 ? 'GAME OF THE WEEK' : 'MATCHUP TO WATCH'} />
  )

  const mine = [...favorites].map((teamId) => model.team(teamId)).filter((team) => team && model.fbsIds.has(team.id))
  const unbeaten = model.unbeatenAfter(order)

  const top5Tile = (
    <Tile title="AP TOP 5" action="Full rankings →" onAction={() => navigate('/rankings')} className="home-top5">
      {top5.length ? top5.map((row) => {
        const team = model.team(row.team_id)
        return (
          <button key={row.team_id} type="button" className={`top5-row${row.rank === 1 ? ' first' : ''}`} onClick={() => openWindow({ type: 'top25' })}>
            <span className="top5-rank cond num">{row.rank}</span>
            <Plate team={team} size={mobile ? 24 : 30} />
            <span className="top5-name cond truncate">{team?.school.toUpperCase()}</span>
            <Flame count={model.flame(row.team_id, order)} size={13} />
            <span className="grow" />
            <span className="top5-record cond num">{recordText(model.record(row.team_id, order))}</span>
            {!mobile && <Movement current={row.rank} previous={previous?.byTeam.get(row.team_id)?.rank ?? null} isNew={Boolean(previous) && !previous?.byTeam.has(row.team_id)} />}
          </button>
        )
      }) : <Empty>The AP Poll appears after its first release.</Empty>}
    </Tile>
  )

  const heismanTile = (
    <Tile title="HEISMAN RACE" action="Full tracker →" onAction={() => navigate('/stats?view=heisman')} className="home-heisman">
      {heisman.length ? heisman.map((row, index) => {
        const team = model.team(row.team_id)
        if (index === 0) {
          const stats = leaderStats(row.player_id)
          return (
            <button key={row.player_id} type="button" className="heisman-leader" onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
              <span className="heisman-rank cond num">1</span>
              <PlayerAvatar playerId={row.player_id} team={team} size={48} />
              <span className="heisman-copy">
                <span className="cond heisman-name truncate">{row.player_name.toUpperCase()}</span>
                <span className="muted small truncate">{[stats.position, team?.school, playerLine('', stats.line)].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="cond num heisman-score">{(row.score * 100).toFixed(1)}</span>
            </button>
          )
        }
        if (mobile && index > 2) return null
        return (
          <button key={row.player_id} type="button" className="heisman-row" onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
            <span className="cond num muted heisman-row-rank">{row.rank}</span>
            <PlayerAvatar playerId={row.player_id} team={team} size={28} />
            <span className="grow truncate">{row.player_name}{leaderStats(row.player_id).position ? ` · ${leaderStats(row.player_id).position}` : ''}</span>
            <span className="cond num secondary">{(row.score * 100).toFixed(1)}</span>
          </button>
        )
      }) : <Empty>The tracker starts after the first games.</Empty>}
    </Tile>
  )

  const resultsTile = (
    <Tile title={resultsTitle} action={mobile ? 'All →' : 'All scores →'} onAction={() => navigate('/scores')} className="home-results">
      {results.length ? (
        <div className="results-grid">
          {results.map((game) => <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={(gameId) => openWindow({ type: 'game', gameId })} compact />)}
        </div>
      ) : <Empty>No games this week.</Empty>}
    </Tile>
  )

  const myTeamsTile = (
    <Tile title="MY TEAMS" action="Edit" onAction={() => openWindow({ type: 'favorites' })} className="home-mine">
      {mine.length ? mine.map((team) => {
        const last = model.lastResult(team!.id, order)
        const line = last ? resultLine(model, team!.id, last.game) : null
        const rank = model.apRankAfter(team!.id, order)
        const next = nextLine(model, team!.id, timeZone)
        return (
          <button key={team!.id} type="button" className="mine-row" onClick={() => navigate(`/teams/${team!.slug}`)}>
            <Plate team={team} size={40} />
            <span className="mine-copy">
              <span className="mine-top">
                <span className="cond mine-name">{team!.school.toUpperCase()}</span>
                <span className="cond num muted">{rank ? `#${rank}` : ''}{rank ? ' · ' : ''}{recordText(model.record(team!.id, order))}</span>
                <Flame count={model.flame(team!.id, order)} size={13} />
              </span>
              <span className="muted small truncate">
                {line && <><span className={line.outcome === 'W' ? 'win' : line.outcome === 'L' ? 'loss' : ''}>{line.outcome}</span> {line.score} {line.text}</>}
                {line && next ? ' · ' : ''}{next ? `Next: ${next}` : ''}
              </span>
            </span>
          </button>
        )
      }) : <Empty>No favorite teams yet. Star teams in Teams to follow them here.</Empty>}
    </Tile>
  )

  if (mobile) {
    return (
      <div className="home-mobile">
        <section>
          <h2 className="section-title cond">{showingPreview ? 'GAMES TO WATCH' : 'WEEKLY AWARDS'}</h2>
          {awards.length ? <div className="scroll-row">{awards.map((award) => <AwardCard key={award.award_type} award={award} model={model} />)}</div>
            : showingPreview ? <div className="scroll-row">{preview.map(previewTile)}</div>
              : <Empty>Weekly awards are calculated on Sunday.</Empty>}
        </section>
        <GameDayTile />
        {top5Tile}
        {resultsTile}
        {myTeamsTile}
        {heismanTile}
        <Tile title="UNDEFEATED WATCH" action="Timeline →" onAction={() => openWindow({ type: 'undefeated' })}>
          <div className="unbeaten-mobile">
            <span className="cond num big-number">{unbeaten.length}</span>
            <span className="muted">unbeaten teams left</span>
          </div>
          <div className="unbeaten-strip">
            {unbeaten.slice(0, 8).map((teamId) => <Plate key={teamId} team={model.team(teamId)} size={24} />)}
            {unbeaten.length > 8 && <span className="cond more-count">+{unbeaten.length - 8}</span>}
          </div>
        </Tile>
      </div>
    )
  }

  return (
    <div className="home">
      <div className="page-head">
        <h1 className="cond">{period?.label.toUpperCase() ?? 'PRESEASON'}</h1>
        <span className="grow" />
        <button type="button" className="undefeated-pill" onClick={() => openWindow({ type: 'undefeated' })}>
          <span className="cond">UNDEFEATED WATCH</span>
          <span className="cond num">{unbeaten.length}</span>
          <span className="muted">teams left</span>
        </button>
      </div>
      {showingPreview && <p className="award-note"><span className="cond">GAMES TO WATCH</span><span className="muted small">The weekly awards follow after Sunday's games.</span></p>}
      <section className="award-grid" aria-label={showingPreview ? 'Games to watch' : 'Weekly awards'}>
        {awards.length ? awards.map((award) => <AwardCard key={award.award_type} award={award} model={model} />)
          : showingPreview ? preview.map(previewTile)
            : <div className="award-empty muted">Weekly awards are calculated on Sunday after the week's games.</div>}
      </section>
      <div className="home-grid">
        {top5Tile}
        {heismanTile}
        {resultsTile}
        {myTeamsTile}
        <GameDayTile />
      </div>
    </div>
  )
}
