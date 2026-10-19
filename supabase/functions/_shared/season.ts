// Season summary fields stored on public.seasons: champion, title game and
// the last unbeaten team. Calculated from stored games only (no API calls).
// deno-lint-ignore-file no-explicit-any

import { loadAll, loadTeamLookups } from "./store.ts";

export const updateSeasonSummary = async (supabase: any, season: number) => {
  const { fbsIds } = await loadTeamLookups(supabase);
  const games = await loadAll<{
    id: number;
    start_time: string | null;
    home_team_id: number;
    away_team_id: number;
    home_points: number | null;
    away_points: number | null;
    is_title_game: boolean;
    cfp_round: string | null;
    status: string;
  }>(
    (from, to) =>
      supabase.from("games")
        .select("id,start_time,home_team_id,away_team_id,home_points,away_points,is_title_game,cfp_round,status")
        .eq("season", season).order("id").range(from, to),
    `${season} games`,
  );
  const patch: Record<string, unknown> = {};

  const title = games.find((game) => game.is_title_game || game.cfp_round === "National Championship");
  if (title && title.status === "final" && title.home_points !== null && title.away_points !== null &&
    title.home_points !== title.away_points) {
    const champion = title.home_points > title.away_points ? title.home_team_id : title.away_team_id;
    patch.champion_team_id = champion;
    patch.title_game_id = title.id;
    const { error } = await supabase.from("team_seasons")
      .update({ postseason_result: "National Champion" })
      .eq("season", season).eq("team_id", champion);
    if (error) throw new Error(`Could not record the national champion: ${error.message}`);
  }

  // The last unbeaten team: the only team still unbeaten, or (once every team
  // has lost) the team whose first loss came last.
  const firstLoss = new Map<number, number>();
  const played = new Set<number>();
  for (const game of [...games].sort((a, b) => Date.parse(a.start_time ?? "") - Date.parse(b.start_time ?? ""))) {
    if (game.home_points === null || game.away_points === null || game.status !== "final") continue;
    for (const [team, points, opponent] of [
      [game.home_team_id, game.home_points, game.away_points],
      [game.away_team_id, game.away_points, game.home_points],
    ] as const) {
      if (!fbsIds.has(team)) continue;
      played.add(team);
      if (points < opponent && !firstLoss.has(team)) firstLoss.set(team, Date.parse(game.start_time ?? "") || 0);
    }
  }
  const unbeaten = [...played].filter((team) => !firstLoss.has(team));
  if (played.size && unbeaten.length === 1) patch.last_unbeaten_team_id = unbeaten[0];
  else if (played.size && unbeaten.length === 0) {
    patch.last_unbeaten_team_id = [...firstLoss].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  } else patch.last_unbeaten_team_id = null;

  const { error } = await supabase.from("seasons").update(patch).eq("year", season);
  if (error) throw new Error(`Could not update the ${season} season summary: ${error.message}`);
  return { season_summary: patch };
};
