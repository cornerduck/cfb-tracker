import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const SEASON = 2026;
const CFBD_BASE_URL = "https://api.collegefootballdata.com";
const JOBS = [
  "near-live",
  "daily-results",
  "weekly",
  "monday",
  "cfp",
  "winter",
  "bootstrap",
  "manual",
] as const;
type Job = typeof JOBS[number];
type JsonObject = Record<string, unknown>;
type CallCounter = { value: number; endpoints: string[] };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-live-scheduler-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const asObject = (value: unknown, label: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CFBD returned an invalid ${label} record`);
  }
  return value as JsonObject;
};

const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`CFBD ${label} response was not an array`);
  return value;
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const integerValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const numberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const identifier = (value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : null;

const slugify = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const normalizeName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const jsonObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {};

const fetchCfbd = async (
  path: string,
  apiKey: string,
  calls: CallCounter,
  params: Record<string, string> = {},
) => {
  const url = new URL(path, CFBD_BASE_URL);
  url.searchParams.set("year", String(SEASON));
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  calls.value += 1;
  calls.endpoints.push(`${url.pathname}${url.search}`);
  const result = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!result.ok) {
    throw new Error(`CFBD ${url.pathname} request failed with HTTP ${result.status}`);
  }
  return asArray(await result.json(), url.pathname);
};

const upsertRows = async (
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: JsonObject[],
  onConflict: string,
) => {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const { error } = await supabase.from(table).upsert(
      rows.slice(offset, offset + 250),
      { onConflict },
    );
    if (error) throw new Error(`Could not update ${table}: ${error.message}`);
  }
  return rows.length;
};

const loadTeamLookups = async (supabase: ReturnType<typeof createClient>) => {
  const { data, error } = await supabase
    .from("teams")
    .select("id,school,is_fbs");
  if (error) throw new Error(`Could not load teams: ${error.message}`);
  const idByName = new Map<string, number>();
  const fbsIds = new Set<number>();
  for (const team of data ?? []) {
    idByName.set(normalizeName(team.school), team.id);
    if (team.is_fbs) fbsIds.add(team.id);
  }
  if (fbsIds.size === 0) {
    throw new Error("No FBS teams are in the database; run the 2026 setup import first");
  }
  return { idByName, fbsIds };
};

const teamIdFor = (value: unknown, idByName: Map<string, number>) => {
  const id = integerValue(value);
  if (id !== null) return id;
  const name = optionalString(value);
  return name ? idByName.get(normalizeName(name)) ?? null : null;
};

type SeasonPeriod = {
  week: number;
  seasonType: string;
  startDate: string | null;
  endDate: string | null;
};

const getCurrentPeriod = async (supabase: ReturnType<typeof createClient>) => {
  const { data, error } = await supabase.from("calendar")
    .select("week,season_type,start_date,end_date")
    .eq("season", SEASON)
    .order("week");
  if (error) throw new Error(`Could not load the 2026 calendar: ${error.message}`);
  const periods = (data ?? [])
    .filter((row) =>
      ["regular", "postseason"].includes(row.season_type) &&
      typeof row.week === "number"
    )
    .map((row) => ({
      week: row.week as number,
      seasonType: row.season_type as string,
      startDate: row.start_date as string | null,
      endDate: row.end_date as string | null,
    }));
  if (!periods.length) {
    throw new Error("The 2026 calendar is empty; run the 2026 setup import first");
  }

  const now = Date.now();
  const active = periods.find((period) =>
    period.startDate && period.endDate &&
    Date.parse(period.startDate) <= now &&
    Date.parse(period.endDate) >= now
  );
  if (active) return active;
  const recentlyStarted = [...periods].reverse().find((period) =>
    period.startDate && Date.parse(period.startDate) <= now &&
    period.endDate && now - Date.parse(period.endDate) <= 18 * 60 * 60 * 1000
  );
  if (recentlyStarted) return recentlyStarted;
  return periods.find((period) =>
    period.startDate && Date.parse(period.startDate) >= now
  ) ?? periods[periods.length - 1];
};

const getPeriodsThroughCurrent = async (
  supabase: ReturnType<typeof createClient>,
  currentPeriod: SeasonPeriod,
) => {
  const { data, error } = await supabase.from("calendar")
    .select("week,season_type,start_date,end_date")
    .eq("season", SEASON)
    .order("week");
  if (error) throw new Error(`Could not load the 2026 calendar: ${error.message}`);
  const periods = (data ?? [])
    .filter((row) =>
      ["regular", "postseason"].includes(row.season_type) &&
      typeof row.week === "number"
    )
    .map((row) => ({
      week: row.week as number,
      seasonType: row.season_type as string,
      startDate: row.start_date as string | null,
      endDate: row.end_date as string | null,
    }));
  const currentIndex = periods.findIndex((period) =>
    period.week === currentPeriod.week &&
    period.seasonType === currentPeriod.seasonType
  );
  if (currentIndex === -1) {
    throw new Error("The current week is missing from the 2026 season calendar");
  }
  return periods.slice(0, currentIndex + 1).filter((period) =>
    (period.week === currentPeriod.week &&
      period.seasonType === currentPeriod.seasonType) ||
    !period.startDate ||
    Date.parse(period.startDate) <= Date.now()
  );
};

const currentPeriodParams = (period: SeasonPeriod) => ({
  week: String(period.week),
  seasonType: period.seasonType,
});

const scheduledJobMatchesBerlinTime = (job: Job, date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const weekday = part("weekday");
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const month = Number(part("month"));
  if (minute !== 0) return false;

  switch (job) {
    case "near-live":
      return (
        (weekday === "Sat" && hour >= 18 && hour <= 22 && hour % 2 === 0) ||
        (weekday === "Sun" && hour <= 8 && hour % 2 === 0)
      );
    case "daily-results":
      return (weekday === "Fri" || weekday === "Sat") && hour === 8;
    case "weekly":
      return weekday === "Sun" && hour === 10;
    case "monday":
      return weekday === "Mon" && hour === 6;
    case "cfp":
      return weekday === "Wed" && hour === 6 && (month === 11 || month === 12);
    case "winter":
      return hour === 8 && (month === 12 || month === 1);
    default:
      return true;
  }
};

const mapGame = (value: unknown, idByName: Map<string, number>) => {
  const game = asObject(value, "game");
  const homeId = integerValue(game.homeId) ??
    teamIdFor(game.homeTeam, idByName);
  const awayId = integerValue(game.awayId) ??
    teamIdFor(game.awayTeam, idByName);
  if (homeId === null || awayId === null || homeId === awayId) return null;
  const id = integerValue(game.id);
  if (id === null) throw new Error("CFBD game record is missing id");
  const notes = optionalString(game.notes) ?? "";
  const seasonType = optionalString(game.seasonType) ?? "regular";
  const status = optionalString(game.status) ?? "scheduled";
  const completed = game.completed === true || /final/i.test(status);
  const inProgress = !completed &&
    ((integerValue(game.period) ?? 0) > 0 ||
      /progress|quarter|half|overtime/i.test(status));
  return {
    id,
    season: SEASON,
    week: integerValue(game.week),
    season_type: seasonType,
    away_team_id: awayId,
    home_team_id: homeId,
    neutral_site: game.neutralSite === true,
    away_points: integerValue(game.awayPoints),
    home_points: integerValue(game.homePoints),
    away_line_scores: Array.isArray(game.awayLineScores)
      ? game.awayLineScores
      : null,
    home_line_scores: Array.isArray(game.homeLineScores)
      ? game.homeLineScores
      : null,
    start_time: optionalString(game.startDate),
    tv: optionalString(game.tv),
    venue: optionalString(game.venue),
    away_postgame_rank: integerValue(game.awayPostgameRank),
    home_postgame_rank: integerValue(game.homePostgameRank),
    conference_game: typeof game.conferenceGame === "boolean"
      ? game.conferenceGame
      : null,
    status: completed ? "final" : inProgress ? "in_progress" : "scheduled",
    is_title_game: /national championship|cfp championship/i.test(notes),
    bowl_name: seasonType.toLowerCase() === "regular" ? null : notes || null,
    cfp_round: /national championship/i.test(notes)
      ? "National Championship"
      : /semifinal/i.test(notes)
      ? "Semifinal"
      : /quarterfinal/i.test(notes)
      ? "Quarterfinal"
      : /first round/i.test(notes)
      ? "First Round"
      : null,
  };
};

const syncGames = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  fbsIds: Set<number>,
  idByName: Map<string, number>,
) => {
  const rows = (await fetchCfbd(
    "/games",
    apiKey,
    calls,
    currentPeriodParams(period),
  ))
    .map((game) => mapGame(game, idByName))
    .filter((game): game is NonNullable<typeof game> =>
      game !== null && (fbsIds.has(game.home_team_id) || fbsIds.has(game.away_team_id))
    );
  const count = await upsertRows(supabase, "games", rows, "id");
  await updateTeamRecords(supabase, fbsIds);
  return { rows, count };
};

const syncLines = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  gameIds: Set<number>,
) => {
  const lineData = await fetchCfbd(
    "/lines",
    apiKey,
    calls,
    currentPeriodParams(period),
  );
  const lines = lineData.flatMap((value) => {
    const item = asObject(value, "line");
    const gameId = integerValue(item.id);
    if (gameId === null || !gameIds.has(gameId)) return [];
    const providerSpreads: Record<string, number> = {};
    const spreads: number[] = [];
    let overUnder: number | null = null;
    for (const rawLine of Array.isArray(item.lines) ? item.lines : []) {
      const line = asObject(rawLine, "provider line");
      const provider = optionalString(line.provider);
      const spread = numberValue(line.spread);
      if (provider && spread !== null) {
        providerSpreads[provider] = spread;
        if (!/consensus/i.test(provider)) spreads.push(spread);
      }
      overUnder ??= numberValue(line.overUnder);
    }
    const consensus = Object.entries(providerSpreads)
      .find(([provider]) => /consensus/i.test(provider))?.[1] ??
      (spreads.length
        ? spreads.reduce((sum, spread) => sum + spread, 0) / spreads.length
        : null);
    return [{
      game_id: gameId,
      provider_spreads: providerSpreads,
      consensus_spread: consensus,
      over_under: overUnder,
    }];
  });
  return await upsertRows(supabase, "lines", lines, "game_id");
};

const updateTeamRecords = async (
  supabase: ReturnType<typeof createClient>,
  fbsIds: Set<number>,
) => {
  const gameRows: Array<{
    away_team_id: number;
    home_team_id: number;
    away_points: number | null;
    home_points: number | null;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("games")
      .select("away_team_id,home_team_id,away_points,home_points")
      .eq("season", SEASON)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not load live games: ${error.message}`);
    gameRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const records = new Map<number, { wins: number; losses: number; ties: number }>();
  for (const game of gameRows) {
    if (game.away_points === null || game.home_points === null) continue;
    for (const [teamId, points, opponentPoints] of [
      [game.home_team_id, game.home_points, game.away_points],
      [game.away_team_id, game.away_points, game.home_points],
    ] as const) {
      if (!fbsIds.has(teamId)) continue;
      const record = records.get(teamId) ?? { wins: 0, losses: 0, ties: 0 };
      if (points > opponentPoints) record.wins += 1;
      else if (points < opponentPoints) record.losses += 1;
      else record.ties += 1;
      records.set(teamId, record);
    }
  }
  const { data: teamSeasons, error } = await supabase.from("team_seasons")
    .select("season,team_id,conference_id,division,final_ranking,postseason_result")
    .eq("season", SEASON);
  if (error) throw new Error(`Could not load live team records: ${error.message}`);
  if (!teamSeasons?.length) {
    throw new Error("The 2026 team-season setup is missing; rerun the 2026 setup import");
  }
  const rows = (teamSeasons ?? []).map((row) => ({
    ...row,
    ...(records.get(row.team_id) ?? { wins: 0, losses: 0, ties: 0 }),
  }));
  await upsertRows(supabase, "team_seasons", rows, "season,team_id");
};

