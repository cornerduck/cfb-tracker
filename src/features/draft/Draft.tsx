import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../../app/context'
import { fetchBigBoards, fetchPlayerSeason, fetchRosterByIds, saveBigBoard, searchRoster, type BigBoardRow } from '../../data/queries'
import type { RosterPlayer } from '../../data/types'
import { ConfPlate, Empty, ErrorBox, Loading, PlayerAvatar, Plate, Tabs } from '../../shared/ui'
import { playerStatLine } from '../stats/Stats'
import { PickOrder } from './PickOrder'
import { BOARD_SIZE, MOCK_PICKS, POSITION_GROUPS, boardYears, move, sizeText, statsSeasonFor } from './logic'

const VIEWS = ['BIG BOARD', 'PICK ORDER'] as const
type View = typeof VIEWS[number]

// The board of every year lives in one query; saves are queued so two quick
// changes can never arrive out of order.
function useBigBoards() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['big-board'], queryFn: fetchBigBoards, staleTime: 60_000 })
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(new Map<number, string[]>())
  const running = useRef(false)

  const flush = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (pending.current.size) {
        const [year, ids] = pending.current.entries().next().value as [number, string[]]
        pending.current.delete(year)
        await saveBigBoard(year, ids)
      }
      setError(null)
    } catch (failure) {
      pending.current.clear()
      setError(failure instanceof Error ? failure.message : 'The board could not be saved.')
      void queryClient.invalidateQueries({ queryKey: ['big-board'] })
    } finally {
      running.current = false
    }
  }, [queryClient])

  const rows = query.data
  const idsFor = useCallback((year: number) => (rows ?? []).filter((row) => row.draft_year === year).sort((a, b) => a.rank - b.rank).map((row) => row.player_id), [rows])
  const setBoard = useCallback((year: number, ids: string[]) => {
    queryClient.setQueryData<BigBoardRow[]>(['big-board'], (old) => [
      ...(old ?? []).filter((row) => row.draft_year !== year),
      ...ids.map((id, index) => ({ draft_year: year, player_id: id, rank: index + 1 })),
    ])
    pending.current.set(year, ids)
    void flush()
  }, [queryClient, flush])
  return { query, years: useMemo(() => [...new Set((rows ?? []).map((row) => row.draft_year))], [rows]), idsFor, setBoard, error, clearError: () => setError(null) }
}

// Roster rows (newest season first, so the first row per player wins) and the
// stat rows of the season that belongs to the draft.
function useBoardPlayers(year: number, ids: string[]) {
  const season = statsSeasonFor(year)
  const key = useMemo(() => [...ids].sort().join(','), [ids])
  const query = useQuery({
    queryKey: ['board-players', season, key],
    queryFn: async () => {
      const [roster, stats] = await Promise.all([fetchRosterByIds(ids), fetchPlayerSeason(season, ids)])
      const byPlayer = new Map<string, RosterPlayer>()
      for (const row of roster) if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, row)
      return { byPlayer, stats }
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  })
  return query
}

function PlayerLine({ player, statsText, trailing, leading }: {
  player: RosterPlayer
  statsText: string
  trailing: ReactNode
  leading: ReactNode
}) {
  const { model, openWindow } = useApp()
  const team = model.team(player.team_id)
  const size = sizeText(player.height, player.weight)
  return (
    <div className="draft-row">
      {leading}
      <PlayerAvatar playerId={player.player_id} team={team} size={34} />
      <div className="draft-copy">
        <button type="button" className="draft-name" onClick={() => openWindow({ type: 'player', playerId: player.player_id, name: player.full_name, teamId: player.team_id })}>{player.full_name}</button>
        <span className="draft-meta muted">
          {player.position && <span className="draft-pos cond">{player.position}</span>}
          <Plate team={team} size={18} />
          <span className="truncate">{team?.school}</span>
          <ConfPlate conference={model.conferenceOf(player.team_id)} small />
          {size && <span className="num">{size}</span>}
        </span>
        <span className="draft-stats cond num">{statsText || 'No stats this season'}</span>
      </div>
      {trailing}
    </div>
  )
}

