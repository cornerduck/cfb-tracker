// Derived data that STRDYS calculates itself from imported games, lines and
// box scores: weekly awards and the stat-based Heisman tracker. These are pure
// functions; the Edge Functions load the rows and store the results.

import { jsonObject, type JsonObject, numberValue } from "./cfbd.ts";

export type GameRow = {
  id: number;
  week: number | null;
  season_type?: string | null;
  home_team_id: number;
  away_team_id: number;
  home_points: number | null;
  away_points: number | null;
  home_line_scores?: number[] | null;
  away_line_scores?: number[] | null;
};

export type PlayerGameRow = {
  game_id: number;
  player_id: string;
  player_name: string;
  team_id: number;
  category: string;
  stats: unknown;
};

const normalizedKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

// Reads a numeric box-score value by any of its CFBD names ("YDS", "TD", ...).
// "C/ATT" values such as "21/30" return the attempts for "att" lookups and the
// completions for "comp" lookups.
export const statValue = (stats: unknown, names: string[]) => {
  const record = jsonObject(stats);
  const targets = new Set(names.map(normalizedKey));
  for (const [name, value] of Object.entries(record)) {
    const key = normalizedKey(name);
    if (key === "catt" && typeof value === "string" && value.includes("/")) {
      const [completions, attempts] = value.split("/");
      if (targets.has("att") || targets.has("attempts")) return numberValue(attempts) ?? 0;
      if (targets.has("comp") || targets.has("completions")) return numberValue(completions) ?? 0;
    }
    if (targets.has(key)) return numberValue(value) ?? 0;
  }
  return 0;
};

const isOvertime = (game: GameRow) =>
  Math.max(game.home_line_scores?.length ?? 0, game.away_line_scores?.length ?? 0) > 4;

export type UpsetTier = "upset" | "big" | "stunner" | null;

// Spread convention (CFBD): negative = home team favored.
export const underdogWin = (
  game: GameRow,
  spread: number | null | undefined,
  fbsIds: Set<number>,
) => {
  if (game.home_points === null || game.away_points === null) return null;
  if (game.home_points === game.away_points) return null;
  const homeWon = game.home_points > game.away_points;
  const winner = homeWon ? game.home_team_id : game.away_team_id;
  const loser = homeWon ? game.away_team_id : game.home_team_id;
  if (spread === null || spread === undefined || spread === 0) {
    // FCS wins over FBS teams count even without a closing line.
    if (!fbsIds.has(winner) && fbsIds.has(loser)) {
      return { winner, loser, winnerSpread: null as number | null, tier: "stunner" as UpsetTier };
    }
    return null;
  }
  const homeFavored = spread < 0;
  const underdogWon = homeFavored ? !homeWon : homeWon;
  if (!underdogWon) return null;
  const winnerSpread = Math.abs(spread);
  const tier: UpsetTier = winnerSpread >= 21
    ? "stunner"
    : winnerSpread >= 14
    ? "big"
    : winnerSpread >= 7
    ? "upset"
    : null;
  return { winner, loser, winnerSpread, tier };
};

