// Imports recruiting data from CFBD for one year: the high school recruits of a class, the
// team class rankings and/or the transfer portal. Request body: {"mode": "class" | "portal" | "both", "year": 2027}.
// class = /recruiting/players + /recruiting/teams, portal = /player/portal, both = all three (3 CFBD calls).
// Existing rows are updated, never deleted. The result lists the date range of the portal entries so the
// season convention of CFBD can be checked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { asObject, type CallCounter, fetchCfbd, integerValue, type JsonObject } from "../_shared/cfbd.ts";
import { countByMonth, mapPortal, mapRecruitingTeams, mapRecruits, unmatchedNames } from "../_shared/recruiting.ts";
import { loadTeamLookups, upsertRows } from "../_shared/store.ts";
import { validateWorkflowToken } from "../_shared/github.ts";

const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";
const MODES = ["class", "portal", "both"];

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

  let mode = "";
  let year: number | null = null;
  try {
    const body = asObject(await request.json(), "request");
    mode = typeof body.mode === "string" ? body.mode : "";
    year = integerValue(body.year);
    if (!MODES.includes(mode)) return response({ error: "mode must be class, portal or both" }, 400);
    const latest = new Date().getUTCFullYear() + 2;
    if (year === null || year < 2015 || year > latest) {
      return response({ error: `year must be between 2015 and ${latest}` }, 400);
    }
    if ((mode === "portal" || mode === "both") && year < 2021) {
      return response({ error: "CFBD has transfer portal data from 2021 on" }, 400);
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
  const selectedYear = year as number;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const calls: CallCounter = { value: 0, endpoints: [] };
  const { data: log, error: logError } = await supabase.from("update_log")
    .insert({ job: "import-recruiting", trigger: "manual", status: "running" })
    .select("id").single();
  if (logError) return response({ error: `Could not start update log: ${logError.message}` }, 500);

  try {
    const { idByName, fbsIds, allIds } = await loadTeamLookups(supabase);
    const result: JsonObject = { mode, year: selectedYear };

    if (mode === "class" || mode === "both") {
      const players = await fetchCfbd("/recruiting/players", apiKey, calls, { classification: "HighSchool" }, { year: selectedYear });
      const recruits = mapRecruits(players, selectedYear, idByName, allIds);
      if (!recruits.length) throw new Error(`CFBD returned no recruits for the class of ${selectedYear}`);
      const teams = await fetchCfbd("/recruiting/teams", apiKey, calls, {}, { year: selectedYear });
      const classRows = mapRecruitingTeams(teams, recruits, selectedYear, idByName, fbsIds);
      result.recruits = await upsertRows(supabase, "recruits", recruits, "class_year,id");
      result.class_rankings = await upsertRows(supabase, "recruiting_teams", classRows, "class_year,team_id");
      result.top_recruit = recruits[0]?.name ?? null;
      result.unmatched_commit_schools = unmatchedNames(
        recruits.map((row) => (row.committed_team_id === null ? (row.committed_to as string | null) : null)),
        idByName,
      );
    }

    if (mode === "portal" || mode === "both") {
      const entries = await fetchCfbd("/player/portal", apiKey, calls, {}, { year: selectedYear });
      const rows = mapPortal(entries, selectedYear, idByName, allIds);
      if (!rows.length) throw new Error(`CFBD returned no portal entries for ${selectedYear}`);
      const dates = rows.map((row) => row.transfer_date as string | null).filter((value): value is string => !!value).sort();
      result.portal_entries = await upsertRows(supabase, "portal_entries", rows, "season,id");
      result.portal_with_destination = rows.filter((row) => row.destination !== null).length;
      result.portal_first_transfer_date = dates[0] ?? null;
      result.portal_last_transfer_date = dates[dates.length - 1] ?? null;
      result.unmatched_portal_schools = unmatchedNames(
        rows.flatMap((row) => [row.origin as string | null, row.destination as string | null]),
        idByName,
      );
      result.portal_by_month = countByMonth(dates);
    }

    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { api_endpoints: calls.endpoints, ...result },
    }).eq("id", log.id);
    if (error) throw new Error(`Could not finish update log: ${error.message}`);
    return response({ status: "success", api_calls_used: calls.value, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected recruiting import failure";
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) console.error("Could not record failed recruiting import:", updateError.message);
    console.error("Recruiting import failed:", message);
    return response({ status: "failed", error: message, api_calls_used: calls.value }, 500);
  }
});
