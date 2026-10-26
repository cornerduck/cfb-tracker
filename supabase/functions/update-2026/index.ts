import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  asObject,
  type CallCounter,
  fetchCfbd,
  finalApRanks,
  type JsonObject,
  mapCoaches,
  mapGame,
  mapLines,
  mapMedia,
  mapPlayerGameStats,
  mapPlayerSeasonStats,
  mapPolls,
  mapScoreboard,
  mapTeamGameStats,
  mapTeamSeasonStats,
} from "../_shared/cfbd.ts";
import {
  type Db,
  gradePickem,
  loadTeamLookups,
  recomputeHeisman,
  recomputeWeeklyAwards,
  savePolls,
  updateTeamRecords,
  upsertRows,
} from "../_shared/store.ts";
import { updateSeasonSummary } from "../_shared/season.ts";
import { syncGameday } from "../_shared/gameday.ts";
import { syncRecruitingWeekly } from "../_shared/recruiting_sync.ts";

const SEASON = 2026;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-live-scheduler-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

type SeasonPeriod = {
  week: number;
  seasonType: string;
  startDate: string | null;
  endDate: string | null;
};

const loadPeriods = async (supabase: Db) => {
  const { data, error } = await supabase.from("calendar")
    .select("week,season_type,start_date,end_date")
    .eq("season", SEASON)
    .order("start_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Could not load the 2026 calendar: ${error.message}`);
  const periods: SeasonPeriod[] = (data ?? [])
    .filter((row: JsonObject) =>
      ["regular", "postseason"].includes(String(row.season_type)) && typeof row.week === "number"
    )
    .map((row: JsonObject) => ({
      week: row.week as number,
      seasonType: row.season_type as string,
      startDate: row.start_date as string | null,
      endDate: row.end_date as string | null,
    }));
  if (!periods.length) throw new Error("The 2026 calendar is empty; run the 2026 setup import first");
  return periods;
};

// The week the season is in right now: the active week, a week whose last
// kickoff was less than 18 hours ago, or else the next week to start.
const getCurrentPeriod = async (supabase: Db) => {
  const periods = await loadPeriods(supabase);
  const now = Date.now();
  const active = periods.find((period) =>
    period.startDate && period.endDate &&
    Date.parse(period.startDate) <= now && Date.parse(period.endDate) >= now
  );
  if (active) return active;
  const recent = [...periods].reverse().find((period) =>
    period.startDate && Date.parse(period.startDate) <= now &&
    period.endDate && now - Date.parse(period.endDate) <= 18 * 60 * 60 * 1000
  );
  if (recent) return recent;
  return periods.find((period) => period.startDate && Date.parse(period.startDate) >= now) ??
    periods[periods.length - 1];
};

// The most recent week whose games have started (for Sunday box scores).
const getLatestStartedPeriod = async (supabase: Db) => {
  const periods = await loadPeriods(supabase);
  const now = Date.now();
  return [...periods].reverse().find((period) =>
    period.startDate && Date.parse(period.startDate) <= now
  ) ?? null;
};

const periodParams = (period: SeasonPeriod) => ({
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
  if (minute > 5) return false;
  switch (job) {
    case "near-live":
      return (weekday === "Sat" && hour >= 18 && hour <= 22 && hour % 2 === 0) ||
        (weekday === "Sun" && hour <= 8 && hour % 2 === 0);
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

type Lookups = Awaited<ReturnType<typeof loadTeamLookups>>;

const syncGames = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  lookups: Lookups,
  fullSeason = false,
) => {
  // The full season (one call) keeps future games in the schedule; a single
  // week is used for the frequent result refreshes.
  const params = fullSeason ? { seasonType: "both" } : periodParams(period);
  const rows = (await fetchCfbd("/games", apiKey, calls, params, { year: SEASON }))
    .map((game) => mapGame(game, lookups.idByName, SEASON))
    .filter((game): game is NonNullable<typeof game> =>
      game !== null &&
      (lookups.fbsIds.has(game.home_team_id) || lookups.fbsIds.has(game.away_team_id)) &&
      lookups.allIds.has(game.home_team_id) && lookups.allIds.has(game.away_team_id)
    );
  // Keep a live in-progress status written by the scoreboard until the game
  // feed reports the final.
  const { data: existing, error } = await supabase.from("games")
    .select("id,status").eq("season", SEASON).eq("status", "in_progress");
  if (error) throw new Error(`Could not read stored games: ${error.message}`);
  const live = new Set((existing ?? []).filter((game: JsonObject) => game.status === "in_progress")
    .map((game: JsonObject) => game.id));
  const merged = rows.map((game) =>
    live.has(game.id) && game.status === "scheduled" ? { ...game, status: "in_progress" } : game
  );
  const count = await upsertRows(supabase, "games", merged, "id");
  return { rows: merged, count };
};

const syncLines = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  gameIds: Set<number>,
) => {
  const lineData = await fetchCfbd("/lines", apiKey, calls, periodParams(period), { year: SEASON });
  return await upsertRows(supabase, "lines", mapLines(lineData, gameIds), "game_id");
};

const syncMedia = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  gameIds: Set<number>,
) => {
  const media = mapMedia(
    await fetchCfbd("/games/media", apiKey, calls, periodParams(period), { year: SEASON }),
  );
  let updated = 0;
  for (const [id, outlet] of media) {
    if (!gameIds.has(id)) continue;
    const { error } = await supabase.from("games").update({ tv: outlet }).eq("id", id);
    if (error) throw new Error(`Could not save TV outlets: ${error.message}`);
    updated += 1;
  }
  return updated;
};

const syncBoxscores = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  gameIds: Set<number>,
  lookups: Lookups,
) => {
  const params = periodParams(period);
  const [teamData, playerData] = await Promise.all([
    fetchCfbd("/games/teams", apiKey, calls, params, { year: SEASON }),
    fetchCfbd("/games/players", apiKey, calls, params, { year: SEASON }),
  ]);
  const teamRows = mapTeamGameStats(teamData, gameIds, lookups.idByName)
    .filter((row) => lookups.allIds.has(row.team_id));
  const playerRows = mapPlayerGameStats(playerData, gameIds, lookups.idByName)
    .filter((row) => lookups.allIds.has(row.team_id));
  return {
    game_team_stats: await upsertRows(supabase, "game_team_stats", teamRows, "game_id,team_id"),
    game_player_stats: await upsertRows(
      supabase,
      "game_player_stats",
      playerRows,
      "game_id,player_id,team_id,category",
    ),
  };
};

