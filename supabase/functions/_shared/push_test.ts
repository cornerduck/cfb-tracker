// Run with: deno test supabase/functions/_shared/push_test.ts
import { finalPayload, isRelevant, kickoffPayload, type PollEntry, type PushGame, ranksForGame } from "./push.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const game = (overrides: Partial<PushGame> = {}): PushGame => ({
  id: 7,
  week: 11,
  season_type: "regular",
  away_team_id: 1,
  home_team_id: 2,
  neutral_site: false,
  away_points: null,
  home_points: null,
  away_line_scores: null,
  home_line_scores: null,
  start_time: "2026-11-07T17:00:00Z",
  tv: "ESPN",
  status: "scheduled",
  ...overrides,
});
const names = new Map([[1, "BYU"], [2, "Utah"], [3, "Tulane"]]);
const poll = (source: string, week: number, rank: number, team_id: number, season_type = "regular"): PollEntry =>
  ({ source, week, rank, team_id, season_type });

Deno.test("AP counts until the CFP ranking is out, latest release up to the game week", () => {
  const ap = [poll("AP", 10, 5, 1), poll("AP", 11, 7, 1), poll("AP", 11, 3, 2), poll("AP", 12, 1, 1)];
  assertEquals([...ranksForGame(ap, game()).entries()], [[1, 7], [2, 3]]);
  const withCfp = [...ap, poll("CFP", 11, 9, 2)];
  assertEquals([...ranksForGame(withCfp, game()).entries()], [[2, 9]]);
  // Bowls use the latest regular-season ranking until a postseason one exists.
  assertEquals(ranksForGame(withCfp, game({ week: 1, season_type: "postseason" })).get(2), 9);
});

Deno.test("Top 25 games and favorite teams are relevant", () => {
  const ranks = new Map([[2, 3]]);
  assertEquals(isRelevant(game(), ranks, new Set()), true);
  assertEquals(isRelevant(game({ home_team_id: 3 }), ranks, new Set()), false);
  assertEquals(isRelevant(game({ home_team_id: 3 }), ranks, new Set([3])), true);
});

Deno.test("kickoff and final texts", () => {
  const ranks = new Map([[1, 7], [2, 3]]);
  assertEquals(kickoffPayload(game(), ranks, names).body, "#7 BYU @ #3 Utah · ESPN");
  assertEquals(kickoffPayload(game({ neutral_site: true, tv: null }), ranks, names).body, "#7 BYU vs #3 Utah");
  const final = finalPayload(
    game({ status: "final", away_points: 31, home_points: 24, home_line_scores: [7, 7, 3, 7, 0] }),
    ranks,
    names,
    -9.5,
    new Set([1, 2]),
  );
  assertEquals(final.title, "FINAL · OT · UPSET");
  assertEquals(final.body, "#7 BYU 31, #3 Utah 24");
  assertEquals(final.url, "?game=7");
  assertEquals(finalPayload(game({ status: "final", away_points: 10, home_points: 24 }), ranks, names, -9.5, new Set([1, 2])).title, "FINAL");
});
