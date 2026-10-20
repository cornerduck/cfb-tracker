// All-time series between two teams for the Compare screen. The result is
// cached in head_to_head; CFBD is only asked again after the two teams have
// played a new game. One CFBD call per refresh, at most 20 per day.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { CFBD_BASE_URL, type CallCounter } from "../_shared/cfbd.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const DAILY_LIMIT = 20;

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("CFBD_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !apiKey) {
    return response({ error: "Required Edge Function configuration is missing" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return response({ error: "Sign-in is required" }, 401);
  const { data: user, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user.user) return response({ error: "The signed-in user could not be verified" }, 401);

  const body = await request.json().catch(() => ({}));
  const first = num(body?.team_a_id);
  const second = num(body?.team_b_id);
  if (first === null || second === null || first === second) {
    return response({ error: "Two different team ids are required" }, 400);
  }
  const [teamA, teamB] = first < second ? [first, second] : [second, first];

  const { data: teams, error: teamError } = await supabase.from("teams").select("id,school").in("id", [teamA, teamB]);
  if (teamError || teams?.length !== 2) return response({ error: "Unknown team" }, 400);
  const school = (id: number) => teams.find((team: { id: number }) => team.id === id)!.school as string;

  // Fresh when no stored game between the two finished after the last refresh.
  const { data: cached } = await supabase.from("head_to_head").select("*")
    .eq("team_a_id", teamA).eq("team_b_id", teamB).maybeSingle();
  if (cached) {
    const { data: latest } = await supabase.from("games").select("start_time")
      .eq("status", "final")
      .or(`and(home_team_id.eq.${teamA},away_team_id.eq.${teamB}),and(home_team_id.eq.${teamB},away_team_id.eq.${teamA})`)
      .order("start_time", { ascending: false }).limit(1);
    const lastGame = latest?.[0]?.start_time ? Date.parse(latest[0].start_time) : 0;
    if (Date.parse(cached.updated_at) > lastGame + 6 * 3600_000) return response({ status: "cached", series: cached });
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent, error: countError } = await supabase.from("update_log")
    .select("api_calls_used").eq("job", "head-to-head").gte("started_at", since);
  if (countError) return response({ error: "Could not check the daily limit" }, 500);
  const used = (recent ?? []).reduce((sum: number, row: { api_calls_used: number }) => sum + (row.api_calls_used ?? 0), 0);
  if (used >= DAILY_LIMIT) {
    return cached
      ? response({ status: "cached", series: cached })
      : response({ error: "The daily limit for new head-to-head lookups is reached. Try again tomorrow." }, 429);
  }

  const calls: CallCounter = { value: 0, endpoints: [] };
  const { data: log } = await supabase.from("update_log")
    .insert({ job: "head-to-head", trigger: "manual", status: "running" }).select("id").single();
  try {
    const result = await fetch(new URL(`${CFBD_BASE_URL}/teams/matchup?team1=${encodeURIComponent(school(teamA))}&team2=${encodeURIComponent(school(teamB))}`), {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    calls.value += 1;
    calls.endpoints.push("/teams/matchup");
    if (!result.ok) throw new Error(`CFBD /teams/matchup request failed with HTTP ${result.status}`);
    const matchup = await result.json();
    const games = Array.isArray(matchup?.games) ? matchup.games : [];
    const meetings = games.map((game: Record<string, unknown>) => ({
      season: num(game.season),
      week: num(game.week),
      season_type: game.seasonType ?? null,
      date: game.date ?? null,
      neutral: Boolean(game.neutralSite),
      home: game.homeTeam ?? null,
      away: game.awayTeam ?? null,
      home_points: num(game.homeScore),
      away_points: num(game.awayScore),
      winner: game.winner ?? null,
    })).sort((a: { date: string | null }, b: { date: string | null }) => String(b.date).localeCompare(String(a.date)));
    const row = {
      team_a_id: teamA,
      team_b_id: teamB,
      team_a_wins: num(matchup?.team1Wins) ?? 0,
      team_b_wins: num(matchup?.team2Wins) ?? 0,
      ties: num(matchup?.ties) ?? 0,
      meetings,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("head_to_head").upsert(row, { onConflict: "team_a_id,team_b_id" });
    if (error) throw new Error(`Could not store the series: ${error.message}`);
    if (log) {
      await supabase.from("update_log").update({
        status: "success", finished_at: new Date().toISOString(), api_calls_used: calls.value,
        details: { team_a_id: teamA, team_b_id: teamB, api_endpoints: calls.endpoints },
      }).eq("id", log.id);
    }
    return response({ status: "updated", series: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Head-to-head lookup failed";
    if (log) {
      await supabase.from("update_log").update({
        status: "failed", finished_at: new Date().toISOString(), api_calls_used: calls.value, error: message,
      }).eq("id", log.id);
    }
    return cached ? response({ status: "cached", series: cached }) : response({ error: message }, 502);
  }
});