// Near-live scores from the scoreboard (one call). Falls back to the game
// feed if the scoreboard is unavailable for this API key.
const syncScoreboard = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  period: SeasonPeriod,
  lookups: Lookups,
) => {
  let updates;
  try {
    updates = mapScoreboard(
      await fetchCfbd("/scoreboard", apiKey, calls, { classification: "fbs" }, { year: null }),
    );
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 401 && status !== 403 && status !== 404) throw error;
    const { count } = await syncGames(supabase, apiKey, calls, period, lookups);
    return { source: "games", games: count };
  }
  const ids = updates.map((update) => update.id);
  const { data: stored, error } = await supabase.from("games")
    .select("id,status,home_points,away_points,clock,period,tv").in("id", ids);
  if (error) throw new Error(`Could not read stored games: ${error.message}`);
  const byId = new Map((stored ?? []).map((game: JsonObject) => [game.id, game]));
  let changed = 0;
  for (const update of updates) {
    const current = byId.get(update.id) as JsonObject | undefined;
    if (!current) continue;
    const patch: JsonObject = {
      status: update.status,
      period: update.status === "in_progress" ? update.period : null,
      clock: update.status === "in_progress" ? update.clock : null,
    };
    if (update.status !== "scheduled") {
      patch.home_points = update.home_points;
      patch.away_points = update.away_points;
      if (update.home_line_scores) patch.home_line_scores = update.home_line_scores;
      if (update.away_line_scores) patch.away_line_scores = update.away_line_scores;
    }
    if (update.tv && !current.tv) patch.tv = update.tv;
    const differs = Object.entries(patch).some(([key, value]) =>
      JSON.stringify(current[key] ?? null) !== JSON.stringify(value ?? null)
    );
    if (!differs) continue;
    const { error: updateError } = await supabase.from("games").update(patch).eq("id", update.id);
    if (updateError) throw new Error(`Could not save live scores: ${updateError.message}`);
    changed += 1;
  }
  return { source: "scoreboard", games: changed };
};

