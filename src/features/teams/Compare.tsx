import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { confName, recordText, teamColor, abbr } from '../../data/model'
import { fetchHeadToHead, refreshHeadToHead } from '../../data/queries'
import type { HeadToHead, Team } from '../../data/types'
import { dayMonth } from '../../shared/format'
import { Empty, ErrorBox, Loading, Plate, Tile } from '../../shared/ui'
import { useTeamStats } from '../stats/Stats'
import { METRICS, formatMetric } from '../stats/teamStats'
import { teamLeaders, useTeamPlayers } from './TeamTabs'

function TeamPicker({ team, other, side, onChange }: { team: Team; other: Team | undefined; side: 'left' | 'right'; onChange: (slug: string) => void }) {
  const { model, period } = useApp()
  const rank = model.apRankAfter(team.id, period?.order ?? Infinity)
  const options = [...model.fbsIds].map((id) => model.team(id)!).filter((item) => item && item.id !== other?.id).sort((a, b) => a.school.localeCompare(b.school))
  return (
    <div className={`compare-picker ${side}`} style={{ background: `linear-gradient(${side === 'left' ? 90 : 270}deg, ${teamColor(team)}aa, ${teamColor(team)}33)` }}>
      <Plate team={team} size={52} />
      <div className="compare-picker-copy">
        <strong className="cond">{team.school.toUpperCase()}</strong>
        <span className="small">{[rank ? `#${rank} AP` : null, recordText(model.record(team.id)), confName(model.conferenceOf(team.id))].filter(Boolean).join(' · ')}</span>
      </div>
      <span className="grow" />
      <label className="cond compare-change">
        CHANGE ▾
        <select aria-label={`Change team ${side === 'left' ? 'A' : 'B'}`} value={team.slug} onChange={(event) => onChange(event.target.value)}>
          {options.map((item) => <option key={item.id} value={item.slug}>{item.school}</option>)}
        </select>
      </label>
    </div>
  )
}

