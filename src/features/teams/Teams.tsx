import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { confAbbr, confName, recordText, teamColor } from '../../data/model'
import { conferenceStandings } from '../../data/standings'
import { dayMonth, kickoffParts } from '../../shared/format'
import { ConfTag, Empty, Flame, Pills, Plate, StarButton, Tabs, imageUrl } from '../../shared/ui'
import { gameText } from '../../shared/gameText'
import { TeamHistoryTab, TeamOverview, TeamStatsTab } from './TeamTabs'
import { Compare } from './Compare'

const FILTERS = ['POWER 4', 'GROUP OF 6', 'INDEPENDENTS', 'MY TEAMS', 'ALL FBS'] as const
type Filter = typeof FILTERS[number]

function Directory() {
  const { model, favorites, account, period, mobile } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter: Filter = params.get('filter') === 'mine' ? 'MY TEAMS' : (FILTERS.find((item) => item.toLowerCase().replace(/ /g, '-') === params.get('filter')) ?? 'POWER 4')
  const setFilter = (next: Filter) => setParams(next === 'MY TEAMS' ? { filter: 'mine' } : { filter: next.toLowerCase().replace(/ /g, '-') }, { replace: true })
  const [query, setQuery] = useState('')
  const order = period?.order ?? Infinity
  const conferences = model.conferenceList().filter((conference) => {
    const group = confAbbr(conference) === 'IND' ? 'Independent' : conference.group_name
    if (filter === 'POWER 4') return group === 'Power 4'
    if (filter === 'GROUP OF 6') return group === 'Group of 6'
    if (filter === 'INDEPENDENTS') return group === 'Independent'
    return true
  })
  const total = model.fbsIds.size
  return (
    <>
      <div className="filter-row">
        <Pills items={FILTERS.map((item) => (item === 'ALL FBS' ? `ALL ${total}` : item)) as string[]} value={filter === 'ALL FBS' ? `ALL ${total}` : filter} onChange={(value) => setFilter(value.startsWith('ALL') ? 'ALL FBS' : value as Filter)} />
        <span className="grow" />
        <input className="text-input" placeholder="Find a team" aria-label="Find a team" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className={`directory${mobile ? '' : ' scroll-y'}`}>
        {conferences.map((conference) => {
          const teams = model.teamsIn(conference.id).map((id) => model.team(id)!).filter(Boolean)
            .filter((team) => filter !== 'MY TEAMS' || favorites.has(team.id))
            .filter((team) => team.school.toLowerCase().includes(query.trim().toLowerCase()))
            .sort((a, b) => a.school.localeCompare(b.school))
          if (!teams.length) return null
          return (
            <section key={conference.id} className="tile directory-card">
              <header className="directory-head">
                <ConfTag code={confAbbr(conference)} />
                <h2 className="cond">{confName(conference).toUpperCase()}</h2>
                <span className="grow" />
                <span className="muted small">{teams.length} teams</span>
              </header>
              {teams.map((team) => {
                const rank = model.apRankAfter(team.id, order)
                return (
                  <div key={team.id} role="button" tabIndex={0} className="dir-row" onClick={() => navigate(`/teams/${team.slug}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/teams/${team.slug}`) }}>
                    <Plate team={team} size={26} />
                    <span className="grow truncate dir-name">{team.school} {rank ? <span className="muted small">#{rank}</span> : null}</span>
                    <StarButton active={favorites.has(team.id)} disabled={account.favoriteSaving} onClick={() => void account.toggleFavorite(team.id)} label={`${favorites.has(team.id) ? 'Remove' : 'Add'} ${team.school} ${favorites.has(team.id) ? 'from' : 'to'} favorites`} />
                  </div>
                )
              })}
            </section>
          )
        })}
        {filter === 'MY TEAMS' && !favorites.size && <Empty>No favorite teams yet. Tap a star to add one.</Empty>}
      </div>
    </>
  )
}

const TEAM_TABS = ['OVERVIEW', 'SCHEDULE', 'STATS', 'HISTORY'] as const
type TeamTab = typeof TEAM_TABS[number]

