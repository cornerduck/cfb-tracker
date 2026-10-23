import type { DraftPickRow, NflTeamRow } from '../../data/queries'

// The NFL team of a real draft pick. Older imports only have the city ("Tennessee");
// that is resolved against the 32 teams when exactly one name starts with it.
export function draftTeam(pick: DraftPickRow, teams: readonly NflTeamRow[]) {
  const byAbbr = pick.nfl_abbr ? teams.find((team) => team.abbr === pick.nfl_abbr) : undefined
  const wanted = pick.nfl_team.trim().toLowerCase()
  const matches = byAbbr ? [byAbbr] : teams.filter((team) => team.name.toLowerCase().startsWith(`${wanted} `))
  const team = matches.length === 1 ? matches[0] : null
  return { abbr: team?.abbr ?? pick.nfl_abbr ?? 'NFL', name: team?.name ?? pick.nfl_team, color: team?.color ?? '3A3F46' }
}
