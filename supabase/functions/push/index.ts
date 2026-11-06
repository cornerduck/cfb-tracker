import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  finalPayload,
  isRelevant,
  kickoffPayload,
  type PollEntry,
  type PushGame,
  type PushPayload,
  ranksForGame,
  testPayload,
} from "../_shared/push.ts";

// Push notifications for STRDYS.
// GET              -> the public VAPID key (created on first use)
// POST test        -> one test notification to the signed-in user's devices
// POST run (cron)  -> kickoff and final notifications; no CFBD calls

const SEASON = 2026;
const VAPID_SUBJECT = "https://cornerduck.github.io/cfb-tracker/";
// The cron runs every 5 minutes; a kickoff is announced once it is due and
// at most 15 minutes late. Finals are announced within 14 hours of kickoff.
const KICKOFF_LATE_MS = 15 * 60 * 1000;
const KICKOFF_EARLY_MS = 60 * 1000;
const FINAL_WINDOW_MS = 14 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-live-scheduler-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

// deno-lint-ignore no-explicit-any
type Db = any;

type Subscription = { endpoint: string; user_id: string; p256dh: string; auth: string };

const vapidKeys = async (supabase: Db) => {
  const read = async () => {
    const { data, error } = await supabase.from("push_config")
      .select("public_key,private_key").eq("id", 1).maybeSingle();
    if (error) throw new Error(`Could not read the push keys: ${error.message}`);
    return data as { public_key: string; private_key: string } | null;
  };
  const existing = await read();
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  const { error } = await supabase.from("push_config")
    .upsert({ id: 1, public_key: keys.publicKey, private_key: keys.privateKey }, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(`Could not store the push keys: ${error.message}`);
  const stored = await read();
  if (!stored) throw new Error("The push keys could not be created");
  return stored;
};

// Sends one payload to every subscription; gone devices are removed.
const deliver = async (supabase: Db, subscriptions: Subscription[], payload: PushPayload) => {
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 60 * 60, urgency: "high" },
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      } else {
        console.error("Push delivery failed:", status, (error as Error).message);
      }
    }
  }
  return { sent, failed };
};

// Marks games as announced and returns only the ones that were not yet.
const claim = async (supabase: Db, gameIds: number[], kind: "kickoff" | "final") => {
  if (!gameIds.length) return new Set<number>();
  const { data, error } = await supabase.from("push_sent")
    .upsert(gameIds.map((game_id) => ({ game_id, kind })), {
      onConflict: "game_id,kind",
      ignoreDuplicates: true,
    })
    .select("game_id");
  if (error) throw new Error(`Could not record sent notifications: ${error.message}`);
  return new Set((data ?? []).map((row: { game_id: number }) => Number(row.game_id)));
};