const syncBoxscores = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  gameIds: Set<number>,
  idByName: Map<string, number>,
) => {
  const params = currentPeriodParams(period);
  const [teamData, playerData] = await Promise.all([
    fetchCfbd("/games/teams", apiKey, calls, params),
    fetchCfbd("/games/players", apiKey, calls, params),
  ]);
  const teamStats = new Map<string, JsonObject>();
  for (const value of teamData) {
    const game = asObject(value, "team game statistics");
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    for (const rawSide of Array.isArray(game.teams) ? game.teams : []) {
      const side = asObject(rawSide, "team game statistics");
      const teamId = teamIdFor(side.teamId ?? side.team_id ?? side.team, idByName);
      if (teamId === null) continue;
      const key = `${gameId}:${teamId}`;
      const row = teamStats.get(key) ??
        { game_id: gameId, team_id: teamId, stats: {} };
      for (const rawStat of Array.isArray(side.stats) ? side.stats : []) {
        const stat = asObject(rawStat, "team game statistic");
        const category = optionalString(stat.category);
        const name = optionalString(stat.stat);
        if (category && name) {
          (row.stats as JsonObject)[`${category}_${name}`] = stat.stat;
        }
      }
      teamStats.set(key, row);
    }
  }
  const playerStats = new Map<string, JsonObject>();
  for (const value of playerData) {
    const game = asObject(value, "player game statistics");
    const gameId = integerValue(game.id);
    if (gameId === null || !gameIds.has(gameId)) continue;
    for (const rawSide of Array.isArray(game.teams) ? game.teams : []) {
      const side = asObject(rawSide, "player game team statistics");
      const teamId = teamIdFor(side.teamId ?? side.team_id ?? side.team, idByName);
      if (teamId === null) continue;
      for (
        const rawCategory of Array.isArray(side.categories) ? side.categories : []
      ) {
        const categoryRecord = asObject(rawCategory, "player game category");
        const category = optionalString(categoryRecord.name);
        if (!category) continue;
        for (
          const rawType of Array.isArray(categoryRecord.types)
            ? categoryRecord.types
            : []
        ) {
          const type = asObject(rawType, "player game statistic type");
          const stat = optionalString(type.name);
          if (!stat) continue;
          for (
            const rawAthlete of Array.isArray(type.athletes) ? type.athletes : []
          ) {
            const athlete = asObject(rawAthlete, "player game statistic");
            const playerName = optionalString(athlete.name);
            if (!playerName) continue;
            const playerId = identifier(athlete.id) ??
              `${teamId}:${slugify(playerName)}`;
            const key = `${gameId}:${playerId}:${teamId}:${category}`;
            const row = playerStats.get(key) ?? {
              game_id: gameId,
              player_id: playerId,
              player_name: playerName,
              team_id: teamId,
              category,
              stats: {},
            };
            (row.stats as JsonObject)[stat] = athlete.stat ?? null;
            playerStats.set(key, row);
          }
        }
      }
    }
  }
  const teamCount = await upsertRows(
    supabase,
    "game_team_stats",
    [...teamStats.values()],
    "game_id,team_id",
  );
  const playerCount = await upsertRows(
    supabase,
    "game_player_stats",
    [...playerStats.values()],
    "game_id,player_id,team_id,category",
  );
  return { game_team_stats: teamCount, game_player_stats: playerCount };
};

