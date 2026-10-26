// Pure helpers for the Recruiting tab.
import type { PortalEligibility, PortalRow, RecruitRow, RecruitingTeamRow } from '../../data/types'

// Position chips and the CFBD positions behind each one.
export const POSITION_GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST / ATH'] as const
export type PositionGroup = typeof POSITION_GROUPS[number]

const GROUP_OF: Record<string, PositionGroup> = {
  QB: 'QB', PRO: 'QB', DUAL: 'QB',
  RB: 'RB', APB: 'RB', FB: 'RB', HB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL', OT: 'OL', OG: 'OL', OC: 'OL', C: 'OL', G: 'OL', T: 'OL', IOL: 'OL',
  DL: 'DL', DT: 'DL', NT: 'DL', DE: 'DL', EDGE: 'DL', SDE: 'DL', WDE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB',
}

export const positionGroup = (position: string | null): PositionGroup => GROUP_OF[(position ?? '').toUpperCase()] ?? 'ST / ATH'

export const ratingText = (value: number | null) => (value === null ? '—' : value.toFixed(4))
export const pointsText = (value: number | null) => (value === null ? '—' : value.toFixed(1))

// CFBD stores height in inches and weight in pounds: 6-3 / 215.
export function sizeText(height: number | null, weight: number | null) {
  const h = height ? `${Math.floor(height / 12)}-${Math.round(height % 12)}` : null
  return [h, weight ? String(weight) : null].filter(Boolean).join(' / ') || '—'
}

export const hometownText = (recruit: Pick<RecruitRow, 'city' | 'state_province' | 'country'>) => {
  const state = recruit.state_province ?? (recruit.country && recruit.country !== 'USA' ? recruit.country : null)
  return [recruit.city, state].filter(Boolean).join(', ') || '—'
}

export const ELIGIBILITY_LABEL: Record<PortalEligibility, string> = {
  Immediate: 'IMMEDIATE',
  SittingOne: 'SITS 1 YEAR',
  PendingAppeal: 'APPEAL',
  TBD: 'TBD',
  Withdrawn: 'WITHDRAWN',
}

export const averageOf = (values: Array<number | null>) => {
  const list = values.filter((value): value is number => value !== null)
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null
}

// Change of the class rank against the previous class of the same team. Positive = better.
export function rankChanges(current: RecruitingTeamRow[], previous: RecruitingTeamRow[]) {
  const before = new Map(previous.map((row) => [row.team_id, row.rank]))
  const changes = new Map<number, number | null>()
  for (const row of current) {
    const old = before.get(row.team_id)
    changes.set(row.team_id, row.rank !== null && old !== null && old !== undefined ? old - row.rank : null)
  }
  return changes
}

// The team with the best average rating in each position group (at least two commits).
export function bestClassByPosition(recruits: RecruitRow[], fbsIds: Set<number>) {
  const result = new Map<PositionGroup, { teamId: number; rating: number }>()
  const groups = new Map<string, number[]>()
  for (const recruit of recruits) {
    if (recruit.committed_team_id === null || !fbsIds.has(recruit.committed_team_id) || recruit.rating === null) continue
    const key = `${positionGroup(recruit.position)}|${recruit.committed_team_id}`
    groups.set(key, [...(groups.get(key) ?? []), recruit.rating])
  }
  for (const [key, ratings] of groups) {
    if (ratings.length < 2) continue
    const [group, team] = key.split('|')
    const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
    const best = result.get(group as PositionGroup)
    if (!best || average > best.rating) result.set(group as PositionGroup, { teamId: Number(team), rating: average })
  }
  return result
}

// Class by stars of one team: 5, 4, 3 and 2 or fewer.
export function starBuckets(recruits: RecruitRow[]) {
  const count = (test: (stars: number) => boolean) => recruits.filter((recruit) => recruit.stars !== null && test(recruit.stars)).length
  return [
    { label: '5★', value: count((stars) => stars === 5) },
    { label: '4★', value: count((stars) => stars === 4) },
    { label: '3★', value: count((stars) => stars === 3) },
    { label: '≤2★', value: count((stars) => stars <= 2) },
  ]
}

export function positionBreakdown(recruits: RecruitRow[]) {
  return POSITION_GROUPS.map((group) => {
    const list = recruits.filter((recruit) => positionGroup(recruit.position) === group)
    return { group, commits: list.length, average: averageOf(list.map((recruit) => recruit.rating)) }
  })
}

// A withdrawn entry never counts as a move.
export const isWithdrawn = (row: PortalRow) => row.eligibility === 'Withdrawn'
export const isCommitted = (row: PortalRow) => !isWithdrawn(row) && (row.destination_team_id !== null || Boolean(row.destination))
export const isStillIn = (row: PortalRow) => !isWithdrawn(row) && row.destination_team_id === null && !row.destination

export function portalSummary(rows: PortalRow[]) {
  return {
    entries: rows.length,
    committed: rows.filter(isCommitted).length,
    stillIn: rows.filter(isStillIn).length,
    average: averageOf(rows.map((row) => row.rating)),
  }
}

// In and out per FBS team. Net = in minus out.
export function portalNet(rows: PortalRow[], fbsIds: Set<number>) {
  const table = new Map<number, { teamId: number; in: number; out: number; net: number }>()
  const row = (teamId: number) => {
    let entry = table.get(teamId)
    if (!entry) table.set(teamId, entry = { teamId, in: 0, out: 0, net: 0 })
    return entry
  }
  for (const item of rows) {
    if (isWithdrawn(item)) continue
    if (item.destination_team_id !== null && fbsIds.has(item.destination_team_id)) row(item.destination_team_id).in += 1
    if (item.origin_team_id !== null && fbsIds.has(item.origin_team_id)) row(item.origin_team_id).out += 1
  }
  for (const entry of table.values()) entry.net = entry.in - entry.out
  return [...table.values()]
}

export const netText = (net: number) => (net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0')

// The class years are the class that is recruited now and the four before it; the portal seasons
// are the live season and the five before it.
export const classYearsFor = (liveYear: number) => Array.from({ length: 5 }, (_, index) => liveYear + 1 - index)
export const portalYearsFor = (liveYear: number) => Array.from({ length: 6 }, (_, index) => liveYear - index)
