// Imports team rosters (player, position, jersey, class, size, hometown).
// Rosters are only added or updated, never deleted, so player data from earlier
// imports is kept. Mode "all" asks CFBD for every FBS roster in one call; mode
// "teams" loads a slice of teams one by one (offset and limit) as a fallback.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { asObject, type CallCounter, fetchCfbd, integerValue, type JsonObject, mapRoster } from "../_shared/cfbd.ts";
import { loadTeamLookups, upsertRows } from "../_shared/store.ts";
import { validateWorkflowToken } from "../_shared/github.ts";

const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";
const MODES = ["all", "teams"] as const;
type Mode = typeof MODES[number];

const response = (body: JsonObject, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  let mode: Mode = "all";
  let season = new Date().getUTCFullYear();
  let offset = 0;
  let limit = 40;
  try {
    const body = asObject(await request.json(), "request");
    if (body.mode !== undefined && body.mode !== null && body.mode !== "") {
      if (typeof body.mode !== "string" || !MODES.includes(body.mode as Mode)) {
        return response({ error: `mode must be one of: ${MODES.join(", ")}` }, 400);
      }
      mode = body.mode as Mode;
    }
    const requested = integerValue(body.season);
    if (requested === null || requested < 2014 || requested > new Date().getUTCFullYear()) {
      return response({ error: "season must be a year from 2014 on" }, 400);
    }
    season = requested;
    if (body.offset !== undefined && body.offset !== null && body.offset !== "") {
      const value = integerValue(body.offset);
      if (value === null || value < 0) return response({ error: "offset must be 0 or higher" }, 400);
      offset = value;
    }
    if (body.limit !== undefined && body.limit !== null && body.limit !== "") {
      const value = integerValue(body.limit);
      if (value === null || value < 1 || value > 140) return response({ error: "limit must be 1 to 140" }, 400);
      limit = value;
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
    .insert({ job: `import-roster-${season}`, trigger: "manual", status: "running" })
    .select("id").single();
  if (logError) return response({ error: `Could not start update log: ${logError.message}` }, 500);

  try {
    const { data: seasonRow, error: seasonError } = await supabase.from("seasons").select("year")
      .eq("year", season).maybeSingle();
    if (seasonError) throw new Error(`Could not check season ${season}: ${seasonError.message}`);
    if (!seasonRow) throw new Error(`Season ${season} is not set up yet. Run the setup stage first.`);

    const { idByName, fbsIds } = await loadTeamLookups(supabase);
    const rows: JsonObject[] = [];
    let teamsDone = 0;
    let teamsTotal = 0;

    if (mode === "all") {
      const data = await fetchCfbd("/roster", apiKey, calls, { classification: "fbs" }, { year: season });
      rows.push(...mapRoster(data, season, idByName, fbsIds));
    } else {
      // Teams that played FBS football in this season, in a stable order.
      const { data: seasonTeams, error: teamsError } = await supabase.from("team_seasons")
        .select("team_id, teams(school)").eq("season", season).order("team_id");
      if (teamsError) throw new Error(`Could not load ${season} teams: ${teamsError.message}`);
      const schools = (seasonTeams ?? [])
        .filter((row: JsonObject) => fbsIds.has(Number(row.team_id)))
        .map((row: JsonObject) => (row.teams as JsonObject | null)?.school)
        .filter((school: unknown): school is string => typeof school === "string");
      teamsTotal = schools.length;
      const slice = schools.slice(offset, offset + limit);
      teamsDone = slice.length;
      for (const school of slice) {
        const data = await fetchCfbd("/roster", apiKey, calls, { team: school }, { year: season });
        rows.push(...mapRoster(data, season, idByName, fbsIds));
      }
    }
    if (!rows.length) throw new Error(`CFBD returned no usable ${season} roster rows`);

    const saved = await upsertRows(supabase, "roster", rows, "season,team_id,player_id");
    const details: JsonObject = {
      mode,
      season,
      roster_rows: saved,
      ...(mode === "teams"
        ? {
          teams_done: teamsDone,
          teams_total: teamsTotal,
          next_offset: offset + limit < teamsTotal ? offset + limit : null,
        }
        : {}),
    };
    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { api_endpoints: calls.endpoints, ...details },
    }).eq("id", log.id);
    if (error) throw new Error(`Could not finish update log: ${error.message}`);
    return response({ status: "success", api_calls_used: calls.value, ...details });
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unexpected ${season} roster import failure`;
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { mode, season, api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) console.error("Could not record failed roster import:", updateError.message);
    console.error(`${season} roster import failed:`, message);
    return response({ status: "failed", season, mode, error: message, api_calls_used: calls.value }, 500);
  }
});