const syncPolls = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  idByName: Map<string, number>,
) => {
  const rankings = await fetchCfbd("/rankings", apiKey, calls);
  const pollsByTeam = new Map<string, JsonObject>();
  for (const value of rankings) {
    const item = asObject(value, "ranking week");
    const week = integerValue(item.week);
    if (week === null) continue;
    for (const rawPoll of Array.isArray(item.polls) ? item.polls : []) {
      const poll = asObject(rawPoll, "poll");
      const pollName = optionalString(poll.poll) ?? "";
      const source = /ap/i.test(pollName)
        ? "AP"
        : /coaches/i.test(pollName)
        ? "Coaches"
        : /cfp|selection committee|college football playoff/i.test(pollName)
        ? "CFP"
        : null;
      if (!source) continue;
      for (const rawRank of Array.isArray(poll.ranks) ? poll.ranks : []) {
        const rank = asObject(rawRank, "poll rank");
        const teamId = teamIdFor(rank.teamId ?? rank.school, idByName);
        const place = integerValue(rank.rank);
        if (teamId === null || place === null) continue;
        pollsByTeam.set(`${week}:${source}:${teamId}`, {
          season: SEASON,
          week,
          source,
          rank: place,
          team_id: teamId,
          points: integerValue(rank.points),
          first_place_votes: integerValue(rank.firstPlaceVotes),
        });
      }
    }
  }
  return await upsertRows(
    supabase,
    "polls",
    [...pollsByTeam.values()],
    "season,week,source,team_id",
  );
};