const syncPolls = async (supabase: Db, apiKey: string, calls: CallCounter, lookups: Lookups) => {
  const polls = mapPolls(
    await fetchCfbd("/rankings", apiKey, calls, {}, { year: SEASON }),
    lookups.idByName,
    SEASON,
  ).filter((poll) => lookups.allIds.has(Number(poll.team_id)));
  return await savePolls(supabase, SEASON, polls, finalApRanks(polls));
};

const syncSeasonStats = async (
  supabase: Db,
  apiKey: string,
  calls: CallCounter,
  lookups: Lookups,
) => {
  const [playerData, teamData] = await Promise.all([
    fetchCfbd("/stats/player/season", apiKey, calls, {}, { year: SEASON }),
    fetchCfbd("/stats/season", apiKey, calls, {}, { year: SEASON }),
  ]);
  const players = mapPlayerSeasonStats(playerData, lookups.idByName, SEASON, lookups.fbsIds);
  const teams = mapTeamSeasonStats(teamData, lookups.idByName, SEASON, lookups.fbsIds);
  if (!players.length && playerData.length) {
    throw new Error("CFBD player season statistics could not be read");
  }
  return {
    player_season_stats: await upsertRows(
      supabase,
      "player_season_stats",
      players,
      "season,player_id,category",
    ),
    team_season_stats: await upsertRows(supabase, "team_season_stats", teams, "season,team_id,category"),
  };
};

const syncCoaches = async (supabase: Db, apiKey: string, calls: CallCounter, lookups: Lookups) => {
  const coaches = mapCoaches(
    await fetchCfbd("/coaches", apiKey, calls, {}, { year: SEASON }),
    lookups.idByName,
    SEASON,
    lookups.fbsIds,
  );
  return await upsertRows(supabase, "coaches", coaches, "season,team_id");
};

// Games of a period that are final but have no stored box score yet.
const completedWithoutBoxscore = async (supabase: Db, gameIds: number[]) => {
  if (!gameIds.length) return [];
  const { data: games, error } = await supabase.from("games")
    .select("id").in("id", gameIds).eq("status", "final");
  if (error) throw new Error(`Could not read completed games: ${error.message}`);
  const finals = (games ?? []).map((game: JsonObject) => Number(game.id));
  if (!finals.length) return [];
  const { data: stats, error: statsError } = await supabase.from("game_team_stats")
    .select("game_id").in("game_id", finals);
  if (statsError) throw new Error(`Could not read stored box scores: ${statsError.message}`);
  const have = new Set((stats ?? []).map((row: JsonObject) => Number(row.game_id)));
  return finals.filter((id: number) => !have.has(id));
};

