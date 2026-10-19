// Database helpers shared by the import and update Edge Functions.
// deno-lint-ignore-file no-explicit-any

import { type JsonObject, normalizeName, numberValue } from "./cfbd.ts";
import {
  computeHeismanWeeks,
  computeWeeklyAwards,
  type GameRow,
  type PlayerGameRow,
} from "./derived.ts";

export type Db = any;

export const upsertRows = async (
  supabase: Db,
  table: string,
  rows: JsonObject[],
  onConflict: string,
) => {
  for (let offset = 0; offset < rows.length; offset += 250) {
    const { error } = await supabase.from(table).upsert(rows.slice(offset, offset + 250), {
      onConflict,
    });
    if (error) throw new Error(`Could not update ${table}: ${error.message}`);
  }
  return rows.length;
};

// Reads every row of a query in pages of 1,000 (the PostgREST maximum).
export const loadAll = async <T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
) => {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

export const loadTeamLookups = async (supabase: Db) => {
  const { data, error } = await supabase.from("teams").select("id,school,slug,abbreviation,is_fbs");
  if (error) throw new Error(`Could not load teams: ${error.message}`);
  const idByName = new Map<string, number>();
  const fbsIds = new Set<number>();
  const allIds = new Set<number>();
  for (const team of data ?? []) {
    idByName.set(normalizeName(team.school), team.id);
    idByName.set(normalizeName(String(team.slug).replace(/-/g, " ")), team.id);
    allIds.add(team.id);
    if (team.is_fbs) fbsIds.add(team.id);
  }
  return { idByName, fbsIds, allIds };
};

export const loadSeasonGames = async (supabase: Db, season: number) =>
  await loadAll<GameRow & { season_type: string }>(
    (from, to) =>
      supabase.from("games")
        .select(
          "id,week,season_type,home_team_id,away_team_id,home_points,away_points,home_line_scores,away_line_scores",
        )
        .eq("season", season)
        .order("id")
        .range(from, to),
    `${season} games`,
  );

export const loadSpreads = async (supabase: Db, gameIds: number[]) => {
  const spreads = new Map<number, number | null>();
  for (let offset = 0; offset < gameIds.length; offset += 200) {
    const { data, error } = await supabase.from("lines")
      .select("game_id,consensus_spread")
      .in("game_id", gameIds.slice(offset, offset + 200));
    if (error) throw new Error(`Could not load closing lines: ${error.message}`);
    for (const line of data ?? []) spreads.set(line.game_id, numberValue(line.consensus_spread));
  }
  return spreads;
};

export const loadPlayerGameRows = async (
  supabase: Db,
  gameIds: number[],
  categories?: string[],
) => {
  const rows: PlayerGameRow[] = [];
  for (let offset = 0; offset < gameIds.length; offset += 60) {
    const batch = gameIds.slice(offset, offset + 60);
    rows.push(
      ...await loadAll<PlayerGameRow>((from, to) => {
        let query = supabase.from("game_player_stats")
          .select("game_id,player_id,player_name,team_id,category,stats")
          .in("game_id", batch);
        if (categories) query = query.in("category", categories);
        return query.order("game_id").order("player_id").order("category").range(from, to);
      }, "player box scores"),
    );
  }
  return rows;
};

// Recalculates the weekly awards for the given weeks (all completed weeks when
// omitted). Rows that no longer apply are removed only after the new rows saved.
export const recomputeWeeklyAwards = async (
  supabase: Db,
  season: number,
  fbsIds: Set<number>,
  onlyWeeks?: Array<{ week: number; seasonType: string }>,
) => {
  const games = await loadSeasonGames(supabase, season);
  const regularWeeks = games.filter((game) => game.season_type === "regular" && game.week !== null)
    .map((game) => game.week!);
  const lastRegularWeek = Math.max(0, ...regularWeeks);
  const awardWeek = (game: { week: number | null; season_type: string }) =>
    game.season_type === "regular" ? game.week! : lastRegularWeek + game.week!;
  const wanted = onlyWeeks
    ? new Set(onlyWeeks.map((period) =>
      period.seasonType === "regular" ? period.week : lastRegularWeek + period.week
    ))
    : null;
  const byWeek = new Map<number, typeof games>();
  for (const game of games) {
    if (game.week === null) continue;
    const week = awardWeek(game);
    if (wanted && !wanted.has(week)) continue;
    byWeek.set(week, [...(byWeek.get(week) ?? []), game]);
  }
  let saved = 0;
  for (const [week, weekGames] of byWeek) {
    const completedIds = weekGames.filter((game) => game.home_points !== null && game.away_points !== null)
      .map((game) => game.id);
    if (!completedIds.length) continue;
    const [spreads, players] = await Promise.all([
      loadSpreads(supabase, completedIds),
      loadPlayerGameRows(supabase, completedIds),
    ]);
    const awards = computeWeeklyAwards(season, week, weekGames, spreads, players, fbsIds);
    saved += await upsertRows(supabase, "weekly_awards", awards, "season,week,award_type");
    const keep = awards.map((award) => award.award_type as string);
    let prune = supabase.from("weekly_awards").delete().eq("season", season).eq("week", week);
    if (keep.length) prune = prune.not("award_type", "in", `(${keep.join(",")})`);
    const { error } = await prune;
    if (error) throw new Error(`Could not prune weekly awards: ${error.message}`);
  }
  return saved;
};

// Rebuilds the Heisman tracker history and current standings for a season.
export const recomputeHeisman = async (supabase: Db, season: number) => {
  const games = await loadSeasonGames(supabase, season);
  const completedIds = games.filter((game) => game.home_points !== null && game.away_points !== null)
    .map((game) => game.id);
  if (!completedIds.length) return { heisman_weekly: 0, heisman_tracker: 0 };
  const [players, polls, positions] = await Promise.all([
    loadPlayerGameRows(supabase, completedIds, ["passing", "rushing", "receiving", "fumbles"]),
    loadAll<{ week: number; season_type: string; team_id: number; rank: number }>(
      (from, to) =>
        supabase.from("polls").select("week,season_type,team_id,rank")
          .eq("season", season).eq("source", "AP").order("week").range(from, to),
      "AP polls",
    ),
    loadAll<{ player_id: string; position: string | null }>(
      (from, to) =>
        supabase.from("player_season_stats").select("player_id,position")
          .eq("season", season).not("position", "is", null).order("player_id").range(from, to),
      "player positions",
    ),
  ]);
  const positionByPlayer = new Map(
    positions.filter((row) => row.position).map((row) => [row.player_id, row.position!]),
  );
  const weeks = computeHeismanWeeks(games, players, polls, positionByPlayer);
  let weekly = 0;
  for (const { week, ranked } of weeks) {
    const topTen = ranked.slice(0, 10).map((player) => ({ season, week, ...player }));
    weekly += await upsertRows(supabase, "heisman_weekly", topTen, "season,week,player_id");
    const keep = topTen.map((player) => `"${player.player_id.replace(/"/g, '""')}"`);
    const { error } = await supabase.from("heisman_weekly").delete()
      .eq("season", season).eq("week", week).not("player_id", "in", `(${keep.join(",")})`);
    if (error) throw new Error(`Could not prune the weekly Heisman field: ${error.message}`);
  }
  const latest = weeks.at(-1)?.ranked ?? [];
  const tracker = latest.map((player) => ({ season, ...player }));
  const trackerCount = await upsertRows(supabase, "heisman_tracker", tracker, "season,player_id");
  if (tracker.length) {
    const { data: existing, error } = await supabase.from("heisman_tracker")
      .select("player_id").eq("season", season);
    if (error) throw new Error(`Could not read the Heisman tracker: ${error.message}`);
    const current = new Set(tracker.map((player) => player.player_id));
    const stale = (existing ?? []).map((row: { player_id: string }) => row.player_id)
      .filter((id: string) => !current.has(id));
    for (let offset = 0; offset < stale.length; offset += 200) {
      const { error: pruneError } = await supabase.from("heisman_tracker").delete()
        .eq("season", season).in("player_id", stale.slice(offset, offset + 200));
      if (pruneError) throw new Error(`Could not prune the Heisman tracker: ${pruneError.message}`);
    }
  }
  return { heisman_weekly: weekly, heisman_tracker: trackerCount };
};

// Updates wins, losses and ties from the stored results.
export const updateTeamRecords = async (supabase: Db, season: number, fbsIds: Set<number>) => {
  const games = await loadSeasonGames(supabase, season);
  const records = new Map<number, { wins: number; losses: number; ties: number }>();
  for (const game of games) {
    if (game.away_points === null || game.home_points === null) continue;
    for (
      const [teamId, points, opponent] of [
        [game.home_team_id, game.home_points, game.away_points],
        [game.away_team_id, game.away_points, game.home_points],
      ] as const
    ) {
      if (!fbsIds.has(teamId)) continue;
      const record = records.get(teamId) ?? { wins: 0, losses: 0, ties: 0 };
      if (points > opponent) record.wins += 1;
      else if (points < opponent) record.losses += 1;
      else record.ties += 1;
      records.set(teamId, record);
    }
  }
  const { data: teamSeasons, error } = await supabase.from("team_seasons")
    .select("season,team_id,conference_id,division,final_ranking,postseason_result")
    .eq("season", season);
  if (error) throw new Error(`Could not load team records: ${error.message}`);
  const rows = (teamSeasons ?? []).map((row: JsonObject) => ({
    ...row,
    ...(records.get(Number(row.team_id)) ?? { wins: 0, losses: 0, ties: 0 }),
  }));
  return await upsertRows(supabase, "team_seasons", rows, "season,team_id");
};

// Upserts polls, prunes rows that the latest feed no longer contains (for
// example FCS teams that were once stored as Coaches Poll entries), and
// refreshes each team's final AP rank.
export const savePolls = async (
  supabase: Db,
  season: number,
  polls: JsonObject[],
  finalRanks: Map<number, number>,
) => {
  if (!polls.length) return 0;
  const saved = await upsertRows(supabase, "polls", polls, "season,season_type,week,source,team_id");
  const keepByGroup = new Map<string, Set<number>>();
  for (const poll of polls) {
    const group = `${poll.season_type}|${poll.week}|${poll.source}`;
    keepByGroup.set(group, (keepByGroup.get(group) ?? new Set()).add(Number(poll.team_id)));
  }
  const existing = await loadAll<{ season_type: string; week: number; source: string; team_id: number }>(
    (from, to) =>
      supabase.from("polls").select("season_type,week,source,team_id").eq("season", season)
        .order("week").order("source").order("team_id").range(from, to),
    "polls",
  );
  const staleGroups = new Set<string>();
  for (const row of existing) {
    const group = `${row.season_type}|${row.week}|${row.source}`;
    if (!keepByGroup.get(group)?.has(row.team_id)) staleGroups.add(group);
  }
  for (const group of staleGroups) {
    const [seasonType, week, source] = group.split("|");
    let query = supabase.from("polls").delete()
      .eq("season", season).eq("season_type", seasonType).eq("week", Number(week)).eq("source", source);
    const keep = keepByGroup.get(group);
    if (keep?.size) query = query.not("team_id", "in", `(${[...keep].join(",")})`);
    const { error } = await query;
    if (error) throw new Error(`Could not prune outdated poll rows: ${error.message}`);
  }
  for (const [teamId, rank] of finalRanks) {
    const { error } = await supabase.from("team_seasons")
      .update({ final_ranking: rank }).eq("season", season).eq("team_id", teamId);
    if (error) throw new Error(`Could not update final ranking: ${error.message}`);
  }
  if (finalRanks.size) {
    const { error } = await supabase.from("team_seasons").update({ final_ranking: null })
      .eq("season", season).not("final_ranking", "is", null)
      .not("team_id", "in", `(${[...finalRanks.keys()].join(",")})`);
    if (error) throw new Error(`Could not clear outdated final rankings: ${error.message}`);
  }
  return saved;
};
