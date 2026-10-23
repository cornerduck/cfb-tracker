import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import type { MockDraftRow, MockPickRow, MockSlotRow, NflTeamRow } from '../../data/queries'
import type { RosterPlayer } from '../../data/types'
import { Empty, ErrorBox, Loading, Plate } from '../../shared/ui'
import { playerStatLine } from '../stats/Stats'
import { NflPlate } from './NflPlate'
import { useBigBoards, useBoardPlayers } from './boardHooks'
import { PlayerLine } from './shared'
import { POSITION_GROUPS, statsSeasonFor } from './logic'
import { addPick, defaultMockName, isComplete, nextSlot, openPicks, positionGroup, tally, undoPick } from './mockLogic'
import { useMockDrafts } from './mockShared'
import { buildSlots, effectiveOrder, type Round } from './pickOrder'
import { useNflTeams, usePickOrders } from './pickHooks'

type Mocks = ReturnType<typeof useMockDrafts>

const unknownPlayer = (id: string, year: number) =>
  ({ season: statsSeasonFor(year), team_id: 0, player_id: id, full_name: `Player ${id}`, jersey: null, position: null, class_year: null, height: null, weight: null, home_city: null, home_state: null, home_country: null } as RosterPlayer)

// One line of the pick list: pick number, owner, and the chosen player.
function MockRow({ slot, team, owner, player, current }: { slot: MockSlotRow; team: NflTeamRow; owner: NflTeamRow; player: RosterPlayer | null; current: boolean }) {
  const { model, openWindow } = useApp()
  const school = player ? model.team(player.team_id) : null
  return (
    <div className={`mk-row${current ? ' current' : ''}${slot.forfeited ? ' forfeited' : ''}`}>
      <span className="mk-number cond num">{slot.pick}</span>
      <NflPlate abbr={owner.abbr} color={owner.color} size={30} />
      <span className="mk-team cond">{owner.abbr}{owner.abbr !== team.abbr && <span className="po-from cond">FROM {team.abbr}</span>}</span>
      <span className="mk-choice">
        {slot.forfeited ? <span className="po-tag cond">FORFEITED</span>
          : player ? (
            <>
              <button type="button" className="draft-name" onClick={() => openWindow({ type: 'player', playerId: player.player_id, name: player.full_name, teamId: player.team_id })}>{player.full_name}</button>
              <span className="draft-meta muted">
                {player.position && <span className="draft-pos cond">{player.position}</span>}
                <Plate team={school} size={18} />
                <span className="truncate">{school?.school}</span>
              </span>
            </>
          ) : current ? <span className="mk-clock cond">ON THE CLOCK</span> : <span className="muted small">open</span>}
      </span>
    </div>
  )
}

function useRename(mock: MockDraftRow, mocks: Mocks) {
  const [name, setName] = useState(mock.name)
  const commit = () => {
    const clean = name.trim().slice(0, 60)
    if (!clean) setName(mock.name)
    else if (clean !== mock.name) mocks.save({ ...mock, name: clean, updated_at: new Date().toISOString() })
  }
  return { name, setName, commit }
}

