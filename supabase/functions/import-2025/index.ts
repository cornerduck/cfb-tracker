// Resumable import of a completed season (2025 by default). The manual
// Supabase workflow runs one stage per call; every stage logs its CFBD calls.
// Earlier seasons can be imported with the same stages by passing "season".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import {
  asObject,
  type CallCounter,
  fetchCfbd,
  finalApRanks,
  integerValue,
  type JsonObject,
  mapCoaches,
  mapGame,
  mapLines,
  mapMedia,
  mapPlayerGameStats,
  mapPlayerSeasonStats,
  mapPolls,
  mapTeam,
  mapTeamGameStats,
  mapTeamSeasonStats,
  normalizeName,
  optionalString,
  slugify,
  teamIdFor,
} from "../_shared/cfbd.ts";
import {
  type Db,
  loadAll,
  loadTeamLookups,
  recomputeHeisman,
  recomputeWeeklyAwards,
  savePolls,
  updateTeamRecords,
  upsertRows,
} from "../_shared/store.ts";
import { updateSeasonSummary } from "../_shared/season.ts";
import { validateWorkflowToken } from "../_shared/github.ts";

const DEFAULT_SEASON = 2025;
const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";
const STAGES = ["setup", "games", "boxscores", "rankings", "season-stats", "awards", "recompute"] as const;
type Stage = typeof STAGES[number];

// CFBD has no awards endpoint, so the Heisman result is recorded here.
const HEISMAN: Record<number, { winner: string; team: string; finalists: Array<{ name: string; team: string }> }> = {
  2025: {
    winner: "Fernando Mendoza",
    team: "Indiana",
    finalists: [
      { name: "Fernando Mendoza", team: "Indiana" },
      { name: "Diego Pavia", team: "Vanderbilt" },
      { name: "Jeremiyah Love", team: "Notre Dame" },
      { name: "Julian Sayin", team: "Ohio State" },
    ],
  },
  2024: {
    winner: "Travis Hunter",
    team: "Colorado",
    finalists: [
      { name: "Travis Hunter", team: "Colorado" },
      { name: "Ashton Jeanty", team: "Boise State" },
      { name: "Cam Ward", team: "Miami" },
      { name: "Dillon Gabriel", team: "Oregon" },
    ],
  },
  2023: {
    winner: "Jayden Daniels",
    team: "LSU",
    finalists: [
      { name: "Jayden Daniels", team: "LSU" },
      { name: "Michael Penix Jr.", team: "Washington" },
      { name: "Bo Nix", team: "Oregon" },
      { name: "Marvin Harrison Jr.", team: "Ohio State" },
    ],
  },
  2022: {
    winner: "Caleb Williams",
    team: "USC",
    finalists: [
      { name: "Caleb Williams", team: "USC" },
      { name: "Max Duggan", team: "TCU" },
      { name: "Stetson Bennett", team: "Georgia" },
      { name: "C.J. Stroud", team: "Ohio State" },
    ],
  },
};

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const normalizeConferenceName = (value: string) =>
  normalizeName(value.toLowerCase().replace(/^the\s+/, "").replace(/\s+conference$/, ""));

const powerFour = new Set(["acc", "atlanticcoast", "b1g", "bigten", "big12", "sec", "southeastern"]);
const groupOfSix = new Set([
  "aac",
  "americanathletic",
  "american",
  "conferenceusa",
  "cusa",
  "mac",
  "midamerican",
  "mwc",
  "mountainwest",
  "pac12",
  "sunbelt",
]);