function TeamPage({ slug }: { slug: string }) {
  const { model, favorites, account, timeZone, openWindow, period } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: TeamTab = TEAM_TABS.find((item) => item.toLowerCase() === params.get('tab')) ?? 'OVERVIEW'
  const setTab = (next: TeamTab) => setParams(next === 'OVERVIEW' ? {} : { tab: next.toLowerCase() }, { replace: true })
  const team = [...model.teams.values()].find((item) => item.slug === slug)
  const order = period?.order ?? Infinity
  const standings = useMemo(() => {
    const conferenceId = team ? model.teamSeasons.get(team.id)?.conference_id : null
    return conferenceId ? conferenceStandings(model, conferenceId, Infinity) : null
  }, [model, team])
  if (!team) return <Empty>This team is not part of the {model.year} season.</Empty>
  const conference = model.conferenceOf(team.id)
  const record = model.record(team.id)
  const conf = model.confRecord(team.id)
  const rank = model.apRankAfter(team.id, order)
  const games = model.teamGames(team.id)
  const position = standings?.groups.flatMap((group) => group.rows).findIndex((row) => row.teamId === team.id) ?? -1
  const stadium = imageUrl('stadiums', team.slug, ['jpg', 'jpeg', 'webp', 'png'])

  return (
    <div className="team-page">
      <button type="button" className="back-link cond" onClick={() => navigate('/teams')}>← ALL TEAMS</button>
      <header className="team-hero" style={{ background: `linear-gradient(90deg, ${teamColor(team)}, ${teamColor(team)}66 55%, transparent), ${stadium ? `url(${stadium}) center/cover` : '#15171A'}` }}>
        <Plate team={team} size={64} />
        <div className="team-hero-copy">
          <span className="cond small">{[confName(conference), team.location?.city && `${team.location.city}, ${team.location.state}`].filter(Boolean).join(' · ').toUpperCase()}</span>
          <h1 className="cond">{rank ? <span className="hero-rank">#{rank} </span> : null}{team.school.toUpperCase()} <span className="mascot">{team.mascot?.toUpperCase()}</span></h1>
          <span className="cond num">{recordText(record)}{conference && confAbbr(conference) !== 'IND' ? ` · ${recordText(conf)} ${confAbbr(conference)}` : ''} <Flame count={model.flame(team.id)} size={14} />{position >= 0 && conference && confAbbr(conference) !== 'IND' && <span className="hero-standing"> {position + 1}{['st', 'nd', 'rd'][position] ?? 'th'} in {confName(conference)}</span>}</span>
        </div>
        <span className="grow" />
        <StarButton active={favorites.has(team.id)} disabled={account.favoriteSaving} onClick={() => void account.toggleFavorite(team.id)} label="Favorite" />
      </header>
      <Tabs items={TEAM_TABS} value={tab} onChange={setTab} />
      {tab === 'OVERVIEW' ? <TeamOverview team={team} /> : tab === 'STATS' ? <TeamStatsTab team={team} /> : tab === 'HISTORY' ? <TeamHistoryTab team={team} /> : (
        <section className="tile schedule">
          {games.map((game) => {
            const home = game.home_team_id === team.id
            const opponentId = home ? game.away_team_id : game.home_team_id
            const text = gameText(model, team.id, game, game.status === 'final')
            const kickoff = kickoffParts(game.start_time, timeZone)
            return (
              <button key={game.id} type="button" className="schedule-row" onClick={() => openWindow({ type: 'game', gameId: game.id })}>
                <span className="cond muted">{model.periodByKey.get(model.periodKeyOf(game))?.short}</span>
                <span className="muted small">{dayMonth(game.start_time, timeZone)}</span>
                <Plate team={model.team(opponentId)} size={24} />
                <span className="grow truncate">{game.status === 'final' ? text.text.replace(/^[\d–]+ /, '') : text.text}{game.conference_game ? '' : <span className="muted small"> · non-conf</span>}</span>
                {game.status === 'final'
                  ? <strong className={`cond num ${text.outcome === 'W' ? 'win' : 'loss'}`}>{text.outcome} {text.text.split(' ')[0]}</strong>
                  : <span className="muted cond small">{game.status === 'in_progress' ? 'LIVE' : `${kickoff.time}${game.tv ? ` · ${game.tv}` : ''}`}</span>}
              </button>
            )
          })}
          {!games.length && <Empty>No games scheduled.</Empty>}
        </section>
      )}
    </div>
  )
}

export function Teams() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  if (slug) return <TeamPage slug={slug} />
  const view = params.get('view') === 'compare' ? 'COMPARE' : 'DIRECTORY'
  return (
    <div className="teams">
      <div className="page-head page-head--tabs">
        <h1 className="cond">TEAMS</h1>
        <Tabs items={['DIRECTORY', 'COMPARE'] as const} value={view} onChange={(next) => setParams(next === 'COMPARE' ? { view: 'compare' } : {}, { replace: true })} />
      </div>
      {view === 'COMPARE' ? <Compare /> : <Directory />}
    </div>
  )
}