// Points formula for Performance of the Week, summed over a player's
// categories in one game.
export const performanceScore = (rows: PlayerGameRow[]) => {
  let score = 0;
  const line: Record<string, number> = {};
  const add = (key: string, value: number) => {
    if (value) line[key] = (line[key] ?? 0) + value;
  };
  for (const row of rows) {
    const category = row.category.toLowerCase();
    const stats = row.stats;
    if (category === "passing") {
      const yards = statValue(stats, ["YDS"]);
      const td = statValue(stats, ["TD"]);
      const int = statValue(stats, ["INT"]);
      score += yards / 25 + td * 4 - int * 2;
      add("pass_yds", yards);
      add("pass_td", td);
      add("int", int);
      add("pass_att", statValue(stats, ["att"]));
      add("pass_comp", statValue(stats, ["comp"]));
      line.int ??= 0;
    } else if (category === "rushing") {
      const yards = statValue(stats, ["YDS"]);
      const td = statValue(stats, ["TD"]);
      score += yards / 10 + td * 6;
      add("rush_yds", yards);
      add("rush_td", td);
      add("car", statValue(stats, ["CAR"]));
    } else if (category === "receiving") {
      const yards = statValue(stats, ["YDS"]);
      const td = statValue(stats, ["TD"]);
      const receptions = statValue(stats, ["REC"]);
      score += yards / 10 + td * 6 + receptions * 0.5;
      add("rec", receptions);
      add("rec_yds", yards);
      add("rec_td", td);
    } else if (category === "defensive") {
      const tackles = statValue(stats, ["TOT"]);
      const sacks = statValue(stats, ["SACKS"]);
      const tfl = statValue(stats, ["TFL"]);
      const pd = statValue(stats, ["PD"]);
      const td = statValue(stats, ["TD"]);
      score += tackles * 0.5 + sacks * 3 + tfl * 1.5 + pd + td * 6;
      add("tackles", tackles);
      add("sacks", sacks);
      add("tfl", tfl);
    } else if (category === "interceptions") {
      const int = statValue(stats, ["INT"]);
      const td = statValue(stats, ["TD"]);
      score += int * 5 + td * 6;
      add("def_int", int);
      add("def_td", td);
    } else if (category === "fumbles") {
      score -= statValue(stats, ["LOST"]) * 2;
    }
  }
  const position = (line.pass_att ?? 0) >= 5
    ? "QB"
    : (line.tackles ?? 0) + (line.sacks ?? 0) + (line.def_int ?? 0) > 0 &&
        (line.rush_yds ?? 0) + (line.rec_yds ?? 0) === 0
    ? "DEF"
    : (line.rec_yds ?? 0) > (line.rush_yds ?? 0)
    ? "WR"
    : "RB";
  return { score, line, position };
};

export const computeWeeklyAwards = (
  season: number,
  week: number,
  games: GameRow[],
  spreadByGame: Map<number, number | null>,
  playerRows: PlayerGameRow[],
  fbsIds: Set<number>,
) => {
  const completed = games.filter((game) =>
    game.home_points !== null && game.away_points !== null &&
    (fbsIds.has(game.home_team_id) || fbsIds.has(game.away_team_id))
  );
  const awards: JsonObject[] = [];
  if (!completed.length) return awards;

  const upsets = completed.flatMap((game) => {
    const result = underdogWin(game, spreadByGame.get(game.id), fbsIds);
    return result ? [{ game, ...result }] : [];
  }).sort((a, b) => (b.winnerSpread ?? 99) - (a.winnerSpread ?? 99));
  if (upsets[0]) {
    awards.push({
      season,
      week,
      award_type: "upset",
      game_id: upsets[0].game.id,
      player_id: null,
      details: {
        winner_team_id: upsets[0].winner,
        winner_spread: upsets[0].winnerSpread,
        tier: upsets[0].tier,
        consensus_spread: spreadByGame.get(upsets[0].game.id) ?? null,
      },
    });
  }

  const fbsGames = completed.filter((game) =>
    fbsIds.has(game.home_team_id) && fbsIds.has(game.away_team_id)
  ).map((game) => ({
    game,
    margin: Math.abs(game.home_points! - game.away_points!),
    total: game.home_points! + game.away_points!,
    overtime: isOvertime(game),
  }));
  const closest = [...fbsGames].sort((a, b) =>
    a.margin - b.margin || Number(b.overtime) - Number(a.overtime) || b.total - a.total
  )[0];
  if (closest) {
    awards.push({
      season,
      week,
      award_type: "game",
      game_id: closest.game.id,
      player_id: null,
      details: { margin: closest.margin, overtime: closest.overtime },
    });
  }
  const blowout = [...fbsGames].sort((a, b) => b.margin - a.margin || b.total - a.total)[0];
  if (blowout) {
    awards.push({
      season,
      week,
      award_type: "blowout",
      game_id: blowout.game.id,
      player_id: null,
      details: { margin: blowout.margin },
    });
  }

  const completedIds = new Set(completed.map((game) => game.id));
  const byPlayerGame = new Map<string, PlayerGameRow[]>();
  for (const row of playerRows) {
    if (!completedIds.has(row.game_id) || !fbsIds.has(row.team_id)) continue;
    const key = `${row.game_id}:${row.player_id}`;
    const rows = byPlayerGame.get(key) ?? [];
    rows.push(row);
    byPlayerGame.set(key, rows);
  }
  let best: { rows: PlayerGameRow[]; result: ReturnType<typeof performanceScore> } | null = null;
  for (const rows of byPlayerGame.values()) {
    const result = performanceScore(rows);
    if (!best || result.score > best.result.score) best = { rows, result };
  }
  if (best && best.result.score > 0) {
    const first = best.rows[0];
    awards.push({
      season,
      week,
      award_type: "performance",
      game_id: first.game_id,
      player_id: first.player_id,
      details: {
        player_name: first.player_name,
        team_id: first.team_id,
        position: best.result.position,
        score: Number(best.result.score.toFixed(2)),
        line: best.result.line,
      },
    });
  }
  return awards;
};

