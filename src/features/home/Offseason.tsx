import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { SeasonScope } from '../../app/SeasonScope'
import { recordText, teamColor, type SeasonModel } from '../../data/model'
import { countdown, shortDateTime } from '../../shared/format'
import { Empty, Plate, Tile } from '../../shared/ui'
import { seasonUpsets } from '../archive/Archive'

export type OffseasonState = { recapYear: number | null; kickoff: number; kickoffKnown: boolean }

const time = (value: string | null) => (value ? Date.parse(value) : Number.NaN)

// Last Saturday of August, the usual Week 0, when the schedule is not stored yet.
const expectedKickoff = (year: number) => {
  const date = new Date(Date.UTC(year, 7, 31, 16))
  date.setUTCDate(31 - ((date.getUTCDay() + 1) % 7))
  return date.getTime()
}

// Offseason: from the day after the national title game until the first
// game of the next season.
export function offseasonState(model: SeasonModel, seasons: Array<{ year: number }>, now = Date.now(), preview = false): OffseasonState | null {
  const starts = model.games.map((game) => time(game.start_time)).filter(Number.isFinite)
  const first = starts.length ? Math.min(...starts) : null
  if (first !== null && now < first) {
    const previous = seasons.find((season) => season.year === model.year - 1)
    return { recapYear: previous?.year ?? null, kickoff: first, kickoffKnown: true }
  }
  const title = model.games.find((game) => game.cfp_round === 'National Championship' || /national championship/i.test(game.bowl_name ?? ''))
  if (title && title.status === 'final' && now > time(title.start_time) + 24 * 3_600_000) {
    return { recapYear: model.year, kickoff: expectedKickoff(model.year + 1), kickoffKnown: false }
  }
  if (preview) {
    const done = model.bundle.season?.champion_team_id ? model.year : seasons.filter((season) => season.year < model.year).map((season) => season.year).sort().at(-1) ?? null
    return { recapYear: done, kickoff: expectedKickoff(model.year + 1), kickoffKnown: false }
  }
  return null
}

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const left = countdown(target, now)
  return (
    <div className="off-count">
      {[['DAYS', left.days], ['HOURS', left.hours], ['MINUTES', left.minutes]].map(([label, value]) => (
        <div key={label}><strong className="num">{String(value).padStart(label === 'DAYS' ? 1 : 2, '0')}</strong><span className="cond">{label}</span></div>
      ))}
    </div>
  )
}

const CALENDAR: Array<{ month: string; title: string; note: string }> = [
  { month: 'APR', title: 'Spring games', note: 'Most programs, through late April' },
  { month: 'APR', title: 'NFL Draft', note: 'Late April' },
  { month: 'JUL', title: 'Conference media days', note: 'Mid July' },
  { month: 'AUG', title: 'Preseason AP Poll', note: 'Mid August' },
  { month: 'AUG', title: 'Week 0 kickoff', note: 'Last Saturday of August' },
]

