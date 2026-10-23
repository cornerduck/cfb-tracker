import { useMemo } from 'react'
import { useApp } from '../../app/context'
import type { MockDraftRow } from '../../data/queries'
import { Empty, ErrorBox, Loading } from '../../shared/ui'
import { isComplete, openPicks } from './mockLogic'
import { useMockDrafts } from './mockShared'
import { useBoardPlayers } from './boardHooks'

const dateText = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// The saved mocks of one draft year.
export function MyMocks({ year, onOpen, onNew }: { year: number; onOpen: (id: string) => void; onNew: () => void }) {
  const { model } = useApp()
  const mocks = useMockDrafts()
  const list = useMemo(() => (mocks.mocks ?? []).filter((mock) => mock.draft_year === year), [mocks.mocks, year])
  // The first three picks of every mock are shown, so their players are loaded.
  const ids = useMemo(() => [...new Set(list.flatMap((mock) => mock.picks.slice(0, 3).map((pick) => pick.player_id)))], [list])
  const players = useBoardPlayers(year, ids)

  if (mocks.query.error) return <ErrorBox message={(mocks.query.error as Error).message} onRetry={() => void mocks.query.refetch()} />
  if (mocks.query.isPending) return <Loading label="Loading your mocks…" />

  const copy = (mock: MockDraftRow) => {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    mocks.save({ ...mock, id, name: `Copy of ${mock.name}`.slice(0, 60), created_at: now, updated_at: now })
  }
  const remove = (mock: MockDraftRow) => { if (window.confirm(`Delete "${mock.name}"?`)) mocks.remove(mock.id) }

  return (
    <div className="mm-root">
      <div className="mm-head">
        <span className="muted">{list.length} saved {list.length === 1 ? 'mock' : 'mocks'} for draft {year}</span>
        <button type="button" className="mk-pick mk-start-button cond" onClick={onNew}>+ NEW MOCK</button>
      </div>
      {mocks.error && <ErrorBox message={mocks.error} onRetry={mocks.clearError} />}
      {list.length === 0 ? <Empty>No mocks yet. Start one in the Mock Draft tab.</Empty> : (
        <div className="mm-grid">
          {list.map((mock) => {
            const complete = isComplete(mock.slots, mock.picks)
            return (
              <article key={mock.id} className="tile mm-card">
                <header className="mm-card-head">
                  <h2 className="cond">{mock.name}</h2>
                  <span className={`mm-badge cond${complete ? ' done' : ''}`}>{complete ? 'COMPLETE' : 'IN PROGRESS'}</span>
                </header>
                <span className="muted small">{dateText(mock.updated_at)} · <span className="num">{mock.picks.length} / {openPicks(mock.slots)}</span> picks</span>
                <div className="mm-preview">
                  {mock.picks.slice(0, 3).map((pick) => {
                    const slot = mock.slots.find((item) => item.pick === pick.pick)
                    const player = players.data?.byPlayer.get(pick.player_id)
                    return (
                      <div key={pick.pick} className="mm-line">
                        <span className="cond num">{pick.pick}</span>
                        <span className="cond">{slot?.owner}</span>
                        <span className="truncate">{player ? player.full_name : `Player ${pick.player_id}`}{player?.position ? ` · ${player.position}` : ''}</span>
                        {player && <span className="muted small truncate">{model.team(player.team_id)?.school}</span>}
                      </div>
                    )
                  })}
                  {mock.picks.length === 0 && <span className="muted small">No picks yet</span>}
                </div>
                <div className="mk-actions">
                  <button type="button" className="mk-pick cond" onClick={() => onOpen(mock.id)}>{complete ? 'OPEN' : 'CONTINUE'}</button>
                  <button type="button" className="po-button cond" onClick={() => copy(mock)}>COPY</button>
                  <button type="button" className="po-button cond" onClick={() => remove(mock)}>DELETE</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