function NameField({ mock, mocks }: { mock: MockDraftRow; mocks: Mocks }) {
  const rename = useRename(mock, mocks)
  return (
    <input className="draft-input mk-name" value={rename.name} maxLength={60} aria-label="Name of the mock" onChange={(event) => rename.setName(event.target.value)} onBlur={rename.commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  )
}

function Summary({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section className="tile mk-summary">
      <header className="tile-head"><h2 className="cond">{title}</h2></header>
      <div className="mk-chips">
        {rows.map(([label, count]) => <span key={label} className="mk-chip"><span className="cond">{label}</span><strong className="cond num">{count}</strong></span>)}
      </div>
    </section>
  )
}

function ActiveMock({ mock, year, boardIds, teams, mocks, onNew }: { mock: MockDraftRow; year: number; boardIds: string[]; teams: Map<string, NflTeamRow>; mocks: Mocks; onNew: () => void }) {
  const { mobile, model } = useApp()
  const slot = nextSlot(mock.slots, mock.picks)
  const complete = slot === null
  const [group, setGroup] = useState<keyof typeof POSITION_GROUPS>('ALL')
  const [round, setRound] = useState<Round | null>(null)
  const [pane, setPane] = useState<'players' | 'picks'>('players')
  const shownRound: Round = round ?? slot?.round ?? 1
  const pickedIds = useMemo(() => new Set(mock.picks.map((pick) => pick.player_id)), [mock.picks])
  const ids = useMemo(() => [...new Set([...boardIds, ...mock.picks.map((pick) => pick.player_id)])], [boardIds, mock.picks])
  const players = useBoardPlayers(year, ids)
  const byPlayer = players.data?.byPlayer
  const playerOf = (id: string) => byPlayer?.get(id) ?? unknownPlayer(id, year)
  const pickByNumber = new Map<number, MockPickRow>(mock.picks.map((pick) => [pick.pick, pick]))
  const update = (picks: MockPickRow[]) => mocks.save({ ...mock, picks, updated_at: new Date().toISOString() })

  const available = boardIds.map((id, index) => ({ id, rank: index + 1 })).filter((item) => !pickedIds.has(item.id)).filter((item) => {
    const list = POSITION_GROUPS[group]
    return !list || (byPlayer?.get(item.id)?.position ? list.includes(byPlayer.get(item.id)!.position as string) : false)
  })

  const list = (listRound: Round) => mock.slots.filter((item) => item.round === listRound).sort((a, b) => a.pick - b.pick).map((item) => {
    const picked = pickByNumber.get(item.pick)
    return <MockRow key={item.pick} slot={item} team={teams.get(item.team)!} owner={teams.get(item.owner)!} player={picked ? playerOf(picked.player_id) : null} current={slot?.pick === item.pick} />
  })

  const left = boardIds.filter((id) => !pickedIds.has(id)).length
  const done = mock.picks.length
  const total = openPicks(mock.slots)
  const toolbar = (
    <div className="mk-actions">
      <button type="button" className="po-button cond" disabled={done === 0} onClick={() => update(undoPick(mock.picks))}>↶ UNDO LAST PICK</button>
      <button type="button" className="po-button cond" onClick={onNew}>NEW MOCK</button>
    </div>
  )

  if (complete) {
    const picked = mock.picks.map((pick) => playerOf(pick.player_id))
    const positions = tally(picked.map((player) => positionGroup(player.position)))
    const conferences = tally(picked.map((player) => model.conferenceOf(player.team_id)?.abbreviation ?? 'Other'))
    return (
      <div className="mk-root">
        <section className="tile mk-head">
          <div className="mk-head-copy">
            <h2 className="cond">MOCK COMPLETE · {done} OF {total} PICKS</h2>
            <span className="muted small">Saved automatically in My Mocks</span>
          </div>
          <NameField key={mock.id} mock={mock} mocks={mocks} />
          {toolbar}
        </section>
        <div className="mk-final">
          {[1, 2].map((item) => (
            <section key={item} className={`tile mk-col${mobile ? '' : ' scroll-y'}`}>
              <header className="tile-head"><h2 className="cond">ROUND {item}</h2></header>
              {list(item as Round)}
            </section>
          ))}
          <div className="mk-side">
            <Summary title="PICKS BY POSITION" rows={positions} />
            <Summary title="PICKS BY CONFERENCE" rows={conferences} />
          </div>
        </div>
      </div>
    )
  }

  const owner = teams.get(slot.owner)!
  const pickList = (
    <section className={`tile mk-col${mobile ? '' : ' scroll-y'}`}>
      <header className="tile-head">
        <div className="pills">
          {([1, 2] as const).map((item) => <button key={item} type="button" className={`pill cond${shownRound === item ? ' active' : ''}`} aria-pressed={shownRound === item} onClick={() => setRound(item)}>ROUND {item}</button>)}
        </div>
      </header>
      {list(shownRound)}
    </section>
  )
  const playerList = (
    <section className={`tile mk-col${mobile ? '' : ' scroll-y'}`}>
      <header className="tile-head">
        <div><h2 className="cond">AVAILABLE ON YOUR BOARD</h2><span className="muted small">{left ? `${left} players` : 'No players left'}</span>
        </div>
      </header>
      <div className="pills">
        {Object.keys(POSITION_GROUPS).map((item) => <button key={item} type="button" className={`pill cond${group === item ? ' active' : ''}`} aria-pressed={group === item} onClick={() => setGroup(item)}>{item}</button>)}
      </div>
      {players.error ? <ErrorBox message={(players.error as Error).message} onRetry={() => void players.refetch()} />
        : players.isPending ? <Loading label="Loading your board…" />
          : available.length ? available.map((item) => {
            const player = playerOf(item.id)
            return (
              <div key={item.id} className="draft-item">
                <PlayerLine
                  player={player}
                  statsText={playerStatLine(players.data?.stats ?? [], item.id).text}
                  leading={<span className="draft-rank cond num">{item.rank}</span>}
                  trailing={<button type="button" className="mk-pick cond" onClick={() => update(addPick(mock.slots, mock.picks, item.id))}>PICK</button>}
                />
              </div>
            )
          }) : <Empty>No players left for this filter.</Empty>}
      <p className="muted small draft-note">Click a name to open the player profile. PICK chooses the player for the team on the clock.</p>
    </section>
  )

  return (
    <div className="mk-root">
      <section className="tile mk-head">
        <NflPlate abbr={owner.abbr} color={owner.color} size={44} />
        <div className="mk-head-copy">
          <span className="cond mk-kicker">ON THE CLOCK · PICK {slot.pick} · ROUND {slot.round}</span>
          <h2 className="cond">{owner.name}{slot.owner !== slot.team && <span className="po-from cond">FROM {slot.team}</span>}</h2>
          <span className="muted small"><strong className="cond num">{done}</strong> of {total} picks · {mock.name}</span>
        </div>
        <NameField key={mock.id} mock={mock} mocks={mocks} />
        {toolbar}
      </section>
      {mobile ? (
        <>
          <div className="pills">
            <button type="button" className={`pill cond${pane === 'players' ? ' active' : ''}`} aria-pressed={pane === 'players'} onClick={() => setPane('players')}>PLAYERS</button>
            <button type="button" className={`pill cond${pane === 'picks' ? ' active' : ''}`} aria-pressed={pane === 'picks'} onClick={() => setPane('picks')}>PICKS</button>
          </div>
          {pane === 'players' ? playerList : pickList}
        </>
      ) : <div className="mk-layout">{pickList}{playerList}</div>}
    </div>
  )
}

// The MOCK DRAFT view: starts a mock from the current board and pick order,
// then runs it. `mockParam` is a mock id, "new" (start screen) or null (the
// latest unfinished mock of the year).
export function MockDraft({ year, mockParam, onOpen, onList }: { year: number; mockParam: string | null; onOpen: (id: string) => void; onList: () => void }) {
  const nfl = useNflTeams()
  const orders = usePickOrders()
  const boards = useBigBoards()
  const mocks = useMockDrafts()
  const teams = nfl.query.data
  const byAbbr = useMemo(() => new Map((teams ?? []).map((team) => [team.abbr, team])), [teams])
  // Without a mock in the address the latest unfinished one is opened, and its
  // id is written to the address so the final view stays after the last pick.
  const unfinished = (mocks.mocks ?? []).find((mock) => mock.draft_year === year && !isComplete(mock.slots, mock.picks))
  const unfinishedId = unfinished?.id ?? null
  useEffect(() => { if (mockParam === null && unfinishedId) onOpen(unfinishedId) }, [mockParam, unfinishedId, onOpen])

  if (nfl.query.error || orders.query.error || mocks.query.error) {
    const message = ((nfl.query.error ?? orders.query.error ?? mocks.query.error) as Error).message
    return <ErrorBox message={message} onRetry={() => { void nfl.query.refetch(); void orders.query.refetch(); void mocks.query.refetch() }} />
  }
  if (nfl.query.isPending || orders.query.isPending || mocks.query.isPending) return <Loading label="Loading your mock…" />
  if (!teams || teams.length !== 32) {
    return nfl.refreshError
      ? <ErrorBox message={`The NFL records could not be loaded: ${nfl.refreshError}`} onRetry={() => window.location.reload()} />
      : <Loading label="Loading the NFL records from ESPN…" />
  }

  const saved = orders.savedFor(year)
  const slots = buildSlots(effectiveOrder(teams, saved.teamOrder), saved.exceptions)
  const needed = openPicks(slots)
  const boardIds = boards.idsFor(year)
  const forYear = (mocks.mocks ?? []).filter((mock) => mock.draft_year === year)
  const current = mockParam === 'new' ? null : mockParam ? forYear.find((mock) => mock.id === mockParam) ?? null : unfinished ?? null

  const start = () => {
    const now = new Date()
    const id = crypto.randomUUID()
    mocks.save({ id, draft_year: year, name: defaultMockName(now), slots, picks: [], created_at: now.toISOString(), updated_at: now.toISOString() })
    onOpen(id)
  }

  if (current) {
    return (
      <>
        {mocks.error && <ErrorBox message={mocks.error} onRetry={mocks.clearError} />}
        <ActiveMock key={current.id} mock={current} year={year} boardIds={boardIds} teams={byAbbr} mocks={mocks} onNew={() => onOpen('new')} />
      </>
    )
  }
  const ready = boardIds.length >= needed
  return (
    <section className="tile mk-start">
      <h2 className="cond">START A MOCK DRAFT {year}</h2>
      <p className="muted">You pick for every team in rounds 1 and 2, in the order of the Pick Order tab. Only players of your Big Board can be picked, and picks are never made for you.</p>
      <p>
        Your board has <strong className="cond num">{boardIds.length}</strong> players. A full mock needs <strong className="cond num">{needed}</strong>.
        {!ready && <span className="muted"> Add {needed - boardIds.length} more in the Big Board tab to start.</span>}
      </p>
      {mocks.error && <ErrorBox message={mocks.error} onRetry={mocks.clearError} />}
      <div className="mk-actions">
        <button type="button" className="mk-pick mk-start-button cond" disabled={!ready} onClick={start}>START MOCK</button>
        {forYear.length > 0 && <button type="button" className="po-button cond" onClick={onList}>MY MOCKS ({forYear.length})</button>}
      </div>
    </section>
  )
}
