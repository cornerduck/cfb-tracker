import { useQuery } from '@tanstack/react-query'
import { useApp } from '../../app/context'
import { fetchDraftPicks, fetchNflTeams, type DraftPickRow, type NflTeamRow } from '../../data/queries'
import { ConfPlate, Empty, ErrorBox, Loading, Plate } from '../../shared/ui'
import { draftTeam } from '../draft/draftTeam'
import { NflPlate } from '../draft/NflPlate'

// CFBD writes the position out in full for many players.
const SHORT: Record<string, string> = {
  Quarterback: 'QB', 'Running Back': 'RB', 'Wide Receiver': 'WR', 'Tight End': 'TE', 'Offensive Tackle': 'OT', 'Offensive Guard': 'OG',
  Center: 'C', 'Offensive Lineman': 'OL', 'Defensive Tackle': 'DT', 'Defensive End': 'DE', 'Defensive Lineman': 'DL', Linebacker: 'LB',
  Cornerback: 'CB', Safety: 'S', 'Defensive Back': 'DB', Edge: 'EDGE', Kicker: 'K', Punter: 'P', Fullback: 'FB',
}
const positionText = (position: string | null) => (position ? SHORT[position] ?? position : '')

function PickLine({ pick, teams }: { pick: DraftPickRow; teams: readonly NflTeamRow[] }) {
  const { model, openWindow } = useApp()
  const nfl = draftTeam(pick, teams)
  const school = pick.college_id !== null ? model.team(pick.college_id) : undefined
  const canOpen = pick.college_athlete_id !== null && school !== undefined
  return (
    <div className="dr-row">
      <span className="dr-number cond num">{pick.overall}</span>
      <NflPlate abbr={nfl.abbr} color={nfl.color} size={32} />
      <span className="dr-nfl truncate">{nfl.name}</span>
      <span className="dr-player">
        {canOpen
          ? <button type="button" className="draft-name" onClick={() => openWindow({ type: 'player', playerId: pick.college_athlete_id as string, name: pick.name, teamId: school.id })}>{pick.name}</button>
          : <span className="dr-plain">{pick.name}</span>}
        <span className="draft-meta muted">
          {pick.position && <span className="draft-pos cond">{positionText(pick.position)}</span>}
          {school ? <Plate team={school} size={18} /> : null}
          <span className="truncate">{school?.school ?? pick.college_team ?? ''}</span>
          {school && <ConfPlate conference={model.conferenceOf(school.id)} small />}
        </span>
      </span>
    </div>
  )
}

const NO_TEAMS: NflTeamRow[] = []

// The first round of the real NFL draft that follows the selected season.
export function DraftResults({ draftYear }: { draftYear: number }) {
  const { mobile } = useApp()
  const picks = useQuery({ queryKey: ['nfl-draft', draftYear], queryFn: () => fetchDraftPicks(draftYear), staleTime: 10 * 60_000 })
  const teams = useQuery({ queryKey: ['nfl-teams'], queryFn: fetchNflTeams, staleTime: 10 * 60_000 })
  if (picks.error) return <ErrorBox message={(picks.error as Error).message} onRetry={() => void picks.refetch()} />
  if (picks.isPending) return <Loading label="Loading the draft…" />
  return (
    <section className={`tile dr-tile${mobile ? '' : ' scroll-y'}`}>
      <header className="tile-head">
        <div>
          <h2 className="cond">NFL DRAFT {draftYear} · FIRST ROUND</h2>
          <span className="muted small">Draft after the {draftYear - 1} season · Source CFBD</span>
        </div>
      </header>
      {picks.data?.length ? picks.data.map((pick) => <PickLine key={pick.overall} pick={pick} teams={teams.data ?? NO_TEAMS} />) : <Empty>No draft data for {draftYear} yet.</Empty>}
    </section>
  )
}