const executeJob = async (job: Job, supabase: Db, apiKey: string, calls: CallCounter) => {
  const period = await getCurrentPeriod(supabase);
  const lookups = await loadTeamLookups(supabase);
  if (!lookups.fbsIds.size) throw new Error("No FBS teams are stored; run the 2026 setup import first");
  const details: JsonObject = { week: period.week, season_type: period.seasonType };
  // The class that is recruited now and the current transfer portal come from CFBD every Monday.
  // A failure is reported in the details and never fails the job.
  const withRecruiting = async (target: JsonObject) => {
    if (job !== "monday" && job !== "manual") return target;
    try {
      Object.assign(target, await syncRecruitingWeekly(supabase, apiKey, calls));
    } catch (error) {
      target.recruiting_error = error instanceof Error ? error.message : "Recruiting update failed";
      console.error("Recruiting update failed:", target.recruiting_error);
    }
    return target;
  };

  if (job === "bootstrap") {
    const periods = (await loadPeriods(supabase)).filter((item) =>
      !item.startDate || Date.parse(item.startDate) <= Date.now() ||
      (item.week === period.week && item.seasonType === period.seasonType)
    );
    const weeks: JsonObject[] = [];
    for (const item of periods) {
      const { rows, count } = await syncGames(supabase, apiKey, calls, item, lookups);
      const gameIds = new Set(rows.map((game) => game.id));
      const entry: JsonObject = { week: item.week, season_type: item.seasonType, games: count };
      entry.lines = await syncLines(supabase, apiKey, calls, item, gameIds);
      entry.tv = await syncMedia(supabase, apiKey, calls, item, gameIds);
      if (rows.some((game) => game.status === "final")) {
        Object.assign(entry, await syncBoxscores(supabase, apiKey, calls, item, gameIds, lookups));
      }
      weeks.push(entry);
    }
    details.weeks = weeks;
    details.schedule = (await syncGames(supabase, apiKey, calls, period, lookups, true)).count;
    details.team_records = await updateTeamRecords(supabase, SEASON, lookups.fbsIds);
    details.pickem_graded = await gradePickem(supabase);
    details.polls = await syncPolls(supabase, apiKey, calls, lookups);
    Object.assign(details, await syncSeasonStats(supabase, apiKey, calls, lookups));
    details.coaches = await syncCoaches(supabase, apiKey, calls, lookups);
    details.weekly_awards = await recomputeWeeklyAwards(supabase, SEASON, lookups.fbsIds);
    Object.assign(details, await recomputeHeisman(supabase, SEASON));
    Object.assign(details, await updateSeasonSummary(supabase, SEASON));
    return details;
  }

  if (job !== "manual") {
    const now = Date.now();
    // Recruiting runs all year, so the Monday job still updates it outside the season.
    const skipped = (reason: string) => withRecruiting({ ...details, skipped: reason });
    if (period.startDate && Date.parse(period.startDate) - now > 7 * 24 * 60 * 60 * 1000) {
      return await skipped("outside the active 2026 season window");
    }
    if (period.endDate && now - Date.parse(period.endDate) > 48 * 60 * 60 * 1000) {
      return await skipped("the 2026 season calendar has ended");
    }
  }

  if (job === "near-live") {
    Object.assign(details, await syncScoreboard(supabase, apiKey, calls, period, lookups));
    details.team_records = await updateTeamRecords(supabase, SEASON, lookups.fbsIds);
    details.pickem_graded = await gradePickem(supabase);
    return details;
  }

  if (job === "cfp") {
    details.polls = await syncPolls(supabase, apiKey, calls, lookups);
    return details;
  }

  // Sunday: the week that was just played (the calendar may already point at
  // the next week once the last kickoff is more than 18 hours old).
  const resultsPeriod = job === "weekly"
    ? await getLatestStartedPeriod(supabase) ?? period
    : period;
  if (job === "weekly") {
    details.week = resultsPeriod.week;
    details.season_type = resultsPeriod.seasonType;
  }

  const fullSeason = job === "monday" || job === "manual";
  const { rows, count } = await syncGames(supabase, apiKey, calls, resultsPeriod, lookups, fullSeason);
  const gameIds = new Set(rows.map((game) => game.id));
  details.games = count;
  details.lines = await syncLines(supabase, apiKey, calls, resultsPeriod, gameIds);

  if (["weekly", "monday", "manual"].includes(job)) {
    details.tv = await syncMedia(supabase, apiKey, calls, resultsPeriod, gameIds);
  }
  const needsBoxscores = job === "weekly" || job === "manual" ||
    (job === "winter" && (await completedWithoutBoxscore(supabase, [...gameIds])).length > 0);
  if (needsBoxscores && rows.some((game) => game.status === "final")) {
    Object.assign(
      details,
      await syncBoxscores(supabase, apiKey, calls, resultsPeriod, gameIds, lookups),
    );
  }
  details.team_records = await updateTeamRecords(supabase, SEASON, lookups.fbsIds);
  details.pickem_graded = await gradePickem(supabase);

  if (["weekly", "winter"].includes(job) && needsBoxscores) {
    details.weekly_awards = await recomputeWeeklyAwards(supabase, SEASON, lookups.fbsIds, [
      { week: resultsPeriod.week, seasonType: resultsPeriod.seasonType },
    ]);
  }
  if (["monday", "winter", "manual"].includes(job)) {
    details.polls = await syncPolls(supabase, apiKey, calls, lookups);
  }
  if (["monday", "manual"].includes(job)) {
    Object.assign(details, await syncSeasonStats(supabase, apiKey, calls, lookups));
    details.coaches = await syncCoaches(supabase, apiKey, calls, lookups);
    Object.assign(details, await recomputeHeisman(supabase, SEASON));
  }
  if (job === "manual") {
    details.weekly_awards = await recomputeWeeklyAwards(supabase, SEASON, lookups.fbsIds);
  }
  // GameDay comes from Wikipedia, not CFBD; a failure never fails the job.
  if (["weekly", "monday", "manual"].includes(job)) {
    try {
      Object.assign(details, await syncGameday(supabase));
    } catch (error) {
      details.gameday_error = error instanceof Error ? error.message : "GameDay update failed";
      console.error("GameDay update failed:", details.gameday_error);
    }
  }
  await withRecruiting(details);
  Object.assign(details, await updateSeasonSummary(supabase, SEASON));
  return details;
};

