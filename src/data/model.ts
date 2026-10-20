// SeasonModel turns the raw season bundle into the lookups every screen
// needs: periods (weeks), records, streaks, polls at a point in time, spreads
// and upsets. Everything is derived from database rows; nothing is hardcoded.

import type { Conference, Game, PollRow, PollSource, SeasonBundle, Team, TeamSeason } from './types'

export type PeriodKind = 'week' | 'confchamp' | 'postseason'

export type Period = {
  key: string
  kind: PeriodKind
  seasonType: 'regular' | 'postseason'
  week: number | null
  order: number
  label: string
  short: string
  start: number | null
  end: number | null
}

export type PollRelease = {
  source: PollSource
  seasonType: 'regular' | 'postseason'
  week: number
  order: number
  label: string
  rows: PollRow[]
  ranked: PollRow[]
  others: PollRow[]
  byTeam: Map<number, PollRow>
}

export type TeamResult = {
  game: Game
  order: number
  time: number
  opponentId: number
  home: boolean
  neutral: boolean
  pf: number
  pa: number
  result: 'W' | 'L' | 'T'
  conference: boolean
}

export type Record3 = { w: number; l: number; t: number }

export type UpsetTier = 'upset' | 'big' | 'stunner'

const time = (value: string | null) => (value ? Date.parse(value) : Number.NaN)

export const recordText = (record: Record3) => `${record.w}–${record.l}${record.t ? `–${record.t}` : ''}`

const CONF_ABBR: Record<string, string> = { MWC: 'MW', PAC: 'P12', 'PAC-12': 'P12', IND: 'IND', 'FBS INDEPENDENTS': 'IND' }
const CONF_NAME: Record<string, string> = {
  ACC: 'ACC',
  B1G: 'Big Ten',
  B12: 'Big 12',
  SEC: 'SEC',
  AAC: 'American',
  CUSA: 'Conference USA',
  MAC: 'MAC',
  MW: 'Mountain West',
  P12: 'Pac-12',
  SBC: 'Sun Belt',
  IND: 'Independents',
}

export const confAbbr = (conference: Conference | null | undefined) => {
  if (!conference) return '—'
  const raw = (conference.abbreviation ?? conference.short_name ?? conference.name).toUpperCase()
  if (/independent/i.test(conference.name)) return 'IND'
  return CONF_ABBR[raw] ?? raw
}

export const confName = (conference: Conference | null | undefined) => {
  if (!conference) return ''
  return CONF_NAME[confAbbr(conference)] ?? conference.short_name ?? conference.name
}

const GROUP_ORDER: Record<string, number> = { 'Power 4': 0, 'Group of 6': 1, Independent: 2 }

export class SeasonModel {
  readonly year: number
  readonly bundle: SeasonBundle
  readonly teams = new Map<number, Team>()
  readonly teamSeasons = new Map<number, TeamSeason>()
  readonly conferences = new Map<number, Conference>()
  readonly divisions = new Map<number, string[]>()
  readonly games: Game[]
  readonly gameById = new Map<number, Game>()
  readonly spreads = new Map<number, number | null>()
  readonly totals = new Map<number, number | null>()
  readonly periods: Period[]
  readonly periodByKey = new Map<string, Period>()
  readonly lastRegularWeek: number
  readonly confChampWeek: number | null
  readonly polls = new Map<PollSource, PollRelease[]>()
  readonly results = new Map<number, TeamResult[]>()
  readonly fbsIds: Set<number>