function Recap({ upcoming }: { upcoming: SeasonModel | null }) {
  const { model, favorites, timeZone, openWindow, mobile } = useApp()
  const navigate = useNavigate()
  const season = model.bundle.season
  const champion = model.team(season?.champion_team_id)
  const unbeaten = model.team(season?.last_unbeaten_team_id)
  const upset = seasonUpsets(model)[0]
  const tiles: Array<{ label: string; value: string; onClick?: () => void }> = [
    { label: 'NATIONAL CHAMPION', value: champion?.school ?? '—', onClick: () => navigate(`/archive?season=${model.year}`) },
    { label: 'HEISMAN WINNER', value: season?.heisman_winner ?? 'Not recorded yet' },
    {
      label: 'UPSET OF THE YEAR',
      value: upset ? `${model.team(upset.upset.winnerId)?.school} · ${upset.upset.winnerSpread === null ? 'FCS' : `+${upset.upset.winnerSpread}`}` : '—',
      onClick: upset ? () => openWindow({ type: 'game', gameId: upset.game.id }) : undefined,
    },
    { label: 'LAST UNBEATEN', value: unbeaten?.school ?? 'Nobody' },
  ]
  const mine = [...favorites].map((id) => model.team(id)).filter((team) => team && model.fbsIds.has(team.id))
  return (
    <>
      <button type="button" className="off-champion" style={{ background: `linear-gradient(110deg, ${teamColor(champion)}, ${teamColor(champion)}55 70%, #15171A)` }} onClick={() => navigate(`/archive?season=${model.year}`)}>
        <span className="cond off-kicker">{model.year} NATIONAL CHAMPIONS</span>
        <span className="varsity off-name">{(champion?.school ?? 'TBD').toUpperCase()}</span>
        <span className="cond off-link">SEASON RECAP IN THE ARCHIVE →</span>
      </button>
      <div className="off-tiles">
        {tiles.map((tile) => (
          <button key={tile.label} type="button" className="tile off-tile" disabled={!tile.onClick} onClick={tile.onClick}>
            <span className="cond muted small">{tile.label}</span>
            <strong className="cond">{tile.value}</strong>
          </button>
        ))}
      </div>
      <Tile title={`MY TEAMS · ${model.year} FINAL`} action="Edit" onAction={() => openWindow({ type: 'favorites' })} className={mobile ? '' : 'off-mine'}>
        {mine.length ? mine.map((team) => {
          const opener = upcoming?.teamGames(team!.id)[0]
          const opponent = opener ? upcoming!.team(opener.home_team_id === team!.id ? opener.away_team_id : opener.home_team_id) : null
          return (
            <button key={team!.id} type="button" className="mine-row" onClick={() => navigate(`/teams/${team!.slug}`)}>
              <Plate team={team} size={34} />
              <span className="mine-copy">
                <span className="cond mine-name">{team!.school.toUpperCase()}</span>
                <span className="muted small">{opener ? `Opener: ${opener.home_team_id === team!.id ? 'vs' : '@'} ${opponent?.school ?? 'TBD'} · ${shortDateTime(opener.start_time, timeZone)}` : 'Opener: schedule not imported yet'}</span>
              </span>
              <span className="grow" />
              <span className="cond num">{recordText(model.record(team!.id))}{model.apRankAfter(team!.id, Infinity) ? ` · #${model.apRankAfter(team!.id, Infinity)}` : ''}</span>
            </button>
          )
        }) : <Empty>No favorite teams yet.</Empty>}
      </Tile>
    </>
  )
}

export function OffseasonHome({ state }: { state: OffseasonState }) {
  const { model, mobile } = useApp()
  const upcoming = state.kickoffKnown ? model : null
  const nextYear = state.kickoffKnown ? model.year : model.year + 1
  const firstGame = upcoming ? [...upcoming.games].sort((a, b) => time(a.start_time) - time(b.start_time))[0] : null
  const firstPeriod = firstGame ? upcoming!.periodByKey.get(upcoming!.periodKeyOf(firstGame)) : null
  const kickoffText = new Date(state.kickoff).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const calendar = (
    <Tile title="OFFSEASON CALENDAR" className={mobile ? '' : 'off-calendar'}>
      {CALENDAR.map((item) => (
        <div key={item.title} className="off-cal-row">
          <span className="cond muted">{item.month}</span>
          <span className="grow"><strong>{item.title}</strong><small className="muted">{item.note}</small></span>
        </div>
      ))}
    </Tile>
  )
  return (
    <div className={mobile ? 'stats-mobile' : 'offseason'}>
      <section className="tile off-countdown">
        <span className="cond off-kicker muted">OFFSEASON · {nextYear} KICKOFF IN</span>
        <Countdown target={state.kickoff} />
        <span className="muted">{state.kickoffKnown ? `First game: ${firstPeriod?.label ?? 'Week 1'} · ${kickoffText}` : `Expected around ${kickoffText}; the schedule is added once it is released.`}</span>
      </section>
      {state.recapYear !== null
        ? <SeasonScope year={state.recapYear}><Recap upcoming={upcoming} /></SeasonScope>
        : <Tile title="SEASON RECAP"><Empty>No completed season stored yet.</Empty></Tile>}
      {calendar}
    </div>
  )
}
