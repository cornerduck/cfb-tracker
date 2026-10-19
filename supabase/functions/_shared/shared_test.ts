// Run with: deno test supabase/functions/_shared/shared_test.ts
import {
  classifyPoll,
  finalApRanks,
  mapGame,
  mapLines,
  mapPlayerSeasonStats,
  mapPolls,
  mapTeam,
  mapTeamGameStats,
} from "./cfbd.ts";
import { computeHeismanWeeks, computeWeeklyAwards, statValue, underdogWin } from "./derived.ts";

const assertEquals = (actual: unknown, expected: unknown, message = "") => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\nexpected ${e}\nreceived ${a}`);
};

Deno.test("only the three FBS polls are classified", () => {
  assertEquals(classifyPoll("AP Top 25"), "AP");
  assertEquals(classifyPoll("Coaches Poll"), "Coaches");
  assertEquals(classifyPoll("Playoff Committee Rankings"), "CFP");
  assertEquals(classifyPoll("FCS Coaches Poll"), null);
  assertEquals(classifyPoll("AFCA Division II Coaches Poll"), null);
  assertEquals(classifyPoll("AFCA Division III Coaches Poll"), null);
});

Deno.test("postseason polls keep their own season type", () => {
  const ids = new Map([["indiana", 84]]);
  const rows = mapPolls([
    { season: 2025, seasonType: "regular", week: 1, polls: [{ poll: "AP Top 25", ranks: [{ rank: 20, school: "Indiana" }] }] },
    { season: 2025, seasonType: "postseason", week: 1, polls: [{ poll: "AP Top 25", ranks: [{ rank: 1, school: "Indiana" }] }] },
  ], ids, 2025);
  assertEquals(rows.map((row) => [row.season_type, row.week, row.rank]), [["regular", 1, 20], ["postseason", 1, 1]]);
  assertEquals([...finalApRanks(rows)], [[84, 1]]);
});

Deno.test("team game stats are keyed by category", () => {
  const rows = mapTeamGameStats([
    { id: 1, teams: [{ teamId: 5, stats: [{ category: "totalYards", stat: "445" }, { category: "thirdDownEff", stat: "5-12" }] }] },
  ], new Set([1]), new Map());
  assertEquals(rows[0].stats, { totalYards: "445", thirdDownEff: "5-12" });
});

Deno.test("player season stats use statType as the name", () => {
  const rows = mapPlayerSeasonStats([
    { playerId: "9", player: "A B", position: "QB", team: "Indiana", category: "passing", statType: "YDS", stat: "3535" },
    { playerId: "9", player: "A B", position: "QB", team: "Indiana", category: "passing", statType: "TD", stat: "41" },
  ], new Map([["indiana", 84]]), 2025, new Set([84]));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].stats, { YDS: 3535, TD: 41 });
  assertEquals(rows[0].position, "QB");
});

Deno.test("games keep notes, seeds and the CFP round", () => {
  const game = mapGame({
    id: 7,
    week: 1,
    seasonType: "postseason",
    homeId: 1,
    awayId: 2,
    completed: true,
    homePoints: 27,
    awayPoints: 21,
    notes: "College Football Playoff National Championship",
    playoff: { round: "championship", roundName: "National Championship", homeSeed: 1, awaySeed: 10, bowlName: null },
  }, new Map(), 2025)!;
  assertEquals([game.cfp_round, game.is_title_game, game.home_seed, game.away_seed, game.status], [
    "National Championship",
    true,
    1,
    10,
    "final",
  ]);
});

Deno.test("team mapping reads the venue and alternate color", () => {
  const team = mapTeam({ id: 1, school: "Texas", alternateColor: "#fff", location: { name: "DKR", capacity: 100119 } }, true);
  assertEquals([team.venue, team.alt_color, team.capacity], ["DKR", "#fff", 100119]);
});

Deno.test("lines average providers when there is no consensus", () => {
  const lines = mapLines([{ id: 3, lines: [{ provider: "A", spread: -3, overUnder: 50 }, { provider: "B", spread: -4, overUnder: 51 }] }], new Set([3]));
  assertEquals([lines[0].consensus_spread, lines[0].over_under], [-3.5, 50.5]);
});

Deno.test("upsets follow the home-perspective spread", () => {
  const fbs = new Set([1, 2]);
  const game = { id: 1, week: 1, home_team_id: 1, away_team_id: 2, home_points: 20, away_points: 24 };
  // Home favored by 22.5, away team won: a stunner.
  assertEquals(underdogWin(game, -22.5, fbs)?.tier, "stunner");
  // Away favored by 7, away team won: no upset.
  assertEquals(underdogWin(game, 7, fbs), null);
  // FCS team (3) beats FBS team (1) with no line.
  assertEquals(underdogWin({ ...game, away_team_id: 3 }, null, fbs)?.tier, "stunner");
});

Deno.test("C/ATT splits into completions and attempts", () => {
  assertEquals(statValue({ "C/ATT": "21/30" }, ["att"]), 30);
  assertEquals(statValue({ "C/ATT": "21/30" }, ["comp"]), 21);
  assertEquals(statValue({ YDS: "412" }, ["YDS"]), 412);
});

Deno.test("weekly awards pick upset, closest game, blowout and performance", () => {
  const fbs = new Set([1, 2, 3, 4, 5, 6]);
  const games = [
    { id: 1, week: 6, home_team_id: 1, away_team_id: 2, home_points: 24, away_points: 27 },
    { id: 2, week: 6, home_team_id: 3, away_team_id: 4, home_points: 45, away_points: 3 },
    {
      id: 3,
      week: 6,
      home_team_id: 5,
      away_team_id: 6,
      home_points: 28,
      away_points: 30,
      home_line_scores: [7, 7, 7, 7, 0],
      away_line_scores: [7, 7, 7, 7, 2],
    },
  ];
  const spreads = new Map<number, number | null>([[1, -22.5], [2, -30], [3, -2]]);
  const players = [
    { game_id: 1, player_id: "p", player_name: "QB One", team_id: 2, category: "passing", stats: { "C/ATT": "25/31", YDS: "412", TD: "5", INT: "0" } },
    { game_id: 2, player_id: "k", player_name: "Punter", team_id: 3, category: "punting", stats: { YDS: "500" } },
  ];
  const awards = computeWeeklyAwards(2025, 6, games, spreads, players, fbs);
  const byType = Object.fromEntries(awards.map((award) => [award.award_type, award]));
  assertEquals(byType.upset.game_id, 1);
  assertEquals((byType.upset.details as Record<string, unknown>).tier, "stunner");
  assertEquals(byType.game.game_id, 3);
  assertEquals(byType.blowout.game_id, 2);
  assertEquals(byType.performance.player_id, "p");
});

Deno.test("heisman weeks rank qualified players", () => {
  const games = [
    { id: 1, week: 1, home_team_id: 1, away_team_id: 2, home_points: 30, away_points: 10 },
    { id: 2, week: 1, home_team_id: 3, away_team_id: 4, home_points: 14, away_points: 21 },
  ];
  const rows = [
    { game_id: 1, player_id: "a", player_name: "Star", team_id: 1, category: "passing", stats: { "C/ATT": "20/28", YDS: "350", TD: "4", INT: "0" } },
    { game_id: 2, player_id: "b", player_name: "Other", team_id: 3, category: "passing", stats: { "C/ATT": "12/30", YDS: "150", TD: "1", INT: "2" } },
    { game_id: 2, player_id: "c", player_name: "Backup", team_id: 4, category: "passing", stats: { "C/ATT": "1/1", YDS: "60", TD: "1", INT: "0" } },
  ];
  const weeks = computeHeismanWeeks(games, rows, [{ week: 2, team_id: 1, rank: 3 }], new Map());
  assertEquals(weeks[0].ranked.map((player) => player.player_id), ["a", "b"]);
});
