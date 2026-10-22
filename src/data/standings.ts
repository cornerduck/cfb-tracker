// Conference standings, race status and the projected CFP field.

import type { Conference, Game } from './types'
import { fallbackDivisions } from './config'
import { type PollRelease, type Record3, SeasonModel, confAbbr, confName } from './model'

export type RaceStatus = 'title' | 'leader' | 'alive' | 'eliminated'

export type StandingRow = {
  teamId: number
  conf: Record3
  overall: Record3
  vsRanked: Record3
  streak: { type: 'W' | 'L' | 'T'; count: number } | null
  gb: number | null
  status: RaceStatus
  apRank: number | null
  remaining: number
}

export type StandingsGroup = { division: string | null; rows: StandingRow[] }

export type ConferenceStandings = {
  conference: Conference
  groups: StandingsGroup[]
  hasDivisions: boolean
  champion: number | null
  titleGame: Game | null
  leaders: number[]
}

const pct = (record: Record3) => {
  const games = record.w + record.l + record.t
  return games ? (record.w + record.t / 2) / games : 0
}

const compare = (a: StandingRow, b: StandingRow) =>
  pct(b.conf) - pct(a.conf) || b.conf.w - a.conf.w || a.conf.l - b.conf.l ||
  pct(b.overall) - pct(a.overall) || b.overall.w - a.overall.w || (a.apRank ?? 99) - (b.apRank ?? 99)

const gamesBack = (leader: Record3, team: Record3) => ((leader.w - team.w) + (team.l - leader.l)) / 2

export function conferenceStandings(model: SeasonModel, conferenceId: number, order = Infinity): ConferenceStandings | null {
  const conference = model.conferences.get(conferenceId)
  if (!conference) return null
  const teamIds = model.teamsIn(conferenceId)
  const isIndependent = confAbbr(conference) === 'IND'
  // CFBD marks conference title games as conference_game = false, so the
  // notes and the two teams' conference decide.
  const titleGame = model.games.find((game) =>
    game.season_type === 'regular' && /championship/i.test(game.notes ?? '') &&
    teamIds.includes(game.home_team_id) && teamIds.includes(game.away_team_id) && model.gameOrder(game) <= order) ?? null
  const champion = titleGame ? model.winnerId(titleGame) : null
  const now = Date.now()

  const rows: StandingRow[] = teamIds.map((teamId) => {
    const remaining = model.teamGames(teamId).filter((game) =>
      game.conference_game && !/championship/i.test(game.notes ?? '') &&
      (game.status !== 'final' || model.gameOrder(game) > order) &&
      (game.start_time ? Date.parse(game.start_time) : now) >= 0).length
    return {
      teamId,
      conf: model.record(teamId, order, (result) => result.conference && !/championship/i.test(result.game.notes ?? '')),
      overall: model.record(teamId, order),
      vsRanked: model.record(teamId, order, (result) => model.apRankAtKickoff(result.opponentId, result.game) !== null),
      streak: model.streak(teamId, order),
      gb: null,
      status: 'alive',
      apRank: model.apRankAfter(teamId, order),
      remaining,
    }
  })
  if (isIndependent) {
    rows.sort((a, b) => pct(b.overall) - pct(a.overall) || b.overall.w - a.overall.w)
    return { conference, groups: [{ division: null, rows }], hasDivisions: false, champion: null, titleGame: null, leaders: [] }
  }

  const stored = (model.divisions.get(conferenceId) ?? []).filter(Boolean)
  const fallback = stored.length > 1 ? null : fallbackDivisions(model.year, conference.slug)
  const divisions = fallback ? fallback.names : stored
  const divisionOf = (teamId: number) => fallback
    ? fallback.byTeam.get(model.team(teamId)?.slug ?? '') ?? null
    : model.teamSeasons.get(teamId)?.division ?? null
  const hasDivisions = divisions.length > 1 && rows.every((row) => divisionOf(row.teamId))
  const groups: StandingsGroup[] = hasDivisions
    ? divisions.map((division) => ({ division, rows: rows.filter((row) => divisionOf(row.teamId) === division) }))
    : [{ division: null, rows }]

  const spots = hasDivisions ? 1 : 2
  const leaders: number[] = []
  for (const group of groups) {
    group.rows.sort(compare)
    const anchor = group.rows[Math.min(spots, group.rows.length) - 1]
    for (const [index, row] of group.rows.entries()) {
      row.gb = index < spots ? null : anchor ? gamesBack(anchor.conf, row.conf) : null
      const maxWins = row.conf.w + row.remaining
      const ahead = group.rows.filter((other) => other !== row && other.conf.w > maxWins).length
      row.status = index < spots ? (hasDivisions ? 'leader' : 'title') : ahead >= spots ? 'eliminated' : 'alive'
    }
    leaders.push(...group.rows.slice(0, spots).map((row) => row.teamId))
  }
  if (titleGame && titleGame.status === 'final') {
    for (const group of groups) {
      for (const row of group.rows) {
        if (row.teamId !== titleGame.home_team_id && row.teamId !== titleGame.away_team_id) row.status = 'eliminated'
      }
    }
  }
  return { conference, groups, hasDivisions, champion, titleGame, leaders }
}

