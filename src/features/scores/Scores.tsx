import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { type SeasonModel, abbr, confAbbr, confName } from '../../data/model'
import type { Game } from '../../data/types'
import { GameTile, UPSET_LABEL } from '../../shared/GameTile'
import { kickoffParts, longDay } from '../../shared/format'
import { Empty, Pills, Plate, Tile } from '../../shared/ui'

type View = { key: string; kind: 'week' | 'confchamp' | 'bowls' | 'cfp'; label: string; top: string; bottom: string }
const FILTERS = ['ALL FBS', 'TOP 25', 'MY TEAMS', 'CONFERENCE'] as const
type Filter = typeof FILTERS[number]

const isCfp = (game: Game) => Boolean(game.cfp_round)

function slotLabel(game: Game, timeZone: string) {
  if (!game.start_time) return 'TIME TBA'
  const kickoff = kickoffParts(game.start_time, timeZone)
  return `${longDay(game.start_time, timeZone)} ${kickoff.date} · ${kickoff.time}`
}

function WeekNumbers({ model, games, label }: { model: SeasonModel; games: Game[]; label: string }) {
  const { openWindow } = useApp()
  const finals = games.filter((game) => game.status === 'final' && game.home_points !== null && game.away_points !== null)
  const rankedLost = finals.flatMap((game) => {
    const winner = model.winnerId(game)
    return [game.home_team_id, game.away_team_id].filter((teamId) => teamId !== winner && winner !== null)
      .map((teamId) => ({ teamId, rank: model.apRankAtKickoff(teamId, game), game }))
      .filter((item) => item.rank !== null)
  }).sort((a, b) => a.rank! - b.rank!)
  const upsets = finals.map((game) => ({ game, upset: model.upset(game) })).filter((item) => item.upset)
    .sort((a, b) => (b.upset!.winnerSpread ?? 99) - (a.upset!.winnerSpread ?? 99))
  const overtime = finals.filter((game) => model.isOvertime(game)).length
  const average = finals.length ? finals.reduce((sum, game) => sum + game.home_points! + game.away_points!, 0) / finals.length : null
  return (
    <>
      <Tile title={`${label.toUpperCase()} IN NUMBERS`}>
        <div className="numbers-grid">
          <div><span>Ranked teams lost</span><strong className="cond num">{rankedLost.length}</strong></div>
          <div><span>Upsets</span><strong className="cond num">{upsets.length}</strong></div>
          <div><span>Overtime games</span><strong className="cond num">{overtime}</strong></div>
          <div><span>Avg. points</span><strong className="cond num">{average === null ? '—' : average.toFixed(1)}</strong></div>
        </div>
      </Tile>
      <Tile title="UPSETS THIS WEEK">
        {upsets.length ? upsets.slice(0, 6).map(({ game, upset }) => {
          const winner = model.team(upset!.winnerId)
          const rankAway = model.apRankAtKickoff(game.away_team_id, game)
          const rankHome = model.apRankAtKickoff(game.home_team_id, game)
          return (
            <button key={game.id} type="button" className="upset-row" onClick={() => openWindow({ type: 'game', gameId: game.id })}>
              <span className={`upset-tag upset-tag--${upset!.tier} cond`}>{UPSET_LABEL[upset!.tier]}</span>
              <span className="upset-copy">
                <strong className="cond num">{rankAway ? `#${rankAway} ` : ''}{abbr(model.team(game.away_team_id))} {game.away_points} {game.neutral_site ? 'vs' : '@'} {rankHome ? `#${rankHome} ` : ''}{abbr(model.team(game.home_team_id))} {game.home_points}</strong>
                <small className="muted">{winner?.school} {upset!.winnerSpread ? `+${upset!.winnerSpread}` : '(FCS)'}</small>
              </span>
            </button>
          )
        }) : <Empty>No upsets yet.</Empty>}
      </Tile>
      <Tile title="RANKED TEAMS THAT LOST">
        {rankedLost.length ? (
          <div className="chip-list">
            {rankedLost.map((item) => (
              <button key={item.teamId} type="button" className="loss-chip cond" onClick={() => openWindow({ type: 'game', gameId: item.game.id })}>#{item.rank} {abbr(model.team(item.teamId))}</button>
            ))}
          </div>
        ) : <Empty>Every ranked team won or has not played.</Empty>}
      </Tile>
    </>
  )
}

