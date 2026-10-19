import { supabase } from '../lib/supabase'
import type {
  CalendarWeek,
  Conference,
  ConferenceSeason,
  Game,
  GamedayRow,
  HeismanRow,
  Line,
  PlayerGameStat,
  PlayerSeasonStat,
  PollRow,
  Season,
  SeasonBundle,
  Team,
  TeamGameStat,
  TeamSeason,
  WeeklyAward,
} from './types'

const client = () => {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

// PostgREST returns at most 1,000 rows per request.
async function loadAll<T>(build: (from: number, to: number) => PageResult<T>, label: string) {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999)
    if (error) throw new Error(`Could not load ${label}: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function single<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query
  if (error) throw new Error(`Could not load ${label}: ${error.message}`)
  return data
}

const TEAM_FIELDS = 'id,slug,school,mascot,abbreviation,color,alt_color,venue,capacity,location,is_fbs'
const GAME_FIELDS = 'id,season,week,season_type,away_team_id,home_team_id,neutral_site,away_points,home_points,away_line_scores,home_line_scores,start_time,tv,venue,conference_game,status,is_title_game,bowl_name,cfp_round,notes,home_seed,away_seed,period,clock'

export async function fetchSeasons() {
  const rows = await single(client().from('seasons').select('year,status').order('year', { ascending: false }), 'seasons')
  return (rows ?? []) as Array<{ year: number; status: 'archived' | 'live' }>
}

export async function fetchSeasonBundle(year: number): Promise<SeasonBundle> {
  const db = client()
  const [season, calendar, conferences, conferenceSeasons, teamSeasons, fbsTeams, games, lines, polls, awards, heismanWeekly, heismanTracker, gameday] = await Promise.all([
    single(db.from('seasons').select('*').eq('year', year).maybeSingle(), 'season'),
    loadAll<CalendarWeek>((from, to) => db.from('calendar').select('*').eq('season', year).order('start_date').range(from, to), 'calendar'),
    loadAll<Conference>((from, to) => db.from('conferences').select('id,slug,name,short_name,abbreviation,group_name').order('id').range(from, to), 'conferences'),
    loadAll<ConferenceSeason>((from, to) => db.from('conference_seasons').select('*').eq('season', year).range(from, to), 'conference seasons'),
    loadAll<TeamSeason>((from, to) => db.from('team_seasons').select('*').eq('season', year).order('team_id').range(from, to), 'team seasons'),
    loadAll<Team>((from, to) => db.from('teams').select(TEAM_FIELDS).eq('is_fbs', true).order('id').range(from, to), 'teams'),
    loadAll<Game>((from, to) => db.from('games').select(GAME_FIELDS).eq('season', year).order('id').range(from, to), 'games'),
    loadAll<Line>((from, to) => db.from('lines').select('game_id,consensus_spread,over_under,games!inner(season)').eq('games.season', year).order('game_id').range(from, to), 'lines'),
    loadAll<PollRow>((from, to) => db.from('polls').select('season,season_type,week,source,rank,team_id,points,first_place_votes').eq('season', year).order('week').order('source').order('rank').range(from, to), 'polls'),
    loadAll<WeeklyAward>((from, to) => db.from('weekly_awards').select('*').eq('season', year).range(from, to), 'weekly awards'),
    loadAll<HeismanRow>((from, to) => db.from('heisman_weekly').select('*').eq('season', year).order('week').order('rank').range(from, to), 'Heisman history'),
    single(db.from('heisman_tracker').select('*').eq('season', year).order('rank').limit(25), 'Heisman tracker'),
    loadAll<GamedayRow>((from, to) => db.from('gameday').select('*').eq('season', year).range(from, to), 'GameDay'),
  ])
  // Opponents outside FBS (FCS teams) are loaded by id.
  const known = new Set(fbsTeams.map((team) => team.id))
  const missing = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]))].filter((id) => !known.has(id))
  const others: Team[] = []
  for (let offset = 0; offset < missing.length; offset += 150) {
    const rows = await single(db.from('teams').select(TEAM_FIELDS).in('id', missing.slice(offset, offset + 150)), 'opponent teams')
    others.push(...((rows ?? []) as Team[]))
  }
  return {
    year,
    season: season as Season | null,
    calendar,
    conferences,
    conferenceSeasons,
    teamSeasons,
    teams: [...fbsTeams, ...others],
    games,
    lines: lines.map(({ game_id, consensus_spread, over_under }) => ({ game_id, consensus_spread, over_under })),
    polls,
    awards,
    heismanWeekly,
    heismanTracker: (heismanTracker ?? []) as HeismanRow[],
    gameday,
  }
}

export async function fetchGameDetail(gameId: number) {
  const db = client()
  const [teamStats, playerStats] = await Promise.all([
    single(db.from('game_team_stats').select('*').eq('game_id', gameId), 'team box score'),
    single(db.from('game_player_stats').select('*').eq('game_id', gameId), 'player box score'),
  ])
  return { teamStats: (teamStats ?? []) as TeamGameStat[], playerStats: (playerStats ?? []) as PlayerGameStat[] }
}

export async function fetchPlayerSeason(year: number, playerIds: string[]) {
  if (!playerIds.length) return [] as PlayerSeasonStat[]
  const rows = await single(client().from('player_season_stats').select('*').eq('season', year).in('player_id', playerIds), 'player season statistics')
  return (rows ?? []) as PlayerSeasonStat[]
}

export async function fetchPlayerGames(playerId: string) {
  const rows = await single(client().from('game_player_stats').select('*').eq('player_id', playerId), 'player game log')
  return (rows ?? []) as PlayerGameStat[]
}

export async function searchPlayers(year: number, query: string) {
  const rows = await single(
    client().from('player_season_stats').select('player_id,player_name,team_id,position,category,stats')
      .eq('season', year).ilike('player_name', `%${query.replace(/[%_]/g, '')}%`).limit(60),
    'players',
  )
  return (rows ?? []) as PlayerSeasonStat[]
}