// ---------------------------------------------------------------- Heisman

type Totals = Record<string, number>;

const addTotals = (target: Totals, stats: unknown, names: Record<string, string[]>) => {
  for (const [key, aliases] of Object.entries(names)) {
    target[key] = (target[key] ?? 0) + statValue(stats, aliases);
  }
};

export type HeismanCandidate = {
  player_id: string;
  player_name: string;
  team_id: number;
  score: number;
};

// Reconstructs the tracker week by week from cumulative box-score production.
// Score = 80 % production percentile within the position (yards, touchdowns,
// efficiency, turnovers) + 20 % team success (win % and an AP ranking bonus).
export const computeHeismanWeeks = (
  games: GameRow[],
  playerRows: PlayerGameRow[],
  apPolls: Array<{ week: number; season_type?: string | null; team_id: number; rank: number }>,
  positionByPlayer: Map<string, string>,
) => {
  const completed = games.filter((game) =>
    game.week !== null && game.home_points !== null && game.away_points !== null
  );
  // Postseason games continue the timeline after the last regular week.
  const lastRegularWeek = Math.max(
    0,
    ...completed.filter((game) => (game.season_type ?? "regular") === "regular")
      .map((game) => game.week!),
  );
  const timelineWeek = (game: GameRow) =>
    (game.season_type ?? "regular") === "regular" ? game.week! : lastRegularWeek + game.week!;
  const gamesByWeek = new Map<number, GameRow[]>();
  const weekByGame = new Map<number, number>();
  for (const game of completed) {
    const week = timelineWeek(game);
    gamesByWeek.set(week, [...(gamesByWeek.get(week) ?? []), game]);
    weekByGame.set(game.id, week);
  }
  const rowsByWeek = new Map<number, PlayerGameRow[]>();
  for (const row of playerRows) {
    const week = weekByGame.get(row.game_id);
    if (week === undefined) continue;
    rowsByWeek.set(week, [...(rowsByWeek.get(week) ?? []), row]);
  }
  const polls = [...apPolls].map((poll) => ({
    ...poll,
    order: (poll.season_type ?? "regular") === "postseason" ? lastRegularWeek + poll.week : poll.week,
  })).sort((a, b) => a.order - b.order);

  const players = new Map<string, {
    player_id: string;
    player_name: string;
    team_id: number;
    totals: Totals;
  }>();
  const records = new Map<number, { wins: number; games: number }>();
  const apRank = new Map<number, number>();
  let currentPollOrder: number | undefined;
  const weeks: Array<{ week: number; ranked: Array<HeismanCandidate & { rank: number }> }> = [];

  for (const week of [...gamesByWeek.keys()].sort((a, b) => a - b)) {
    for (const game of gamesByWeek.get(week) ?? []) {
      for (const teamId of [game.home_team_id, game.away_team_id]) {
        const record = records.get(teamId) ?? { wins: 0, games: 0 };
        record.games += 1;
        const won = teamId === game.home_team_id
          ? game.home_points! > game.away_points!
          : game.away_points! > game.home_points!;
        if (won) record.wins += 1;
        records.set(teamId, record);
      }
    }
    for (const row of rowsByWeek.get(week) ?? []) {
      const player = players.get(row.player_id) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        team_id: row.team_id,
        totals: {},
      };
      player.team_id = row.team_id;
      const category = row.category.toLowerCase();
      if (category === "passing") {
        addTotals(player.totals, row.stats, {
          pass_yds: ["YDS"],
          pass_td: ["TD"],
          int: ["INT"],
          pass_att: ["att"],
        });
      } else if (category === "rushing") {
        addTotals(player.totals, row.stats, { rush_yds: ["YDS"], rush_td: ["TD"], car: ["CAR"] });
      } else if (category === "receiving") {
        addTotals(player.totals, row.stats, { rec_yds: ["YDS"], rec_td: ["TD"], rec: ["REC"] });
      } else if (category === "fumbles") {
        addTotals(player.totals, row.stats, { fum_lost: ["LOST"] });
      }
      players.set(row.player_id, player);
    }
    // The AP poll released after this week's games (CFBD numbers it as the
    // following week) replaces the previous one.
    const latestOrder = polls.filter((poll) => poll.order <= week + 1).at(-1)?.order;
    if (latestOrder !== undefined && latestOrder !== currentPollOrder) {
      currentPollOrder = latestOrder;
      apRank.clear();
      for (const poll of polls) {
        if (poll.order === latestOrder) apRank.set(poll.team_id, poll.rank);
      }
    }

    const candidates = [...players.values()].flatMap((player) => {
      const t = player.totals;
      const teamGames = records.get(player.team_id)?.games ?? 0;
      if (!teamGames) return [];
      const known = (positionByPlayer.get(player.player_id) ?? "").toUpperCase();
      const position = known === "QB" || (t.pass_att ?? 0) >= 10 * teamGames
        ? "QB"
        : ["WR", "TE"].includes(known) ||
            (!known && (t.rec_yds ?? 0) > (t.rush_yds ?? 0))
        ? "WR"
        : ["RB", "FB", "HB"].includes(known) || !known
        ? "RB"
        : null;
      if (!position) return [];
      // Qualifying minimums keep backups with a single big play out of the field.
      if (position === "QB" && (t.pass_att ?? 0) < 10 * teamGames) return [];
      if (position === "RB" && (t.car ?? 0) < 6 * teamGames) return [];
      if (position === "WR" && (t.rec ?? 0) < 2.5 * teamGames) return [];
      const yards = position === "QB"
        ? (t.pass_yds ?? 0) + (t.rush_yds ?? 0)
        : position === "WR"
        ? t.rec_yds ?? 0
        : (t.rush_yds ?? 0) + (t.rec_yds ?? 0);
      const touchdowns = position === "QB"
        ? (t.pass_td ?? 0) + (t.rush_td ?? 0)
        : (t.rush_td ?? 0) + (t.rec_td ?? 0);
      const attempts = position === "QB"
        ? t.pass_att ?? 0
        : position === "WR"
        ? t.rec ?? 0
        : t.car ?? 0;
      const record = records.get(player.team_id)!;
      const rank = apRank.get(player.team_id);
      const teamSuccess = Math.min(
        1,
        (record.wins / record.games) * 0.8 + (rank ? Math.max(0, 26 - rank) / 25 : 0) * 0.2,
      );
      return [{
        player,
        position,
        yards,
        touchdowns,
        efficiency: attempts ? (position === "QB" ? t.pass_yds ?? 0 : yards) / attempts : 0,
        turnovers: (t.int ?? 0) + (t.fum_lost ?? 0),
        teamSuccess,
      }];
    });
    if (!candidates.length) continue;
    const byPosition = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      byPosition.set(candidate.position, [...(byPosition.get(candidate.position) ?? []), candidate]);
    }
    const percentile = (
      peers: typeof candidates,
      field: "yards" | "touchdowns" | "efficiency" | "turnovers",
      value: number,
    ) => {
      if (peers.length <= 1) return 1;
      const better = field === "turnovers"
        ? peers.filter((peer) => peer[field] < value).length
        : peers.filter((peer) => peer[field] > value).length;
      return 1 - better / (peers.length - 1);
    };
    const scored = candidates.map((candidate) => {
      const peers = byPosition.get(candidate.position)!;
      const production = (
        percentile(peers, "yards", candidate.yards) +
        percentile(peers, "touchdowns", candidate.touchdowns) +
        percentile(peers, "efficiency", candidate.efficiency) +
        percentile(peers, "turnovers", candidate.turnovers)
      ) / 4;
      return {
        player_id: candidate.player.player_id,
        player_name: candidate.player.player_name,
        team_id: candidate.player.team_id,
        yards: candidate.yards,
        score: Number((0.8 * production + 0.2 * candidate.teamSuccess).toFixed(6)),
      };
    }).sort((a, b) =>
      b.score - a.score || b.yards - a.yards || a.player_name.localeCompare(b.player_name)
    ).map(({ yards: _yards, ...candidate }, index) => ({ ...candidate, rank: index + 1 }));
    weeks.push({ week, ranked: scored });
  }
  return weeks;
};
