// Compares the first round of a finished mock with the real NFL draft.
import type { DraftPickRow, MockPickRow, MockSlotRow } from '../../data/queries'

export type MockChoice = { playerId: string; name: string }
export type CompareStatus = 'exact' | 'moved' | 'out' | 'none'
export type CompareRow = {
  pick: number
  real: DraftPickRow
  mock: MockChoice | null
  status: CompareStatus
  // Pick of the mock minus the real pick of the same player (positive: the mock took him later).
  delta: number | null
  sameTeam: boolean
}
export type CompareSummary = {
  exact: number
  inRound: number
  within3: number
  sameTeam: number
  total: number
  missed: DraftPickRow[]
  averageMiss: number | null
}

const clean = (name: string) => name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '')

// Real first round pick of a mock player: by athlete id, else (only for real
// picks without an id) by name.
function realPickOf(choice: MockChoice, real: readonly DraftPickRow[]) {
  return real.find((pick) => pick.college_athlete_id !== null && pick.college_athlete_id === choice.playerId)
    ?? real.find((pick) => pick.college_athlete_id === null && clean(pick.name) !== '' && clean(pick.name) === clean(choice.name))
    ?? null
}

export function compareToReal(
  slots: readonly MockSlotRow[],
  picks: readonly MockPickRow[],
  names: (playerId: string) => string,
  real: readonly DraftPickRow[],
) {
  const choiceAt = new Map<number, MockChoice>(picks.map((pick) => [pick.pick, { playerId: pick.player_id, name: names(pick.player_id) }]))
  const rows: CompareRow[] = [...real].sort((a, b) => a.overall - b.overall).map((realPick) => {
    const mock = choiceAt.get(realPick.overall) ?? null
    const slot = slots.find((item) => item.pick === realPick.overall)
    const sameTeam = !!slot && !!realPick.nfl_abbr && slot.owner === realPick.nfl_abbr
    if (!mock) return { pick: realPick.overall, real: realPick, mock: null, status: 'none', delta: null, sameTeam }
    const match = realPickOf(mock, real)
    if (!match) return { pick: realPick.overall, real: realPick, mock, status: 'out', delta: null, sameTeam }
    return { pick: realPick.overall, real: realPick, mock, status: match.overall === realPick.overall ? 'exact' : 'moved', delta: realPick.overall - match.overall, sameTeam }
  })
  // Every real first round player the mock took anywhere, with his mock pick.
  const mockPickOfReal = new Map<number, number>()
  for (const pick of picks) {
    const match = realPickOf({ playerId: pick.player_id, name: names(pick.player_id) }, real)
    if (match) mockPickOfReal.set(match.overall, pick.pick)
  }
  const gaps = [...mockPickOfReal].map(([realOverall, mockPick]) => Math.abs(mockPick - realOverall))
  const summary: CompareSummary = {
    exact: rows.filter((row) => row.status === 'exact').length,
    inRound: mockPickOfReal.size,
    within3: gaps.filter((gap) => gap <= 3).length,
    sameTeam: rows.filter((row) => row.sameTeam).length,
    total: rows.length,
    missed: real.filter((pick) => !mockPickOfReal.has(pick.overall)),
    averageMiss: gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
  }
  return { rows, summary }
}