function useSeries(a: Team, b: Team) {
  const queryClient = useQueryClient()
  const key = ['h2h', Math.min(a.id, b.id), Math.max(a.id, b.id)]
  const query = useQuery({ queryKey: key, queryFn: () => fetchHeadToHead(a.id, b.id), staleTime: 10 * 60_000 })
  const { model } = useApp()
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Ask the Edge Function only when nothing is cached or the teams have met since.
  const lastMeeting = model.games.filter((game) => game.status === 'final' &&
    ((game.home_team_id === a.id && game.away_team_id === b.id) || (game.home_team_id === b.id && game.away_team_id === a.id)))
    .map((game) => Date.parse(game.start_time ?? '')).sort((x, y) => y - x)[0] ?? 0
  const stale = query.isSuccess && (!query.data || Date.parse(query.data.updated_at) < lastMeeting + 6 * 3600_000)
  useEffect(() => {
    if (!stale || refreshing) return
    let active = true
    setRefreshing(true)
    setRefreshError(null)
    refreshHeadToHead(a.id, b.id)
      .then((series) => { if (active) queryClient.setQueryData(key, series) })
      .catch((error: unknown) => { if (active) setRefreshError(error instanceof Error ? error.message : 'Could not load the series.') })
      .finally(() => { if (active) setRefreshing(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, a.id, b.id])
  return { series: query.data ?? null, loading: query.isPending || (stale && refreshing), error: (query.error as Error | null)?.message ?? (stale ? refreshError : null) }
}

function SeriesStrip({ a, b }: { a: Team; b: Team }) {
  const { model, timeZone, openWindow } = useApp()
  const { series, loading, error } = useSeries(a, b)
  const [open, setOpen] = useState(false)
  const winsOf = (team: Team, data: HeadToHead) => (team.id === data.team_a_id ? data.team_a_wins : data.team_b_wins)
  const next = model.games.find((game) => game.status === 'scheduled' &&
    ((game.home_team_id === a.id && game.away_team_id === b.id) || (game.home_team_id === b.id && game.away_team_id === a.id)))
  let seriesText = loading ? 'Loading…' : error ? 'Not available' : 'Never met'
  let last = '—'
  if (series && series.meetings.length) {
    const aw = winsOf(a, series)
    const bw = winsOf(b, series)
    const ties = series.ties ? `–${series.ties}` : ''
    seriesText = aw === bw ? `Series tied ${aw}–${bw}${ties}` : `${aw > bw ? a.school : b.school} leads ${Math.max(aw, bw)}–${Math.min(aw, bw)}${ties}`
    const meeting = series.meetings[0]
    const winner = meeting.winner === a.school ? a : meeting.winner === b.school ? b : null
    last = `${meeting.season} · ${winner ? `${abbr(winner)} won` : 'tie'} ${Math.max(meeting.home_points ?? 0, meeting.away_points ?? 0)}–${Math.min(meeting.home_points ?? 0, meeting.away_points ?? 0)}`
  }
  return (
    <section className="tile compare-strip">
      <div className="compare-strip-row">
        <h2 className="cond">HEAD TO HEAD</h2>
        <div><span className="muted small cond">ALL-TIME SERIES</span><strong>{seriesText}</strong></div>
        <div><span className="muted small cond">LAST MEETING</span><strong>{last}</strong></div>
        <div>
          <span className="muted small cond">NEXT MEETING</span>
          {next ? <button type="button" className="link-strong" onClick={() => openWindow({ type: 'game', gameId: next.id })}>{model.periodByKey.get(model.periodKeyOf(next))?.short} · {abbr(model.team(next.away_team_id))} {next.neutral_site ? 'vs' : '@'} {abbr(model.team(next.home_team_id))} · {dayMonth(next.start_time, timeZone)}</button> : <strong>Not scheduled</strong>}
        </div>
        <span className="grow" />
        {series && series.meetings.length > 0 && <button type="button" className="tile-link" onClick={() => setOpen(!open)}>{open ? 'Hide meetings' : 'All meetings →'}</button>}
      </div>
      {error && !loading && <p className="muted small">{error}</p>}
      {open && series && (
        <div className="meetings scroll-y">
          {series.meetings.map((meeting, index) => (
            <div key={`${meeting.season}-${index}`} className="meeting-row">
              <span className="muted num">{meeting.season}</span>
              <span className="grow truncate">{meeting.away} {meeting.neutral ? 'vs' : '@'} {meeting.home}</span>
              <strong className="num">{meeting.away_points}–{meeting.home_points}</strong>
              <span className="muted small">{meeting.winner ?? 'Tie'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Leaders({ team, align }: { team: Team; align: 'left' | 'right' }) {
  const { model, openWindow } = useApp()
  const players = useTeamPlayers(model.year, team.id)
  const leaders = useMemo(() => teamLeaders(players.data ?? []), [players.data])
  return (
    <Tile title={`${team.school.toUpperCase()} LEADERS`} className={`compare-leaders ${align} scroll-y`}>
      {players.error ? <ErrorBox message={(players.error as Error).message} /> : !players.data ? <Loading /> : leaders.length ? leaders.map((leader) => (
        <button key={leader.label} type="button" className="compare-leader" onClick={() => openWindow({ type: 'player', playerId: leader.row.player_id, name: leader.row.player_name, teamId: team.id })}>
          <span className="cond muted small">{leader.label}</span>
          <strong>{leader.row.player_name}</strong>
          <span className="small muted">{leader.text}</span>
        </button>
      )) : <Empty>No player statistics yet.</Empty>}
    </Tile>
  )
}

const ROWS: Array<{ key: string; label: string }> = [
  { key: 'ppg', label: 'Points / game' },
  { key: 'papg', label: 'Allowed / game' },
  { key: 'ypg', label: 'Yards / game' },
  { key: 'yapg', label: 'Yards allowed / game' },
  { key: 'pass', label: 'Pass yds / game' },
  { key: 'rush', label: 'Rush yds / game' },
  { key: 'third', label: '3rd down %' },
  { key: 'margin', label: 'Turnover margin' },
  { key: 'sacks', label: 'Sacks' },
]

function SeasonCompare({ a, b }: { a: Team; b: Team }) {
  const { model, period } = useApp()
  const { lines } = useTeamStats()
  const order = period?.order ?? Infinity
  const ra = model.record(a.id)
  const rb = model.record(b.id)
  const pctOf = (record: { w: number; l: number; t: number }) => (record.w + record.l + record.t ? (record.w + record.t / 2) / (record.w + record.l + record.t) : 0)
  const rankA = model.apRankAfter(a.id, order)
  const rankB = model.apRankAfter(b.id, order)
  const row = (label: string, left: string, right: string, va: number | null, vb: number | null, lowerBetter = false) => {
    const better = va === null || vb === null || va === vb ? 0 : (va > vb) !== lowerBetter ? -1 : 1
    // Bar share: higher is longer; for lower-is-better values the shares are flipped.
    const sa = va === null || vb === null ? 0.5 : (() => {
      const x = Math.max(0, va)
      const y = Math.max(0, vb)
      if (x + y === 0) return 0.5
      return lowerBetter ? y / (x + y) : x / (x + y)
    })()
    return (
      <div key={label} className="cmp-row">
        <div className="cmp-values">
          <strong className={`cond num${better === 1 ? ' dim' : ''}`}>{left}</strong>
          <span className="muted small">{label}</span>
          <strong className={`cond num${better === -1 ? ' dim' : ''}`}>{right}</strong>
        </div>
        <div className="cmp-bars">
          <span style={{ flex: Math.max(0.04, sa), background: better === 1 ? `${teamColor(a)}66` : teamColor(a) }} />
          <span style={{ flex: Math.max(0.04, 1 - sa), background: better === -1 ? '#C9CDD344' : '#C9CDD3' }} />
        </div>
      </div>
    )
  }
  const la = lines?.get(a.id)
  const lb = lines?.get(b.id)
  return (
    <Tile title={`${model.year} SEASON`} className="compare-season scroll-y">
      {row('Record', recordText(ra), recordText(rb), pctOf(ra), pctOf(rb))}
      {row('AP rank', rankA ? `#${rankA}` : 'NR', rankB ? `#${rankB}` : 'NR', rankA ? 26 - rankA : 0, rankB ? 26 - rankB : 0)}
      {lines ? ROWS.map((item) => {
        const metric = METRICS[item.key]
        const va = la?.values[item.key] ?? null
        const vb = lb?.values[item.key] ?? null
        return row(item.label, formatMetric(metric, va), formatMetric(metric, vb), va, vb, metric.lowerBetter)
      }) : <Loading />}
    </Tile>
  )
}

export function Compare() {
  const { model, favorites, period, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const bySlug = (slug: string | null) => (slug ? [...model.teams.values()].find((team) => team.slug === slug && model.fbsIds.has(team.id)) : undefined)
  const poll = model.pollAfter('AP', period?.order ?? Infinity)
  const defaults = [...favorites].filter((id) => model.fbsIds.has(id)).map((id) => model.team(id)!)
    .concat((poll?.ranked ?? []).map((row) => model.team(row.team_id)!))
    .concat([...model.fbsIds].map((id) => model.team(id)!))
    .filter(Boolean)
  const a = bySlug(params.get('a')) ?? defaults[0]
  const b = bySlug(params.get('b')) ?? defaults.find((team) => team.id !== a?.id)
  if (!a || !b) return <Empty>Not enough teams to compare.</Empty>
  const set = (side: 'a' | 'b', slug: string) => {
    const next = new URLSearchParams(params)
    next.set('view', 'compare')
    next.set('a', side === 'a' ? slug : a.slug)
    next.set('b', side === 'b' ? slug : b.slug)
    setParams(next, { replace: true })
  }
  const pickers = (
    <div className="compare-pickers">
      <TeamPicker team={a} other={b} side="left" onChange={(slug) => set('a', slug)} />
      <span className="cond muted compare-vs">VS</span>
      <TeamPicker team={b} other={a} side="right" onChange={(slug) => set('b', slug)} />
    </div>
  )
  if (mobile) {
    return (
      <div className="stats-mobile">
        {pickers}
        <SeriesStrip a={a} b={b} />
        <SeasonCompare a={a} b={b} />
        <Leaders team={a} align="left" />
        <Leaders team={b} align="left" />
      </div>
    )
  }
  return (
    <div className="compare">
      {pickers}
      <SeriesStrip a={a} b={b} />
      <div className="compare-grid">
        <Leaders team={a} align="left" />
        <SeasonCompare a={a} b={b} />
        <Leaders team={b} align="right" />
      </div>
    </div>
  )
}