const runNotifications = async (supabase: Db) => {
  const now = Date.now();
  const columns =
    "id,week,season_type,away_team_id,home_team_id,neutral_site,away_points,home_points,away_line_scores,home_line_scores,start_time,tv,status";
  const [kickoffs, finals] = await Promise.all([
    supabase.from("games").select(columns)
      .eq("season", SEASON).eq("start_time_tbd", false).neq("status", "final")
      .gte("start_time", new Date(now - KICKOFF_LATE_MS).toISOString())
      .lte("start_time", new Date(now + KICKOFF_EARLY_MS).toISOString()),
    supabase.from("games").select(columns)
      .eq("season", SEASON).eq("status", "final")
      .gte("start_time", new Date(now - FINAL_WINDOW_MS).toISOString()),
  ]);
  if (kickoffs.error) throw new Error(`Could not read kickoffs: ${kickoffs.error.message}`);
  if (finals.error) throw new Error(`Could not read finals: ${finals.error.message}`);
  const kickoffGames = (kickoffs.data ?? []) as PushGame[];
  const finalGames = (finals.data ?? []) as PushGame[];

  // Every game is marked once, even when nobody is subscribed yet, so a new
  // device never gets a flood of old games.
  const newKickoffs = await claim(supabase, kickoffGames.map((game) => game.id), "kickoff");
  const newFinals = await claim(supabase, finalGames.map((game) => game.id), "final");
  const due = [
    ...kickoffGames.filter((game) => newKickoffs.has(game.id)).map((game) => ({ game, kind: "kickoff" as const })),
    ...finalGames.filter((game) => newFinals.has(game.id)).map((game) => ({ game, kind: "final" as const })),
  ];
  if (!due.length) return { kickoffs: 0, finals: 0, sent: 0 };

  const { data: subscriptionRows, error: subscriptionError } = await supabase.from("push_subscriptions")
    .select("endpoint,user_id,p256dh,auth");
  if (subscriptionError) throw new Error(`Could not read devices: ${subscriptionError.message}`);
  const subscriptions = (subscriptionRows ?? []) as Subscription[];
  if (!subscriptions.length) return { kickoffs: newKickoffs.size, finals: newFinals.size, sent: 0 };

  const teamIds = [...new Set(due.flatMap(({ game }) => [game.home_team_id, game.away_team_id]))];
  const userIds = [...new Set(subscriptions.map((row) => row.user_id))];
  const [teams, polls, lines, profiles] = await Promise.all([
    supabase.from("teams").select("id,school,is_fbs").in("id", teamIds),
    supabase.from("polls").select("season_type,week,source,rank,team_id")
      .eq("season", SEASON).in("source", ["AP", "CFP"]),
    supabase.from("lines").select("game_id,consensus_spread").in("game_id", due.map(({ game }) => game.id)),
    supabase.from("profiles").select("user_id,favorite_team_ids").in("user_id", userIds),
  ]);
  for (const result of [teams, polls, lines, profiles]) {
    if (result.error) throw new Error(`Could not read notification data: ${result.error.message}`);
  }
  const names = new Map<number, string>(
    (teams.data ?? []).map((team: { id: number; school: string }) => [Number(team.id), team.school]),
  );
  const fbsIds = new Set<number>(
    (teams.data ?? []).filter((team: { is_fbs: boolean }) => team.is_fbs).map((team: { id: number }) => Number(team.id)),
  );
  const spreads = new Map<number, number | null>(
    (lines.data ?? []).map((line: { game_id: number; consensus_spread: number | null }) => [
      Number(line.game_id),
      line.consensus_spread === null ? null : Number(line.consensus_spread),
    ]),
  );
  const favorites = new Map<string, Set<number>>(
    (profiles.data ?? []).map((profile: { user_id: string; favorite_team_ids: number[] | null }) => [
      profile.user_id,
      new Set((profile.favorite_team_ids ?? []).map(Number)),
    ]),
  );
  const pollRows = (polls.data ?? []) as PollEntry[];

  let sent = 0;
  // Kickoffs in order of start time so a busy slot arrives in a stable order.
  due.sort((a, b) => (a.game.start_time ?? "").localeCompare(b.game.start_time ?? ""));
  for (const { game, kind } of due) {
    const ranks = ranksForGame(pollRows, game);
    const targets = subscriptions.filter((row) => isRelevant(game, ranks, favorites.get(row.user_id) ?? new Set()));
    if (!targets.length) continue;
    const payload = kind === "kickoff"
      ? kickoffPayload(game, ranks, names)
      : finalPayload(game, ranks, names, spreads.get(game.id) ?? null, fbsIds);
    sent += (await deliver(supabase, targets, payload)).sent;
  }
  return { kickoffs: newKickoffs.size, finals: newFinals.size, sent };
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

  try {
    const keys = await vapidKeys(supabase);
    if (request.method === "GET") return response({ public_key: keys.public_key });
    webpush.setVapidDetails(VAPID_SUBJECT, keys.public_key, keys.private_key);

    const body = await request.json().catch(() => ({})) as { action?: unknown; endpoint?: unknown };
    const schedulerToken = request.headers.get("x-live-scheduler-token");

    if (body.action === "run") {
      const { data: valid, error } = await supabase.rpc("is_live_scheduler_token", { candidate: schedulerToken });
      if (error) return response({ error: "Scheduler authorization could not be verified" }, 500);
      if (valid !== true) return response({ error: "Unauthorized scheduler request" }, 401);
      return response({ status: "success", ...(await runNotifications(supabase)) });
    }

    if (body.action === "test") {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return response({ error: "Sign-in is required" }, 401);
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return response({ error: "The signed-in user could not be verified" }, 401);
      const { data: rows, error: rowsError } = await supabase.from("push_subscriptions")
        .select("endpoint,user_id,p256dh,auth").eq("user_id", data.user.id);
      if (rowsError) throw new Error(`Could not read devices: ${rowsError.message}`);
      // Only the device that was just set up gets the test, when it is named.
      const targets = ((rows ?? []) as Subscription[]).filter((row) =>
        typeof body.endpoint !== "string" || row.endpoint === body.endpoint
      );
      return response({ status: "success", ...(await deliver(supabase, targets, testPayload())) });
    }

    return response({ error: "action must be run or test" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push notifications failed";
    console.error("Push function failed:", message);
    return response({ error: message }, 500);
  }
});
