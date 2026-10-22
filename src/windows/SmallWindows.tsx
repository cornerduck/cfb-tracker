import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApp } from '../app/context'
import { confName, recordText } from '../data/model'
import type { PollSource } from '../data/types'
import { searchPlayers } from '../data/queries'
import { Empty, Flame, Movement, Plate, PlayerAvatar, Tabs } from '../shared/ui'
import { nextLine } from '../features/home/Home'
import { WindowFrame } from './WindowFrame'

export function Top25Window() {
  const { model, period, closeWindow } = useApp()
  const navigate = useNavigate()
  const [source, setSource] = useState<PollSource>('AP')
  const order = period?.order ?? 0
  const release = model.pollAfter(source, order)
  const previous = release ? model.previousRelease(release) : null
  const before = release ? (release.seasonType === 'postseason' ? model.lastRegularWeek + 1 : release.week - 1) : order
  const dropped = previous ? previous.ranked.filter((row) => !release?.byTeam.has(row.team_id)) : []
  const hasCfp = model.pollReleases('CFP').length > 0
  return (
    <WindowFrame className="top25-window" title="TOP 25" kicker={release ? `${release.label}${source === 'AP' ? ' · AP Poll' : source === 'Coaches' ? ' · Coaches Poll' : ' · CFP'}` : undefined} onClose={closeWindow}>
      <Tabs items={(hasCfp ? ['AP', 'Coaches', 'CFP'] : ['AP', 'Coaches']) as PollSource[]} value={source} onChange={setSource} labels={{ AP: 'AP POLL', Coaches: 'COACHES', CFP: 'CFP' }} />
      <div className="window-scroll">
        {release ? (
          <>
            <div className="top25-grid">
              {release.ranked.map((row) => {
                const team = model.team(row.team_id)
                return (
                  <button key={row.team_id} type="button" className={`top25-row${row.rank === 1 ? ' first' : ''}`} onClick={() => { closeWindow(); navigate(`/teams/${team?.slug}`) }}>
                    <span className="cond num rank-num">{row.rank}</span>
                    <Movement current={row.rank} previous={previous?.byTeam.get(row.team_id)?.rank ?? null} isNew={Boolean(previous) && !previous?.byTeam.has(row.team_id)} />
                    <Plate team={team} size={24} />
                    <span className="cond top25-name truncate">{team?.school.toUpperCase()}</span>
                    <Flame count={model.flame(row.team_id, before)} />
                    <span className="grow" />
                    <span className="cond num muted">{recordText(model.record(row.team_id, before))}</span>
                  </button>
                )
              })}
            </div>
            {(dropped.length > 0 || release.others.length > 0) && (
              <p className="small muted top25-foot">
                {dropped.length > 0 && <><strong className="cond">DROPPED OUT</strong> {dropped.map((row) => `${model.team(row.team_id)?.school} (${row.rank})`).join(', ')}<br /></>}
                {release.others.length > 0 && <><strong className="cond">ALSO RECEIVING VOTES</strong> {release.others.slice(0, 8).map((row) => `${model.team(row.team_id)?.school} ${row.points ?? ''}`).join(', ')}</>}
              </p>
            )}
          </>
        ) : <Empty>This poll has not been released yet.</Empty>}
      </div>
    </WindowFrame>
  )
}

