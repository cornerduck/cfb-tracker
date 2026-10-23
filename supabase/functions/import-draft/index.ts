// Imports the first round of the real NFL drafts for the archive. The draft
// after a college season is held in the following spring, so season 2025 gives
// the 2026 draft. Without a season every archived season is imported; one CFBD
// call per draft year. Existing rows are updated, never deleted.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { asObject, type CallCounter, fetchCfbd, integerValue, type JsonObject } from "../_shared/cfbd.ts";
import { mapDraftPicks } from "../_shared/draft.ts";
import { upsertRows } from "../_shared/store.ts";
import { validateWorkflowToken } from "../_shared/github.ts";

const GITHUB_OIDC_AUDIENCE = "strdys-supabase-test-import";

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

  let requested: number | null = null;
  try {
    const body = asObject(await request.json(), "request");
    if (body.season !== undefined && body.season !== null && body.season !== "") {
      requested = integerValue(body.season);
      if (requested === null || requested < 2014 || requested > new Date().getUTCFullYear()) {
        return response({ error: "season must be a year from 2014 on" }, 400);
      }
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
    .insert({ job: "import-draft", trigger: "manual", status: "running" })
    .select("id").single();
  if (logError) return response({ error: `Could not start update log: ${logError.message}` }, 500);

  try {
    let seasons: number[];
    if (requested !== null) seasons = [requested];
    else {
      const { data, error } = await supabase.from("seasons").select("year").eq("status", "archived").order("year");
      if (error) throw new Error(`Could not load seasons: ${error.message}`);
      seasons = (data ?? []).map((row: { year: number }) => row.year);
    }
    if (!seasons.length) throw new Error("There is no archived season to import a draft for");

    const imported: Record<string, number> = {};
    for (const season of seasons) {
      const draftYear = season + 1;
      const data = await fetchCfbd("/draft/picks", apiKey, calls, {}, { year: draftYear });
      const rows = mapDraftPicks(data, draftYear);
      if (!rows.length) throw new Error(`CFBD returned no first round picks for the ${draftYear} draft`);
      imported[String(draftYear)] = await upsertRows(supabase, "nfl_draft_picks", rows, "draft_year,overall");
    }

    const { error } = await supabase.from("update_log").update({
      status: "success",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      details: { api_endpoints: calls.endpoints, picks_by_draft_year: imported },
    }).eq("id", log.id);
    if (error) throw new Error(`Could not finish update log: ${error.message}`);
    return response({ status: "success", api_calls_used: calls.value, picks_by_draft_year: imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected draft import failure";
    const { error: updateError } = await supabase.from("update_log").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      api_calls_used: calls.value,
      error: message,
      details: { api_endpoints: calls.endpoints },
    }).eq("id", log.id);
    if (updateError) console.error("Could not record failed draft import:", updateError.message);
    console.error("Draft import failed:", message);
    return response({ status: "failed", error: message, api_calls_used: calls.value }, 500);
  }
});
