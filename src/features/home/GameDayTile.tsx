import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { hostResult, isNeutral, teamGameday, useGamedayStops } from '../gameday/data'
import { abbr, recordText, teamColor } from '../../data/model'
import type { Team } from '../../data/types'
import { countdown, kickoffParts } from '../../shared/format'
import { imageUrl } from '../../shared/ui'
import { currentGamedayRow } from '../gameday/GameDayWindow'

export function Pennant({ team, side }: { team: Team | undefined; side: 'left' | 'right' }) {
  const left = side === 'left'
  return (
    <svg width="74" height="40" viewBox="0 0 74 40" aria-hidden="true">
      <path d={left ? 'M2 2 L72 20 L2 38 Z' : 'M72 2 L2 20 L72 38 Z'} fill={teamColor(team)} stroke="#F2F3F5" strokeWidth="2" />
      <circle cx={left ? 20 : 54} cy="20" r="14" fill="#D9DCE0" />
      <text x={left ? 20 : 54} y="23.6" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="700" fontSize="10" fill={teamColor(team)}>{abbr(team)}</text>
    </svg>
  )
}

// The show airs from 9:00 to 12:00 Eastern on game day.
export function showStartTime(start: string | null) {
  if (!start) return null
  const date = new Date(start)
  // Late kickoffs (after midnight UTC) still belong to the Eastern game day.
  const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '-5'
  const [, sign, hours] = offset.match(/^([+-])(\d{1,2})/) ?? ['', '-', '5']
  return Date.parse(`${eastern}T09:00:00${sign}${hours.padStart(2, '0')}:00`)
}

// College GameDay: the show's location for the coming week, added on Monday
// of game week from the Wikipedia list.
export function GameDayTile() {
  const { model, period, timeZone, openWindow, mobile } = useApp()
  const navigate = useNavigate()
  const stops = useGamedayStops()
  const next = period ? model.nextPeriodAfter(period) ?? period : null
  const week = next ? model.awardWeekFor(next) : null
  const row = currentGamedayRow(model, period ? model.awardWeekFor(period) : null, week)
  const game = row?.game_id ? model.gameById.get(row.game_id) : undefined
  const host = model.team(row?.team_id ?? game?.home_team_id)

  if (!row || !game) {
    return (
      <section className={`gameday-tile gameday-tile--empty${mobile ? ' gameday-tile--mobile' : ''}`}>
        <div className="gameday-photo" style={{ background: '#3A2A1C' }}>
          <span className="varsity gameday-kicker">COLLEGE GAMEDAY{next ? ` · ${next.short}` : ''}</span>
          <span className="varsity gameday-city">TBA</span>
        </div>
        <div className="gameday-body">
          <p className="gameday-note">The show's next location is added on Monday of game week.</p>
        </div>
      </section>
    )
  }

  const photo = host ? imageUrl('gameday', host.slug, ['jpg', 'jpeg', 'webp', 'png']) : null
  const kickoff = kickoffParts(game.start_time, timeZone)
  const order = model.gameOrder(game)
  const away = model.team(game.away_team_id)
  const home = model.team(game.home_team_id)
  const rankOf = (teamId: number) => model.apRankAtKickoff(teamId, game)
  // The show airs from 9:00 to 12:00 Eastern on game day.
  const showStart = showStartTime(game.start_time)
  const before = (stops.data ?? []).filter((stop) => stop.game_id !== game.id && (stop.show_date ?? '') < (game.start_time ?? '').slice(0, 10))
  const hostLine = host && stops.data ? teamGameday(before, host.id, host) : null
  const recent = before.filter((stop) => stop.season === model.year).slice(-3).reverse()
  const remaining = showStart && showStart > Date.now() ? countdown(showStart).text : null
  return (
    <section className={`gameday-tile${mobile ? ' gameday-tile--mobile' : ''}`} style={{ borderColor: teamColor(host) }}>
      <button type="button" className={`gameday-photo${photo ? '' : ' gameday-photo--plain'}`} style={{ background: teamColor(host), backgroundImage: photo ? `linear-gradient(to top, rgba(0,0,0,.65), rgba(0,0,0,0) 60%), url(${photo})` : undefined }} onClick={() => openWindow({ type: 'gameday' })}>
        <span className="varsity gameday-kicker">COLLEGE GAMEDAY · WK {game.week}</span>
        <span className="varsity gameday-city">{String(row.result.city ?? host?.location?.city ?? host?.school ?? '').toUpperCase()}</span>
        <span className="varsity gameday-state">{String(row.result.state ?? host?.location?.state ?? '').toUpperCase()}</span>
      </button>
      <div className="gameday-body">
        <div className="gameday-matchup">
          <span className="gameday-side"><Pennant team={away} side="left" /><span className="cond">{rankOf(game.away_team_id) ? `#${rankOf(game.away_team_id)} · ` : ''}{recordText(model.record(game.away_team_id, order - 1))}</span></span>
          <span className="varsity gameday-at">{game.neutral_site ? 'VS' : '@'}</span>
          <span className="gameday-side"><Pennant team={home} side="right" /><span className="cond">{rankOf(game.home_team_id) ? `#${rankOf(game.home_team_id)} · ` : ''}{recordText(model.record(game.home_team_id, order - 1))}{game.neutral_site ? '' : ' · HOME'}</span></span>
        </div>
        <div className="gameday-countdown">
          {game.status === 'final'
            ? <><span className="cond">FINAL</span><span className="varsity num">{game.away_points}–{game.home_points}</span></>
            : <><span className="cond">{remaining ? 'SHOW STARTS IN' : 'KICKOFF'}</span><span className="varsity num">{remaining ?? kickoff.time}</span></>}
          <span className="cond gameday-kick">KICKOFF {kickoff.day} {kickoff.time}{game.tv ? ` · ${game.tv}` : ''}{model.favoriteText(game) ? ` · ${model.favoriteText(game)}` : ''}</span>
        </div>
        <div className="gameday-facts">
          <div><span>Guest picker</span><strong className="cond">{row.guest_picker ?? 'TBA'}</strong></div>
          {hostLine && host
            ? <div><span>{abbr(host)} w/ GameDay</span><strong className="cond num">{hostLine.homeW}–{hostLine.homeL} at home</strong></div>
            : <div><span>Venue</span><strong className="cond truncate">{game.venue ?? 'TBA'}</strong></div>}
        </div>
        {!mobile && recent.length > 0 && (
          <div className="gameday-recent">
            <span className="cond gameday-recent-head">RECENT STOPS</span>
            {recent.map((stop) => {
              const result = hostResult(stop)
              const neutral = isNeutral(stop, model.team(stop.host_team_id))
              return (
                <div key={stop.stop} className="gameday-recent-row">
                  <span className="cond muted">{stop.game_id && model.gameById.get(stop.game_id) ? model.periodByKey.get(model.periodKeyOf(model.gameById.get(stop.game_id)!))?.short : ''}</span>
                  <span className="grow truncate">{stop.city}</span>
                  <strong className={`cond num ${neutral ? '' : result === 'W' ? 'win' : result === 'L' ? 'loss' : ''}`}>{result ? (neutral ? `${Math.max(stop.host_points!, stop.visitor_points!)}–${Math.min(stop.host_points!, stop.visitor_points!)}` : `${result} ${stop.host_points}–${stop.visitor_points}`) : ''}</strong>
                </div>
              )
            })}
          </div>
        )}
        {!mobile && <button type="button" className="outline-button cond gameday-all" onClick={() => navigate('/archive?view=gameday')}>ALL GAMEDAY STOPS</button>}
      </div>
    </section>
  )
}
