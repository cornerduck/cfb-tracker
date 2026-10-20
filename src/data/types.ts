export type Team = {
  id: number
  slug: string
  school: string
  mascot: string | null
  abbreviation: string | null
  color: string | null
  alt_color: string | null
  venue: string | null
  capacity: number | null
  location: { city?: string; state?: string; name?: string; latitude?: number; longitude?: number } | null
  is_fbs: boolean
}

export type Conference = {
  id: number
  slug: string
  name: string
  short_name: string | null
  abbreviation: string | null
  group_name: 'Power 4' | 'Group of 6' | 'Independent' | null
}

export type ConferenceSeason = { season: number; conference_id: number; divisions: string[] }

export type TeamSeason = {
  season: number
  team_id: number
  conference_id: number | null
  division: string | null
  wins: number
  losses: number
  ties: number
  final_ranking: number | null
  postseason_result: string | null
}

export type Season = {
  year: number
  status: 'archived' | 'live'
  champion_team_id: number | null
  title_game_id: number | null
  heisman_winner: string | null
  heisman_finalists: Array<{ name: string; team: string; team_id: number | null } | string>
  last_unbeaten_team_id: number | null
}

export type CalendarWeek = {
  season: number
  week: number
  season_type: string
  start_date: string | null
  end_date: string | null
}

export type GameStatus = 'scheduled' | 'in_progress' | 'final'

export type Game = {
  id: number
  season: number
  week: number | null
  season_type: string
  away_team_id: number
  home_team_id: number
  neutral_site: boolean
  away_points: number | null
  home_points: number | null
  away_line_scores: number[] | null
  home_line_scores: number[] | null
  start_time: string | null
  tv: string | null
  venue: string | null
  conference_game: boolean | null
  status: GameStatus
  is_title_game: boolean
  bowl_name: string | null
  cfp_round: string | null
  notes: string | null
  home_seed: number | null
  away_seed: number | null
  period: number | null
  clock: string | null
}

export type Line = { game_id: number; consensus_spread: number | null; over_under: number | null }

export type PollSource = 'AP' | 'Coaches' | 'CFP'

export type PollRow = {
  season: number
  season_type: 'regular' | 'postseason'
  week: number
  source: PollSource
  rank: number
  team_id: number
  points: number | null
  first_place_votes: number | null
}

export type WeeklyAward = {
  season: number
  week: number
  award_type: 'upset' | 'game' | 'blowout' | 'performance'
  game_id: number | null
  player_id: string | null
  details: Record<string, unknown>
}

export type HeismanRow = {
  season: number
  week?: number
  player_id: string
  player_name: string
  team_id: number | null
  score: number
  rank: number
}

export type GamedayRow = {
  season: number
  week: number
  team_id: number | null
  game_id: number | null
  guest_picker: string | null
  guest_pick_team_id: number | null
  result: Record<string, unknown>
}

export type PlayerGameStat = {
  game_id: number
  player_id: string
  player_name: string
  team_id: number
  category: string
  stats: Record<string, string | number | null>
}

export type TeamGameStat = { game_id: number; team_id: number; stats: Record<string, string | number | null> }

export type PlayerSeasonStat = {
  season: number
  player_id: string
  player_name: string
  team_id: number | null
  position: string | null
  category: string
  stats: Record<string, string | number | null>
}

export type SeasonBundle = {
  year: number
  season: Season | null
  calendar: CalendarWeek[]
  conferences: Conference[]
  conferenceSeasons: ConferenceSeason[]
  teamSeasons: TeamSeason[]
  teams: Team[]
  games: Game[]
  lines: Line[]
  polls: PollRow[]
  awards: WeeklyAward[]
  heismanWeekly: HeismanRow[]
  heismanTracker: HeismanRow[]
  gameday: GamedayRow[]
}

export type PickMode = 'straight_up' | 'against_the_spread'

export type PickRow = {
  user_id: string
  game_id: number
  pick_team_id: number | null
  mode: PickMode
  locked: boolean
  correct: boolean | null
  spread: number | null
  updated_at: string
}

export type Meeting = {
  season: number | null
  week: number | null
  season_type: string | null
  date: string | null
  neutral: boolean
  home: string | null
  away: string | null
  home_points: number | null
  away_points: number | null
  winner: string | null
}

export type HeadToHead = {
  team_a_id: number
  team_b_id: number
  team_a_wins: number
  team_b_wins: number
  ties: number
  meetings: Meeting[]
  updated_at: string
}