export function Scores() {
  const { model, period, timeZone, favorites, openWindow, mobile } = useApp()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('ALL FBS')
  const [conference, setConference] = useState<number | null>(null)

  const views = useMemo<View[]>(() => {
    const list: View[] = model.periods.filter((item) => item.seasonType === 'regular').map((item) => ({
      key: item.key,
      kind: item.kind === 'confchamp' ? 'confchamp' : 'week',
      label: item.label,
      top: item.kind === 'confchamp' ? 'CONF' : 'WEEK',
      bottom: item.kind === 'confchamp' ? 'CHAMP' : String(item.week),
    }))
    list.push({ key: 'bowls', kind: 'bowls', label: 'Bowl season', top: '', bottom: 'BOWLS' })
    list.push({ key: 'cfp', kind: 'cfp', label: 'College Football Playoff', top: '', bottom: 'CFP' })
    return list
  }, [model])

  const defaultKey = period?.seasonType === 'postseason'
    ? (model.games.some((game) => isCfp(game) && game.status !== 'final') || !model.games.some((game) => game.season_type !== 'regular' && !isCfp(game) && game.status !== 'final') ? 'cfp' : 'bowls')
    : period?.key ?? views[0]?.key
  const [viewKey, setViewKey] = useState(defaultKey)
  useEffect(() => setViewKey(defaultKey), [defaultKey])
  const view = views.find((item) => item.key === viewKey) ?? views[0]

  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    barRef.current?.querySelector('.week-chip.active')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [viewKey])

  const games = useMemo(() => {
    if (!view) return []
    if (view.kind === 'bowls') return model.games.filter((game) => game.season_type !== 'regular' && !isCfp(game))
    if (view.kind === 'cfp') return model.games.filter(isCfp)
    return model.gamesIn(view.key)
  }, [model, view])

  const conferences = model.conferenceList()
  const activeConference = conference ?? conferences[0]?.id ?? null
  const visible = games.filter((game) => {
    const ids = [game.home_team_id, game.away_team_id]
    if (filter === 'TOP 25') return ids.some((id) => model.apRankAtKickoff(id, game) !== null)
    if (filter === 'MY TEAMS') return ids.some((id) => favorites.has(id))
    if (filter === 'CONFERENCE') return ids.some((id) => model.teamSeasons.get(id)?.conference_id === activeConference)
    return true
  })
  const fbsCount = games.length

  const open = (gameId: number) => openWindow({ type: 'game', gameId })

  const weekBar = (
    <div className="week-bar" ref={barRef}>
      {!mobile && <button type="button" className="week-arrow" aria-label="Previous" onClick={() => {
        const index = views.findIndex((item) => item.key === view?.key)
        if (index > 0) setViewKey(views[index - 1].key)
      }}>‹</button>}
      <div className="week-chips">
        {views.map((item) => (
          <button key={item.key} type="button" className={`week-chip cond${item.key === view?.key ? ' active' : ''}${item.key === period?.key ? ' current' : ''}${item.top ? '' : ' single'}`} onClick={() => setViewKey(item.key)}>
            {item.top && <span>{item.top}</span>}
            <strong>{item.bottom}</strong>
          </button>
        ))}
      </div>
      {!mobile && <button type="button" className="week-arrow" aria-label="Next" onClick={() => {
        const index = views.findIndex((item) => item.key === view?.key)
        if (index < views.length - 1) setViewKey(views[index + 1].key)
      }}>›</button>}
    </div>
  )

  const filters = view && (view.kind === 'week') ? (
    <div className="filter-row">
      <Pills items={FILTERS} value={filter} onChange={setFilter} />
      {filter === 'CONFERENCE' && (
        <select className="select" aria-label="Conference" value={activeConference ?? ''} onChange={(event) => setConference(Number(event.target.value))}>
          {conferences.map((item) => <option key={item.id} value={item.id}>{confName(item)}</option>)}
        </select>
      )}
      <span className="grow" />
      {!mobile && <span className="muted">{fbsCount} FBS games</span>}
    </div>
  ) : (
    <div className="filter-row"><span className="grow" /><span className="muted">{view?.label}</span></div>
  )

  let content: ReactNode
  let side: ReactNode = null
  if (!view) content = <Empty>No games scheduled.</Empty>
  else if (view.kind === 'confchamp') {
    const titleGames = games.filter((game) => /championship/i.test(game.notes ?? ''))
    const others = games.filter((game) => !titleGames.includes(game))
    content = (
      <>
        <h2 className="section-title cond">ALL CONFERENCE TITLE GAMES</h2>
        {titleGames.length ? (
          <div className="slot-grid">
            {titleGames.map((game) => {
              const conferenceRow = model.conferenceOf(game.home_team_id)
              return <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={open} header={`${confAbbr(conferenceRow)} · ${(game.notes ?? '').toUpperCase()}${game.venue ? ` · ${game.venue.toUpperCase()}` : ''}`} />
            })}
          </div>
        ) : <Empty>Title game matchups are set after the final regular-season week.</Empty>}
        {others.length > 0 && <><h2 className="section-title cond">OTHER GAMES</h2><div className="slot-grid">{others.map((game) => <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={open} />)}</div></>}
      </>
    )
    side = <Tile title="WHAT'S AT STAKE"><p className="muted small">Power 4 champions earn automatic playoff bids. The best Group of 6 champion gets one too.</p><button type="button" className="tile-link" onClick={() => navigate('/rankings?view=bracket')}>Projected bracket →</button></Tile>
  } else if (view.kind === 'cfp') {
    const rounds = ['First Round', 'Quarterfinal', 'Semifinal', 'National Championship']
    content = games.length ? rounds.map((round) => {
      const roundGames = games.filter((game) => game.cfp_round === round)
      if (!roundGames.length) return null
      return (
        <section key={round} className="slot">
          <h2 className="section-title cond">{round === 'First Round' ? 'FIRST ROUND · ON CAMPUS' : round === 'Quarterfinal' ? 'QUARTERFINALS' : round === 'Semifinal' ? 'SEMIFINALS' : 'NATIONAL CHAMPIONSHIP'}</h2>
          <div className="slot-grid slot-grid--4">
            {roundGames.map((game) => <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={open} seeds header={round === 'First Round' ? null : (game.bowl_name ?? '').toUpperCase() || null} />)}
          </div>
        </section>
      )
    }) : <Empty>The playoff field is set on Selection Day. Until then, see the projected bracket in Rankings.</Empty>
    const seeds = games.flatMap((game) => [
      { teamId: game.home_team_id, seed: game.home_seed },
      { teamId: game.away_team_id, seed: game.away_seed },
    ]).filter((item) => item.seed && item.seed <= 4)
    const byes = [...new Map(seeds.map((item) => [item.teamId, item])).values()].sort((a, b) => a.seed! - b.seed!)
    side = (
      <Tile title="BYES · SEEDS 1–4" action="Full bracket →" onAction={() => navigate('/rankings?view=bracket')}>
        {byes.length ? byes.map((item) => (
          <div key={item.teamId} className="bye-row"><span className="muted num">({item.seed})</span><Plate team={model.team(item.teamId)} size={22} /><span>{model.team(item.teamId)?.school}</span></div>
        )) : <Empty>Seeds are set on Selection Day.</Empty>}
      </Tile>
    )
  } else {
    const sorted = [...visible].sort((a, b) => (Date.parse(a.start_time ?? '') || Infinity) - (Date.parse(b.start_time ?? '') || Infinity))
    const slots = new Map<string, Game[]>()
    for (const game of sorted) {
      const label = view.kind === 'bowls' && game.start_time
        ? `${longDay(game.start_time, timeZone).slice(0, 3)} ${kickoffParts(game.start_time, timeZone).date}`
        : slotLabel(game, timeZone)
      slots.set(label, [...(slots.get(label) ?? []), game])
    }
    content = slots.size ? [...slots].map(([label, slotGames]) => (
      <section key={label} className="slot">
        <h2 className="section-title cond">{label}</h2>
        <div className="slot-grid">
          {slotGames.map((game) => <GameTile key={game.id} model={model} game={game} timeZone={timeZone} onOpen={open} withDate={view.kind !== 'week'} header={view.kind === 'bowls' ? [game.bowl_name, game.venue].filter(Boolean).join(' · ').toUpperCase() || null : null} />)}
        </div>
      </section>
    )) : <Empty>{filter === 'MY TEAMS' ? 'None of your teams play this week.' : 'No games match this filter.'}</Empty>
    if (view.kind === 'bowls') {
      side = (
        <Tile title="BOWL SEASON">
          <div className="numbers-grid">
            <div><span>Bowl games</span><strong className="cond num">{games.length}</strong></div>
            <div><span>Played</span><strong className="cond num">{games.filter((game) => game.status === 'final').length}</strong></div>
          </div>
        </Tile>
      )
    } else side = <WeekNumbers model={model} games={games} label={view.label} />
  }

  if (mobile) {
    return (
      <div className="scores-mobile">
        {weekBar}
        {filters}
        {view?.kind === 'week' && (() => {
          const finals = games.filter((game) => game.status === 'final')
          return (
            <div className="mini-numbers">
              <div><span>Upsets</span><strong className="cond num">{finals.filter((game) => model.upset(game)).length}</strong></div>
              <div><span>Ranked lost</span><strong className="cond num">{finals.filter((game) => {
                const winner = model.winnerId(game)
                return [game.home_team_id, game.away_team_id].some((id) => id !== winner && model.apRankAtKickoff(id, game) !== null)
              }).length}</strong></div>
              <div><span>Overtime</span><strong className="cond num">{finals.filter((game) => model.isOvertime(game)).length}</strong></div>
            </div>
          )
        })()}
        <div className="scores-list">{content}</div>
        {view?.kind !== 'week' && side}
        <p className="muted small center">{fbsCount} FBS games this week</p>
      </div>
    )
  }

  return (
    <div className="scores">
      {weekBar}
      {filters}
      <div className="scores-layout">
        <div className="scores-main scroll-y">{content}</div>
        <aside className="side-stack scroll-y">{side}</aside>
      </div>
    </div>
  )
}
