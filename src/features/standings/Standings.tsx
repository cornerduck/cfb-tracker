import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { type Record3, type SeasonModel, abbr, confAbbr, confName, recordText, teamColor } from '../../data/model'
import { type ConferenceStandings, type StandingRow, conferenceStandings } from '../../data/standings'
import type { Conference } from '../../data/types'
import { dayMonth, kickoffParts } from '../../shared/format'
import { Empty, Plate, StarButton, Tile } from '../../shared/ui'

const STATUS_LABEL = { title: 'TITLE SPOT', leader: 'LEADER', alive: 'ALIVE', eliminated: 'ELIMINATED' } as const

const streakText = (row: StandingRow) => (row.streak ? `${row.streak.type}${row.streak.count}` : '—')

function leaderText(model: SeasonModel, standings: ConferenceStandings | null) {
  if (!standings) return ''
  if (confAbbr(standings.conference) === 'IND') return ''
  if (standings.champion) return `Champion ${abbr(model.team(standings.champion))}`
  if (standings.hasDivisions) return `Leader ${standings.groups.map((group) => abbr(model.team(group.rows[0]?.teamId))).join(' · ')}`
  const first = standings.groups[0]?.rows[0]
  return first ? `Leader ${abbr(model.team(first.teamId))} ${recordText(first.conf)}` : ''
}

function StandingsTable({ model, group, order, independent }: {
  model: SeasonModel
  group: ConferenceStandings['groups'][number]
  order: number
  independent: boolean
}) {
  const { mobile, favorites, account } = useApp()
  const navigate = useNavigate()
  return (
    <div className={`standings-table${independent ? ' standings-table--ind' : ''}`}>
      {group.division && <h3 className="cond division-title">{group.division.toUpperCase()} DIVISION</h3>}
      <div className="st-row st-head cond">
        <span>#</span><span>TEAM</span>
        {!independent && <span>CONF</span>}
        {!independent && !mobile && <span>GB</span>}
        <span>{mobile ? 'OVR' : 'OVERALL'}</span>
        {!mobile && <span>VS RANKED</span>}
        <span>{mobile ? 'STRK' : 'STREAK'}</span>
        {!independent && <span>STATUS</span>}
        {!mobile && <span />}
      </div>
      {group.rows.map((row, index) => {
        const team = model.team(row.teamId)
        const flame = model.flame(row.teamId, order)
        const spot = row.status === 'title' || row.status === 'leader'
        const lastSpot = spot && group.rows[index + 1] && !(group.rows[index + 1].status === 'title' || group.rows[index + 1].status === 'leader')
        return (
          <div key={row.teamId} role="button" tabIndex={0} className={`st-row${spot ? ' spot' : ''}${lastSpot ? ' cut' : ''}${row.status === 'eliminated' ? ' eliminated' : ''}`}
            onClick={() => navigate(`/teams/${team?.slug}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/teams/${team?.slug}`) }}>
            <span className="muted num">{index + 1}</span>
            <span className="st-team"><Plate team={team} size={24} /><span className="muted num st-rank">{row.apRank ?? ''}</span><span className="st-name truncate">{team?.school}</span></span>
            {!independent && <strong className="cond num st-conf">{recordText(row.conf)}</strong>}
            {!independent && !mobile && <span className="muted num">{row.gb === null ? '—' : row.gb}</span>}
            <span className="num">{recordText(row.overall)}</span>
            {!mobile && <span className="muted num">{recordText(row.vsRanked)}</span>}
            <span className={`cond num streak ${row.streak?.type === 'W' ? (flame ? 'hot' : 'win') : row.streak?.type === 'L' ? 'loss' : ''}`}>{flame ? <svg className="flame-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3-2 5-2 8a2 2 0 0 0 4 0c0-1 0-2-1-3 3 1 5 4 5 7a6 6 0 0 1-12 0c0-5 4-7 6-12z" /></svg> : null}{streakText(row)}</span>
            {!independent && <span className={`status-chip status-chip--${row.status} cond`}>{mobile ? STATUS_LABEL[row.status].split(' ')[0] : STATUS_LABEL[row.status]}</span>}
            {!mobile && <StarButton active={favorites.has(row.teamId)} onClick={() => void account.toggleFavorite(row.teamId)} label={`Favorite ${team?.school}`} disabled={account.favoriteSaving} />}
          </div>
        )
      })}
    </div>
  )
}

