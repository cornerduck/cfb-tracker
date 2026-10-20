import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { SeasonScope } from '../../app/SeasonScope'
import { fetchAllTime } from '../../data/queries'
import { abbr, confAbbr, recordText, teamColor, type SeasonModel } from '../../data/model'
import { conferenceLeader, conferenceStandings } from '../../data/standings'
import type { Game, Season, Team } from '../../data/types'
import { ConfTag, Empty, ErrorBox, Loading, Plate, Tabs, Tile, imageUrl } from '../../shared/ui'
import { seasonUpsets } from '../../data/upsets'
import { Scores } from '../scores/Scores'
import { Bracket } from '../rankings/Bracket'
import { GameDayHistory } from '../gameday/GameDayHistory'
import { isNeutral, useGamedayStops } from '../gameday/data'

const VIEWS = ['SEASONS', 'ALL TIME', 'GAMEDAY HISTORY'] as const
type View = typeof VIEWS[number]

const finalistsOf = (season: Season | null) =>
  (season?.heisman_finalists ?? []).map((item) => (typeof item === 'string' ? { name: item, team: '', team_id: null } : item))

const scoreLine = (model: SeasonModel, game: Game) => {
  const winner = model.winnerId(game)
  const sides = [
    { id: game.home_team_id, points: game.home_points ?? 0 },
    { id: game.away_team_id, points: game.away_points ?? 0 },
  ].sort((a) => (a.id === winner ? -1 : 1))
  return sides.map((side) => `${abbr(model.team(side.id))} ${side.points}`).join(' · ')
}


function UpsetRow({ model, game, spread, index }: { model: SeasonModel; game: Game; spread: number | null; index?: number }) {
  const { openWindow } = useApp()
  const winner = model.winnerId(game)
  const loser = winner === game.home_team_id ? game.away_team_id : game.home_team_id
  const loserRank = model.apRankAtKickoff(loser, game)
  const winnerHome = winner === game.home_team_id && !game.neutral_site
  const period = model.periodByKey.get(model.periodKeyOf(game))
  return (
    <button type="button" className="archive-upset" onClick={() => openWindow({ type: 'game', gameId: game.id })}>
      {index !== undefined && <span className="muted num">{index}</span>}
      <strong className={`cond num ${spread === null || spread >= 21 ? 'tier-stunner' : 'tier-big'}`}>{spread === null ? 'FCS' : `+${spread}`}</strong>
      <span className="grow truncate">{model.team(winner)?.school} {winnerHome ? 'vs' : game.neutral_site ? 'vs' : '@'} {loserRank ? `#${loserRank} ` : ''}{model.team(loser)?.school}</span>
      <span className="muted small cond">{period?.short ?? ''}</span>
    </button>
  )
}

