import { gameText } from '../../shared/gameText'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { seasonConfig } from '../../data/config'
import { type PollRelease, type SeasonModel, confAbbr, recordText } from '../../data/model'
import { projectField } from '../../data/standings'
import type { PollSource } from '../../data/types'
import { countdown, fullDateTime, number } from '../../shared/format'
import { ConfTag, Empty, Flame, Movement, Plate, Tabs, Tile } from '../../shared/ui'
import { Bracket } from './Bracket'

const VIEWS = ['AP POLL', 'COACHES', 'CFP RANKINGS', 'PLAYOFF BRACKET'] as const
type View = typeof VIEWS[number]
const SOURCE: Partial<Record<View, PollSource>> = { 'AP POLL': 'AP', COACHES: 'Coaches', 'CFP RANKINGS': 'CFP' }
const PARAM: Record<string, View> = { ap: 'AP POLL', coaches: 'COACHES', cfp: 'CFP RANKINGS', bracket: 'PLAYOFF BRACKET' }

// The games that came before a poll and the games that follow it.
export const pollWindow = (model: SeasonModel, release: PollRelease) => {
  const before = release.seasonType === 'postseason' ? model.lastRegularWeek + 1 : release.week - 1
  return { before, after: before + 1 }
}


export function lastAndNext(model: SeasonModel, teamId: number, release: PollRelease) {
  const { before, after } = pollWindow(model, release)
  const games = model.teamGames(teamId)
  const last = before >= 1 ? games.find((game) => model.gameOrder(game) === before) : undefined
  const next = games.find((game) => model.gameOrder(game) >= after && game.status !== 'final') ??
    games.find((game) => model.gameOrder(game) === after)
  return {
    last: before < 1 ? null : last && last.status === 'final' ? gameText(model, teamId, last, true) : last ? gameText(model, teamId, last, false) : { outcome: '', text: 'Bye' },
    next: next ? gameText(model, teamId, next, false).text : '—',
  }
}

function ConferenceBars({ model, release }: { model: SeasonModel; release: PollRelease }) {
  const counts = new Map<string, number>()
  for (const row of release.ranked) {
    const code = confAbbr(model.conferenceOf(row.team_id))
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...sorted.map(([, count]) => count))
  return (
    <Tile title="TOP 25 BY CONFERENCE">
      {sorted.map(([code, count]) => (
        <div key={code} className="meter-row">
          <ConfTag code={code} />
          <span className="meter"><span style={{ width: `${(count / max) * 100}%` }} /></span>
          <strong className="cond num">{count}</strong>
        </div>
      ))}
    </Tile>
  )
}

function InAndOut({ model, release, previous }: { model: SeasonModel; release: PollRelease; previous: PollRelease | null }) {
  const name = (teamId: number) => model.team(teamId)?.school ?? ''
  const added = previous ? release.ranked.filter((row) => !previous.byTeam.has(row.team_id)) : []
  const dropped = previous ? previous.ranked.filter((row) => !release.byTeam.has(row.team_id)) : []
  return (
    <Tile title="IN AND OUT">
      {previous ? (
        <>
          <p className="inline-stat"><strong className="cond up">NEW</strong> {added.map((row) => name(row.team_id)).join(', ') || 'None'}</p>
          <p className="inline-stat"><strong className="cond down">OUT</strong> {dropped.map((row) => name(row.team_id)).join(', ') || 'None'}</p>
        </>
      ) : <p className="muted small">The first poll of the season.</p>}
      {release.others.length > 0 && (
        <p className="inline-stat small"><strong className="cond">ALSO RECEIVING VOTES</strong> {release.others.slice(0, 8).map((row) => `${name(row.team_id)}${row.points ? ` ${row.points}` : ''}`).join(', ')}</p>
      )}
    </Tile>
  )
}

