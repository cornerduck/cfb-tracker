import { underdogWin } from "./derived.ts";

// Pure helpers for push notifications: which ranking counts, which games a
// user hears about, and the text of each notification.

export type PushGame = {
  id: number;
  week: number | null;
  season_type: string;
  away_team_id: number;
  home_team_id: number;
  neutral_site: boolean;
  away_points: number | null;
  home_points: number | null;
  away_line_scores: number[] | null;
  home_line_scores: number[] | null;
  start_time: string | null;
  tv: string | null;
  status: string;
};

export type PollEntry = {
  season_type: string;
  week: number;
  source: string;
  rank: number;
  team_id: number;
};

export type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  gameId?: number;
};

const typeOrder = (seasonType: string) => seasonType === "postseason" ? 1 : 0;

// The AP Poll counts until the first CFP ranking is out, then the CFP ranking.
// For each game the latest release up to the game's week is used.
export const ranksForGame = (polls: PollEntry[], game: Pick<PushGame, "week" | "season_type">) => {
  const source = polls.some((row) => row.source === "CFP") ? "CFP" : "AP";
  const gameKey = typeOrder(game.season_type) * 100 + (game.week ?? 99);
  let best: number | null = null;
  for (const row of polls) {
    if (row.source !== source) continue;
    const key = typeOrder(row.season_type) * 100 + row.week;
    if (key <= gameKey && (best === null || key > best)) best = key;
  }
  const ranks = new Map<number, number>();
  if (best === null) return ranks;
  for (const row of polls) {
    if (row.source === source && typeOrder(row.season_type) * 100 + row.week === best && row.rank <= 25) {
      ranks.set(row.team_id, row.rank);
    }
  }
  return ranks;
};

export const isRelevant = (game: PushGame, ranks: Map<number, number>, favorites: Set<number>) =>
  ranks.has(game.home_team_id) || ranks.has(game.away_team_id) ||
  favorites.has(game.home_team_id) || favorites.has(game.away_team_id);

const label = (teamId: number, ranks: Map<number, number>, names: Map<number, string>) => {
  const rank = ranks.get(teamId);
  const name = names.get(teamId) ?? "TBD";
  return rank ? `#${rank} ${name}` : name;
};

export const kickoffPayload = (
  game: PushGame,
  ranks: Map<number, number>,
  names: Map<number, string>,
): PushPayload => {
  const matchup = `${label(game.away_team_id, ranks, names)} ${game.neutral_site ? "vs" : "@"} ${
    label(game.home_team_id, ranks, names)
  }`;
  return {
    title: "KICKOFF",
    body: game.tv ? `${matchup} · ${game.tv}` : matchup,
    tag: `game-${game.id}`,
    url: `?game=${game.id}`,
    gameId: game.id,
  };
};

export const finalPayload = (
  game: PushGame,
  ranks: Map<number, number>,
  names: Map<number, string>,
  spread: number | null,
  fbsIds: Set<number>,
): PushPayload => {
  const homeWon = (game.home_points ?? 0) >= (game.away_points ?? 0);
  const [winner, winnerPoints, loser, loserPoints] = homeWon
    ? [game.home_team_id, game.home_points, game.away_team_id, game.away_points]
    : [game.away_team_id, game.away_points, game.home_team_id, game.home_points];
  const overtime = Math.max(game.home_line_scores?.length ?? 0, game.away_line_scores?.length ?? 0) > 4;
  const upset = underdogWin(game, spread, fbsIds);
  const title = ["FINAL", overtime ? "OT" : null, upset?.tier ? "UPSET" : null].filter(Boolean).join(" · ");
  return {
    title,
    body: `${label(winner, ranks, names)} ${winnerPoints ?? 0}, ${label(loser, ranks, names)} ${loserPoints ?? 0}`,
    tag: `game-${game.id}`,
    url: `?game=${game.id}`,
    gameId: game.id,
  };
};

export const testPayload = (): PushPayload => ({
  title: "STRDYS",
  body: "Notifications are on. You will get kickoffs and finals of Top 25 games and your teams.",
  tag: "strdys-test",
  url: "",
});
