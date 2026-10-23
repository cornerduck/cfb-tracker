import { Fragment, useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import type { NflTeamRow, PickExceptionRow } from '../../data/queries'
import { Empty, ErrorBox, Loading } from '../../shared/ui'
import { NflPlate } from './NflPlate'
import { useNflTeams, usePickOrders } from './pickHooks'
import { move, statsSeasonFor } from './logic'
import { buildSlots, changedPicks, effectiveOrder, recordOrder, recordText, setException, TEAM_COUNT, type PickSlot, type Round } from './pickOrder'

const NO_TEAMS: NflTeamRow[] = []

const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function PickLine({ slot, team, owner, selected, dragging, over, onSelect, onDragStart, onDragOver, onDrop, onDragEnd }: {
  slot: PickSlot
  team: NflTeamRow
  owner: NflTeamRow
  selected: boolean
  dragging: boolean
  over: boolean
  onSelect: () => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      className={`po-item${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${over ? ' over' : ''}${slot.forfeited ? ' forfeited' : ''}`}
      draggable
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(slot.pick)); onDragStart() }}
      onDragOver={(event) => { event.preventDefault(); onDragOver() }}
      onDrop={(event) => { event.preventDefault(); onDrop() }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="po-row" onClick={onSelect} aria-pressed={selected}>
        <span className="draft-grip" aria-hidden="true">⋮⋮</span>
        <span className="po-number cond num">{slot.pick}</span>
        <NflPlate abbr={owner.abbr} color={owner.color} size={30} />
        <span className="po-team">
          <span className="po-name">{owner.name}</span>
          {owner.abbr !== team.abbr && <span className="po-from cond">FROM {team.abbr}</span>}
          {slot.forfeited && <span className="po-tag cond">FORFEITED</span>}
        </span>
        <span className="po-record cond num">{recordText(team)}</span>
      </button>
    </div>
  )
}