function SidePanels({ model, standings, order }: { model: SeasonModel; standings: ConferenceStandings; order: number }) {
  const { timeZone, openWindow } = useApp()
  const teamIds = standings.groups.flatMap((group) => group.rows.map((row) => row.teamId))
  const contenders = standings.hasDivisions
    ? standings.groups.map((group) => group.rows[0]).filter(Boolean)
    : standings.groups[0].rows.slice(0, 2)
  const title = standings.titleGame
  const ranks = new Map(standings.groups.flatMap((group) => group.rows.map((row, index) => [row.teamId, index] as const)))
  const upcoming = model.games.filter((game) => game.conference_game && game.status === 'scheduled' &&
    teamIds.includes(game.home_team_id) && teamIds.includes(game.away_team_id) && !/championship/i.test(game.notes ?? ''))
  const nextOrder = Math.min(...upcoming.map((game) => model.gameOrder(game)))
  const watch = upcoming.filter((game) => model.gameOrder(game) === nextOrder)
    .sort((a, b) => ((ranks.get(a.home_team_id) ?? 20) + (ranks.get(a.away_team_id) ?? 20)) - ((ranks.get(b.home_team_id) ?? 20) + (ranks.get(b.away_team_id) ?? 20)))[0]
  const sum = (records: Record3[]) => records.reduce((total, record) => ({ w: total.w + record.w, l: total.l + record.l, t: total.t + record.t }), { w: 0, l: 0, t: 0 })
  const nonConference = sum(teamIds.map((teamId) => model.record(teamId, order, (result) => !result.conference && result.game.season_type === 'regular')))
  const upsets = model.games.filter((game) => model.gameOrder(game) <= order && model.upset(game) && teamIds.includes(model.upset(game)!.winnerId)).length
  const ranked = teamIds.filter((teamId) => model.apRankAfter(teamId, order) !== null).length
  const unbeaten = teamIds.filter((teamId) => {
    const record = model.record(teamId, order)
    return record.l === 0 && record.w > 0
  }).length

  const sideTeam = (teamId: number | undefined, label: string) => {
    const team = model.team(teamId)
    return (
      <div className="title-side">
        <span className="title-badge cond" style={{ background: teamColor(team) }}>{abbr(team)}</span>
        <small className="muted">{label}</small>
      </div>
    )
  }
  return (
    <>
      <Tile title={title ? 'TITLE GAME' : 'PROJECTED TITLE GAME'}>
        {title ? (
          <button type="button" className="title-game" onClick={() => openWindow({ type: 'game', gameId: title.id })}>
            {sideTeam(title.away_team_id, title.status === 'final' ? String(title.away_points) : model.team(title.away_team_id)?.school ?? '')}
            <span className="cond at-big">{title.neutral_site ? 'VS' : '@'}</span>
            {sideTeam(title.home_team_id, title.status === 'final' ? String(title.home_points) : model.team(title.home_team_id)?.school ?? '')}
          </button>
        ) : contenders.length >= 2 ? (
          <div className="title-game">
            {sideTeam(contenders[0].teamId, `${standings.hasDivisions ? `${standings.groups[0].division} · ` : contenders[0].apRank ? `#${contenders[0].apRank} · ` : ''}${recordText(contenders[0].conf)}`)}
            <span className="cond at-big">VS</span>
            {sideTeam(contenders[1].teamId, `${standings.hasDivisions ? `${standings.groups[1].division} · ` : contenders[1].apRank ? `#${contenders[1].apRank} · ` : ''}${recordText(contenders[1].conf)}`)}
          </div>
        ) : <Empty>No title game.</Empty>}
        <p className="muted small center">{title ? `${dayMonth(title.start_time, timeZone)}${title.venue ? ` · ${title.venue}` : ''}` : standings.hasDivisions ? 'Division winners meet in the title game' : 'The top two meet in the title game'}</p>
      </Tile>
      {watch && (
        <Tile title="GAME TO WATCH IN THE RACE">
          <button type="button" className="watch-card" onClick={() => openWindow({ type: 'game', gameId: watch.id })}>
            {[watch.away_team_id, watch.home_team_id].map((teamId, index) => {
              const rank = model.apRankAtKickoff(teamId, watch)
              return <span key={teamId} className="watch-line"><span className="at-slot cond">{index ? (watch.neutral_site ? 'vs' : '@') : ''}</span><Plate team={model.team(teamId)} size={22} /><strong className="cond">{rank ? `#${rank} ` : ''}{model.team(teamId)?.school.toUpperCase()}</strong></span>
            })}
            <span className="muted small cond">{(() => { const kickoff = kickoffParts(watch.start_time, timeZone); return [kickoff.day, kickoff.time, watch.tv, model.favoriteText(watch)].filter(Boolean).join(' · ') })()}</span>
          </button>
        </Tile>
      )}
      <Tile title="CONFERENCE AT A GLANCE">
        <div className="numbers-grid">
          <div><span>Ranked teams</span><strong className="cond num">{ranked}</strong></div>
          <div><span>Unbeaten</span><strong className="cond num">{unbeaten}</strong></div>
          <div><span>Non-conference</span><strong className="cond num">{recordText(nonConference)}</strong></div>
          <div><span>Upsets this season</span><strong className="cond num">{upsets}</strong></div>
        </div>
      </Tile>
    </>
  )
}

export function Standings() {
  const { model, period, mobile } = useApp()
  const order = period?.order ?? 0
  const conferences = model.conferenceList()
  const [selected, setSelected] = useState<number | null>(null)
  const conferenceId = selected ?? conferences.find((conference) => confAbbr(conference) === 'B1G')?.id ?? conferences[0]?.id ?? null
  const all = useMemo(() => new Map(conferences.map((conference) => [conference.id, conferenceStandings(model, conference.id, order)])), [model, conferences, order])
  const standings = conferenceId ? all.get(conferenceId) ?? null : null
  if (!standings) return <Empty>Standings appear once the season's teams are imported.</Empty>
  const independent = confAbbr(standings.conference) === 'IND'
  const teamCount = standings.groups.reduce((sum, group) => sum + group.rows.length, 0)

  const groups = (['Power 4', 'Group of 6', 'Independent'] as const).map((group) => ({
    group,
    items: conferences.filter((conference) => (conference.group_name ?? 'Group of 6') === group || (group === 'Independent' && confAbbr(conference) === 'IND' && conference.group_name !== 'Independent')),
  })).filter((item) => item.items.length)

  const navItem = (conference: Conference) => (
    <button key={conference.id} type="button" className={`conf-link${conference.id === conferenceId ? ' active' : ''}`} onClick={() => setSelected(conference.id)}>
      <span className="conf-plate cond">{confAbbr(conference)}</span>
      <span className="conf-link-copy"><strong className="cond">{confName(conference).toUpperCase()}</strong><small className="muted">{leaderText(model, all.get(conference.id) ?? null)}</small></span>
    </button>
  )

  const main = (
    <section className="tile standings-main">
      <header className="standings-head">
        <span className="conf-plate conf-plate--lg cond">{confAbbr(standings.conference)}</span>
        <h1 className="cond">{confName(standings.conference).toUpperCase()}</h1>
        <span className="muted small">{teamCount} teams{independent ? '' : standings.hasDivisions ? ' · two divisions · division winners meet in the title game' : ' · top two meet in the title game'}</span>
        <span className="grow" />
        {!mobile && !independent && <span className="legend"><span className="status-chip status-chip--title cond">{standings.hasDivisions ? 'LEADER' : 'TITLE SPOT'}</span><span className="status-chip status-chip--alive cond">ALIVE</span><span className="status-chip status-chip--eliminated cond">ELIMINATED</span></span>}
      </header>
      <div className={mobile ? '' : 'scroll-y'}>
        {standings.groups.map((group) => <StandingsTable key={group.division ?? 'all'} model={model} group={group} order={order} independent={independent} />)}
      </div>
    </section>
  )

  if (mobile) {
    return (
      <div className="standings-mobile">
        <h1 className="cond page-title">STANDINGS</h1>
        <label className="conf-select">
          <span className="conf-plate cond">{confAbbr(standings.conference)}</span>
          <span className="conf-link-copy"><strong className="cond">{confName(standings.conference).toUpperCase()}</strong><small className="muted">{teamCount} teams · tap to switch conference</small></span>
          <select aria-label="Conference" value={conferenceId ?? ''} onChange={(event) => setSelected(Number(event.target.value))}>
            {conferences.map((conference) => <option key={conference.id} value={conference.id}>{confName(conference)}</option>)}
          </select>
          <span aria-hidden="true">▾</span>
        </label>
        {main}
        {!independent && <div className="side-stack"><SidePanels model={model} standings={standings} order={order} /></div>}
      </div>
    )
  }

  return (
    <div className="standings">
      <nav className="conf-nav scroll-y" aria-label="Conferences">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <span className="nav-small cond">{group === 'Independent' ? 'OTHER' : group.toUpperCase()}</span>
            {items.map(navItem)}
          </div>
        ))}
      </nav>
      {main}
      <aside className="side-stack scroll-y">{!independent && <SidePanels model={model} standings={standings} order={order} />}</aside>
    </div>
  )
}