  constructor(bundle: SeasonBundle) {
    this.year = bundle.year
    this.bundle = bundle
    for (const team of bundle.teams) this.teams.set(team.id, team)
    for (const row of bundle.teamSeasons) this.teamSeasons.set(row.team_id, row)
    for (const conference of bundle.conferences) this.conferences.set(conference.id, conference)
    for (const row of bundle.conferenceSeasons) this.divisions.set(row.conference_id, row.divisions ?? [])
    for (const line of bundle.lines) {
      this.spreads.set(line.game_id, line.consensus_spread === null ? null : Number(line.consensus_spread))
      this.totals.set(line.game_id, line.over_under === null ? null : Number(line.over_under))
    }
    this.fbsIds = new Set(bundle.teamSeasons.map((row) => row.team_id))
    for (const team of bundle.teams) if (team.is_fbs) this.fbsIds.add(team.id)

    this.games = [...bundle.games].sort((a, b) => (time(a.start_time) || 0) - (time(b.start_time) || 0) || a.id - b.id)
    for (const game of this.games) this.gameById.set(game.id, game)

    const regularWeeks = [
      ...bundle.calendar.filter((row) => row.season_type === 'regular').map((row) => row.week),
      ...this.games.filter((game) => game.season_type === 'regular' && game.week !== null).map((game) => game.week!),
    ]
    this.lastRegularWeek = Math.max(1, ...regularWeeks)
    const ccg = this.games.find((game) => game.season_type === 'regular' && /championship/i.test(game.notes ?? '') && !/^fcs/i.test(game.notes ?? ''))
    this.confChampWeek = ccg?.week ?? null

    const periods: Period[] = []
    const regularRows = [...new Map(bundle.calendar.filter((row) => row.season_type === 'regular').map((row) => [row.week, row])).values()]
      .sort((a, b) => a.week - b.week)
    const weeksSeen = new Set(regularRows.map((row) => row.week))
    for (const week of new Set(regularWeeks)) {
      if (!weeksSeen.has(week)) regularRows.push({ season: this.year, week, season_type: 'regular', start_date: null, end_date: null })
    }
    regularRows.sort((a, b) => a.week - b.week)
    for (const row of regularRows) {
      const confChamp = row.week === this.confChampWeek
      const weekGames = this.games.filter((game) => game.season_type === 'regular' && game.week === row.week)
      const start = time(row.start_date) || Math.min(...weekGames.map((game) => time(game.start_time)).filter(Number.isFinite))
      const end = time(row.end_date) || Math.max(...weekGames.map((game) => time(game.start_time)).filter(Number.isFinite))
      periods.push({
        key: `r${row.week}`,
        kind: confChamp ? 'confchamp' : 'week',
        seasonType: 'regular',
        week: row.week,
        order: row.week,
        label: confChamp ? 'Conf Champ' : `Week ${row.week}`,
        short: confChamp ? 'CCG' : `WK ${row.week}`,
        start: Number.isFinite(start) ? start : null,
        end: Number.isFinite(end) ? end : null,
      })
    }
    const postRows = bundle.calendar.filter((row) => row.season_type === 'postseason')
    const postGames = this.games.filter((game) => game.season_type !== 'regular')
    if (postRows.length || postGames.length) {
      const starts = [...postRows.map((row) => time(row.start_date)), ...postGames.map((game) => time(game.start_time))].filter(Number.isFinite)
      const ends = [...postRows.map((row) => time(row.end_date)), ...postGames.map((game) => time(game.start_time))].filter(Number.isFinite)
      periods.push({
        key: 'post',
        kind: 'postseason',
        seasonType: 'postseason',
        week: null,
        order: this.lastRegularWeek + 1,
        label: 'Postseason',
        short: 'POST',
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
      })
    }
    this.periods = periods
    for (const period of periods) this.periodByKey.set(period.key, period)

    // Polls: CFBD numbers a poll by the week whose games follow it, so the
    // poll for week w sits between periods w-1 and w (order w - 0.5).
    const groups = new Map<string, PollRow[]>()
    for (const row of bundle.polls) {
      const key = `${row.source}|${row.season_type}|${row.week}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const [key, rows] of groups) {
      const [source, seasonType, weekText] = key.split('|') as [PollSource, 'regular' | 'postseason', string]
      const week = Number(weekText)
      const order = seasonType === 'postseason' ? this.lastRegularWeek + 1.5 : week - 0.5
      const sorted = [...rows].sort((a, b) => a.rank - b.rank || (b.points ?? 0) - (a.points ?? 0))
      const release: PollRelease = {
        source,
        seasonType,
        week,
        order,
        label: seasonType === 'postseason' ? 'Final' : week <= 1 ? 'Preseason' : `Week ${week - 1}`,
        rows: sorted,
        ranked: sorted.filter((row) => row.rank <= 25),
        others: sorted.filter((row) => row.rank > 25),
        byTeam: new Map(sorted.filter((row) => row.rank <= 25).map((row) => [row.team_id, row])),
      }
      this.polls.set(source, [...(this.polls.get(source) ?? []), release])
    }
    for (const releases of this.polls.values()) releases.sort((a, b) => a.order - b.order)

    for (const game of this.games) {
      if (game.status !== 'final' || game.home_points === null || game.away_points === null) continue
      const order = this.gameOrder(game)
      for (const home of [true, false]) {
        const teamId = home ? game.home_team_id : game.away_team_id
        const pf = home ? game.home_points : game.away_points
        const pa = home ? game.away_points : game.home_points
        const list = this.results.get(teamId) ?? []
        list.push({
          game,
          order,
          time: time(game.start_time) || 0,
          opponentId: home ? game.away_team_id : game.home_team_id,
          home,
          neutral: game.neutral_site,
          pf,
          pa,
          result: pf > pa ? 'W' : pf < pa ? 'L' : 'T',
          conference: Boolean(game.conference_game),
        })
        this.results.set(teamId, list)
      }
    }
  }

  // ------------------------------------------------------------ periods

  gameOrder(game: Game) {
    return game.season_type === 'regular' ? game.week ?? 0 : this.lastRegularWeek + 1
  }

  periodKeyOf(game: Game) {
    return game.season_type === 'regular' ? `r${game.week}` : 'post'
  }

  gamesIn(key: string) {
    return this.games.filter((game) => this.periodKeyOf(game) === key)
  }

  // The week the season is in: the latest period that has started.
  currentPeriod(now = Date.now()) {
    const started = this.periods.filter((period) => period.start !== null && period.start <= now)
    return started.at(-1) ?? this.periods[0] ?? null
  }

  // The next period with games still to play (for "next week" tiles).
  nextPeriodAfter(period: Period | null) {
    if (!period) return null
    return this.periods.find((item) => item.order > period.order) ?? null
  }

  awardWeekFor(period: Period) {
    return period.seasonType === 'regular' ? period.week! : this.lastRegularWeek + 1
  }

  // ------------------------------------------------------------ teams

  team(id: number | null | undefined) {
    return id === null || id === undefined ? undefined : this.teams.get(id)
  }

  conferenceOf(teamId: number) {
    const conferenceId = this.teamSeasons.get(teamId)?.conference_id
    return conferenceId ? this.conferences.get(conferenceId) ?? null : null
  }

  conferenceList() {
    const ids = new Set([...this.teamSeasons.values()].map((row) => row.conference_id).filter((id): id is number => id !== null))
    return [...ids].map((id) => this.conferences.get(id)).filter((conference): conference is Conference => Boolean(conference))
      .sort((a, b) =>
        (GROUP_ORDER[a.group_name ?? ''] ?? 3) - (GROUP_ORDER[b.group_name ?? ''] ?? 3) ||
        confName(a).localeCompare(confName(b)))
  }

  teamsIn(conferenceId: number) {
    return [...this.teamSeasons.values()].filter((row) => row.conference_id === conferenceId).map((row) => row.team_id)
  }

  // ------------------------------------------------------------ records

  resultsThrough(teamId: number, order = Infinity) {
    return (this.results.get(teamId) ?? []).filter((result) => result.order <= order).sort((a, b) => a.time - b.time)
  }

  record(teamId: number, order = Infinity, filter?: (result: TeamResult) => boolean): Record3 {
    const record = { w: 0, l: 0, t: 0 }
    for (const result of this.resultsThrough(teamId, order)) {
      if (filter && !filter(result)) continue
      if (result.result === 'W') record.w += 1
      else if (result.result === 'L') record.l += 1
      else record.t += 1
    }
    return record
  }

  confRecord(teamId: number, order = Infinity) {
    return this.record(teamId, order, (result) => result.conference)
  }

  // Win or loss streak after the given point in the season.
  streak(teamId: number, order = Infinity, beforeGameId?: number) {
    let list = this.resultsThrough(teamId, order)
    if (beforeGameId !== undefined) {
      const index = list.findIndex((result) => result.game.id === beforeGameId)
      if (index >= 0) list = list.slice(0, index + 1)
    }
    const last = list.at(-1)
    if (!last) return null
    let count = 0
    for (let index = list.length - 1; index >= 0 && list[index].result === last.result; index -= 1) count += 1
    return { type: last.result, count }
  }

  // Win streak of 5 or more, shown as a flame.
  flame(teamId: number, order = Infinity, throughGameId?: number) {
    const streak = this.streak(teamId, order, throughGameId)
    return streak && streak.type === 'W' && streak.count >= 5 ? streak.count : null
  }

  lastResult(teamId: number, order = Infinity) {
    return this.resultsThrough(teamId, order).at(-1) ?? null
  }

  teamGames(teamId: number) {
    return this.games.filter((game) => game.home_team_id === teamId || game.away_team_id === teamId)
  }

  nextGame(teamId: number, now = Date.now()) {
    return this.teamGames(teamId).find((game) => game.status !== 'final' && (time(game.start_time) || Infinity) >= now - 5 * 3600_000) ?? null
  }

  // ------------------------------------------------------------ polls

  pollReleases(source: PollSource) {
    return this.polls.get(source) ?? []
  }

  // The poll released after the games of a period (or the latest one before it
  // when that poll is not out yet).
  pollAfter(source: PollSource, order: number) {
    const releases = this.pollReleases(source)
    return releases.find((release) => release.order > order && release.order < order + 1) ??
      [...releases].reverse().find((release) => release.order < order + 1) ?? null
  }

  // The poll in effect when a game kicks off.
  pollAt(source: PollSource, order: number) {
    return [...this.pollReleases(source)].reverse().find((release) => release.order < order) ?? null
  }

  previousRelease(release: PollRelease) {
    const releases = this.pollReleases(release.source)
    const index = releases.indexOf(release)
    return index > 0 ? releases[index - 1] : null
  }

  apRankAtKickoff(teamId: number, game: Game) {
    return this.pollAt('AP', this.gameOrder(game))?.byTeam.get(teamId)?.rank ?? null
  }

  apRankAfter(teamId: number, order: number) {
    return this.pollAfter('AP', order)?.byTeam.get(teamId)?.rank ?? null
  }

  // ------------------------------------------------------------ lines and upsets

  // CFBD spreads are from the home team's view: negative = home favored.
  favoriteText(game: Game) {
    const spread = this.spreads.get(game.id)
    if (spread === null || spread === undefined) return null
    if (spread === 0) return 'PICK'
    const favorite = this.team(spread < 0 ? game.home_team_id : game.away_team_id)
    return `${abbr(favorite)} −${formatSpread(Math.abs(spread))}`
  }

  winnerId(game: Game) {
    if (game.status !== 'final' || game.home_points === null || game.away_points === null) return null
    if (game.home_points === game.away_points) return null
    return game.home_points > game.away_points ? game.home_team_id : game.away_team_id
  }

  upset(game: Game): { tier: UpsetTier; winnerSpread: number | null; winnerId: number } | null {
    const winner = this.winnerId(game)
    if (winner === null) return null
    const loser = winner === game.home_team_id ? game.away_team_id : game.home_team_id
    const spread = this.spreads.get(game.id)
    if (spread === null || spread === undefined || spread === 0) {
      if (!this.fbsIds.has(winner) && this.fbsIds.has(loser)) return { tier: 'stunner', winnerSpread: null, winnerId: winner }
      return null
    }
    const homeFavored = spread < 0
    if ((winner === game.home_team_id) === homeFavored) return null
    const size = Math.abs(spread)
    const tier: UpsetTier | null = size >= 21 ? 'stunner' : size >= 14 ? 'big' : size >= 7 ? 'upset' : null
    return tier ? { tier, winnerSpread: size, winnerId: winner } : null
  }

  isOvertime(game: Game) {
    return Math.max(game.home_line_scores?.length ?? 0, game.away_line_scores?.length ?? 0) > 4
  }

  // ------------------------------------------------------------ unbeaten

  unbeatenAfter(order: number) {
    return [...this.fbsIds].filter((teamId) => {
      const record = this.record(teamId, order)
      return record.l === 0 && record.w + record.t > 0
    })
  }
}

export const abbr = (team: Team | undefined | null) =>
  team ? (team.abbreviation ?? team.school.replace(/[^A-Za-z]/g, '').slice(0, 4)).toUpperCase() : 'TBD'

export const formatSpread = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

export const teamColor = (team: Team | undefined | null) => {
  const color = team?.color?.trim()
  return color && /^#?[0-9a-f]{3,8}$/i.test(color) ? (color.startsWith('#') ? color : `#${color}`) : '#5B616B'
}

export const shortName = (team: Team | undefined | null) => {
  if (!team) return 'TBD'
  return team.school
    .replace(/ State$/, ' St')
    .replace(/^North Carolina St$/, 'NC State')
}