function PickPanel({ slot, team, teams, canUp, canDown, onOwner, onForfeit, onMove, onClose, changed, onReset, customOrder }: {
  slot: PickSlot
  team: NflTeamRow
  teams: NflTeamRow[]
  canUp: boolean
  canDown: boolean
  onOwner: (abbr: string) => void
  onForfeit: (value: boolean) => void
  onMove: (delta: number) => void
  onClose: () => void
  changed: number
  customOrder: boolean
  onReset: () => void
}) {
  const alphabetical = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams])
  return (
    <section className="tile po-panel">
      <div className="po-panel-head">
        <div>
          <h2 className="cond">PICK {slot.pick} · ROUND {slot.round}</h2>
          <span className="muted small">Originally {team.name} · ranked by record, ties alphabetical</span>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <span className="muted small">Who owns this pick?</span>
      <div className="po-owners" role="listbox" aria-label="Owner of the pick">
        {alphabetical.map((item) => (
          <button key={item.abbr} type="button" role="option" aria-selected={item.abbr === slot.owner} className={`po-owner${item.abbr === slot.owner ? ' active' : ''}`} onClick={() => onOwner(item.abbr)}>
            <NflPlate abbr={item.abbr} color={item.color} size={24} />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <span className="muted small">Position in the order (applies to both rounds)</span>
      <div className="po-move">
        <button type="button" className="po-button cond" disabled={!canUp} onClick={() => onMove(-1)}>↑ MOVE UP</button>
        <button type="button" className="po-button cond" disabled={!canDown} onClick={() => onMove(1)}>↓ MOVE DOWN</button>
      </div>
      <label className="po-check">
        <input type="checkbox" checked={slot.forfeited} onChange={(event) => onForfeit(event.target.checked)} />
        <span>Pick is forfeited (for example because of a penalty)</span>
      </label>
      <div className="po-panel-foot muted small">
        <span>Changed picks: <strong className="cond num">{changed}</strong>{customOrder ? ' · own order' : ''}. Changes are saved at once and apply to all your mocks.</span>
        <button type="button" className="po-button cond" disabled={!changed && !customOrder} onClick={onReset}>RESET ALL</button>
      </div>
    </section>
  )
}

export function PickOrder({ year }: { year: number }) {
  const { mobile } = useApp()
  const nfl = useNflTeams()
  const orders = usePickOrders()
  const teams = nfl.query.data ?? NO_TEAMS
  const saved = orders.savedFor(year)
  const [selected, setSelected] = useState<{ round: Round; team: string } | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [round, setRound] = useState<Round>(1)

  const byAbbr = useMemo(() => new Map(teams.map((team) => [team.abbr, team])), [teams])
  const order = useMemo(() => effectiveOrder(teams, saved.teamOrder), [teams, saved.teamOrder])
  const slots = useMemo(() => buildSlots(order, saved.exceptions), [order, saved.exceptions])
  const baseline = useMemo(() => recordOrder(teams), [teams])

  if (nfl.query.error) return <ErrorBox message={(nfl.query.error as Error).message} onRetry={() => void nfl.query.refetch()} />
  if (nfl.query.isPending || orders.query.isPending) return <Loading label="Loading the pick order…" />
  if (orders.query.error) return <ErrorBox message={(orders.query.error as Error).message} onRetry={() => void orders.query.refetch()} />
  if (teams.length !== TEAM_COUNT) {
    return nfl.refreshError
      ? <ErrorBox message={`The NFL records could not be loaded: ${nfl.refreshError}`} onRetry={() => window.location.reload()} />
      : <Loading label="Loading the NFL records from ESPN…" />
  }

  const recordSeason = teams[0].record_season
  const expectedSeason = statsSeasonFor(year)
  const newest = new Date(Math.max(...teams.map((team) => Date.parse(team.updated_at)))).toISOString()
  const commit = (teamOrder: string[] | null, exceptions: PickExceptionRow[]) => {
    const same = teamOrder !== null && teamOrder.length === baseline.length && teamOrder.every((abbr, index) => abbr === baseline[index])
    orders.setOrder(year, { teamOrder: same ? null : teamOrder, exceptions })
  }
  const reorder = (from: number, to: number) => { if (from !== to) commit(move(order, from, to), saved.exceptions) }
  const selectedSlot = selected ? slots.find((slot) => slot.round === selected.round && slot.team === selected.team) ?? null : null
  const selectedIndex = selectedSlot ? order.indexOf(selectedSlot.team) : -1
  const endDrag = () => { setDragFrom(null); setDragOver(null) }

  const panel = selectedSlot && (
    <PickPanel
      slot={selectedSlot}
      team={byAbbr.get(selectedSlot.team)!}
      teams={teams}
      canUp={selectedIndex > 0}
      canDown={selectedIndex < order.length - 1}
      onOwner={(owner) => commit(saved.teamOrder, setException(saved.exceptions, selectedSlot.round, selectedSlot.team, { owner: owner === selectedSlot.team ? null : owner }))}
      onForfeit={(value) => commit(saved.teamOrder, setException(saved.exceptions, selectedSlot.round, selectedSlot.team, { forfeited: value }))}
      onMove={(delta) => reorder(selectedIndex, selectedIndex + delta)}
      onClose={() => setSelected(null)}
      changed={changedPicks(saved.exceptions)}
      customOrder={saved.teamOrder !== null}
      onReset={() => { if (window.confirm('Reset all changes to the pick order of this draft year?')) { orders.setOrder(year, { teamOrder: null, exceptions: [] }); setSelected(null) } }}
    />
  )

  const column = (columnRound: Round) => {
    const list = slots.filter((slot) => slot.round === columnRound)
    return (
      <section key={columnRound} className={`tile po-col${mobile ? '' : ' scroll-y'}`}>
        <header className="tile-head">
          <div>
            <h2 className="cond">ROUND {columnRound}</h2>
            <span className="muted small">{columnRound === 1 ? 'Picks 1 to 32 · tap a pick to change its owner' : 'Picks 33 to 64 · same order as round 1'}{mobile ? '' : ' · drag to reorder'}</span>
          </div>
        </header>
        {list.map((slot, index) => (
          <Fragment key={slot.pick}>
            <PickLine
              slot={slot}
              team={byAbbr.get(slot.team)!}
              owner={byAbbr.get(slot.owner)!}
              selected={selected?.round === slot.round && selected.team === slot.team}
              dragging={dragFrom === index}
              over={dragOver === index && dragFrom !== null && dragFrom !== index}
              onSelect={() => setSelected(selected?.round === slot.round && selected.team === slot.team ? null : { round: slot.round, team: slot.team })}
              onDragStart={() => setDragFrom(index)}
              onDragOver={() => setDragOver(index)}
              onDrop={() => { if (dragFrom !== null) reorder(dragFrom, index); endDrag() }}
              onDragEnd={endDrag}
            />
            {mobile && selected?.round === slot.round && selected.team === slot.team && panel}
          </Fragment>
        ))}
      </section>
    )
  }

  return (
    <div className="po-root">
      <div className="po-status">
        <span className={`po-dot${nfl.refreshError ? ' warn' : ''}`} aria-hidden="true" />
        <span className="small">
          Records from ESPN, as of {dateText(newest)} · Projection by win share, not final until the end of the season
          {nfl.refreshError && ' · could not refresh, showing the last saved records'}
        </span>
      </div>
      {recordSeason !== expectedSeason && (
        <p className="muted small po-hint">These are the records of the {recordSeason} season. Draft {year} follows the {expectedSeason} season, so this order is a placeholder until then.</p>
      )}
      {orders.error && <ErrorBox message={orders.error} onRetry={orders.clearError} />}
      {mobile ? (
        <div className="stats-mobile">
          <div className="pills">
            {([1, 2] as const).map((item) => <button key={item} type="button" className={`pill cond${round === item ? ' active' : ''}`} aria-pressed={round === item} onClick={() => setRound(item)}>ROUND {item}</button>)}
          </div>
          {column(round)}
        </div>
      ) : (
        <div className="po-layout">
          {column(1)}
          {column(2)}
          {panel || <section className="tile po-panel"><Empty>Select a pick to change its owner, its position or to mark it as forfeited.</Empty></section>}
        </div>
      )}
    </div>
  )
}