export function UndefeatedWindow() {
  const { model, period, closeWindow, openWindow } = useApp()
  const navigate = useNavigate()
  const order = period?.order ?? 0
  const weeks = model.periods.filter((item) => item.order <= order && item.seasonType === 'regular')
  const series = [{ label: 'START', count: model.fbsIds.size }, ...weeks.map((item) => ({ label: item.short, count: model.unbeatenAfter(item.order).length }))]
  const max = Math.max(1, ...series.map((item) => item.count))
  const unbeaten = model.unbeatenAfter(order).sort((a, b) => (model.apRankAfter(a, order) ?? 99) - (model.apRankAfter(b, order) ?? 99))
  const firstLosses = [...weeks].reverse().map((week) => {
    const losers = model.games.filter((game) => model.gameOrder(game) === week.order && game.status === 'final').flatMap((game) => {
      const winner = model.winnerId(game)
      return [game.home_team_id, game.away_team_id].filter((id) => winner !== null && id !== winner && model.fbsIds.has(id))
        .filter((id) => model.record(id, week.order - 1).l === 0)
        .map((id) => ({ id, game, rank: model.apRankAtKickoff(id, game) }))
    })
    return { week, losers }
  }).filter((entry) => entry.losers.length)
  const columns = series.slice(-8)
  return (
    <WindowFrame className="undefeated-window" title="UNDEFEATED WATCH" onClose={closeWindow}>
      <div className="window-scroll">
        <div className="undefeated-top">
          <div className="undefeated-count">
            <span className="cond num big-number">{unbeaten.length}</span>
            <span className="muted small">of {model.fbsIds.size} FBS teams are still unbeaten after {period?.label.toLowerCase() ?? 'the opener'}</span>
          </div>
          <div className="unbeaten-chart">
            <h3 className="cond">UNBEATEN TEAMS AFTER EACH WEEK</h3>
            <div className="bar-chart">
              {columns.map((item, index) => (
                <div key={item.label} className="bar">
                  <span className="bar-value cond num">{item.count}</span>
                  <span className={`bar-fill${index === columns.length - 1 ? ' current' : ''}`} style={{ height: `${(item.count / max) * 100}%` }} />
                  <span className="bar-label cond small">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="undefeated-bottom">
          <div>
            <h3 className="cond">STILL PERFECT</h3>
            <div className="perfect-grid">
              {unbeaten.map((teamId) => {
                const team = model.team(teamId)
                const rank = model.apRankAfter(teamId, order)
                return (
                  <button key={teamId} type="button" className="perfect-row" onClick={() => { closeWindow(); navigate(`/teams/${team?.slug}`) }}>
                    <Plate team={team} size={22} /><span className="grow truncate">{team?.school}</span><span className="muted num small">{rank ? `#${rank}` : ''}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <h3 className="cond">FIRST LOSSES · RANKED TEAMS</h3>
            {firstLosses.map(({ week, losers }) => {
              const ranked = losers.filter((item) => item.rank !== null).sort((a, b) => a.rank! - b.rank!)
              return (
                <div key={week.key} className="first-loss">
                  <span className="cond">{week.short}</span>
                  <div>
                    {ranked.length ? (
                      <button type="button" className="loss-link" onClick={() => openWindow({ type: 'game', gameId: ranked[0].game.id })}>{ranked.map((item) => `#${item.rank} ${model.team(item.id)?.school}`).join(', ')}</button>
                    ) : <span className="loss">No ranked team</span>}
                    <small className="muted">{losers.length} team{losers.length === 1 ? '' : 's'} lost their first game</small>
                  </div>
                </div>
              )
            })}
            {!firstLosses.length && <Empty>No unbeaten team has lost yet.</Empty>}
          </div>
        </div>
      </div>
    </WindowFrame>
  )
}

export function SearchWindow() {
  const { model, closeWindow, openWindow, account, period } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  const order = period?.order ?? Infinity
  const teams = useMemo(() => !trimmed ? [] : [...model.teams.values()].filter((team) => model.fbsIds.has(team.id))
    .filter((team) => `${team.school} ${team.mascot ?? ''} ${team.abbreviation ?? ''}`.toLowerCase().includes(trimmed))
    .sort((a, b) => Number(!a.school.toLowerCase().startsWith(trimmed)) - Number(!b.school.toLowerCase().startsWith(trimmed)) || a.school.localeCompare(b.school))
    .slice(0, 6), [model, trimmed])
  const players = useQuery({
    queryKey: ['player-search', model.year, trimmed],
    queryFn: () => searchPlayers(model.year, trimmed),
    enabled: trimmed.length >= 3,
    staleTime: 60_000,
  })
  const playerResults = useMemo(() => {
    const byPlayer = new Map<string, { id: string; name: string; teamId: number | null; position: string | null; yards: number }>()
    for (const row of players.data ?? []) {
      if (row.team_id !== null && !model.fbsIds.has(row.team_id)) continue
      const current = byPlayer.get(row.player_id) ?? { id: row.player_id, name: row.player_name, teamId: row.team_id, position: row.position, yards: 0 }
      const yards = Number((row.stats as Record<string, unknown>).YDS ?? 0)
      if (['passing', 'rushing', 'receiving'].includes(row.category)) current.yards = Math.max(current.yards, Number.isFinite(yards) ? yards : 0)
      byPlayer.set(row.player_id, current)
    }
    return [...byPlayer.values()].sort((a, b) => b.yards - a.yards).slice(0, 6)
  }, [players.data, model])
  const recent = account.profile?.recent_searches ?? []

  const openTeam = (slug: string, name: string) => {
    void account.saveRecentSearch(name)
    closeWindow()
    navigate(`/teams/${slug}`)
  }
  return (
    <WindowFrame className="search-window" onClose={closeWindow}>
      <label className="search-field">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams or players" aria-label="Search teams or players" />
      </label>
      <div className="window-scroll">
        {!trimmed ? (
          recent.length ? (
            <>
              <h3 className="cond">RECENT SEARCHES</h3>
              {recent.map((item) => {
                const team = [...model.teams.values()].find((candidate) => candidate.school === item)
                return (
                  <button key={item} type="button" className="search-row" onClick={() => (team ? openTeam(team.slug, team.school) : setQuery(item))}>
                    {team ? <Plate team={team} size={30} /> : <span className="plate-empty" />}<span>{item}</span>
                  </button>
                )
              })}
            </>
          ) : <Empty>Search FBS teams and players.</Empty>
        ) : (
          <>
            <h3 className="cond">TEAMS</h3>
            {teams.length ? teams.map((team) => {
              const rank = model.apRankAfter(team.id, order)
              return (
                <button key={team.id} type="button" className="search-row" onClick={() => openTeam(team.slug, team.school)}>
                  <Plate team={team} size={30} />
                  <span className="search-copy"><strong>{team.school} {team.mascot ?? ''}</strong><small className="muted">{[rank ? `#${rank}` : null, confName(model.conferenceOf(team.id))].filter(Boolean).join(' · ')}</small></span>
                </button>
              )
            }) : <Empty>No FBS team matches.</Empty>}
            <h3 className="cond">PLAYERS</h3>
            {trimmed.length < 3 ? <Empty>Type at least three letters to search players.</Empty> : players.isLoading ? <Empty>Searching…</Empty> : playerResults.length ? playerResults.map((player) => {
              const team = model.team(player.teamId)
              return (
                <button key={player.id} type="button" className="search-row" onClick={() => { void account.saveRecentSearch(player.name); openWindow({ type: 'player', playerId: player.id, name: player.name, teamId: player.teamId }) }}>
                  <PlayerAvatar playerId={player.id} team={team} size={30} />
                  <span className="search-copy"><strong>{player.name}</strong><small className="muted">{[player.position, team?.school, player.yards ? `${player.yards} yds` : null].filter(Boolean).join(' · ')}</small></span>
                </button>
              )
            }) : <Empty>No player matches.</Empty>}
          </>
        )}
      </div>
    </WindowFrame>
  )
}

export function FavoritesWindow() {
  const { model, favorites, closeWindow, timeZone, period } = useApp()
  const navigate = useNavigate()
  const order = period?.order ?? Infinity
  const teams = [...favorites].map((id) => model.team(id)).filter((team) => team && model.fbsIds.has(team.id))
  return (
    <WindowFrame className="small-window" title="MY TEAMS" onClose={closeWindow}>
      <div className="window-scroll">
        {teams.length ? teams.map((team) => {
          const rank = model.apRankAfter(team!.id, order)
          const next = nextLine(model, team!.id, timeZone)
          return (
            <button key={team!.id} type="button" className="search-row" onClick={() => { closeWindow(); navigate(`/teams/${team!.slug}`) }}>
              <Plate team={team} size={34} />
              <span className="search-copy">
                <strong>{team!.school} <span className="muted">{rank ? `#${rank}` : ''} · {recordText(model.record(team!.id, order))}</span></strong>
                <small className="muted">{next ? `Next: ${next}` : 'Season complete'}</small>
              </span>
            </button>
          )
        }) : <Empty>No favorite teams yet.</Empty>}
        <button type="button" className="tile-link" onClick={() => { closeWindow(); navigate('/teams') }}>Manage favorite teams →</button>
      </div>
    </WindowFrame>
  )
}

export function AccountWindow() {
  const { account, favorites, closeWindow } = useApp()
  const navigate = useNavigate()
  const name = account.profile?.display_name || account.session?.user.email || ''
  const go = (path: string) => { closeWindow(); navigate(path) }
  return (
    <WindowFrame className="small-window account-window" onClose={closeWindow}>
      <div className="account-head">
        <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span><strong>{name}</strong><small className="muted">{favorites.size} favorite teams</small></span>
      </div>
      <button type="button" className="menu-row" onClick={() => go('/teams?filter=mine')}>My favorite teams</button>
      <button type="button" className="menu-row" onClick={() => go('/pickem')}>My Pick'em</button>
      <button type="button" className="menu-row" onClick={() => go('/settings')}>Settings</button>
      <button type="button" className="menu-row danger" onClick={() => { closeWindow(); void account.signOut() }}>Sign out</button>
    </WindowFrame>
  )
}

export function ErrorWindow() {
  const { account, closeWindow } = useApp()
  const { liveUpdate, manualUpdateBusy, updateNowMessage } = account
  return (
    <WindowFrame className="small-window" title={liveUpdate.state === 'failed' ? 'UPDATE FAILED' : 'DATA UPDATES'} onClose={closeWindow}>
      <p>{liveUpdate.state === 'failed'
        ? 'The most recent scheduled update failed. You are seeing the data from the last successful update.'
        : liveUpdate.state === 'overdue' || liveUpdate.state === 'uninitialized'
        ? 'A scheduled update is overdue.'
        : 'Live data is up to date.'}</p>
      {updateNowMessage && <p className="notice" role="status">{updateNowMessage}</p>}
      <button type="button" className="primary-button cond" disabled={manualUpdateBusy} onClick={() => void account.updateNow()}>{manualUpdateBusy ? 'UPDATING…' : 'UPDATE NOW'}</button>
      <p className="muted small">Available again 15 minutes after each use.</p>
    </WindowFrame>
  )
}

