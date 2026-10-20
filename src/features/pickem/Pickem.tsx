import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { abbr } from '../../data/model'
import { fetchPicks, savePick } from '../../data/queries'
import type { Game, PickMode, PickRow } from '../../data/types'
import { kickoffParts } from '../../shared/format'
import { Empty, ErrorBox, Loading, Plate, Tabs, Tile } from '../../shared/ui'
import { isLocked, outcomeOf, pct, seasonLine, slateFor, weekLines, type Outcome, type WeekLine } from './logic'

const VIEWS = ['THIS WEEK', 'MY RESULTS'] as const
type View = typeof VIEWS[number]
// Only straight-up picks. The spread stays visible as game information.
const MODE: PickMode = 'straight_up'

function usePicks(year: number) {
  const queryClient = useQueryClient()
  const key = ['picks', year]
  const query = useQuery({ queryKey: key, queryFn: () => fetchPicks(year), staleTime: 60_000 })
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (input: { gameId: number; mode: PickMode; teamId: number | null }) => savePick(input.gameId, input.mode, input.teamId),
    onMutate: async (input) => {
      setError(null)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<PickRow[]>(key) ?? []
      const rest = previous.filter((pick) => !(pick.game_id === input.gameId && pick.mode === input.mode))
      const next = input.teamId === null ? rest : [...rest, {
        user_id: '', game_id: input.gameId, pick_team_id: input.teamId, mode: input.mode,
        locked: false, correct: null, spread: null, updated_at: new Date().toISOString(),
      }]
      queryClient.setQueryData(key, next)
      return { previous }
    },
    onError: (failure, _input, context) => {
      if (context) queryClient.setQueryData(key, context.previous)
      setError(failure instanceof Error ? failure.message : 'The pick could not be saved.')
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  })
  return { query, picks: query.data ?? [], save: mutation.mutate, error, clearError: () => setError(null) }
}

const OUTCOME_LABEL: Record<Outcome, string> = { correct: 'CORRECT', wrong: 'WRONG', push: 'PUSH', pending: '' }

function PickCard({ game, pick, badges, onPick }: {
  game: Game
  pick: PickRow | undefined
  badges: { gameday: boolean; mine: boolean }
  onPick: (teamId: number | null) => void
}) {
  const { model, timeZone, openWindow } = useApp()
  const locked = isLocked(game)
  const kickoff = kickoffParts(game.start_time, timeZone)
  const outcome = pick ? outcomeOf(pick, game) : 'pending'
  const head = game.status === 'final'
    ? `FINAL · ${Math.max(game.home_points ?? 0, game.away_points ?? 0)}–${Math.min(game.home_points ?? 0, game.away_points ?? 0)}`
    : game.status === 'in_progress' ? 'LIVE' : `${kickoff.day} ${kickoff.time}`
  const meta = [game.tv, model.favoriteText(game)].filter(Boolean).join(' · ')
  return (
    <article className={`pick-card${locked ? ' locked' : ''}`}>
      <header className="pick-head cond">
        <button type="button" className="pick-time" onClick={() => openWindow({ type: 'game', gameId: game.id })}>
          <strong>{head}</strong>{meta && <span className="muted"> · {meta}</span>}
        </button>
        <span className="grow" />
        {badges.gameday && <span className="pick-badge solid">GAMEDAY</span>}
        {badges.mine && <span className="pick-badge">★ MY TEAM</span>}
        {pick && outcome !== 'pending' && <span className={`pick-result ${outcome}`}>{OUTCOME_LABEL[outcome]}</span>}
        {locked && (!pick || outcome === 'pending') && <span className="pick-result muted">🔒 LOCKED</span>}
      </header>
      {[game.away_team_id, game.home_team_id].map((teamId, index) => {
        const team = model.team(teamId)
        const rank = model.apRankAtKickoff(teamId, game)
        const chosen = pick?.pick_team_id === teamId
        const state = chosen ? (outcome === 'correct' ? ' correct' : outcome === 'wrong' ? ' wrong' : ' chosen') : ''
        return (
          <button
            key={teamId}
            type="button"
            className={`pick-team${state}`}
            disabled={locked}
            aria-pressed={chosen}
            onClick={() => onPick(chosen ? null : teamId)}
          >
            <span className="at-slot cond">{index === 1 ? (game.neutral_site ? 'vs' : '@') : ''}</span>
            <Plate team={team} size={28} />
            <span className="muted num pick-rank">{rank ?? ''}</span>
            <span className="cond pick-name truncate">{(team?.school ?? 'TBD').toUpperCase()}</span>
            {game.status !== 'scheduled' && <span className="cond num pick-score">{index === 1 ? game.home_points : game.away_points}</span>}
            <span className="pick-check" aria-hidden="true">{chosen ? (outcome === 'wrong' ? '✕' : '✓') : ''}</span>
          </button>
        )
      })}
    </article>
  )
}