const importSetup = async (supabase: Db, season: number, apiKey: string, calls: CallCounter, counts: JsonObject) => {
  const [teamData, fbsData, conferenceData, calendarData] = await Promise.all([
    fetchCfbd("/teams", apiKey, calls, {}, { year: season }),
    fetchCfbd("/teams/fbs", apiKey, calls, {}, { year: season }),
    fetchCfbd("/conferences", apiKey, calls, {}, { year: null }),
    fetchCfbd("/calendar", apiKey, calls, {}, { year: season }),
  ]);
  if (!teamData.length || !fbsData.length || !conferenceData.length || !calendarData.length) {
    throw new Error(`CFBD returned an empty ${season} teams, conferences, or calendar dataset`);
  }
  const { data: existingTeams, error: existingTeamsError } = await supabase.from("teams").select("id,is_fbs");
  if (existingTeamsError) throw new Error(`Could not load existing teams: ${existingTeamsError.message}`);
  // FBS membership is kept from later seasons: a team is FBS if it is FBS in
  // this season or was already stored as FBS.
  const fbsIds = new Set([
    ...fbsData.map((value) => integerValue(asObject(value, "FBS team").id)).filter((id): id is number => id !== null),
    ...(existingTeams ?? []).filter((team: JsonObject) => team.is_fbs).map((team: JsonObject) => Number(team.id)),
  ]);
  const teams = teamData.map((value) => {
    const team = mapTeam(value, false);
    return { ...team, is_fbs: fbsIds.has(team.id) };
  });
  const fbsConferenceNames = new Set(
    fbsData.map((value) => optionalString(asObject(value, "FBS team").conference))
      .filter((name): name is string => Boolean(name)).map(normalizeConferenceName),
  );
  const conferences = conferenceData.flatMap((value) => {
    const conference = asObject(value, "conference");
    const name = optionalString(conference.name);
    if (!name) return [];
    const identifiers = [name, optionalString(conference.shortName), optionalString(conference.abbreviation)]
      .filter((identifier): identifier is string => identifier !== null).map(normalizeConferenceName);
    const classification = optionalString(conference.classification);
    if (
      (classification && classification.toLowerCase() !== "fbs") ||
      (!classification && !identifiers.some((identifier) => fbsConferenceNames.has(identifier)))
    ) return [];
    const id = integerValue(conference.id);
    if (id === null) return [];
    return [{
      id,
      slug: slugify(name),
      name,
      short_name: optionalString(conference.shortName),
      abbreviation: optionalString(conference.abbreviation),
      group_name: identifiers.some((identifier) => identifier.includes("independent"))
        ? "Independent"
        : identifiers.some((identifier) => powerFour.has(identifier))
        ? "Power 4"
        : identifiers.some((identifier) => groupOfSix.has(identifier))
        ? "Group of 6"
        : null,
      classification,
    }];
  });
  const calendar = calendarData.map((value) => {
    const week = asObject(value, "calendar");
    return {
      season,
      week: integerValue(week.week),
      season_type: optionalString(week.seasonType) ?? "regular",
      start_date: optionalString(week.firstGameStart) ?? optionalString(week.startDate),
      end_date: optionalString(week.lastGameStart) ?? optionalString(week.endDate),
    };
  }).filter((week) => week.week !== null);
  const { error: seasonError } = await supabase.from("seasons").upsert(
    { year: season, status: "live" },
    { onConflict: "year", ignoreDuplicates: true },
  );
  if (seasonError) throw new Error(`Could not create the ${season} season: ${seasonError.message}`);
  counts.teams = await upsertRows(supabase, "teams", teams, "id");
  counts.conferences = await upsertRows(supabase, "conferences", conferences, "id");
  const conferenceByName = new Map<string, number>();
  for (const conference of conferences) {
    for (const name of [conference.name, conference.short_name, conference.abbreviation]) {
      if (name) conferenceByName.set(normalizeConferenceName(name), conference.id);
    }
  }
  const divisionsByConference = new Map<number, Set<string>>();
  const { data: existingSeasonRows, error: existingSeasonError } = await supabase.from("team_seasons")
    .select("team_id,wins,losses,ties,final_ranking,postseason_result").eq("season", season);
  if (existingSeasonError) throw new Error(`Could not load team seasons: ${existingSeasonError.message}`);
  const existingByTeam = new Map((existingSeasonRows ?? []).map((row: JsonObject) => [row.team_id, row]));
  const teamSeasons = teamData.flatMap((value) => {
    const team = asObject(value, "team");
    const id = integerValue(team.id);
    if (id === null || !fbsIds.has(id)) return [];
    const existing = existingByTeam.get(id) as JsonObject | undefined;
    const conferenceName = optionalString(team.conference);
    const conferenceId = conferenceName ? conferenceByName.get(normalizeConferenceName(conferenceName)) ?? null : null;
    const division = optionalString(team.division);
    if (conferenceId && division) {
      divisionsByConference.set(conferenceId, (divisionsByConference.get(conferenceId) ?? new Set()).add(division));
    }
    return [{
      season,
      team_id: id,
      conference_id: conferenceId,
      division,
      wins: existing?.wins ?? 0,
      losses: existing?.losses ?? 0,
      ties: existing?.ties ?? 0,
      final_ranking: existing?.final_ranking ?? null,
      postseason_result: existing?.postseason_result ?? null,
    }];
  });
  counts.conference_seasons = await upsertRows(
    supabase,
    "conference_seasons",
    conferences.map((conference) => ({
      season,
      conference_id: conference.id,
      divisions: [...(divisionsByConference.get(conference.id) ?? [])].sort(),
    })),
    "season,conference_id",
  );
  counts.calendar = await upsertRows(supabase, "calendar", calendar, "season,week,season_type");
  counts.team_seasons = await upsertRows(supabase, "team_seasons", teamSeasons, "season,team_id");
};