const syncSeasonStats = async (
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
  idByName: Map<string, number>,
  fbsIds: Set<number>,
) => {
  const [playerData, teamData] = await Promise.all([
    fetchCfbd("/stats/player/season", apiKey, calls),
    fetchCfbd("/stats/season", apiKey, calls),
  ]);
  const players = new Map<string, JsonObject>();
  for (const value of playerData) {
    const item = asObject(value, "player season statistic");
    const playerId = identifier(item.playerId) ?? identifier(item.athleteId);
    const playerName = optionalString(item.player) ??
      optionalString(item.playerName) ?? optionalString(item.athlete);
    const category = optionalString(item.category);
    const stat = optionalString(item.statName) ?? optionalString(item.stat);
    const teamId = teamIdFor(item.teamId ?? item.team, idByName);
    if (!playerId || !playerName || !category || !stat || !teamId || !fbsIds.has(teamId)) {
      continue;
    }
    const key = `${playerId}:${category}`;
    const row = players.get(key) ?? {
      season: SEASON,
      player_id: playerId,
      player_name: playerName,
      team_id: teamId,
      category,
      stats: {},
    };
    (row.stats as JsonObject)[stat] = item.statValue ?? item.value ?? null;
    players.set(key, row);
  }
  const teams = new Map<number, JsonObject>();
  for (const value of teamData) {
    const item = asObject(value, "team season statistic");
    const teamId = teamIdFor(item.teamId ?? item.team, idByName);
    const stat = optionalString(item.statName) ?? optionalString(item.stat);
    if (teamId === null || !fbsIds.has(teamId) || !stat) continue;
    const row = teams.get(teamId) ?? {
      season: SEASON,
      team_id: teamId,
      category: "season",
      stats: {},
      national_ranks: {},
    };
    (row.stats as JsonObject)[stat] = item.statValue ?? item.value ?? null;
    const rank = integerValue(item.ranking ?? item.rank);
    if (rank !== null) (row.national_ranks as JsonObject)[stat] = rank;
    teams.set(teamId, row);
  }
  const playerCount = await upsertRows(
    supabase,
    "player_season_stats",
    [...players.values()],
    "season,player_id,category",
  );
  const teamCount = await upsertRows(
    supabase,
    "team_season_stats",
    [...teams.values()],
    "season,team_id,category",
  );
  return {
    player_season_stats: playerCount,
    team_season_stats: teamCount,
  };
};

const metricValue = (stats: JsonObject, names: string[]) => {
  const targets = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [name, value] of Object.entries(stats)) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (targets.has(normalized)) {
      if (
        typeof value === "string" &&
        value.includes("/") &&
        targets.has("attempts") &&
        ["catt", "completionsattempts"].includes(normalized)
      ) {
        return numberValue(value.split("/").at(-1)) ?? 0;
      }
      return numberValue(value) ?? 0;
    }
  }
  return 0;
};

