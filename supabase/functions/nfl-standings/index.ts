// Keeps the 32 NFL teams and their records in nfl_teams for the pick order of
// the Draft tab. Signed-in users trigger it from the app; the data is only
// fetched from ESPN when it is older than three hours, so many visitors cause
// at most a few requests a day. Needs no API key (unofficial ESPN endpoints).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { nflSeasonFor, parseRecords, parseTeams, type NflRecord } from "../_shared/espn.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const FRESH_MS = 3 * 60 * 60 * 1000;
const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const standingsUrl = (season: number) => `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${season}`;
const groupUrl = (season: number, group: number) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/types/2/groups/${group}/standings/0`;

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const getJson = async (url: string) => {
  const result = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!result.ok) throw new Error(`ESPN answered ${result.status} for ${new URL(url).pathname}`);
  return await result.json();
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "Required Edge Function configuration is missing" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return response({ error: "Sign-in is required" }, 401);
  const { data: user, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user.user) return response({ error: "The signed-in user could not be verified" }, 401);

  const season = nflSeasonFor(new Date());
  const { data: stored, error: storedError } = await supabase.from("nfl_teams").select("updated_at,record_season");
  if (storedError) return response({ error: `Could not read nfl_teams: ${storedError.message}` }, 500);
  const newest = Math.min(...(stored ?? []).map((row: { updated_at: string }) => Date.parse(row.updated_at)));
  const fresh = (stored?.length ?? 0) === 32 && Date.now() - newest < FRESH_MS &&
    (stored ?? []).every((row: { record_season: number }) => row.record_season === season);
  if (fresh) return response({ status: "fresh", updated_at: new Date(newest).toISOString() });

  try {
    const teams = parseTeams(await getJson(TEAMS_URL));
    if (teams.length !== 32) throw new Error(`ESPN listed ${teams.length} teams instead of 32`);

    let records = new Map<number, NflRecord>();
    const sources: string[] = [];
    try {
      records = parseRecords(await getJson(standingsUrl(season)));
      sources.push("standings");
    } catch (error) {
      sources.push(`standings failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    if (!teams.every((team) => records.has(team.espnId))) {
      for (const group of [8, 7]) {
        try {
          for (const [id, record] of parseRecords(await getJson(groupUrl(season, group)))) records.set(id, record);
          sources.push(`group ${group}`);
        } catch (error) {
          sources.push(`group ${group} failed: ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }
    const missing = teams.filter((team) => !records.has(team.espnId));
    if (missing.length) {
      throw new Error(`ESPN gave no record for ${missing.length} of 32 teams (${missing.slice(0, 4).map((team) => team.abbr).join(", ")}); ${sources.join("; ")}`);
    }

    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from("nfl_teams").upsert(
      teams.map((team) => {
        const record = records.get(team.espnId)!;
        return {
          abbr: team.abbr,
          espn_id: team.espnId,
          name: team.name,
          color: team.color,
          wins: record.wins,
          losses: record.losses,
          ties: record.ties,
          record_season: season,
          updated_at: updatedAt,
        };
      }),
      { onConflict: "abbr" },
    );
    if (error) throw new Error(`Could not update nfl_teams: ${error.message}`);
    return response({ status: "updated", updated_at: updatedAt, season });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "The NFL standings could not be updated" }, 502);
  }
});