const importGames = async (supabase: Db, season: number, apiKey: string, calls: CallCounter, counts: JsonObject) => {
  const lookups = await loadTeamLookups(supabase);
  const [gameData, lineData, mediaData] = await Promise.all([
    fetchCfbd("/games", apiKey, calls, { seasonType: "both" }, { year: season }),
    fetchCfbd("/lines", apiKey, calls, { seasonType: "both" }, { year: season }),
    fetchCfbd("/games/media", apiKey, calls, { seasonType: "both" }, { year: season }),
  ]);
  const media = mapMedia(mediaData);
  const games = gameData.map((game) => mapGame(game, lookups.idByName, season))
    .filter((game): game is NonNullable<typeof game> =>
      game !== null &&
      (lookups.fbsIds.has(game.home_team_id) || lookups.fbsIds.has(game.away_team_id)) &&
      lookups.allIds.has(game.home_team_id) && lookups.allIds.has(game.away_team_id)
    )
    .map((game) => ({ ...game, tv: media.get(game.id) ?? null }));
  if (!games.length) throw new Error(`CFBD returned no ${season} games with an FBS team`);
  counts.games = await upsertRows(supabase, "games", games, "id");
  counts.lines = await upsertRows(supabase, "lines", mapLines(lineData, new Set(games.map((game) => game.id))), "game_id");
  counts.team_records = await updateTeamRecords(supabase, season, lookups.fbsIds);
};

const importBoxscores = async (supabase: Db, season: number, apiKey: string, calls: CallCounter, counts: JsonObject) => {
  const lookups = await loadTeamLookups(supabase);
  const games = await loadAll<{ id: number }>(
    (from, to) => supabase.from("games").select("id").eq("season", season).order("id").range(from, to),
    `${season} games`,
  );
  const gameIds = new Set(games.map((game) => game.id));
  const { data: calendar, error } = await supabase.from("calendar").select("week,season_type").eq("season", season);
  if (error) throw new Error(`Could not load the ${season} calendar: ${error.message}`);
  const periods = (calendar ?? []).filter((period: JsonObject) =>
    ["regular", "postseason"].includes(String(period.season_type)) && typeof period.week === "number"
  );
  if (!periods.length) throw new Error(`The ${season} calendar has no regular or postseason weeks`);
  let teamRows = 0;
  let playerRows = 0;
  for (const period of periods) {
    const params = { week: String(period.week), seasonType: String(period.season_type) };
    const [teamData, playerData] = await Promise.all([
      fetchCfbd("/games/teams", apiKey, calls, params, { year: season }),
      fetchCfbd("/games/players", apiKey, calls, params, { year: season }),
    ]);
    teamRows += await upsertRows(
      supabase,
      "game_team_stats",
      mapTeamGameStats(teamData, gameIds, lookups.idByName).filter((row) => lookups.allIds.has(row.team_id)),
      "game_id,team_id",
    );
    playerRows += await upsertRows(
      supabase,
      "game_player_stats",
      mapPlayerGameStats(playerData, gameIds, lookups.idByName).filter((row) => lookups.allIds.has(row.team_id)),
      "game_id,player_id,team_id,category",
    );
  }
  if (!teamRows || !playerRows) {
    throw new Error(`CFBD returned no usable ${season} box scores (team rows: ${teamRows}, player rows: ${playerRows})`);
  }
  counts.game_team_stats = teamRows;
  counts.game_player_stats = playerRows;
};

