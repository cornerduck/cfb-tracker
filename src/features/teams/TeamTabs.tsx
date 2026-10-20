import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { fetchCoaches, fetchTeamHistory, fetchTeamPlayers } from '../../data/queries'
import { abbr, confName, recordText, type SeasonModel } from '../../data/model'
import type { Game, PlayerSeasonStat, Team } from '../../data/types'
import { GameTile } from '../../shared/GameTile'
import { dayMonth, kickoffParts, number } from '../../shared/format'
import { statNumber } from '../../shared/stats'
import { Empty, ErrorBox, Loading, Plate, Tile } from '../../shared/ui'
import { gameText } from '../rankings/Rankings'
import { useTeamStats } from '../stats/Stats'
import { METRICS, formatMetric, type TeamStatLine } from '../stats/teamStats'

// ---------------------------------------------------------------- shared

function useTeamPlayers(year: number, teamId: number) {
  return useQuery({ queryKey: ['team-players', year, teamId], queryFn: () => fetchTeamPlayers(year, teamId), staleTime: 30 * 60_000 })
}

export function useTeamHistory(teamId: number) {
  return useQuery({ queryKey: ['team-history', teamId], queryFn: () => fetchTeamHistory(teamId), staleTime: 30 * 60_000 })
}

type Leader = { label: string; short: string; row: PlayerSeasonStat; text: string }

function teamLeaders(rows: PlayerSeasonStat[]): Leader[] {
  const best = (category: string, key: string) => rows.filter((row) => row.category === category)
    .sort((a, b) => statNumber(b.stats, key) - statNumber(a.stats, key))[0]
  const list: Array<Leader | null> = []
  const passer = best('passing', 'YDS')
  if (passer) list.push({ label: 'PASSING', short: passer.position ?? 'QB', row: passer, text: `${passer.stats.COMPLETIONS}/${passer.stats.ATT} · ${number(statNumber(passer.stats, 'YDS'))} yds · ${passer.stats.TD} TD · ${passer.stats.INT} INT` })
  const rusher = best('rushing', 'YDS')
  if (rusher) list.push({ label: 'RUSHING', short: rusher.position ?? 'RB', row: rusher, text: `${rusher.stats.CAR} car · ${number(statNumber(rusher.stats, 'YDS'))} yds · ${rusher.stats.TD} TD` })
  const receiver = best('receiving', 'YDS')
  if (receiver) list.push({ label: 'RECEIVING', short: receiver.position ?? 'WR', row: receiver, text: `${receiver.stats.REC} rec · ${number(statNumber(receiver.stats, 'YDS'))} yds · ${receiver.stats.TD} TD` })
  const tackler = best('defensive', 'TOT')
  if (tackler) list.push({ label: 'TACKLES', short: tackler.position ?? 'LB', row: tackler, text: `${tackler.stats.TOT} tkl${statNumber(tackler.stats, 'TFL') ? ` · ${tackler.stats.TFL} TFL` : ''}` })
  const rusherD = best('defensive', 'SACKS')
  if (rusherD && statNumber(rusherD.stats, 'SACKS')) list.push({ label: 'SACKS', short: rusherD.position ?? 'DL', row: rusherD, text: `${rusherD.stats.SACKS} sacks` })
  const hawk = best('interceptions', 'INT')
  if (hawk && statNumber(hawk.stats, 'INT')) list.push({ label: 'INTERCEPTIONS', short: hawk.position ?? 'DB', row: hawk, text: `${hawk.stats.INT} INT` })
  return list.filter((item): item is Leader => item !== null)
}

