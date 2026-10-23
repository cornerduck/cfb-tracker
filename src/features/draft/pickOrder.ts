// Pure helpers for the pick order: worst record first, the same order in
// round 2, and the changes an account made on top of it.
import type { NflTeamRow, PickExceptionRow } from '../../data/queries'

export type Round = 1 | 2
export type PickSlot = {
  pick: number
  round: Round
  // The team whose record decides the position of this pick.
  team: string
  // The team that owns the pick now (the same team unless traded).
  owner: string
  forfeited: boolean
}

export const TEAM_COUNT = 32

const games = (team: NflTeamRow) => team.wins + team.losses + team.ties
// Ties count as half a win. A team without games is placed in the middle.
export const winShare = (team: NflTeamRow) => (games(team) === 0 ? 0.5 : (team.wins + team.ties / 2) / games(team))

export const recordText = (team: NflTeamRow) => `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''}`

// Worst win share first; teams with the same share are sorted alphabetically.
export function recordOrder(teams: NflTeamRow[]) {
  return [...teams].sort((a, b) => winShare(a) - winShare(b) || a.name.localeCompare(b.name)).map((team) => team.abbr)
}

// A saved order wins; teams it does not know (or lost) are placed by record.
export function effectiveOrder(teams: NflTeamRow[], saved: string[] | null) {
  const byRecord = recordOrder(teams)
  if (!saved) return byRecord
  const known = new Set(byRecord)
  const kept = saved.filter((abbr, index) => known.has(abbr) && saved.indexOf(abbr) === index)
  const left = byRecord.filter((abbr) => !kept.includes(abbr))
  return [...kept, ...left]
}

export function buildSlots(order: string[], exceptions: PickExceptionRow[]): PickSlot[] {
  const slots: PickSlot[] = []
  for (const round of [1, 2] as const) {
    order.forEach((team, index) => {
      const exception = exceptions.find((item) => item.round === round && item.team === team)
      slots.push({ pick: (round - 1) * order.length + index + 1, round, team, owner: exception?.owner ?? team, forfeited: exception?.forfeited ?? false })
    })
  }
  return slots
}

// Exceptions as they are stored: only picks that differ from the default.
export function cleanExceptions(list: PickExceptionRow[]) {
  return list.filter((item) => item.forfeited || (item.owner !== null && item.owner !== item.team))
}

export function setException(list: PickExceptionRow[], round: Round, team: string, change: Partial<Pick<PickExceptionRow, 'owner' | 'forfeited'>>) {
  const current = list.find((item) => item.round === round && item.team === team) ?? { round, team, owner: null, forfeited: false }
  const next = { ...current, ...change }
  return cleanExceptions([...list.filter((item) => !(item.round === round && item.team === team)), next])
}

// How many picks changed hands or were removed.
export const changedPicks = (exceptions: PickExceptionRow[]) => cleanExceptions(exceptions).length