function Movers({ model, release, previous }: { model: SeasonModel; release: PollRelease; previous: PollRelease | null }) {
  if (!previous) return null
  const moves = release.ranked.map((row) => ({ teamId: row.team_id, rank: row.rank, diff: (previous.byTeam.get(row.team_id)?.rank ?? 0) - row.rank }))
    .filter((move) => previous.byTeam.has(move.teamId))
  const dropped = previous.ranked.filter((row) => !release.byTeam.has(row.team_id))
  const up = [...moves].sort((a, b) => b.diff - a.diff).filter((move) => move.diff > 0).slice(0, 2)
  const down = [...moves].sort((a, b) => a.diff - b.diff).filter((move) => move.diff < 0).slice(0, 2)
  if (!up.length && !down.length && !dropped.length) return null
  return (
    <Tile title="BIGGEST MOVERS">
      {[...up, ...down].map((move) => (
        <div key={move.teamId} className="mover-row">
          <span>{model.team(move.teamId)?.school}</span>
          <strong className={`cond num ${move.diff > 0 ? 'up' : 'down'}`}>{move.diff > 0 ? '▲' : '▼'}{Math.abs(move.diff)} to #{move.rank}</strong>
        </div>
      ))}
    </Tile>
  )
}

function Disagreements({ model, release }: { model: SeasonModel; release: PollRelease }) {
  const ap = model.pollReleases('AP').find((item) => item.seasonType === release.seasonType && item.week === release.week)
  if (!ap) return null
  const rows = release.ranked.map((row) => ({ teamId: row.team_id, here: row.rank, ap: ap.byTeam.get(row.team_id)?.rank ?? null }))
    .filter((row) => row.ap !== row.here)
    .sort((a, b) => Math.abs((b.ap ?? 30) - b.here) - Math.abs((a.ap ?? 30) - a.here)).slice(0, 4)
  return (
    <Tile title="BIGGEST DISAGREEMENTS">
      {rows.length ? rows.map((row) => (
        <div key={row.teamId} className="mover-row">
          <span>{model.team(row.teamId)?.school}</span>
          <strong className="cond num">#{row.here} here · {row.ap ? `AP #${row.ap}` : 'unranked in AP'}</strong>
        </div>
      )) : <Empty>Both polls agree.</Empty>}
    </Tile>
  )
}

function CfpCountdown({ year, onBracket }: { year: number; onBracket: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => tick((value) => value + 1), 60_000)
    return () => window.clearInterval(interval)
  }, [])
  const first = seasonConfig(year).cfpReleases[0]
  const target = first ? Date.parse(first) : null
  return (
    <div className="cfp-empty">
      {target && target > Date.now() ? (
        <>
          <span className="cond muted-label">FIRST CFP RANKING IN</span>
          <strong className="cond num countdown-big">{countdown(target).text}</strong>
          <p className="muted">The selection committee releases its first Top 25 on {fullDateTime(first!, 'Europe/Berlin')} (German time). Until then, the playoff picture is projected from the AP Poll.</p>
        </>
      ) : (
        <>
          <span className="cond muted-label">CFP RANKINGS</span>
          <p className="muted">No committee ranking has been imported for this season.</p>
        </>
      )}
      <button type="button" className="primary-button cond" onClick={onBracket}>SEE PROJECTED BRACKET</button>
    </div>
  )
}

