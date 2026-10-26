import { supabase } from '../lib/supabase'
import type {
  CalendarWeek,
  Conference,
  ConferenceSeason,
  Game,
  GamedayRow,
  GamedayStop,
  HeadToHead,
  HeismanRow,
  Line,
  PickMode,
  PickRow,
  PlayerGameStat,
  PlayerSeasonStat,
  PortalRow,
  RecruitingTeamRow,
  RecruitRow,
  RosterPlayer,
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

// Every stored season of one player, for the Career tab.
export async function fetchPlayerCareer(playerId: string) {
  const rows = await single(client().from('player_season_stats').select('*').eq('player_id', playerId).order('season'), 'player career statistics')
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

export async function fetchPlayerSeasonCategory(year: number, category: string) {
  return await loadAll<PlayerSeasonStat>(
    (from, to) => client().from('player_season_stats').select('season,player_id,player_name,team_id,position,category,stats')
      .eq('season', year).eq('category', category).order('player_id').range(from, to),
    'player season statistics',
  )
}

export async function fetchTeamPlayers(year: number, teamId: number) {
  const rows = await single(client().from('player_season_stats').select('*').eq('season', year).eq('team_id', teamId), 'team players')
  return (rows ?? []) as PlayerSeasonStat[]
}

export async function fetchTeamRoster(year: number, teamId: number) {
  const rows = await single(client().from('roster').select('*').eq('season', year).eq('team_id', teamId).order('jersey', { ascending: true, nullsFirst: false }), 'team roster')
  return (rows ?? []) as RosterPlayer[]
}

export type CoachRow = { season: number; team_id: number; coach_name: string; wins: number; losses: number; ties: number }

export async function fetchCoaches(teamId: number) {
  const rows = await single(client().from('coaches').select('season,team_id,coach_name,wins,losses,ties').eq('team_id', teamId).order('season', { ascending: false }), 'coaches')
  return (rows ?? []) as CoachRow[]
}

export async function fetchTeamHistory(teamId: number) {
  const db = client()
  const [teamSeasons, games, seasons, polls, upsets] = await Promise.all([
    single(db.from('team_seasons').select('*').eq('team_id', teamId).order('season', { ascending: false }), 'team seasons'),
    loadAll<Game>((from, to) => db.from('games').select(GAME_FIELDS).or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`).order('id').range(from, to), 'team games'),
    single(db.from('seasons').select('*').order('year', { ascending: false }), 'seasons'),
    loadAll<PollRow>((from, to) => db.from('polls').select('season,season_type,week,source,rank,team_id,points,first_place_votes').eq('team_id', teamId).eq('source', 'AP').range(from, to), 'team rankings'),
    loadAll<WeeklyAward>((from, to) => db.from('weekly_awards').select('*').eq('award_type', 'upset').range(from, to), 'upsets'),
  ])
  return {
    teamSeasons: (teamSeasons ?? []) as TeamSeason[],
    games,
    seasons: (seasons ?? []) as Season[],
    polls,
    upsetsWon: upsets.filter((award) => Number(award.details.winner_team_id) === teamId),
  }
}

export type TeamSeasonStatRow = { season: number; team_id: number; category: string; stats: Record<string, string | number | null> }

export async function fetchTeamSeasonStats(year: number) {
  return await loadAll<TeamSeasonStatRow>(
    (from, to) => client().from('team_season_stats').select('season,team_id,category,stats').eq('season', year).order('team_id').range(from, to),
    'team season statistics',
  )
}

export async function fetchAllTime() {
  const db = client()
  const [seasons, numberOnes, upsets, teamSeasons, gameday] = await Promise.all([
    single(db.from('seasons').select('*').order('year', { ascending: false }), 'seasons'),
    loadAll<PollRow>((from, to) => db.from('polls').select('season,season_type,week,source,rank,team_id,points,first_place_votes').eq('source', 'AP').eq('rank', 1).range(from, to), 'number one teams'),
    loadAll<WeeklyAward>((from, to) => db.from('weekly_awards').select('*').eq('award_type', 'upset').range(from, to), 'upsets'),
    loadAll<TeamSeason>((from, to) => db.from('team_seasons').select('*').order('season').order('team_id').range(from, to), 'team seasons'),
    loadAll<GamedayRow>((from, to) => db.from('gameday').select('*').range(from, to), 'GameDay'),
  ])
  const seasonRows = (seasons ?? []) as Season[]
  const gameIds = [...new Set([...upsets.map((row) => row.game_id), ...seasonRows.map((season) => season.title_game_id)].filter((id): id is number => id !== null))]
  const games: Game[] = []
  for (let offset = 0; offset < gameIds.length; offset += 150) {
    const rows = await single(db.from('games').select(GAME_FIELDS).in('id', gameIds.slice(offset, offset + 150)), 'archive games')
    games.push(...((rows ?? []) as Game[]))
  }
  // All FBS teams plus any FCS winners of stored upsets.
  const teams = await loadAll<Team>((from, to) => db.from('teams').select(TEAM_FIELDS).eq('is_fbs', true).order('id').range(from, to), 'teams')
  const known = new Set(teams.map((team) => team.id))
  const missing = [...new Set(games.flatMap((game) => [game.home_team_id, game.away_team_id]))].filter((id) => !known.has(id))
  for (let offset = 0; offset < missing.length; offset += 150) {
    const rows = await single(db.from('teams').select(TEAM_FIELDS).in('id', missing.slice(offset, offset + 150)), 'teams')
    teams.push(...((rows ?? []) as Team[]))
  }
  return { seasons: seasonRows, numberOnes, upsets, teamSeasons, gameday, games, teams }
}

// ---------------------------------------------------------------- Pick'em

export async function fetchPicks(year: number) {
  const rows = await loadAll<PickRow & { games?: unknown }>(
    (from, to) => client().from('pickem_picks').select('user_id,game_id,pick_team_id,mode,locked,correct,spread,updated_at,games!inner(season)')
      .eq('games.season', year).order('game_id').range(from, to),
    'picks',
  )
  return rows.map(({ games: _games, ...row }) => row as PickRow)
}

const readError = async (error: { message: string; context?: unknown }) => {
  const context = error.context as Response | undefined
  const body = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
  return (body && typeof body.error === 'string' ? body.error : null) ?? error.message
}

export async function savePick(gameId: number, mode: PickMode, teamId: number | null) {
  const { data, error } = await client().rpc('save_pickem_pick', { p_game_id: gameId, p_mode: mode, p_team_id: teamId })
  if (error) throw new Error(/lock at kickoff/i.test(error.message) ? 'This game has kicked off; the pick is locked.' : error.message)
  const row = data as PickRow | null
  return row && row.game_id ? row : null
}

// ---------------------------------------------------------------- compare

export async function fetchHeadToHead(teamA: number, teamB: number) {
  const [low, high] = teamA < teamB ? [teamA, teamB] : [teamB, teamA]
  const row = await single(client().from('head_to_head').select('*').eq('team_a_id', low).eq('team_b_id', high).maybeSingle(), 'head to head')
  return row as HeadToHead | null
}

export async function refreshHeadToHead(teamA: number, teamB: number) {
  const { data, error } = await client().functions.invoke('head-to-head', { body: { team_a_id: teamA, team_b_id: teamB } })
  if (error) throw new Error(await readError(error as { message: string; context?: unknown }))
  return (data as { series: HeadToHead }).series
}

// ---------------------------------------------------------------- GameDay

export async function fetchGamedayStops() {
  return await loadAll<GamedayStop>(
    (from, to) => client().from('gameday_stops').select('*').order('season').order('stop').range(from, to),
    'GameDay history',
  )
}

// ---------------------------------------------------------------- Draft

export type BigBoardRow = { draft_year: number; player_id: string; rank: number }

// Every board of the signed-in account (the policy limits the rows to it).
export async function fetchBigBoards() {
  const rows = await single(client().from('big_boards').select('draft_year,player_id,rank').order('draft_year').order('rank'), 'big board')
  return (rows ?? []) as BigBoardRow[]
}

// Replaces the whole board of one draft year, in the given order.
export async function saveBigBoard(year: number, playerIds: string[]) {
  const { error } = await client().rpc('save_big_board', { p_year: year, p_player_ids: playerIds })
  if (error) throw new Error(error.message)
}

// Roster rows of the given players, newest season first, so the caller can
// take the first row per player.
export async function fetchRosterByIds(playerIds: string[]) {
  if (!playerIds.length) return [] as RosterPlayer[]
  const rows = await single(client().from('roster').select('*').in('player_id', playerIds).order('season', { ascending: false }), 'board players')
  return (rows ?? []) as RosterPlayer[]
}

export async function searchRoster(season: number, query: string, positions: string[] | null, teamId: number | null) {
  let request = client().from('roster').select('*').eq('season', season)
  const text = query.replace(/[%_,()]/g, '').trim()
  if (text) request = request.ilike('full_name', `%${text}%`)
  if (positions) request = request.in('position', positions)
  if (teamId !== null) request = request.eq('team_id', teamId)
  const rows = await single(request.order('full_name').limit(60), 'players')
  return (rows ?? []) as RosterPlayer[]
}

export type NflTeamRow = {
  abbr: string
  espn_id: number
  name: string
  color: string
  wins: number
  losses: number
  ties: number
  record_season: number
  updated_at: string
}

export type PickExceptionRow = { round: 1 | 2; team: string; owner: string | null; forfeited: boolean }
export type PickOrderRow = { draft_year: number; team_order: string[] | null; exceptions: PickExceptionRow[] }

export async function fetchNflTeams() {
  const rows = await single(client().from('nfl_teams').select('*').order('name'), 'NFL teams')
  return (rows ?? []) as NflTeamRow[]
}

// Asks the nfl-standings function to refresh the records. It only calls ESPN
// when the stored records are older than three hours.
export async function refreshNflTeams() {
  const { data, error } = await client().functions.invoke('nfl-standings', { body: {} })
  if (error) throw new Error(await readError(error as { message: string; context?: unknown }))
  return data as { status: 'fresh' | 'updated'; updated_at: string }
}

export async function fetchPickOrders() {
  const rows = await single(client().from('pick_orders').select('draft_year,team_order,exceptions').order('draft_year'), 'pick orders')
  return (rows ?? []) as PickOrderRow[]
}

// Saves the pick order of one draft year. No order and no exceptions removes
// it, which brings back the order by records.
export async function savePickOrder(year: number, teamOrder: string[] | null, exceptions: PickExceptionRow[]) {
  const { error } = await client().rpc('save_pick_order', { p_year: year, p_team_order: teamOrder, p_exceptions: exceptions })
  if (error) throw new Error(error.message)
}

export type MockSlotRow = { pick: number; round: 1 | 2; team: string; owner: string; forfeited: boolean }
export type MockPickRow = { pick: number; player_id: string }
export type MockDraftRow = {
  id: string
  draft_year: number
  name: string
  slots: MockSlotRow[]
  picks: MockPickRow[]
  created_at: string
  updated_at: string
}

export async function fetchMockDrafts() {
  const rows = await single(client().from('mock_drafts').select('*').order('updated_at', { ascending: false }), 'mock drafts')
  return (rows ?? []) as MockDraftRow[]
}

// Creates or updates one of your mocks (the caller chooses the id).
export async function saveMockDraft(mock: Pick<MockDraftRow, 'id' | 'draft_year' | 'name' | 'slots' | 'picks'>) {
  const { error } = await client().rpc('save_mock_draft', { p_id: mock.id, p_year: mock.draft_year, p_name: mock.name, p_slots: mock.slots, p_picks: mock.picks })
  if (error) throw new Error(error.message)
}

export async function deleteMockDraft(id: string) {
  const { error } = await client().rpc('delete_mock_draft', { p_id: id })
  if (error) throw new Error(error.message)
}

export type DraftPickRow = {
  draft_year: number
  overall: number
  round: number
  pick: number | null
  nfl_team: string
  nfl_abbr: string | null
  name: string
  position: string | null
  height: number | null
  weight: number | null
  college_team: string | null
  college_id: number | null
  college_athlete_id: string | null
  college_conference: string | null
}

// The first round of one real NFL draft, from CFBD.
export async function fetchDraftPicks(draftYear: number) {
  const rows = await single(client().from('nfl_draft_picks').select('*').eq('draft_year', draftYear).eq('round', 1).order('overall').limit(100), 'draft picks')
  return (rows ?? []) as DraftPickRow[]
}

// ---------------------------------------------------------------- recruiting

// The team class rankings of one class year.
export const fetchRecruitingTeams = (classYear: number) =>
  loadAll<RecruitingTeamRow>((from, to) => client().from('recruiting_teams').select('*').eq('class_year', classYear).order('team_id').range(from, to), 'class rankings')

// The class rank of one team in every stored class year.
export async function fetchRecruitingHistory(teamId: number) {
  const rows = await single(client().from('recruiting_teams').select('class_year,rank,points').eq('team_id', teamId).order('class_year', { ascending: false }), 'class history')
  return (rows ?? []) as Array<Pick<RecruitingTeamRow, 'class_year' | 'rank' | 'points'>>
}

// Every recruit of one class (about 4,000 rows, so four requests).
export const fetchRecruits = (classYear: number) =>
  loadAll<RecruitRow>((from, to) => client().from('recruits')
    .select('class_year,id,name,position,stars,rating,national_rank,position_rank,state_rank,high_school,city,state_province,country,height,weight,committed_team_id,committed_to')
    .eq('class_year', classYear).order('national_rank', { nullsFirst: false }).order('id').range(from, to), 'recruits')

// Every transfer portal entry of one season (about 4,500 rows).
export const fetchPortal = (season: number) =>
  loadAll<PortalRow>((from, to) => client().from('portal_entries')
    .select('season,id,name,position,origin,origin_team_id,destination,destination_team_id,transfer_date,stars,rating,eligibility')
    .eq('season', season).order('rating', { ascending: false, nullsFirst: false }).order('id').range(from, to), 'transfer portal')
