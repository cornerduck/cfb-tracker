import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchDraftPicks, fetchNflTeams, type MockDraftRow } from '../../data/queries'
import type { RosterPlayer } from '../../data/types'
import { Empty, ErrorBox, Loading, Plate } from '../../shared/ui'
import { useApp } from '../../app/context'
import { NflPlate } from './NflPlate'
import { compareToReal, type CompareRow, type CompareStatus } from './compare'

const LABEL: Record<CompareStatus, string> = { exact: 'EXACT', moved: 'CLOSE', out: 'MISS', none: '' }

function Row({ row, color, player }: { row: CompareRow; color: string; player: RosterPlayer | null }) {
  const { model } = useApp()
  const school = player ? model.team(player.team_id) : null
  const note = row.status === 'moved' && row.delta !== null
    ? row.delta < 0 ? `Went ${-row.delta} later in reality` : `Went ${row.delta} earlier in reality`
    : row.status === 'out' ? 'Not in round 1 in reality' : ''
  return (
    <div className={`cp-row ${row.status}`}>
      <span className="mk-number cond num">{row.pick}</span>
      <span className="cp-mock">
        {row.mock ? (
          <>
            <span className="cp-name">{row.mock.name}</span>
            <span className="draft-meta muted">
              {player?.position && <span className="draft-pos cond">{player.position}</span>}
              {school && <Plate team={school} size={16} />}
              <span className="truncate">{note || school?.school}</span>
            </span>
          </>
        ) : <span className="muted small">no pick</span>}
      </span>
      <span className={`cp-badge cond ${row.status}`}>{LABEL[row.status]}</span>
      <span className="cp-real">
        <NflPlate abbr={row.real.nfl_abbr ?? row.real.nfl_team.slice(0, 3).toUpperCase()} color={color} size={26} />
        <span className="cp-name truncate">{row.real.name}</span>
      </span>
    </div>
  )
}

// The finished mock next to the first round of the real draft of that year.
export function MockCompare({ mock, playerOf, ready }: { mock: MockDraftRow; playerOf: (id: string) => RosterPlayer; ready: boolean }) {
  const { mobile } = useApp()
  const real = useQuery({ queryKey: ['nfl-draft', mock.draft_year], queryFn: () => fetchDraftPicks(mock.draft_year), staleTime: 10 * 60_000 })
  const teams = useQuery({ queryKey: ['nfl-teams'], queryFn: fetchNflTeams, staleTime: 10 * 60_000 })
  const result = useMemo(
    () => (real.data?.length && ready ? compareToReal(mock.slots, mock.picks, (id) => playerOf(id).full_name, real.data) : null),
    [real.data, ready, mock.slots, mock.picks, playerOf],
  )
  if (real.error) return <ErrorBox message={(real.error as Error).message} onRetry={() => void real.refetch()} />
  if (real.isPending || !ready) return <Loading label="Loading the real draft…" />
  if (!result) return <Empty>The real draft {mock.draft_year} is not in the data yet.</Empty>
  const colors = new Map((teams.data ?? []).map((team) => [team.abbr, team.color]))
  const { summary } = result
  const chips: [string, string][] = [
    ['EXACT PICKS', `${summary.exact} / ${summary.total}`],
    ['IN FIRST ROUND', `${summary.inRound} / ${summary.total}`],
    ['WITHIN 3 PICKS', `${summary.within3} / ${summary.total}`],
    ['TEAM ON THE CLOCK', `${summary.sameTeam} / ${summary.total}`],
    ['AVG. MISS', summary.averageMiss === null ? '–' : summary.averageMiss.toFixed(1)],
  ]
  return (
    <div className={`cp-root${mobile ? '' : ' scroll-y'}`}>
      <section className="tile mk-summary">
        <header className="tile-head">
          <div>
            <h2 className="cond">YOUR MOCK VS THE REAL DRAFT {mock.draft_year}</h2>
            <span className="muted small">First round only. Exact is the same player at the same pick; within 3 and the average miss count every real first round player you picked anywhere.</span>
          </div>
        </header>
        <div className="mk-chips">
          {chips.map(([label, value]) => <span key={label} className="mk-chip"><span className="cond">{label}</span><strong className="cond num">{value}</strong></span>)}
        </div>
        {summary.missed.length > 0 && (
          <p className="muted small cp-missed">Real first rounders you did not pick: {summary.missed.slice(0, 8).map((pick) => `${pick.name} (${pick.overall})`).join(', ')}{summary.missed.length > 8 ? ` and ${summary.missed.length - 8} more` : ''}</p>
        )}
      </section>
      <section className="tile cp-list">
        <div className="cp-head cond muted"><span>PICK</span><span>YOUR MOCK</span><span /><span>REAL DRAFT</span></div>
        {result.rows.map((row) => (
          <Row key={row.pick} row={row} color={(row.real.nfl_abbr && colors.get(row.real.nfl_abbr)) || '3A3F46'} player={row.mock ? playerOf(row.mock.playerId) : null} />
        ))}
      </section>
    </div>
  )
}