// The best team of a conference: the champion, else the current leader.
export function conferenceLeader(standings: ConferenceStandings | null) {
  if (!standings) return null
  if (standings.champion) return standings.champion
  const all = standings.groups.flatMap((group) => group.rows).sort(compare)
  return all[0]?.teamId ?? null
}

export type FieldEntry = {
  teamId: number
  rank: number | null
  seed: number
  bye: boolean
  autoBid: string | null
}

export type ProjectedField = {
  source: 'CFP' | 'AP'
  release: PollRelease | null
  field: FieldEntry[]
  autoBids: Array<{ label: string; teamId: number | null }>
  firstFourOut: Array<{ teamId: number; rank: number }>
  inField: Set<number>
}

const POWER4 = ['ACC', 'B12', 'B1G', 'SEC']

// 2026 rules: champions of the Power 4 get automatic bids, the highest-ranked
// Group of 6 champion gets one, Notre Dame qualifies if ranked in the top 12,
// the rest are at-large. Straight seeding; seeds 1-4 get a bye.
export function projectField(model: SeasonModel, order: number, preferCfp = true, explicit?: PollRelease | null): ProjectedField {
  const cfp = preferCfp ? model.pollAfter('CFP', order) : null
  const release = explicit ?? (cfp && cfp.order <= order + 1 ? cfp : model.pollAfter('AP', order))
  const source = release?.source === 'CFP' ? 'CFP' : 'AP'
  const rankOf = (teamId: number) => release?.byTeam.get(teamId)?.rank ?? null

  const autoBids: Array<{ label: string; teamId: number | null }> = []
  const groupOfSix: number[] = []
  for (const conference of model.conferenceList()) {
    const code = confAbbr(conference)
    if (code === 'IND') continue
    const leader = conferenceLeader(conferenceStandings(model, conference.id, order))
    if (POWER4.includes(code)) autoBids.push({ label: confName(conference), teamId: leader })
    else if (leader !== null) groupOfSix.push(leader)
  }
  const bestG6 = [...groupOfSix].sort((a, b) =>
    (rankOf(a) ?? 99) - (rankOf(b) ?? 99) ||
    (model.record(b, order).w - model.record(b, order).l) - (model.record(a, order).w - model.record(a, order).l))[0] ?? null
  autoBids.push({ label: 'Best Group of 6', teamId: bestG6 })

  const notreDame = [...model.teams.values()].find((team) => team.school === 'Notre Dame')
  const ndRank = notreDame ? rankOf(notreDame.id) : null
  if (notreDame && ndRank !== null && ndRank <= 12) autoBids.push({ label: 'Notre Dame (top 12)', teamId: notreDame.id })

  const inField = new Set(autoBids.map((bid) => bid.teamId).filter((id): id is number => id !== null))
  for (const row of release?.ranked ?? []) {
    if (inField.size >= 12) break
    inField.add(row.team_id)
  }
  const autoLabel = new Map(autoBids.filter((bid) => bid.teamId !== null).map((bid) => [bid.teamId!, bid.label]))
  const field = [...inField]
    .sort((a, b) => (rankOf(a) ?? 99) - (rankOf(b) ?? 99))
    .map((teamId, index) => ({
      teamId,
      rank: rankOf(teamId),
      seed: index + 1,
      bye: index < 4,
      autoBid: autoLabel.get(teamId) ?? null,
    }))
  const firstFourOut = (release?.ranked ?? []).filter((row) => !inField.has(row.team_id)).slice(0, 4)
    .map((row) => ({ teamId: row.team_id, rank: row.rank }))
  return { source, release, field, autoBids, firstFourOut, inField }
}