const getStatus = async (supabase: Db) => {
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
    period.startDate && Date.parse(period.startDate) - now <= 7 * 24 * 60 * 60 * 1000 &&
      period.endDate && now - Date.parse(period.endDate) <= 48 * 60 * 60 * 1000,
  );
  if (!data) {
    return {
      state: seasonActive ? "uninitialized" : "healthy",
      last_updated: null,
      job: null,
      current_week: period.week,
      season_type: period.seasonType,
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
    season_type: period.seasonType,
    season_active: seasonActive,
    overdue,
  };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (!["GET", "POST"].includes(request.method)) return response({ error: "Method not allowed" }, 405);

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
  if (!apiKey) return response({ error: "CFBD_API_KEY is not configured for this Edge Function" }, 500);

  let job: Job;
  let trigger: "manual" | "schedule";
  const schedulerToken = request.headers.get("x-live-scheduler-token");
  if (schedulerToken !== null) {
    const { data: valid, error } = await supabase.rpc("is_live_scheduler_token", {
      candidate: schedulerToken,
    });
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
    if (error || !data.user) return response({ error: "The signed-in user could not be verified" }, 401);
    trigger = "manual";
  }

  try {
    const body = asObject(await request.json().catch(() => ({})), "request");
    if (trigger === "manual") {
      job = "manual";
    } else if (typeof body.job === "string" && JOBS.includes(body.job as Job) && body.job !== "manual") {
      job = body.job as Job;
    } else {
      return response({
        error: `job must be one of: ${JOBS.filter((name) => name !== "manual").join(", ")}`,
      }, 400);
    }
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Invalid request body" }, 400);
  }

  if (trigger === "manual") {
    const { data: allowed, error: throttleError } = await supabase.rpc("claim_live_manual_update");
    if (throttleError) {
      console.error("Could not enforce the manual update cooldown:", throttleError.message);
      return response({ error: "Manual update cooldown could not be checked" }, 500);
    }
    if (allowed !== true) {
      return response({ error: "Manual updates are limited to once every 15 minutes" }, 429);
    }
  }

  if (trigger === "schedule" && job !== "bootstrap" && !scheduledJobMatchesBerlinTime(job, new Date())) {
    return response({
      status: "skipped",
      job,
      reason: "This UTC schedule slot does not match the Berlin local-time schedule.",
    });
  }

  const { data: log, error: logError } = await supabase.from("update_log")
    .insert({ job: `live-2026-${job}`, trigger, status: "running" })
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
    return response({ status: "success", season: SEASON, job, trigger, api_calls_used: calls.value, ...details });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected live update failure";
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { job, api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) console.error("Could not record failed live update:", updateError.message);
    console.error(`2026 live update ${job} failed:`, message);
    return response({ status: "failed", job, error: message, api_calls_used: calls.value }, 500);
  }
});
