import { Suspense, lazy, useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import { abbr } from '../../data/model'
import { ErrorBox, Loading } from '../../shared/ui'
import { hostResult, isNeutral, placeLabel, useGamedayStops } from './data'

const GameDayMap = lazy(() => import('./GameDayMap'))

// Archive → GameDay History: every show since 1993 on the map and in a list.
export function GameDayHistory() {
  const { model, openWindow, mobile } = useApp()
  const query = useGamedayStops()
  const [season, setSeason] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const stops = useMemo(() => query.data ?? [], [query.data])
  const seasons = [...new Set(stops.map((stop) => stop.season))].sort((a, b) => b - a)
  const needle = search.trim().toLowerCase()
  const filtered = stops
    .filter((stop) => season === null || stop.season === season)
    .filter((stop) => !needle || `${stop.city} ${stop.state} ${stop.host} ${stop.visitor}`.toLowerCase().includes(needle))
  const list = [...filtered].sort((a, b) => b.season - a.season || b.stop - a.stop)
  const campuses = new Set(filtered.map((stop) => placeLabel(stop))).size
  let hostW = 0
  let hostL = 0
  for (const stop of filtered) {
    if (isNeutral(stop, model.team(stop.host_team_id))) continue
    const result = hostResult(stop)
    if (result === 'W') hostW += 1
    if (result === 'L') hostL += 1
  }
  const thisWeek = new Date().toISOString().slice(0, 10)

  if (query.error) return <ErrorBox message={(query.error as Error).message} onRetry={() => void query.refetch()} />
  if (!query.data) return <Loading label="Loading every GameDay stop…" />
  if (!stops.length) {
    return <p className="empty">The GameDay history is imported with the next weekly update (or Update now in Settings).</p>
  }

  const map = (
    <section className="gd-history-map">
      <header className="gd-history-head">
        <h2 className="varsity">EVERY GAMEDAY STOP</h2>
        <span className="cond muted small">PIN SIZE = NUMBER OF VISITS</span>
      </header>
      <div className="gd-history-canvas">
        <Suspense fallback={<Loading />}>
          <GameDayMap stops={filtered} teams={[...model.teams.values()]} />
        </Suspense>
      </div>
      <div className="gd-history-facts">
        <div><span>Total stops</span><strong className="cond num">{filtered.length}</strong></div>
        <div><span>Places visited</span><strong className="cond num">{campuses}</strong></div>
        <div><span>Host record</span><strong className="cond num">{hostW}–{hostL}</strong></div>
      </div>
    </section>
  )
  const table = (
    <section className={`tile gd-history-list${mobile ? '' : ' scroll-y'}`}>
      <div className="filter-row">
        <select className="select cond" aria-label="Season" value={season ?? ''} onChange={(event) => setSeason(event.target.value ? Number(event.target.value) : null)}>
          <option value="">ALL SEASONS</option>
          {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <input className="text-input grow" placeholder="Find a campus" aria-label="Find a campus" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="gd-row gd-row-head cond"><span>SEASON</span><span>SHOW</span><span>CAMPUS</span><span>GAME</span><span>HOST</span></div>
      {list.map((stop) => {
        const host = model.team(stop.host_team_id)
        const game = stop.game_id ? model.gameById.get(stop.game_id) : undefined
        const result = hostResult(stop)
        const neutral = isNeutral(stop, host)
        const upcoming = !result && (stop.show_date ?? '') >= thisWeek
        return (
          <button key={`${stop.season}-${stop.stop}`} type="button" className="gd-row" disabled={!game} onClick={() => game && openWindow({ type: 'game', gameId: game.id })}>
            <span className="muted num">{stop.season}</span>
            <span className="muted small">{stop.show_date ? new Date(`${stop.show_date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : `#${stop.stop}`}</span>
            <span className="truncate">{placeLabel(stop)}</span>
            <span className="small truncate">{abbr(model.team(stop.visitor_team_id)) || stop.visitor} @ {abbr(host) || stop.host}</span>
            <strong className={`cond num gd-result ${upcoming ? 'this' : neutral ? 'neutral' : result === 'W' ? 'win' : result === 'L' ? 'loss' : ''}`}>
              {upcoming ? 'UPCOMING' : !result ? '—' : neutral ? 'Neutral' : `${result} ${stop.host_points}–${stop.visitor_points}`}
            </strong>
          </button>
        )
      })}
    </section>
  )
  return mobile ? <div className="stats-mobile">{map}{table}</div> : <div className="gd-history">{map}{table}</div>
}