export function Rankings() {
  const { model, period, mobile, favorites } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = PARAM[params.get('view') ?? ''] ?? 'AP POLL'
  const setView = (next: View) => setParams((current) => {
    const copy = new URLSearchParams(current)
    copy.set('view', Object.entries(PARAM).find(([, value]) => value === next)![0])
    copy.delete('poll')
    return copy
  }, { replace: true })
  const source = SOURCE[view]
  const releases = source ? model.pollReleases(source) : []
  const order = period?.order ?? 0
  const defaultRelease = source ? model.pollAfter(source, order) : null
  const pollParam = params.get('poll')
  const release = releases.find((item) => `${item.seasonType}-${item.week}` === pollParam) ?? defaultRelease
  const previous = release ? model.previousRelease(release) : null
  const setRelease = (key: string) => setParams((current) => {
    const copy = new URLSearchParams(current)
    copy.set('poll', key)
    return copy
  }, { replace: true })

  const cfpField = useMemo(() => (view === 'CFP RANKINGS' && release ? projectField(model, order, true, release) : null), [view, release, model, order])
  const apForCompare = release && source !== 'AP'
    ? model.pollReleases('AP').find((item) => item.seasonType === release.seasonType && item.week === release.week) ?? null
    : null

  const selector = releases.length > 0 && view !== 'PLAYOFF BRACKET' && (
    <select className="select cond" aria-label="Poll week" value={release ? `${release.seasonType}-${release.week}` : ''} onChange={(event) => setRelease(event.target.value)}>
      {[...releases].reverse().map((item) => <option key={`${item.seasonType}-${item.week}`} value={`${item.seasonType}-${item.week}`}>{item.label.toUpperCase()}</option>)}
    </select>
  )

  const header = (
    <div className="page-head page-head--tabs">
      <h1 className="cond">RANKINGS</h1>
      <Tabs items={VIEWS} value={view} onChange={setView} labels={mobile ? { 'AP POLL': 'AP', 'CFP RANKINGS': 'CFP', 'PLAYOFF BRACKET': 'BRACKET' } : undefined} />
      <span className="grow" />
      {!mobile && release && view !== 'PLAYOFF BRACKET' && <span className="muted small">{release.label === 'Preseason' ? 'Preseason poll' : release.label === 'Final' ? 'Final poll' : `After ${release.label.toLowerCase()}`}{release.ranked[0]?.first_place_votes ? ` · ${release.ranked.reduce((sum, row) => sum + (row.first_place_votes ?? 0), 0)} first-place votes` : ''}</span>}
      {selector}
    </div>
  )

  if (view === 'PLAYOFF BRACKET') return <div className="rankings">{header}<Bracket /></div>
  if (view === 'CFP RANKINGS' && !releases.length) return <div className="rankings">{header}<CfpCountdown year={model.year} onBracket={() => setView('PLAYOFF BRACKET')} /></div>
  if (!release) return <div className="rankings">{header}<Empty>This poll has not been released yet.</Empty></div>

  const fieldByTeam = new Map(cfpField?.field.map((entry) => [entry.teamId, entry]) ?? [])
  const { before } = pollWindow(model, release)

  const rows = release.ranked.map((row) => {
    const team = model.team(row.team_id)
    const prev = previous?.byTeam.get(row.team_id)?.rank ?? null
    const info = lastAndNext(model, row.team_id, release)
    const record = recordText(model.record(row.team_id, before))
    const apRank = apForCompare?.byTeam.get(row.team_id)?.rank ?? null
    const field = fieldByTeam.get(row.team_id)
    const out = view === 'CFP RANKINGS' && !field
    if (mobile) {
      return (
        <button key={row.team_id} type="button" className={`rank-mobile-row${row.rank <= 4 ? ' top' : ''}${out ? ' out' : ''}`} onClick={() => navigate(`/teams/${team?.slug}`)}>
          <span className="cond num rank-num">{row.rank}</span>
          <Movement current={row.rank} previous={prev} isNew={Boolean(previous) && prev === null} />
          <Plate team={team} size={24} />
          <span className="rank-mobile-copy">
            <span className="cond rank-name truncate">{team?.school.toUpperCase()} <Flame count={model.flame(row.team_id, before)} size={11} /></span>
            <span className="small muted truncate">
              {view === 'CFP RANKINGS' ? (field ? `Seed ${field.seed}${field.bye ? ' · bye' : ''}${field.autoBid ? ' · auto bid' : ''}` : 'Out') :
                info.last ? <><span className={info.last.outcome === 'W' ? 'win' : info.last.outcome === 'L' ? 'loss' : ''}>{info.last.outcome}</span> {info.last.text}</> : `Next: ${info.next}`}
            </span>
          </span>
          <span className="cond num muted">{record}</span>
        </button>
      )
    }
    return (
      <div key={row.team_id} role="button" tabIndex={0} className={`rank-row${row.rank === 4 && view !== 'CFP RANKINGS' ? ' divider' : ''}${row.rank <= 4 ? ' top' : ''}${out ? ' out' : ''}${favorites.has(row.team_id) ? ' favorite' : ''}`}
        onClick={() => navigate(`/teams/${team?.slug}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/teams/${team?.slug}`) }}>
        <span className="cond num rank-num">{row.rank}</span>
        <Movement current={row.rank} previous={prev} isNew={Boolean(previous) && prev === null} />
        <span className="rank-team"><Plate team={team} size={24} /><span className="cond rank-name truncate">{view === 'CFP RANKINGS' ? team?.school.toUpperCase() : team?.school}</span><Flame count={model.flame(row.team_id, before)} /></span>
        <span className="cond num muted">{record}</span>
        <ConfTag code={confAbbr(model.conferenceOf(row.team_id))} />
        {view === 'CFP RANKINGS' ? (
          <>
            <span className="field-cell">{field ? <><span className="seed-chip cond">SEED {field.seed}</span>{field.bye && <span className="cond muted">BYE</span>}{field.autoBid && !field.bye && <span className="cond muted small">AUTO BID</span>}</> : <span className="muted small">Out</span>}</span>
            <span className="muted small">{apRank ? `AP #${apRank}` : 'AP —'}</span>
          </>
        ) : (
          <>
            <span className="cond num points">{row.points ? number(row.points) : '—'}{row.first_place_votes ? ` (${row.first_place_votes})` : ''}</span>
            {view === 'COACHES' ? (
              <span className="muted small">{apRank ? `AP #${apRank}${apRank > row.rank ? ' · coaches higher' : apRank < row.rank ? ' · coaches lower' : ''}` : 'Not in AP Top 25'}</span>
            ) : (
              <span className="small truncate">{info.last ? <><span className={info.last.outcome === 'W' ? 'win' : info.last.outcome === 'L' ? 'loss' : ''}>{info.last.outcome}</span> <span className="muted">{info.last.text}</span></> : <span className="muted">—</span>}</span>
            )}
            <span className="muted small truncate">{info.next}</span>
          </>
        )}
      </div>
    )
  })

  const cutIndex = view === 'CFP RANKINGS' ? release.ranked.findIndex((row) => !fieldByTeam.has(row.team_id)) : -1
  const side = view === 'CFP RANKINGS' && cfpField ? (
    <>
      <Tile title="RELEASE">
        <p>Ranking {releases.indexOf(release) + 1} of {Math.max(releases.length, seasonConfig(model.year).cfpReleases.length || releases.length)}</p>
        {(() => {
          const next = seasonConfig(model.year).cfpReleases.find((iso) => Date.parse(iso) > Date.now())
          return next ? <p className="muted small">Next release {fullDateTime(next, 'Europe/Berlin')}</p> : null
        })()}
      </Tile>
      <Tile title="FIRST FOUR OUT">
        {cfpField.firstFourOut.map((item) => (
          <div key={item.teamId} className="out-row"><Plate team={model.team(item.teamId)} size={24} /><span className="grow">{model.team(item.teamId)?.school}</span><span className="muted num">#{item.rank}</span></div>
        ))}
      </Tile>
      <button type="button" className="outline-button cond wide" onClick={() => setView('PLAYOFF BRACKET')}>OPEN PLAYOFF BRACKET →</button>
    </>
  ) : (
    <>
      <ConferenceBars model={model} release={release} />
      {view === 'COACHES' ? <Disagreements model={model} release={release} /> : <Movers model={model} release={release} previous={previous} />}
      <InAndOut model={model} release={release} previous={previous} />
    </>
  )

  const table = (
    <section className={`rank-table rank-table--${view === 'CFP RANKINGS' ? 'cfp' : view === 'COACHES' ? 'coaches' : 'ap'}`}>
      {!mobile && (
        <div className="rank-row rank-head cond">
          <span>#</span><span /><span>TEAM</span><span>REC</span><span>CONF</span>
          {view === 'CFP RANKINGS' ? <><span>FIELD</span><span>AP</span></> : <><span>POINTS</span><span>{view === 'COACHES' ? 'AP RANK' : 'LAST GAME'}</span><span>NEXT</span></>}
        </div>
      )}
      <div className={mobile ? '' : 'scroll-y rank-body'}>
        {rows.map((row, index) => (
          <div key={index}>
            {index === cutIndex && <div className="cut-line cond">CUT LINE <span>Below the line: out, unless they win an automatic bid</span></div>}
            {row}
          </div>
        ))}
      </div>
    </section>
  )

  return (
    <div className="rankings">
      {header}
      {mobile ? (
        <>
          {table}
          <div className="side-stack">{side}</div>
        </>
      ) : (
        <div className="rankings-layout">
          {table}
          <aside className="side-stack scroll-y">{side}</aside>
        </div>
      )}
    </div>
  )
}