const loadPlayerStats = async (
  supabase: ReturnType<typeof createClient>,
  gameIds?: number[],
) => {
  const rows: Array<{
    game_id: number;
    player_id: string;
    player_name: string;
    team_id: number;
    category: string;
    stats: unknown;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from("game_player_stats")
      .select("game_id,player_id,player_name,team_id,category,stats")
      .order("game_id")
      .range(offset, offset + 999);
    if (gameIds) query = query.in("game_id", gameIds);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load player box scores: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

const syncWeeklyAwards = async (
  supabase: ReturnType<typeof createClient>,
  week: number,
  gameIds: number[],
  fbsIds: Set<number>,
) => {
  if (!gameIds.length) return 0;
  const { data: games, error: gamesError } = await supabase.from("games")
    .select("id,home_team_id,away_team_id,home_points,away_points")
    .in("id", gameIds)
    .not("home_points", "is", null)
    .not("away_points", "is", null);
  if (gamesError) throw new Error(`Could not load results for weekly awards: ${gamesError.message}`);
  const completed = games ?? [];
  if (!completed.length) return 0;
  const completedIds = completed.map((game) => game.id);
  const [{ data: lines, error: linesError }, playerRows] = await Promise.all([
    supabase.from("lines").select("game_id,consensus_spread").in("game_id", completedIds),
    loadPlayerStats(supabase, completedIds),
  ]);
  if (linesError) throw new Error(`Could not load closing lines for weekly awards: ${linesError.message}`);
  const lineByGame = new Map((lines ?? []).map((line) => [
    line.game_id,
    numberValue(line.consensus_spread),
  ]));
  const playerRowsByGame = new Map<number, typeof playerRows>();
  for (const player of playerRows) {
    const rows = playerRowsByGame.get(player.game_id) ?? [];
    rows.push(player);
    playerRowsByGame.set(player.game_id, rows);
  }
  const results = completed.map((game) => ({
    ...game,
    margin: Math.abs(game.home_points - game.away_points),
  }));
  const fbsResults = results.filter((game) =>
    fbsIds.has(game.home_team_id) && fbsIds.has(game.away_team_id)
  );
  const underdogWins = results.filter((game) => {
    const spread = lineByGame.get(game.id);
    return spread !== null && spread !== undefined &&
      game.home_points !== game.away_points &&
      ((spread > 0 && game.away_points > game.home_points) ||
        (spread < 0 && game.home_points > game.away_points));
  }).sort((first, second) =>
    Math.abs(lineByGame.get(second.id) ?? 0) -
    Math.abs(lineByGame.get(first.id) ?? 0)
  );
  const closest = [...fbsResults].sort((first, second) => first.margin - second.margin)[0];
  const blowout = [...fbsResults].sort((first, second) => second.margin - first.margin)[0];
  const awards: JsonObject[] = [];
  if (underdogWins[0]) {
    awards.push({
      season: SEASON,
      week,
      award_type: "upset",
      game_id: underdogWins[0].id,
      details: { consensus_spread: lineByGame.get(underdogWins[0].id) },
    });
  }
  if (closest) {
    awards.push({
      season: SEASON,
      week,
      award_type: "game",
      game_id: closest.id,
      details: { margin: closest.margin },
    });
  }
  if (blowout) {
    awards.push({
      season: SEASON,
      week,
      award_type: "blowout",
      game_id: blowout.id,
      details: { margin: blowout.margin },
    });
  }
  let performance: { player: typeof playerRows[number]; score: number } | null = null;
  for (const game of completed) {
    for (const player of playerRowsByGame.get(game.id) ?? []) {
      if (!fbsIds.has(player.team_id)) continue;
      const stats = jsonObject(player.stats);
      const category = player.category.toLowerCase();
      const yards = metricValue(stats, ["yards", "yds"]);
      const touchdowns = metricValue(stats, ["touchdowns", "td"]);
      const interceptions = metricValue(stats, ["interceptions", "int"]);
      const attempts = metricValue(stats, ["attempts", "att"]);
      const score = /pass/.test(category)
        ? yards / 25 + touchdowns * 4 - interceptions * 2 +
          metricValue(stats, ["rushingyards", "rushyds"]) / 10
        : yards / 10 + touchdowns * 6 + attempts * 0.1;
      if (!performance || score > performance.score) performance = { player, score };
    }
  }
  if (performance && performance.score > 0) {
    awards.push({
      season: SEASON,
      week,
      award_type: "performance",
      game_id: performance.player.game_id,
      player_id: performance.player.player_id,
      details: {
        player_name: performance.player.player_name,
        team_id: performance.player.team_id,
        score: Number(performance.score.toFixed(2)),
      },
    });
  }
  return await upsertRows(
    supabase,
    "weekly_awards",
    awards,
    "season,week,award_type",
  );
};

const syncHeismanTracker = async (
  supabase: ReturnType<typeof createClient>,
  week: number,
  saveWeeklyHistory: boolean,
) => {
  const playerRows: Array<{
    player_id: string;
    player_name: string;
    team_id: number | null;
    category: string;
    stats: unknown;
  }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("player_season_stats")
      .select("player_id,player_name,team_id,category,stats")
      .eq("season", SEASON)
      .order("player_id")
      .range(offset, offset + 999);
    if (error) throw new Error(`Could not load Heisman season statistics: ${error.message}`);
    playerRows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const [{ data: teamSeasons, error: teamError }, { data: polls, error: pollsError }] =
    await Promise.all([
      supabase.from("team_seasons")
        .select("team_id,wins,losses,ties")
        .eq("season", SEASON),
      supabase.from("polls")
        .select("week,team_id,rank")
        .eq("season", SEASON)
        .eq("source", "AP")
        .lte("week", week)
        .order("week"),
    ]);
  if (teamError) throw new Error(`Could not load team records for Heisman scoring: ${teamError.message}`);
  if (pollsError) throw new Error(`Could not load AP polls for Heisman scoring: ${pollsError.message}`);
  if (!playerRows.length) return { heisman_tracker: 0, heisman_weekly: 0 };

  const playerStats = new Map<string, {
    player_id: string;
    player_name: string;
    team_id: number;
    passing: JsonObject;
    rushing: JsonObject;
    receiving: JsonObject;
  }>();
  for (const row of playerRows) {
    if (row.team_id === null) continue;
    const player = playerStats.get(row.player_id) ?? {
      player_id: row.player_id,
      player_name: row.player_name,
      team_id: row.team_id,
      passing: {},
      rushing: {},
      receiving: {},
    };
    const category = row.category.toLowerCase();
    const target = category.includes("pass")
      ? player.passing
      : category.includes("rush")
      ? player.rushing
      : category.includes("receiv")
      ? player.receiving
      : null;
    if (target) {
      for (const [name, value] of Object.entries(jsonObject(row.stats))) {
        target[name] = (numberValue(target[name]) ?? 0) + (numberValue(value) ?? 0);
      }
    }
    playerStats.set(row.player_id, player);
  }

  const teamRecord = new Map((teamSeasons ?? []).map((record) => [
    record.team_id,
    {
      wins: record.wins,
      games: record.wins + record.losses + record.ties,
    },
  ]));
  const latestApRank = new Map<number, number>();
  for (const poll of polls ?? []) latestApRank.set(poll.team_id, poll.rank);
  const candidates = [...playerStats.values()].map((player) => {
    const passYards = metricValue(player.passing, ["yards", "yds", "passingyards"]);
    const passAttempts = metricValue(player.passing, ["attempts", "att", "passingattempts"]);
    const passTd = metricValue(player.passing, ["td", "touchdowns", "passingtouchdowns"]);
    const interceptions = metricValue(player.passing, ["int", "interceptions"]);
    const rushYards = metricValue(player.rushing, ["yards", "yds", "rushingyards"]);
    const rushAttempts = metricValue(player.rushing, ["attempts", "att", "carries"]);
    const rushTd = metricValue(player.rushing, ["td", "touchdowns", "rushingtouchdowns"]);
    const receiveYards = metricValue(player.receiving, ["yards", "yds", "receivingyards"]);
    const receptions = metricValue(player.receiving, ["receptions", "rec", "catches"]);
    const receiveTd = metricValue(player.receiving, ["td", "touchdowns", "receivingtouchdowns"]);
    const quarterback = passAttempts > 0;
    const receiver = !quarterback && receiveYards + receptions > rushYards;
    const yards = quarterback ? passYards : receiver ? receiveYards : rushYards;
    const touchdowns = quarterback ? passTd : receiver ? receiveTd : rushTd;
    const attempts = quarterback ? passAttempts : receiver ? receptions : rushAttempts;
    const record = teamRecord.get(player.team_id) ?? { wins: 0, games: 0 };
    const teamSuccess = Math.min(
      1,
      (record.games ? record.wins / record.games : 0) * 0.8 +
        (latestApRank.has(player.team_id)
          ? Math.max(0, 26 - latestApRank.get(player.team_id)!) / 25
          : 0) * 0.2,
    );
    return {
      ...player,
      position: quarterback ? "QB" : receiver ? "WR" : "RB",
      yards,
      touchdowns,
      efficiency: attempts ? yards / attempts : 0,
      turnovers: interceptions +
        metricValue(player.rushing, ["fum", "fumbles", "lostfum", "lostfumbles"]),
      teamSuccess,
    };
  }).filter((player) => player.yards > 0 || player.touchdowns > 0);
  const byPosition = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = byPosition.get(candidate.position) ?? [];
    group.push(candidate);
    byPosition.set(candidate.position, group);
  }
  const scores = candidates.map((candidate) => {
    const peers = byPosition.get(candidate.position) ?? [];
    const percentile = (field: "yards" | "touchdowns" | "efficiency" | "turnovers") => {
      if (peers.length <= 1) return 1;
      const higherIsBetter = field !== "turnovers";
      const lowerPeers = peers.filter((peer) =>
        higherIsBetter ? peer[field] < candidate[field] : peer[field] > candidate[field]
      ).length;
      const tiedPeers = peers.filter((peer) => peer[field] === candidate[field]).length;
      return Math.min(1, (lowerPeers + Math.max(0, tiedPeers - 1) / 2) / (peers.length - 1));
    };
    const production = (
      percentile("yards") + percentile("touchdowns") +
      percentile("efficiency") + percentile("turnovers")
    ) / 4;
    return {
      season: SEASON,
      player_id: candidate.player_id,
      player_name: candidate.player_name,
      team_id: candidate.team_id,
      score: Number((0.7 * production + 0.3 * candidate.teamSuccess).toFixed(6)),
    };
  }).sort((first, second) =>
    second.score - first.score ||
    first.player_name.localeCompare(second.player_name)
  );
  const trackerRows = scores.map((player, index) => ({ ...player, rank: index + 1 }));
  const trackerCount = await upsertRows(
    supabase,
    "heisman_tracker",
    trackerRows,
    "season,player_id",
  );
  let weeklyCount = 0;
  if (saveWeeklyHistory && trackerRows.length) {
    const { data: existing, error } = await supabase.from("heisman_weekly")
      .select("player_id")
      .eq("season", SEASON)
      .eq("week", week)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Could not check existing weekly Heisman field: ${error.message}`);
    if (!existing) {
      weeklyCount = await upsertRows(
        supabase,
        "heisman_weekly",
        trackerRows.slice(0, 10).map((player, index) => ({
          season: SEASON,
          week,
          player_id: player.player_id,
          player_name: player.player_name,
          team_id: player.team_id,
          score: player.score,
          rank: index + 1,
        })),
        "season,week,player_id",
      );
    }
  }
  return { heisman_tracker: trackerCount, heisman_weekly: weeklyCount };
};

const executeJob = async (
  job: Job,
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  calls: CallCounter,
) => {
  const period = await getCurrentPeriod(supabase);
  if (job === "bootstrap") {
    const { idByName, fbsIds } = await loadTeamLookups(supabase);
    const periods = await getPeriodsThroughCurrent(supabase, period);
    const weeks: JsonObject[] = [];
    for (const weeklyPeriod of periods) {
      const { rows, count } = await syncGames(
        supabase,
        apiKey,
        calls,
        weeklyPeriod,
        fbsIds,
        idByName,
      );
      const gameIds = new Set(rows.map((game) => game.id));
      const lines = await syncLines(
        supabase,
        apiKey,
        calls,
        weeklyPeriod,
        gameIds,
      );
      const boxscores = await syncBoxscores(
        supabase,
        apiKey,
        calls,
        weeklyPeriod,
        gameIds,
        idByName,
      );
      const weeklyAwards = await syncWeeklyAwards(
        supabase,
        weeklyPeriod.week,
        [...gameIds],
        fbsIds,
      );
      weeks.push({
        week: weeklyPeriod.week,
        season_type: weeklyPeriod.seasonType,
        games: count,
        lines,
        ...boxscores,
        weekly_awards: weeklyAwards,
      });
    }
    const polls = await syncPolls(supabase, apiKey, calls, idByName);
    const stats = await syncSeasonStats(
      supabase,
      apiKey,
      calls,
      idByName,
      fbsIds,
    );
    const heisman = await syncHeismanTracker(
      supabase,
      period.week,
      false,
    );
    return { weeks, polls, ...stats, ...heisman };
  }
  if (job !== "manual") {
    const now = Date.now();
    if (
      period.startDate &&
      Date.parse(period.startDate) - now > 7 * 24 * 60 * 60 * 1000
    ) {
      return {
        skipped: "outside the active 2026 season window",
        week: period.week,
        season_type: period.seasonType,
      };
    }
    if (
      period.endDate &&
      now - Date.parse(period.endDate) > 48 * 60 * 60 * 1000
    ) {
      return {
        skipped: "the 2026 season calendar has ended",
        week: period.week,
        season_type: period.seasonType,
      };
    }
  }
  const { idByName, fbsIds } = await loadTeamLookups(supabase);
  const details: JsonObject = {
    week: period.week,
    season_type: period.seasonType,
  };
  const needsGames = [
    "near-live",
    "daily-results",
    "weekly",
    "monday",
    "winter",
    "manual",
  ].includes(job);
  let gameIds = new Set<number>();
  if (needsGames) {
    const { rows, count } = await syncGames(
      supabase,
      apiKey,
      calls,
      period,
      fbsIds,
      idByName,
    );
    gameIds = new Set(rows.map((game) => game.id));
    details.games = count;
  }

  if (["daily-results", "weekly", "monday", "winter", "manual"].includes(job)) {
    details.lines = await syncLines(
      supabase,
      apiKey,
      calls,
      period,
      gameIds,
    );
  }
  if (["weekly", "manual"].includes(job)) {
    Object.assign(
      details,
      await syncBoxscores(
        supabase,
        apiKey,
        calls,
        period,
        gameIds,
        idByName,
      ),
    );
    details.weekly_awards = await syncWeeklyAwards(
      supabase,
      period.week,
      [...gameIds],
      fbsIds,
    );
  }
  if (["monday", "cfp", "winter", "manual"].includes(job)) {
    details.polls = await syncPolls(supabase, apiKey, calls, idByName);
  }
  if (["monday", "manual"].includes(job)) {
    Object.assign(
      details,
      await syncSeasonStats(supabase, apiKey, calls, idByName, fbsIds),
    );
    Object.assign(
      details,
      await syncHeismanTracker(
        supabase,
        period.week,
        job === "monday",
      ),
    );
  }
  return details;
};

const getStatus = async (supabase: ReturnType<typeof createClient>) => {
  const period = await getCurrentPeriod(supabase);
  const { data, error } = await supabase.from("update_log")
    .select("job,status,started_at,finished_at")
    .like("job", "live-2026-%")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not read live update status: ${error.message}`);
  const now = Date.now();
  const seasonActive = Boolean(
    period.startDate &&
      Date.parse(period.startDate) - now <= 7 * 24 * 60 * 60 * 1000 &&
      period.endDate &&
      now - Date.parse(period.endDate) <= 48 * 60 * 60 * 1000,
  );
  if (!data) {
    return {
      state: seasonActive ? "uninitialized" : "healthy",
      last_updated: null,
      job: null,
      current_week: period.week,
      season_active: seasonActive,
      overdue: seasonActive,
    };
  }
  const lastUpdated = data.finished_at ?? data.started_at;
  const age = lastUpdated ? now - Date.parse(lastUpdated) : Infinity;
  const overdue = seasonActive && age > 26 * 60 * 60 * 1000;
  const staleRun = data.status === "running" && age > 30 * 60 * 1000;
  return {
    state: data.status === "failed"
      ? "failed"
      : data.status === "running" && !staleRun
      ? "running"
      : staleRun
      ? "failed"
      : overdue
      ? "overdue"
      : "healthy",
    last_updated: data.finished_at,
    job: data.job,
    current_week: period.week,
    season_active: seasonActive,
    overdue,
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!["GET", "POST"].includes(request.method)) {
    return response({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: "Required Supabase Edge Function configuration is missing" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (request.method === "GET") {
    try {
      return response(await getStatus(supabase));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read live status";
      console.error("Live status lookup failed:", message);
      return response({ error: message }, 500);
    }
  }

  const apiKey = Deno.env.get("CFBD_API_KEY");
  if (!apiKey) {
    return response({ error: "CFBD_API_KEY is not configured for this Edge Function" }, 500);
  }

  let job: Job;
  let trigger: "manual" | "schedule";
  const schedulerToken = request.headers.get("x-live-scheduler-token");
  if (schedulerToken !== null) {
    const { data: valid, error } = await supabase.rpc(
      "is_live_scheduler_token",
      { candidate: schedulerToken },
    );
    if (error) {
      console.error("Could not validate the scheduler token:", error.message);
      return response({ error: "Scheduler authorization could not be verified" }, 500);
    }
    if (valid !== true) return response({ error: "Unauthorized scheduler request" }, 401);
    trigger = "schedule";
  } else {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return response({ error: "Sign-in is required for manual updates" }, 401);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return response({ error: "The signed-in user could not be verified" }, 401);
    }
    trigger = "manual";
  }

  try {
    const body = asObject(await request.json(), "request");
    if (trigger === "manual") {
      job = "manual";
    } else if (typeof body.job === "string" && JOBS.includes(body.job as Job)) {
      job = body.job as Job;
      if (job === "manual") {
        return response({ error: "The scheduled endpoint cannot request a manual update" }, 400);
      }
    } else {
      return response({ error: `job must be one of: ${JOBS.filter((name) => name !== "manual").join(", ")}` }, 400);
    }
  } catch (error) {
    return response({
      error: error instanceof SyntaxError
        ? "Request body must be valid JSON"
        : error instanceof Error
        ? error.message
        : "Invalid request body",
    }, 400);
  }

  if (trigger === "manual") {
    const { data: allowed, error: throttleError } = await supabase.rpc(
      "claim_live_manual_update",
    );
    if (throttleError) {
      console.error("Could not enforce the manual update cooldown:", throttleError.message);
      return response({ error: "Manual update cooldown could not be checked" }, 500);
    }
    if (allowed !== true) {
      return response({
        error: "Manual updates are limited to once every 15 minutes",
      }, 429);
    }
  }

  if (trigger === "schedule" && !scheduledJobMatchesBerlinTime(job, new Date())) {
    return response({
      status: "skipped",
      job,
      reason: "This UTC schedule slot does not match the Berlin local-time schedule.",
    });
  }

  const { data: log, error: logError } = await supabase.from("update_log")
    .insert({
      job: `live-2026-${job}`,
      trigger,
      status: "running",
    })
    .select("id")
    .single();
  if (logError) {
    console.error("Could not start live update log:", logError.message);
    return response({ error: "Could not start the live update" }, 500);
  }

  const calls: CallCounter = { value: 0, endpoints: [] };
  try {
    const details = await executeJob(job, supabase, apiKey, calls);
    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { job, api_endpoints: calls.endpoints, ...details },
    }).eq("id", log.id);
    if (error) throw new Error(`Could not finish live update log: ${error.message}`);
    return response({
      status: "success",
      season: SEASON,
      job,
      trigger,
      api_calls_used: calls.value,
      ...details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected live update failure";
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { job, api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) {
      console.error("Could not record failed live update:", updateError.message);
    }
    console.error(`2026 live update ${job} failed:`, message);
    return response({
      status: "failed",
      job,
      error: message,
      api_calls_used: calls.value,
      api_endpoints: calls.endpoints,
    }, 500);
  }
});