function BoardRow({ index, count, player, statsText, dragging, over, onMove, onRemove, onDragStart, onDragOver, onDrop, onDragEnd }: {
  index: number
  count: number
  player: RosterPlayer
  statsText: string
  dragging: boolean
  over: boolean
  onMove: (from: number, to: number) => void
  onRemove: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      className={`draft-item${dragging ? ' dragging' : ''}${over ? ' over' : ''}${index >= MOCK_PICKS ? ' reserve' : ''}`}
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', player.player_id); onDragStart() }}
      onDragOver={(event) => { event.preventDefault(); onDragOver() }}
      onDrop={(event) => { event.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
    >
      <PlayerLine
        player={player}
        statsText={statsText}
        leading={<><span className="draft-grip" aria-hidden="true">⋮⋮</span><span className="draft-rank cond num">{index + 1}</span></>}
        trailing={
          <span className="draft-actions">
            <button type="button" className="icon-button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index, index - 1)}>▲</button>
            <button type="button" className="icon-button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>▼</button>
            <button type="button" className="icon-button" aria-label={`Remove ${player.full_name}`} onClick={onRemove}>✕</button>
          </span>
        }
      />
    </div>
  )
}

function AddPanel({ year, onBoard, full, onAdd }: { year: number; onBoard: Set<string>; full: boolean; onAdd: (player: RosterPlayer) => void }) {
  const { model } = useApp()
  const season = statsSeasonFor(year)
  const [text, setText] = useState('')
  const [group, setGroup] = useState<keyof typeof POSITION_GROUPS>('ALL')
  const [teamId, setTeamId] = useState<number | null>(null)
  const query = text.trim()
  const ready = query.length >= 2 || teamId !== null
  const found = useQuery({
    queryKey: ['draft-search', season, query.toLowerCase(), group, teamId],
    queryFn: () => searchRoster(season, query, POSITION_GROUPS[group], teamId),
    enabled: ready,
    staleTime: 60_000,
  })
  const ids = useMemo(() => (found.data ?? []).map((row) => row.player_id), [found.data])
  const stats = useQuery({ queryKey: ['draft-search-stats', season, ids.join(',')], queryFn: () => fetchPlayerSeason(season, ids), enabled: ids.length > 0, staleTime: 5 * 60_000 })
  const teams = useMemo(() => [...model.teams.values()].filter((team) => model.fbsIds.has(team.id)).sort((a, b) => a.school.localeCompare(b.school)), [model])
  return (
    <section className="tile draft-add">
      <header className="tile-head"><h2 className="cond">ADD PLAYERS</h2><span className="muted small">{season} season</span></header>
      <input className="draft-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Search by name" aria-label="Search players by name" />
      <div className="pills">
        {Object.keys(POSITION_GROUPS).map((item) => (
          <button key={item} type="button" className={`pill cond${group === item ? ' active' : ''}`} aria-pressed={group === item} onClick={() => setGroup(item)}>{item}</button>
        ))}
      </div>
      <select className="draft-input" aria-label="School" value={teamId ?? ''} onChange={(event) => setTeamId(event.target.value ? Number(event.target.value) : null)}>
        <option value="">All schools</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.school}</option>)}
      </select>
      <div className="draft-results">
        {!ready ? <Empty>Type at least two letters or pick a school.</Empty>
          : found.error ? <ErrorBox message={(found.error as Error).message} onRetry={() => void found.refetch()} />
            : found.isPending ? <Loading label="Searching…" />
              : found.data?.length ? found.data.map((player) => {
                const added = onBoard.has(player.player_id)
                return (
                  <PlayerLine
                    key={player.player_id}
                    player={player}
                    statsText={playerStatLine(stats.data ?? [], player.player_id).text}
                    leading={null}
                    trailing={<button type="button" className={`draft-add-button cond${added ? ' added' : ''}`} disabled={added || full} onClick={() => onAdd(player)} aria-label={added ? 'Already on your board' : `Add ${player.full_name}`}>{added ? '✓' : '+'}</button>}
                  />
                )
              }) : <Empty>No player found.</Empty>}
      </div>
    </section>
  )
}