const importRankings = async (supabase: Db, season: number, apiKey: string, calls: CallCounter, counts: JsonObject) => {
  const lookups = await loadTeamLookups(supabase);
  const polls = mapPolls(
    await fetchCfbd("/rankings", apiKey, calls, { seasonType: "both" }, { year: season }),
    lookups.idByName,
    season,
  ).filter((poll) => lookups.allIds.has(Number(poll.team_id)));
  if (!polls.length) throw new Error(`CFBD returned no usable ${season} AP, Coaches, or CFP rankings`);
  counts.polls = await savePolls(supabase, season, polls, finalApRanks(polls));
  counts.by_source = Object.fromEntries(
    ["AP", "Coaches", "CFP"].map((source) => [source, polls.filter((poll) => poll.source === source).length]),
  );
};

const importSeasonStats = async (supabase: Db, season: number, apiKey: string, calls: CallCounter, counts: JsonObject) => {
  const lookups = await loadTeamLookups(supabase);
  const [playerData, teamData, coachData] = await Promise.all([
    fetchCfbd("/stats/player/season", apiKey, calls, { seasonType: "both" }, { year: season }),
    fetchCfbd("/stats/season", apiKey, calls, {}, { year: season }),
    fetchCfbd("/coaches", apiKey, calls, {}, { year: season }),
  ]);
  const players = mapPlayerSeasonStats(playerData, lookups.idByName, season, lookups.fbsIds);
  if (!players.length) throw new Error(`CFBD returned no usable ${season} player season statistics`);
  counts.player_season_stats = await upsertRows(supabase, "player_season_stats", players, "season,player_id,category");
  counts.team_season_stats = await upsertRows(
    supabase,
    "team_season_stats",
    mapTeamSeasonStats(teamData, lookups.idByName, season, lookups.fbsIds),
    "season,team_id,category",
  );
  counts.coaches = await upsertRows(
    supabase,
    "coaches",
    mapCoaches(coachData, lookups.idByName, season, lookups.fbsIds),
    "season,team_id",
  );
};

const recompute = async (supabase: Db, season: number, counts: JsonObject) => {
  const { fbsIds } = await loadTeamLookups(supabase);
  counts.weekly_awards = await recomputeWeeklyAwards(supabase, season, fbsIds);
  Object.assign(counts, await recomputeHeisman(supabase, season));
  Object.assign(counts, await updateSeasonSummary(supabase, season));
};

const importAwardsAndArchive = async (supabase: Db, season: number, counts: JsonObject) => {
  await recompute(supabase, season, counts);
  const { idByName } = await loadTeamLookups(supabase);
  const { data: summary, error: summaryError } = await supabase.from("seasons")
    .select("champion_team_id,title_game_id").eq("year", season).single();
  if (summaryError) throw new Error(`Could not read the ${season} season: ${summaryError.message}`);
  if (!summary?.champion_team_id) {
    throw new Error(`CFBD did not provide a completed ${season} national championship game`);
  }
  const heisman = HEISMAN[season];
  const patch: JsonObject = { status: "archived" };
  if (heisman) {
    patch.heisman_winner = heisman.winner;
    patch.heisman_finalists = heisman.finalists.map((finalist) => ({
      ...finalist,
      team_id: teamIdFor(finalist.team, idByName),
    }));
  }
  const { error } = await supabase.from("seasons").update(patch).eq("year", season);
  if (error) throw new Error(`Could not archive the ${season} season: ${error.message}`);
  counts.heisman_winner = heisman?.winner ?? null;
  counts.status = "archived";
};