function StatBox({ line, metricKey, label }: { line: TeamStatLine | undefined; metricKey: string; label?: string }) {
  const metric = METRICS[metricKey]
  const rank = line?.ranks[metricKey]
  return (
    <div className="stat-box">
      <span className="muted small">{label ?? metric.label}</span>
      <span><strong className="cond num">{formatMetric(metric, line?.values[metricKey] ?? null)}</strong>{rank ? <small className="muted num"> #{rank} FBS</small> : null}</span>
    </div>
  )
}

function LeadersTile({ model, team, title, compact = false }: { model: SeasonModel; team: Team; title: string; compact?: boolean }) {
  const { openWindow } = useApp()
  const players = useTeamPlayers(model.year, team.id)
  const leaders = useMemo(() => teamLeaders(players.data ?? []), [players.data])
  return (
    <Tile title={title}>
      {players.error ? <ErrorBox message={(players.error as Error).message} /> : !players.data ? <Loading /> : leaders.length ? leaders.slice(0, compact ? 4 : 6).map((leader) => (
        <button key={leader.label} type="button" className="team-leader" onClick={() => openWindow({ type: 'player', playerId: leader.row.player_id, name: leader.row.player_name, teamId: team.id })}>
          <span className="cond muted small team-leader-label">{compact ? leader.short : leader.label}</span>
          <span className="truncate team-leader-name">{leader.row.player_name}</span>
          <span className="muted small num team-leader-line">{leader.text}</span>
        </button>
      )) : <Empty>Player statistics appear after the first weekly update.</Empty>}
    </Tile>
  )
}

// ---------------------------------------------------------------- overview

function RankChart({ model, teamId }: { model: SeasonModel; teamId: number }) {
  const releases = model.pollReleases('AP')
  if (!releases.length) return <Empty>No AP Poll released yet.</Empty>
  const points = releases.map((release) => ({ label: release.label === 'Preseason' ? 'PRE' : release.label === 'Final' ? 'FIN' : release.label.replace(/^Week /, ''), rank: release.byTeam.get(teamId)?.rank ?? null }))
  const ranked = points.filter((point) => point.rank !== null)
  if (!ranked.length) return <Empty>Not ranked this season.</Empty>
  const worst = Math.max(25, ...ranked.map((point) => point.rank!))
  const width = 420
  const height = 120
  const x = (index: number) => 24 + (index * (width - 40)) / Math.max(1, points.length - 1)
  const y = (rank: number) => 10 + ((rank - 1) * (height - 30)) / (worst - 1)
  const segments: string[] = []
  let current = ''
  points.forEach((point, index) => {
    if (point.rank === null) {
      if (current) segments.push(current)
      current = ''
      return
    }
    current += `${current ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.rank).toFixed(1)}`
  })
  if (current) segments.push(current)
  const last = points.map((point, index) => ({ point, index })).filter((entry) => entry.point.rank !== null).at(-1)!
  return (
    <svg className="rank-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="AP ranking by week">
      {[1, 10, 25].map((rank) => (
        <g key={rank}>
          <line x1={20} x2={width - 10} y1={y(rank)} y2={y(rank)} className="grid" />
          <text x={0} y={y(rank) + 4} className="axis">#{rank}</text>
        </g>
      ))}
      {segments.map((path) => <path key={path} d={path} className="line" />)}
      <circle cx={x(last.index)} cy={y(last.point.rank!)} r={4} className="dot" />
      {points.map((point, index) => (index % Math.ceil(points.length / 8) === 0 || index === points.length - 1) && <text key={index} x={x(index)} y={height - 2} className="axis" textAnchor="middle">{point.label}</text>)}
    </svg>
  )
}

export function TeamOverview({ team }: { team: Team }) {
  const { model, timeZone, openWindow, mobile } = useApp()
  const { lines } = useTeamStats()
  const line = lines?.get(team.id)
  const history = useTeamHistory(team.id)
  const coaches = useQuery({ queryKey: ['coaches', team.id], queryFn: () => fetchCoaches(team.id), staleTime: 60 * 60_000 })
  const games = model.teamGames(team.id)
  const next = model.nextGame(team.id)
  const coach = coaches.data?.find((row) => row.season === model.year) ?? coaches.data?.[0]
  const titles = history.data?.seasons.filter((season) => season.champion_team_id === team.id).map((season) => season.year) ?? []
  const heismans = history.data?.seasons.filter((season) => season.heisman_finalists?.some((item) => typeof item !== 'string' && item.team_id === team.id && item.name === season.heisman_winner)).map((season) => `${season.heisman_winner} (${season.year})`) ?? []

  const schedule = (
    <Tile title={`${model.year} SCHEDULE`} className={mobile ? '' : 'scroll-y'}>
      {games.map((game) => <ScheduleRow key={game.id} model={model} team={team} game={game} timeZone={timeZone} onOpen={() => openWindow({ type: 'game', gameId: game.id })} />)}
      {!games.length && <Empty>No games scheduled.</Empty>}
    </Tile>
  )
  const middle = (
    <>
      <Tile title="NEXT GAME">
        {next ? <GameTile model={model} game={next} timeZone={timeZone} onOpen={(gameId) => openWindow({ type: 'game', gameId })} /> : <Empty>Season complete.</Empty>}
      </Tile>
      <Tile title="AP RANKING THIS SEASON"><RankChart model={model} teamId={team.id} /></Tile>
      <Tile title="TEAM STATS">
        <div className="stat-boxes stat-boxes--3">
          {['ppg', 'papg', 'ypg', 'pass', 'rush', 'margin'].map((key) => <StatBox key={key} line={line} metricKey={key} />)}
        </div>
      </Tile>
    </>
  )
  const right = (
    <>
      <LeadersTile model={model} team={team} title="TOP PLAYERS" compact />
      <Tile title="PROGRAM">
        <div className="program-row"><span className="muted">Head coach</span><span>{coach ? `${coach.coach_name}${coach.season === model.year ? '' : ` (${coach.season})`}` : '—'}</span></div>
        <div className="program-row"><span className="muted">Stadium</span><span>{[team.venue, team.capacity ? number(team.capacity) : null].filter(Boolean).join(' · ') || '—'}</span></div>
        <div className="program-row"><span className="muted">Location</span><span>{[team.location?.city, team.location?.state].filter(Boolean).join(', ') || '—'}</span></div>
        <div className="program-row"><span className="muted">National titles</span><span>{titles.length ? `${titles.length} · ${titles.join(', ')}` : history.data ? 'None since tracking began' : '…'}</span></div>
        <div className="program-row"><span className="muted">Heisman winners</span><span>{heismans.length ? heismans.join(', ') : history.data ? 'None since tracking began' : '…'}</span></div>
      </Tile>
    </>
  )
  if (mobile) return <div className="team-mobile">{middle}{schedule}{right}</div>
  return (
    <div className="team-overview-grid">
      {schedule}
      <div className="team-col scroll-y">{middle}</div>
      <div className="team-col scroll-y">{right}</div>
    </div>
  )
}

function ScheduleRow({ model, team, game, timeZone, onOpen }: { model: SeasonModel; team: Team; game: Game; timeZone: string; onOpen: () => void }) {
  const home = game.home_team_id === team.id
  const opponentId = home ? game.away_team_id : game.home_team_id
  const opponent = model.team(opponentId)
  const rank = model.apRankAtKickoff(opponentId, game)
  const text = gameText(model, team.id, game, game.status === 'final')
  const kickoff = kickoffParts(game.start_time, timeZone)
  const period = model.periodByKey.get(model.periodKeyOf(game))
  const next = model.nextGame(team.id)?.id === game.id
  return (
    <button type="button" className={`sched-row${next ? ' next' : ''}`} onClick={onOpen}>
      <span className="muted small cond">{period?.short}</span>
      <span className="muted small">{game.neutral_site ? 'vs' : home ? 'vs' : 'at'}</span>
      <Plate team={opponent} size={22} />
      <span className="grow truncate">{rank ? <span className="muted">#{rank} </span> : null}{opponent?.school ?? 'TBD'}</span>
      {game.status === 'final'
        ? <strong className={`cond num ${text.outcome === 'W' ? 'win' : 'loss'}`}>{text.outcome} {text.text.split(' ')[0]}</strong>
        : <span className="cond small">{game.status === 'in_progress' ? 'LIVE' : game.start_time && Date.parse(game.start_time) - Date.now() < 7 * 86400_000 ? `${kickoff.day.slice(0, 1)}${kickoff.day.slice(1, 3).toLowerCase()} ${kickoff.time}` : dayMonth(game.start_time, timeZone)}</span>}
      <span className="muted small num sched-line">{opponent && !opponent.is_fbs ? 'FCS' : model.favoriteText(game) ?? ''}</span>
    </button>
  )
}

// ---------------------------------------------------------------- stats

function PointsChart({ model, teamId }: { model: SeasonModel; teamId: number }) {
  const results = model.resultsThrough(teamId)
  if (!results.length) return <Empty>No games played yet.</Empty>
  const max = Math.max(...results.flatMap((result) => [result.pf, result.pa]), 1)
  return (
    <div className="points-chart">
      {results.map((result) => (
        <div key={result.game.id} className="points-game">
          <span className="small num">{result.pf}–{result.pa}</span>
          <div className="points-bars">
            <span className="pf" style={{ height: `${(result.pf / max) * 100}%` }} />
            <span className="pa" style={{ height: `${(result.pa / max) * 100}%` }} />
          </div>
          <span className="muted small cond">{abbr(model.team(result.opponentId))}</span>
        </div>
      ))}
    </div>
  )
}

export function TeamStatsTab({ team }: { team: Team }) {
  const { model, mobile } = useApp()
  const { lines, error, retry } = useTeamStats()
  const players = useTeamPlayers(model.year, team.id)
  const line = lines?.get(team.id)
  const kicker = (players.data ?? []).filter((row) => row.category === 'kicking').sort((a, b) => statNumber(b.stats, 'FGA') - statNumber(a.stats, 'FGA'))[0]
  if (error) return <ErrorBox message={error.message} onRetry={retry} />
  if (!lines) return <Loading label="Loading team statistics…" />
  if (!line) return <Empty>Statistics for {team.school} appear after the first weekly update.</Empty>
  const offense = <Tile title="OFFENSE"><div className="stat-boxes">{['ppg', 'ypg', 'pass', 'rush', 'ypp', 'third'].map((key) => <StatBox key={key} line={line} metricKey={key} />)}</div></Tile>
  const defense = <Tile title="DEFENSE"><div className="stat-boxes">{['papg', 'yapg', 'sacks', 'takeaways', 'thirdA', 'tfl'].map((key) => <StatBox key={key} line={line} metricKey={key} />)}</div></Tile>
  const special = (
    <Tile title="SPECIAL TEAMS">
      <div className="stat-boxes">
        <div className="stat-box"><span className="muted small">FG made</span><span><strong className="cond num">{kicker ? `${kicker.stats.FGM ?? 0} / ${kicker.stats.FGA ?? 0}` : '—'}</strong></span></div>
        <StatBox line={line} metricKey="kr" />
        <StatBox line={line} metricKey="pr" />
        <StatBox line={line} metricKey="margin" />
      </div>
    </Tile>
  )
  const chart = <Tile title="POINTS BY GAME" action="SCORED · ALLOWED"><PointsChart model={model} teamId={team.id} /></Tile>
  const leaders = <LeadersTile model={model} team={team} title="TEAM LEADERS" />
  if (mobile) return <div className="team-mobile">{offense}{defense}{special}{chart}{leaders}</div>
  return (
    <div className="team-stats-grid">
      {offense}{defense}
      <div className="team-stats-leaders">{leaders}</div>
      {special}{chart}
    </div>
  )
}

// ---------------------------------------------------------------- history

export function TeamHistoryTab({ team }: { team: Team }) {
  const { model, mobile } = useApp()
  const history = useTeamHistory(team.id)
  if (history.error) return <ErrorBox message={(history.error as Error).message} onRetry={() => void history.refetch()} />
  if (!history.data) return <Loading label="Loading program history…" />
  const { teamSeasons, games, seasons, polls, upsetsWon } = history.data
  const seasonByYear = new Map(seasons.map((season) => [season.year, season]))
  const won = (game: Game) => (game.home_team_id === team.id ? (game.home_points ?? 0) > (game.away_points ?? 0) : (game.away_points ?? 0) > (game.home_points ?? 0))
  const finals = games.filter((game) => game.status === 'final' && game.home_points !== null && game.away_points !== null)
  const name = (id: number) => (id === team.id ? team.school : model.team(id)?.school ?? 'Opponent')

  const rows = teamSeasons.map((row) => {
    const season = seasonByYear.get(row.season)
    const own = finals.filter((game) => game.season === row.season)
    const conf = own.filter((game) => game.conference_game && game.season_type === 'regular' && !/championship/i.test(game.notes ?? ''))
    const confRecord = { w: conf.filter(won).length, l: conf.filter((game) => !won(game)).length, t: 0 }
    const seasonPolls = polls.filter((poll) => poll.season === row.season)
    const lastPoll = [...seasonPolls].sort((a, b) => (a.season_type === b.season_type ? a.week - b.week : a.season_type === 'regular' ? -1 : 1)).at(-1)
    const finalRank = row.final_ranking ?? (season?.status === 'archived' ? lastPoll?.rank ?? null : null)
    const post = own.filter((game) => game.season_type === 'postseason')
    const lastPost = post.sort((a, b) => Date.parse(a.start_time ?? '') - Date.parse(b.start_time ?? '')).at(-1)
    const opponent = lastPost ? (lastPost.home_team_id === team.id ? lastPost.away_team_id : lastPost.home_team_id) : null
    const score = lastPost ? `${Math.max(lastPost.home_points!, lastPost.away_points!)}–${Math.min(lastPost.home_points!, lastPost.away_points!)}` : ''
    const postseason = season?.champion_team_id === team.id
      ? `National champion${lastPost && opponent ? ` · beat ${name(opponent)} ${score}` : ''}`
      : row.postseason_result ?? (lastPost && opponent ? `${won(lastPost) ? 'W' : 'L'} ${score} vs ${name(opponent)}${lastPost.bowl_name ? ` · ${lastPost.bowl_name}` : lastPost.cfp_round ? ` · CFP ${lastPost.cfp_round}` : ''}` : season?.status === 'live' ? 'In progress' : '—')
    const conference = row.conference_id ? model.conferences.get(row.conference_id) : null
    const confTitle = own.find((game) => game.season_type !== 'postseason' && /championship/i.test(game.notes ?? '') && game.conference_game && won(game))
    return { row, season, record: { w: row.wins, l: row.losses, t: row.ties }, confRecord, finalRank, postseason, conference, confTitle, weeksRanked: seasonPolls.length, weeksAtOne: seasonPolls.filter((poll) => poll.rank === 1).length }
  })
  const first = Math.min(...rows.map((entry) => entry.row.season), model.year)
  const total = rows.reduce((sum, entry) => ({ w: sum.w + entry.record.w, l: sum.l + entry.record.l, t: sum.t + entry.record.t }), { w: 0, l: 0, t: 0 })
  const honors: Array<{ year: number; text: string }> = []
  for (const entry of rows) {
    if (entry.season?.champion_team_id === team.id) honors.push({ year: entry.row.season, text: 'National champions' })
    if (entry.confTitle) honors.push({ year: entry.row.season, text: `${confName(entry.conference)} champions` })
    const heisman = entry.season?.heisman_finalists?.find((item) => typeof item !== 'string' && item.team_id === team.id && item.name === entry.season?.heisman_winner)
    if (heisman && typeof heisman !== 'string') honors.push({ year: entry.row.season, text: `Heisman Trophy · ${heisman.name}` })
  }

  const table = (
    <Tile title="SEASONS TRACKED" action={mobile ? undefined : 'Grows by one row every year'}>
      <div className="history-table">
        {!mobile && <div className="history-row history-head cond"><span>SEASON</span><span>RECORD</span><span>CONF</span><span>FINAL</span><span>CONFERENCE</span><span>POSTSEASON</span></div>}
        {rows.map((entry) => (
          <div key={entry.row.season} className={`history-row${entry.season?.status === 'live' ? ' current' : ''}`}>
            <strong className="cond num history-year">{entry.row.season}{entry.season?.status === 'live' && <span className="pill-tag cond">CURRENT</span>}</strong>
            <strong className="cond num">{recordText(entry.record)}</strong>
            <span className="num">{recordText(entry.confRecord)}</span>
            <strong className="cond num">{entry.finalRank ? `#${entry.finalRank}` : '—'}</strong>
            <span className="truncate">{confName(entry.conference)}</span>
            <span className="history-post">{entry.postseason}</span>
          </div>
        ))}
      </div>
    </Tile>
  )
  const since = (
    <Tile title={`SINCE ${first}`}>
      <div className="stat-boxes">
        <div className="stat-box"><span className="muted small">Record</span><strong className="cond num">{recordText(total)}</strong></div>
        <div className="stat-box"><span className="muted small">Weeks ranked</span><strong className="cond num">{rows.reduce((sum, entry) => sum + entry.weeksRanked, 0)}</strong></div>
        <div className="stat-box"><span className="muted small">Weeks at #1</span><strong className="cond num">{rows.reduce((sum, entry) => sum + entry.weeksAtOne, 0)}</strong></div>
        <div className="stat-box"><span className="muted small">Upsets of the week</span><strong className="cond num">{upsetsWon.length}</strong></div>
      </div>
    </Tile>
  )
  const honorTile = (
    <Tile title="HONORS">
      {honors.length ? honors.map((honor) => (
        <div key={`${honor.year}-${honor.text}`} className="program-row"><span className="muted num">{honor.year}</span><span>{honor.text}</span></div>
      )) : <Empty>No titles since tracking began.</Empty>}
    </Tile>
  )
  if (mobile) return <div className="team-mobile">{since}{table}{honorTile}</div>
  return (
    <div className="team-history-grid">
      {table}
      <div className="team-col">{since}{honorTile}</div>
    </div>
  )
}