function BigBoard({ year }: { year: number }) {
  const { mobile } = useApp()
  const boards = useBigBoards()
  const ids = boards.idsFor(year)
  const players = useBoardPlayers(year, ids)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const onBoard = useMemo(() => new Set(ids), [ids])
  const full = ids.length >= BOARD_SIZE
  // Players of the board that are neither in the roster nor have stats stay
  // visible by id so they can still be removed.
  const lines = useMemo(() => new Map(ids.map((id) => [id, playerStatLine(players.data?.stats ?? [], id).text])), [ids, players.data])

  const reorder = (from: number, to: number) => boards.setBoard(year, move(ids, from, to))
  const remove = (id: string) => boards.setBoard(year, ids.filter((item) => item !== id))
  const add = (player: RosterPlayer) => { if (!onBoard.has(player.player_id) && !full) boards.setBoard(year, [...ids, player.player_id]) }
  const endDrag = () => { setDragFrom(null); setDragOver(null) }

  const list = (
    <section className={`tile draft-board${mobile ? '' : ' scroll-y'}`}>
      <header className="tile-head">
        <div>
          <h2 className="cond">MY BIG BOARD {year}</h2>
          <span className="muted small">{mobile ? 'Use the arrows to reorder' : 'Drag to reorder. Changes are saved at once.'}</span>
        </div>
        <div className="draft-progress">
          <span className="muted"><strong className="cond num">{ids.length}</strong> of {BOARD_SIZE} spots{ids.length >= MOCK_PICKS ? ' · mock ready' : ` · ${MOCK_PICKS - ids.length} more for a full mock`}</span>
          <span className="draft-bar"><span style={{ width: `${Math.min(100, (ids.length / BOARD_SIZE) * 100)}%` }} /></span>
        </div>
      </header>
      {boards.error && <ErrorBox message={boards.error} onRetry={boards.clearError} />}
      {players.error ? <ErrorBox message={(players.error as Error).message} onRetry={() => void players.refetch()} />
        : ids.length && players.isPending ? <Loading label="Loading your board…" />
          : ids.length ? ids.map((id, index) => {
            const player = players.data?.byPlayer.get(id) ?? ({ season: statsSeasonFor(year), team_id: 0, player_id: id, full_name: `Player ${id}`, jersey: null, position: null, class_year: null, height: null, weight: null, home_city: null, home_state: null, home_country: null } as RosterPlayer)
            return (
              <BoardRow
                key={id}
                index={index}
                count={ids.length}
                player={player}
                statsText={lines.get(id) ?? ''}
                dragging={dragFrom === index}
                over={dragOver === index && dragFrom !== null && dragFrom !== index}
                onMove={reorder}
                onRemove={() => remove(id)}
                onDragStart={() => setDragFrom(index)}
                onDragOver={() => setDragOver(index)}
                onDrop={() => { if (dragFrom !== null) reorder(dragFrom, index); endDrag() }}
                onDragEnd={endDrag}
              />
            )
          }) : <Empty>Your board is empty. Add players to build it.</Empty>}
      {ids.length > 0 && <p className="muted small draft-note">Spots 1 to {MOCK_PICKS} are enough for a full mock. The rest is reserve.</p>}
    </section>
  )
  const panel = <AddPanel year={year} onBoard={onBoard} full={full} onAdd={add} />
  if (mobile) {
    return (
      <div className="stats-mobile">
        <button type="button" className="draft-toggle cond" onClick={() => setAdding((value) => !value)}>{adding ? 'CLOSE SEARCH' : '+ ADD PLAYERS'}</button>
        {adding && panel}
        {list}
      </div>
    )
  }
  return <div className="draft-layout">{list}{panel}</div>
}

export function Draft() {
  const { liveYear, account, mobile } = useApp()
  const [params, setParams] = useSearchParams()
  const boards = useBigBoards()
  const fallback = liveYear + 1
  const years = boardYears(boards.years, fallback)
  const requested = Number(params.get('year'))
  const year = years.includes(requested) ? requested : years.includes(fallback) ? fallback : years[years.length - 1]
  const view: View = params.get('view') === 'picks' ? 'PICK ORDER' : 'BIG BOARD'
  const go = (value: number, target: View) => {
    const next: Record<string, string> = {}
    if (value !== fallback) next.year = String(value)
    if (target === 'PICK ORDER') next.view = 'picks'
    setParams(next, { replace: true })
  }
  const selectYear = (value: number) => go(value, view)
  const next = years[years.length - 1] + 1
  const [extra, setExtra] = useState<number[]>([])
  const shown = [...new Set([...years, ...extra])].sort((a, b) => a - b)

  if (!account.session) return <Empty>Sign in to build your Big Board and pick order.</Empty>
  return (
    <div className="draft">
      <div className="page-head page-head--tabs">
        <h1 className="cond">DRAFT</h1>
        <Tabs items={VIEWS} value={view} onChange={(target) => go(year, target)} />
        <span className="grow" />
        <div className="pills draft-years">
          {shown.map((item) => <button key={item} type="button" className={`pill cond${item === year ? ' active' : ''}`} aria-pressed={item === year} onClick={() => selectYear(item)}>{mobile ? item : `DRAFT ${item}`}</button>)}
          <button type="button" className="pill cond draft-new" onClick={() => { setExtra((list) => [...list, next]); selectYear(next) }}>+ {mobile ? next : `NEW BOARD ${next}`}</button>
        </div>
      </div>
      {boards.query.error ? <ErrorBox message={(boards.query.error as Error).message} onRetry={() => void boards.query.refetch()} />
        : boards.query.isPending ? <Loading label="Loading your board…" />
          : view === 'PICK ORDER' ? <PickOrder year={shown.includes(year) ? year : fallback} />
            : <BigBoard year={shown.includes(year) ? year : fallback} />}
    </div>
  )
}