const runStage = async (stage: Stage, season: number, supabase: Db, apiKey: string, calls: CallCounter) => {
  const prerequisites = stage === "recompute" ? [] : STAGES.slice(0, STAGES.indexOf(stage));
  if (prerequisites.length) {
    const prerequisiteJobs = prerequisites.map((name) => `import-${season}-${name}`);
    const { data, error } = await supabase.from("update_log").select("job").in("job", prerequisiteJobs)
      .eq("status", "success");
    if (error) throw new Error(`Could not verify earlier import stages: ${error.message}`);
    const completed = new Set((data ?? []).map((entry: JsonObject) => entry.job));
    const missing = prerequisiteJobs.filter((job) => !completed.has(job));
    if (missing.length) throw new Error(`Run these successful stages first: ${missing.join(", ")}`);
  }
  const counts: JsonObject = {};
  switch (stage) {
    case "setup":
      await importSetup(supabase, season, apiKey, calls, counts);
      break;
    case "games":
      await importGames(supabase, season, apiKey, calls, counts);
      break;
    case "boxscores":
      await importBoxscores(supabase, season, apiKey, calls, counts);
      break;
    case "rankings":
      await importRankings(supabase, season, apiKey, calls, counts);
      break;
    case "season-stats":
      await importSeasonStats(supabase, season, apiKey, calls, counts);
      break;
    case "awards":
      await importAwardsAndArchive(supabase, season, counts);
      break;
    case "recompute":
      await recompute(supabase, season, counts);
      break;
  }
  return counts;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const githubToken = request.headers.get("x-github-oidc-token");
  if (!githubToken) return response({ error: "Missing GitHub Actions identity token" }, 401);
  try {
    await validateWorkflowToken(githubToken, GITHUB_OIDC_AUDIENCE);
  } catch {
    return response({ error: "GitHub Actions identity could not be verified" }, 401);
  }
  const apiKey = Deno.env.get("CFBD_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    return response({ error: "Required Edge Function configuration is missing" }, 500);
  }

  let stage: Stage;
  let season = DEFAULT_SEASON;
  try {
    const body = asObject(await request.json(), "request");
    if (typeof body.stage !== "string" || !STAGES.includes(body.stage as Stage)) {
      return response({ error: `stage must be one of: ${STAGES.join(", ")}` }, 400);
    }
    stage = body.stage as Stage;
    if (body.season !== undefined && body.season !== null && body.season !== "") {
      const requested = integerValue(body.season);
      if (requested === null || requested < 2014 || requested > new Date().getUTCFullYear() - 1) {
        return response({ error: "season must be a completed season from 2014 on" }, 400);
      }
      season = requested;
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const calls: CallCounter = { value: 0, endpoints: [] };
  const { data: log, error: logError } = await supabase.from("update_log")
    .insert({ job: `import-${season}-${stage}`, trigger: "manual", status: "running" })
    .select("id").single();
  if (logError) return response({ error: `Could not start update log: ${logError.message}` }, 500);

  try {
    const details = await runStage(stage, season, supabase, apiKey, calls);
    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { stage, season, api_endpoints: calls.endpoints, ...details },
    }).eq("id", log.id);
    if (error) throw new Error(`Could not finish update log: ${error.message}`);
    return response({ status: "success", season, stage, api_calls_used: calls.value, ...details });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unexpected ${season} import failure`;
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { stage, season, api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) console.error("Could not record failed import:", updateError.message);
    console.error(`${season} import ${stage} failed:`, message);
    return response({ status: "failed", season, stage, error: message, api_calls_used: calls.value }, 500);
  }
});