function SeasonTiles({ lines, onWeek }: { lines: WeekLine[]; onWeek?: (key: string) => void }) {
  const season = seasonLine(lines)
  return (
    <>
      <Tile title="MY SEASON">
        <div className="stat-boxes">
          <div className="stat-box"><span className="muted small">Record</span><strong className="cond num">{season.w}–{season.l}</strong></div>
          <div className="stat-box"><span className="muted small">Hit rate</span><strong className="cond num">{pct(season.rate)}</strong></div>
          <div className="stat-box"><span className="muted small">Last week</span><strong className="cond num">{season.last ? `${season.last.w}–${season.last.l}` : '—'}</strong></div>
          <div className="stat-box"><span className="muted small">Best week</span><strong className="cond num">{season.best ? `${season.best.w}–${season.best.l}` : '—'}</strong></div>
        </div>
      </Tile>
      <Tile title="WEEK BY WEEK">
        {lines.length ? lines.map((line) => <WeekBar key={line.key} line={line} onClick={onWeek ? () => onWeek(line.key) : undefined} />) : <Empty>No picks yet.</Empty>}
      </Tile>
    </>
  )
}

function WeekBar({ line, onClick, active = false }: { line: WeekLine; onClick?: () => void; active?: boolean }) {
  const graded = line.w + line.l
  const rate = graded ? line.w / graded : 0
  return (
    <button type="button" className={`week-bar-row${active ? ' active' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="cond week-bar-label">{line.label.toUpperCase()}</span>
      <strong className="cond num">{line.w}–{line.l}</strong>
      <span className="week-bar-track"><span className={rate >= 0.75 ? 'good' : ''} style={{ width: `${rate * 100}%` }} /></span>
      <span className="muted small num">{line.pending ? 'In progress' : graded ? `${Math.round(rate * 100)}%` : '—'}</span>
    </button>
  )
}

function ThisWeek({ picksState }: { picksState: ReturnType<typeof usePicks> }) {
  const { model, period, favorites, setPeriodKey, mobile } = useApp()
  const { picks, save, error, clearError } = picksState
  if (!period) return <Empty>No week selected.</Empty>
  const slate = slateFor(model, period.key, favorites, picks)
  const pickFor = (gameId: number) => picks.find((pick) => pick.game_id === gameId && pick.mode === MODE)
  const picked = slate.filter((entry) => pickFor(entry.game.id)?.pick_team_id).length
  const index = model.periods.findIndex((item) => item.key === period.key)
  const lines = weekLines(model, picks, MODE)

  const board = (
    <section className="pick-main">
      <div className="pick-toolbar">
        <button type="button" className="icon-button" aria-label="Previous week" disabled={index <= 0} onClick={() => setPeriodKey(model.periods[index - 1].key)}>‹</button>
        <h2 className="cond pick-week">{period.label.toUpperCase()}</h2>
        <button type="button" className="icon-button" aria-label="Next week" disabled={index >= model.periods.length - 1} onClick={() => setPeriodKey(model.periods[index + 1].key)}>›</button>
        {!mobile && <span className="muted small">Picks lock at each game's kickoff</span>}
        <span className="grow" />
        <span className="cond pick-progress"><strong className="num">{picked} / {slate.length}</strong> PICKED <span className="pick-progress-bar"><span style={{ width: `${slate.length ? (picked / slate.length) * 100 : 0}%` }} /></span></span>
      </div>
      {error && <div className="pick-error" role="alert"><span>{error}</span><button type="button" className="tile-link" onClick={clearError}>Dismiss</button></div>}
      <div className={`pick-grid${mobile ? '' : ' scroll-y'}`}>
        {slate.map((entry) => (
          <PickCard key={entry.game.id} game={entry.game} pick={pickFor(entry.game.id)} badges={entry}
            onPick={(teamId) => save({ gameId: entry.game.id, mode: MODE, teamId })} />
        ))}
        {!slate.length && <Empty>No games on the slate this week. The slate holds every game with an AP Top 25 team, the GameDay game and your favorite teams.</Empty>}
      </div>
    </section>
  )
  const side = <aside className={`side-stack${mobile ? '' : ' scroll-y'}`}><SeasonTiles lines={lines} onWeek={setPeriodKey} /></aside>
  return mobile ? <div className="stats-mobile">{board}{side}</div> : <div className="pickem-layout">{board}{side}</div>
}

function Results({ picksState }: { picksState: ReturnType<typeof usePicks> }) {
  const { model, mobile, openWindow } = useApp()
  const { picks } = picksState
  const su = weekLines(model, picks, 'straight_up')
  const suSeason = seasonLine(su)
  const weekKeys = [...new Set(su.map((line) => line.key))]
  const order = new Map(model.periods.map((period, index) => [period.key, index]))
  weekKeys.sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0))
  const [selected, setSelected] = useState<string | null>(null)
  const key = selected && weekKeys.includes(selected) ? selected : weekKeys[0] ?? null
  const position = key ? weekKeys.indexOf(key) : -1
  const weekPicks = picks.filter((pick) => pick.mode === MODE && pick.pick_team_id !== null && (() => {
    const game = model.gameById.get(pick.game_id)
    return game && model.periodKeyOf(game) === key
  })())
    .sort((a, b) => Date.parse(model.gameById.get(a.game_id)?.start_time ?? '') - Date.parse(model.gameById.get(b.game_id)?.start_time ?? '') || a.mode.localeCompare(b.mode))
  const selectedLine = su.find((line) => line.key === key)

  const summary = (
    <Tile title="SEASON SUMMARY">
      <div className="stat-boxes">
        <div className="stat-box"><span className="muted small">Record</span><strong className="cond num">{suSeason.w}–{suSeason.l}</strong></div>
        <div className="stat-box"><span className="muted small">Hit rate</span><strong className="cond num">{pct(suSeason.rate)}</strong></div>
        <div className="stat-box"><span className="muted small">Last week</span><strong className="cond num">{suSeason.last ? `${suSeason.last.w}–${suSeason.last.l}` : '—'}</strong></div>
        <div className="stat-box"><span className="muted small">Best week</span><strong className="cond num">{suSeason.best ? `${suSeason.best.w}–${suSeason.best.l} · ${suSeason.best.short}` : '—'}</strong></div>
      </div>
    </Tile>
  )
  const weeks = (
    <Tile title="WEEK BY WEEK" className={mobile ? '' : 'scroll-y'}>
      {su.length ? su.map((line) => <WeekBar key={line.key} line={line} active={line.key === key} onClick={() => setSelected(line.key)} />) : <Empty>No picks yet.</Empty>}
    </Tile>
  )
  const list = (
    <section className={`tile${mobile ? '' : ' scroll-y'}`}>
      <header className="tile-head">
        <h2 className="cond">YOUR PICKS</h2>
        {key && (
          <span className="results-nav">
            <button type="button" className="icon-button" aria-label="Newer week" disabled={position <= 0} onClick={() => setSelected(weekKeys[position - 1])}>‹</button>
            <span className="cond">{model.periodByKey.get(key)?.label.toUpperCase()}{selectedLine ? ` · ${selectedLine.w}–${selectedLine.l}` : ''}</span>
            <button type="button" className="icon-button" aria-label="Older week" disabled={position >= weekKeys.length - 1} onClick={() => setSelected(weekKeys[position + 1])}>›</button>
          </span>
        )}
      </header>
      {weekPicks.map((pick) => {
        const game = model.gameById.get(pick.game_id)!
        const outcome = outcomeOf(pick, game)
        const score = game.status === 'final' ? `${game.away_points}–${game.home_points}` : game.status === 'in_progress' ? 'LIVE' : ''
        return (
          <button key={`${pick.game_id}-${pick.mode}`} type="button" className="result-row" onClick={() => openWindow({ type: 'game', gameId: game.id })}>
            <span className={`result-mark ${outcome}`}>{outcome === 'correct' ? '✓' : outcome === 'wrong' ? '✕' : outcome === 'push' ? '=' : '·'}</span>
            <strong className="cond">{abbr(model.team(game.away_team_id))} {game.neutral_site ? 'vs' : '@'} {abbr(model.team(game.home_team_id))}</strong>
            <span className="grow truncate muted">You: {model.team(pick.pick_team_id)?.school}</span>
            <span className="muted num">{score}</span>
          </button>
        )
      })}
      {!weekPicks.length && <Empty>No picks yet. Make them under This Week.</Empty>}
    </section>
  )
  if (mobile) return <div className="stats-mobile">{summary}{list}{weeks}</div>
  return (
    <div className="results-layout">
      <div className="team-col">{summary}{weeks}</div>
      {list}
    </div>
  )
}

export function Pickem() {
  const { model, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'results' ? 'MY RESULTS' : 'THIS WEEK'
  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value === null) merged.delete(key)
      else merged.set(key, value)
    }
    setParams(merged, { replace: true })
  }
  const picksState = usePicks(model.year)
  return (
    <div className="pickem">
      <div className="page-head page-head--tabs">
        <h1 className="cond">PICK'EM</h1>
        <Tabs items={VIEWS} value={view} onChange={(next) => update({ view: next === 'MY RESULTS' ? 'results' : null })} labels={mobile ? { 'MY RESULTS': 'RESULTS' } : undefined} />
      </div>
      {picksState.query.error ? <ErrorBox message={(picksState.query.error as Error).message} onRetry={() => void picksState.query.refetch()} />
        : picksState.query.isPending ? <Loading label="Loading your picks…" />
          : view === 'THIS WEEK'
            ? <ThisWeek picksState={picksState} />
            : <Results picksState={picksState} />}
    </div>
  )
}