function SeasonView({ onSub }: { onSub: (sub: 'games' | 'bracket') => void }) {
  const { model, openWindow, mobile } = useApp()
  const navigate = useNavigate()
  const [full25, setFull25] = useState(false)
  const season = model.bundle.season
  const live = season?.status !== 'archived'
  const year = model.year
  const finalAp = model.pollReleases('AP').at(-1) ?? null
  const champion = model.team(season?.champion_team_id)
  const titleGame = season?.title_game_id ? model.gameById.get(season.title_game_id) ?? null : null
  const leader = finalAp?.ranked[0] ? model.team(finalAp.ranked[0].team_id) : null
  const hero = champion ?? (live ? leader : null)
  const photo = imageUrl('champions', year, ['jpg', 'jpeg', 'webp', 'png'])
  const finalists = finalistsOf(season)
  const cfpGames = model.games.filter((game) => game.cfp_round)
  const seedOne = cfpGames.flatMap((game) => [game.home_seed === 1 ? game.home_team_id : null, game.away_seed === 1 ? game.away_team_id : null]).find((id) => id !== null) ?? null
  const runnerUp = titleGame && titleGame.status === 'final' ? (model.winnerId(titleGame) === titleGame.home_team_id ? titleGame.away_team_id : titleGame.home_team_id) : null
  const upsets = useMemo(() => seasonUpsets(model).slice(0, 5), [model])
  const conferences = useMemo(() => model.conferenceList().filter((conference) => confAbbr(conference) !== 'IND').map((conference) => {
    const standings = conferenceStandings(model, conference.id)
    return { conference, teamId: conferenceLeader(standings), decided: Boolean(standings?.champion) || !live }
  }), [model, live])
  const unbeaten = model.team(season?.last_unbeaten_team_id)
  const tracker = [...model.bundle.heismanTracker].sort((a, b) => a.rank - b.rank)
  const gamedayStops = model.bundle.gameday.length

  const banner = (
    <section className="champion-banner" style={{ background: `linear-gradient(100deg, ${teamColor(hero)} 0%, ${teamColor(hero)}cc 55%, #15171A 100%)` }}>
      <div className="champion-copy">
        <span className="cond champion-kicker">{champion ? `${year} NATIONAL CHAMPIONS` : live ? `${year} SEASON · IN PROGRESS` : `${year} SEASON`}</span>
        <h2 className="varsity champion-name">{(hero?.school ?? 'TBD').toUpperCase()}</h2>
        {hero && <span className="cond champion-mascot">{champion ? hero.mascot?.toUpperCase() : 'NO. 1 IN THE AP POLL'}</span>}
        {titleGame && titleGame.status === 'final' && <span className="champion-score cond"><small>TITLE GAME</small> {scoreLine(model, titleGame)}</span>}
        <button type="button" className="outline-button cond champion-link" onClick={() => (live ? navigate('/scores') : onSub('games'))}>EVERY {year} GAME AND BOX SCORE →</button>
      </div>
      {photo && !mobile && <img className="champion-photo" src={photo} alt="" />}
    </section>
  )

  const heisman = (
    <Tile title="HEISMAN TROPHY" className="archive-heisman">
      {season?.heisman_winner ? finalists.map((finalist) => {
        const team = model.team(finalist.team_id)
        const winner = finalist.name === season.heisman_winner
        return (
          <div key={finalist.name} className={`finalist${winner ? ' winner' : ''}`}>
            <Plate team={team} size={28} />
            <span className="grow"><strong>{finalist.name}</strong><small className="muted">{team?.school ?? finalist.team}</small></span>
            <span className="cond small">{winner ? 'WINNER' : 'FINALIST'}</span>
          </div>
        )
      }) : (
        <>
          <p className="muted small">Awarded in December. The stat-based tracker leads with</p>
          {tracker.slice(0, 3).map((row) => {
            const team = model.team(row.team_id)
            return (
              <button key={row.player_id} type="button" className="finalist" onClick={() => openWindow({ type: 'player', playerId: row.player_id, name: row.player_name, teamId: row.team_id })}>
                <Plate team={team} size={28} />
                <span className="grow"><strong>{row.player_name}</strong><small className="muted">{team?.school}</small></span>
                <span className="cond small num">#{row.rank}</span>
              </button>
            )
          })}
          {!tracker.length && <Empty>No tracker data yet.</Empty>}
        </>
      )}
      {season?.heisman_winner && tracker[0] && <p className="muted small cond">TRACKER FINAL #1 · {tracker[0].player_name.toUpperCase()}</p>}
    </Tile>
  )

  const top10 = (
    <Tile title={live ? 'LATEST AP TOP 10' : 'FINAL AP TOP 10'} action={finalAp && finalAp.ranked.length > 10 ? (full25 ? 'Top 10 ←' : 'Full Top 25 →') : undefined} onAction={() => setFull25(!full25)}>
      {finalAp ? finalAp.ranked.slice(0, full25 ? 25 : 10).map((row) => {
        const team = model.team(row.team_id)
        return (
          <div key={row.team_id} className="archive-poll-row">
            <span className="cond num">{row.rank}</span>
            <Plate team={team} size={24} />
            <span className="grow truncate">{team?.school}</span>
            <span className="muted num">{recordText(model.record(row.team_id))}</span>
          </div>
        )
      }) : <Empty>No AP Poll stored for {year}.</Empty>}
    </Tile>
  )

  const playoff = (
    <Tile title="PLAYOFF" action={cfpGames.length ? 'Full bracket →' : undefined} onAction={() => onSub('bracket')}>
      {cfpGames.length ? (
        <div className="playoff-boxes">
          <div><span className="muted small">No. 1 seed</span><strong className="cond">{model.team(seedOne)?.school ?? '—'}</strong></div>
          <div><span className="muted small">Champion</span><strong className="cond">{champion?.school ?? 'TBD'}</strong></div>
          <div><span className="muted small">Runner-up</span><strong className="cond">{model.team(runnerUp)?.school ?? 'TBD'}</strong></div>
        </div>
      ) : <Empty>The playoff field is set in December.</Empty>}
    </Tile>
  )

  const champions = (
    <Tile title="CONFERENCE CHAMPIONS">
      {conferences.map(({ conference, teamId, decided }) => (
        <div key={conference.id} className="conf-champ-row">
          <ConfTag code={confAbbr(conference)} />
          <Plate team={model.team(teamId)} size={22} />
          <span className={`grow truncate${decided ? '' : ' muted'}`}>{model.team(teamId)?.school ?? 'TBD'}</span>
          {!decided && <span className="muted small cond">LEADS</span>}
        </div>
      ))}
    </Tile>
  )

  const upsetTile = (
    <Tile title={`BIGGEST UPSETS OF ${year}`}>
      {upsets.length ? upsets.map((entry) => <UpsetRow key={entry.game.id} model={model} game={entry.game} spread={entry.upset.winnerSpread} />) : <Empty>No upsets yet.</Empty>}
    </Tile>
  )

  const facts = (
    <section className="tile archive-facts">
      <div>
        <span className="muted small">{live ? 'Unbeaten teams' : 'Last unbeaten'}</span>
        {live ? <strong className="cond">{model.unbeatenAfter(Infinity).length}</strong> : <strong className="cond">{unbeaten?.school ?? '—'}</strong>}
        {!live && unbeaten && <small className="muted">{model.record(unbeaten.id).l ? `Finished ${recordText(model.record(unbeaten.id))}` : 'Finished perfect'}</small>}
      </div>
      {gamedayStops > 0 && <div><span className="muted small">GameDay stops</span><strong className="cond">{gamedayStops}</strong></div>}
    </section>
  )

  if (mobile) return <div className="archive-mobile">{banner}{heisman}{playoff}{top10}{champions}{upsetTile}{facts}</div>
  return (
    <div className="archive-grid">
      <div className="archive-banner-cell">{banner}</div>
      <div className="archive-heisman-cell">{heisman}</div>
      <div className="archive-col scroll-y">{top10}</div>
      <div className="archive-col scroll-y">{playoff}{champions}</div>
      <div className="archive-col scroll-y">{upsetTile}{facts}</div>
    </div>
  )
}

function SeasonSub({ sub, onBack }: { sub: 'games' | 'bracket'; onBack: () => void }) {
  const { model } = useApp()
  return (
    <div className="archive-sub">
      <button type="button" className="back-link cond" onClick={onBack}>← {model.year} SEASON</button>
      {sub === 'games' ? <Scores /> : <Bracket />}
    </div>
  )
}

type AllTimeData = Awaited<ReturnType<typeof fetchAllTime>>

function AllTime() {
  const { liveYear, openWindow, mobile } = useApp()
  const query = useQuery({ queryKey: ['all-time'], queryFn: fetchAllTime, staleTime: 30 * 60_000 })
  const gameday = useGamedayStops()
  if (query.error) return <ErrorBox message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  if (!query.data) return <Loading label="Loading the archive…" />
  const data: AllTimeData = query.data
  const teams = new Map<number, Team>(data.teams.map((team) => [team.id, team]))
  const gameById = new Map(data.games.map((game) => [game.id, game]))
  const firstYear = Math.min(...data.seasons.map((season) => season.year))

  const weeksAtOne = new Map<number, number>()
  for (const row of data.numberOnes) weeksAtOne.set(row.team_id, (weeksAtOne.get(row.team_id) ?? 0) + 1)
  const mostWeeks = [...weeksAtOne.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const records = new Map<number, { w: number; l: number; t: number }>()
  for (const row of data.teamSeasons) {
    const record = records.get(row.team_id) ?? { w: 0, l: 0, t: 0 }
    record.w += row.wins
    record.l += row.losses
    record.t += row.ties
    records.set(row.team_id, record)
  }
  const pct = (record: { w: number; l: number; t: number }) => (record.w + record.l + record.t ? (record.w + record.t / 2) / (record.w + record.l + record.t) : 0)
  const bestRecords = [...records.entries()].sort((a, b) => pct(b[1]) - pct(a[1]) || b[1].w - a[1].w).slice(0, 5)

  const upsets = data.upsets
    .map((award) => ({ award, game: award.game_id ? gameById.get(award.game_id) : undefined, spread: award.details.winner_spread === null || award.details.winner_spread === undefined ? null : Number(award.details.winner_spread) }))
    .filter((entry): entry is { award: typeof entry.award; game: Game; spread: number | null } => Boolean(entry.game))
    .sort((a, b) => (b.spread ?? 99) - (a.spread ?? 99))
    .slice(0, 8)
  const plate = (teamId: number | null | undefined) => (teamId && teams.get(teamId) ? <Plate team={teams.get(teamId)} size={24} /> : <span className="plate-empty" />)
  const seasons = [...data.seasons].sort((a, b) => b.year - a.year)
  // Campus visits: shows on the host's campus, counted per host.
  const visits = new Map<string, { label: string; teamId: number | null; count: number }>()
  for (const stop of gameday.data ?? []) {
    const host = stop.host_team_id ? teams.get(stop.host_team_id) : undefined
    if (isNeutral(stop, host)) continue
    const key = stop.host_team_id ? `t${stop.host_team_id}` : stop.host
    const entry = visits.get(key) ?? { label: host?.school ?? stop.host, teamId: stop.host_team_id, count: 0 }
    entry.count += 1
    visits.set(key, entry)
  }
  const mostVisits = [...visits.values()].sort((a, b) => b.count - a.count).slice(0, 5)

  return (
    <div className={mobile ? 'archive-mobile' : 'alltime-grid scroll-y'}>
      <Tile title="NATIONAL CHAMPIONS">
        {seasons.map((season) => {
          const game = season.title_game_id ? gameById.get(season.title_game_id) : undefined
          return (
            <div key={season.year} className="alltime-row">
              <span className="muted num">{season.year}</span>
              {plate(season.champion_team_id)}
              <span className={`grow truncate${season.champion_team_id ? '' : ' muted'}`}>{season.champion_team_id ? teams.get(season.champion_team_id)?.school : season.year === liveYear ? 'In progress' : '—'}</span>
              {game && game.home_points !== null && game.away_points !== null && <span className="cond small num">{Math.max(game.home_points, game.away_points)}–{Math.min(game.home_points, game.away_points)}</span>}
            </div>
          )
        })}
      </Tile>
      <Tile title="HEISMAN WINNERS">
        {seasons.map((season) => {
          const finalist = finalistsOf(season).find((item) => item.name === season.heisman_winner)
          return (
            <div key={season.year} className="alltime-row">
              <span className="muted num">{season.year}</span>
              {plate(finalist?.team_id)}
              <span className={`grow truncate${season.heisman_winner ? '' : ' muted'}`}>{season.heisman_winner ?? (season.year === liveYear ? 'Awarded in December' : '—')}</span>
              {finalist?.team && <span className="muted small">{finalist.team}</span>}
            </div>
          )
        })}
      </Tile>
      <Tile title="MOST WEEKS AT #1">
        {mostWeeks.length ? mostWeeks.map(([teamId, weeks], index) => (
          <div key={teamId} className="alltime-row">
            <span className="muted num">#{index + 1}</span>
            {plate(teamId)}
            <span className="grow truncate">{teams.get(teamId)?.school}</span>
            <strong className="cond num">{weeks} {weeks === 1 ? 'week' : 'weeks'}</strong>
          </div>
        )) : <Empty>No AP Polls stored yet.</Empty>}
      </Tile>
      <Tile title="MOST GAMEDAY VISITS">
        {mostVisits.length ? mostVisits.map((entry, index) => (
          <div key={entry.label} className="alltime-row">
            <span className="muted num">#{index + 1}</span>
            {plate(entry.teamId)}
            <span className="grow truncate">{entry.label}</span>
            <strong className="cond num">{entry.count} visits</strong>
          </div>
        )) : gameday.isPending ? <Loading /> : <Empty>The GameDay history arrives with the next weekly update.</Empty>}
      </Tile>
      <Tile title={`BEST RECORD SINCE ${firstYear}`}>
        {bestRecords.map(([teamId, record], index) => (
          <div key={teamId} className="alltime-row">
            <span className="muted num">#{index + 1}</span>
            {plate(teamId)}
            <span className="grow truncate">{teams.get(teamId)?.school ?? '—'}</span>
            <strong className="cond num">{recordText(record)}</strong>
          </div>
        ))}
      </Tile>
      <Tile title="BIGGEST UPSETS EVER" className="alltime-wide">
        {upsets.length ? upsets.map((entry, index) => {
          const winner = Number(entry.award.details.winner_team_id)
          const loser = winner === entry.game.home_team_id ? entry.game.away_team_id : entry.game.home_team_id
          return (
            <button key={entry.game.id} type="button" className="archive-upset" onClick={() => openWindow({ type: 'game', gameId: entry.game.id, season: entry.game.season })}>
              <span className="muted num">{index + 1}</span>
              <strong className={`cond num ${entry.spread === null || entry.spread >= 21 ? 'tier-stunner' : 'tier-big'}`}>{entry.spread === null ? 'FCS' : `+${entry.spread}`}</strong>
              <span className="grow truncate">{teams.get(winner)?.school} {winner === entry.game.home_team_id || entry.game.neutral_site ? 'vs' : '@'} {teams.get(loser)?.school}</span>
              <span className="muted small cond">{entry.game.season} · {entry.game.season_type === 'postseason' ? 'POST' : `WK ${entry.game.week}`}</span>
            </button>
          )
        }) : <Empty>No upsets stored yet.</Empty>}
      </Tile>
    </div>
  )
}

export function Archive() {
  const { seasons, liveYear, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'alltime' ? 'ALL TIME' : params.get('view') === 'gameday' ? 'GAMEDAY HISTORY' : 'SEASONS'
  const years = [...seasons].sort((a, b) => a.year - b.year)
  const archived = years.filter((season) => season.status === 'archived')
  const year = Number(params.get('season')) || archived.at(-1)?.year || liveYear
  const sub = params.get('sub') === 'games' || params.get('sub') === 'bracket' ? params.get('sub') as 'games' | 'bracket' : null
  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key)
      else merged.set(key, value)
    }
    setParams(merged, { replace: false })
  }
  return (
    <div className="archive">
      <div className="page-head page-head--tabs">
        <h1 className="cond">ARCHIVE</h1>
        <Tabs items={VIEWS} value={view} onChange={(next) => update({ view: next === 'ALL TIME' ? 'alltime' : next === 'GAMEDAY HISTORY' ? 'gameday' : null, sub: null })} labels={mobile ? { 'GAMEDAY HISTORY': 'GAMEDAY' } : undefined} />
        <span className="grow" />
        {view === 'SEASONS' && (
          <div className="pills season-pills">
            {years.map((season) => (
              <button key={season.year} type="button" className={`pill cond${season.year === year ? ' active' : ''}`} aria-pressed={season.year === year} onClick={() => update({ season: String(season.year), sub: null })}>
                {season.year}{season.status === 'live' ? ' · LIVE' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      {view === 'ALL TIME' ? <AllTime /> : view === 'GAMEDAY HISTORY' ? <GameDayHistory /> : (
        <SeasonScope year={year} key={year}>
          {sub ? <SeasonSub sub={sub} onBack={() => update({ sub: null })} /> : <SeasonView onSub={(next) => update({ sub: next })} />}
        </SeasonScope>
      )}
    </div>
  )
}
