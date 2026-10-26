// Run with: deno test supabase/functions/_shared/recruiting_test.ts
import { portalSeasonsToRefresh } from "./recruiting_sync.ts";
import { countByMonth, currentClassYear, mapPortal, mapRecruitingTeams, mapRecruits, unmatchedNames } from "./recruiting.ts";

const assertEquals = (actual: unknown, expected: unknown, message = "") => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\nexpected ${e}\nreceived ${a}`);
};

const ids = new Map([["indiana", 84], ["ohiostate", 194], ["texas", 251], ["northdakotastate", 2449]]);
const all = new Set([84, 194, 251, 2449]);
const fbs = new Set([84, 194, 251]);

Deno.test("the class year changes in August", () => {
  assertEquals(currentClassYear(new Date("2026-10-26T10:00:00Z")), 2027);
  assertEquals(currentClassYear(new Date("2027-03-01T10:00:00Z")), 2027);
  assertEquals(currentClassYear(new Date("2027-08-01T10:00:00Z")), 2028);
});

const recruitData = [
  { id: "1", athleteId: "11", year: 2027, ranking: 3, name: "A One", school: "HS A", committedTo: "Indiana", position: "QB", height: 75, weight: 210, stars: 5, rating: 0.99871, city: "X", stateProvince: "TX", country: "USA" },
  { id: "2", athleteId: null, year: 2027, ranking: 1, name: "B Two", school: "HS B", committedTo: "Texas", position: "QB", height: 74, weight: 205, stars: 5, rating: 0.9991, city: "Y", stateProvince: "TX", country: "USA" },
  { id: "3", year: 2027, ranking: 0, name: "C Three", committedTo: "Nowhere State", position: "WR", stars: 2, rating: 0.8, stateProvince: "FL" },
  { id: "4", year: 2027, ranking: 9, name: "D Four", committedTo: "North Dakota State", position: "WR", stars: 3, rating: 0.86, stateProvince: "FL" },
  { id: "1", year: 2027, ranking: 5, name: "Duplicate" },
];

Deno.test("recruits get position and state ranks from the national rank", () => {
  const rows = mapRecruits(recruitData, 2027, ids, all);
  assertEquals(rows.map((row) => row.id), ["2", "1", "4", "3"]);
  assertEquals(rows.map((row) => [row.national_rank, row.position_rank, row.state_rank]), [[1, 1, 1], [3, 2, 2], [9, 1, 1], [null, null, null]]);
  assertEquals(rows[1].rating, 0.9987);
  assertEquals(rows.map((row) => row.committed_team_id), [251, 84, 2449, null]);
});

Deno.test("class rows count the commits of FBS teams only", () => {
  const recruits = mapRecruits(recruitData, 2027, ids, all);
  const rows = mapRecruitingTeams([
    { year: 2027, rank: 9, team: "Indiana", points: 241.6 },
    { year: 2027, rank: 12, team: "Texas", points: 230.123 },
    { year: 2027, rank: 90, team: "North Dakota State", points: 40 },
    { year: 2027, rank: 4, team: "Unknown School", points: 10 },
  ], recruits, 2027, ids, fbs);
  assertEquals(rows.map((row) => [row.team_id, row.rank, row.points, row.commits, row.five_stars, row.average_rating]), [[84, 9, 241.6, 1, 1, 0.9987], [251, 12, 230.12, 1, 1, 0.9991]]);
});

Deno.test("portal entries keep a stable id and a null destination", () => {
  const rows = mapPortal([
    { season: 2026, firstName: "Al", lastName: "Bee", position: "QB", origin: "Texas", destination: "Ohio State", transferDate: "2025-12-10T05:00:00.000Z", rating: 0.97123, stars: 4, eligibility: "Immediate" },
    { season: 2026, firstName: "Cy", lastName: "Dee", position: "WR", origin: "Indiana", transferDate: "not a date", stars: 3, eligibility: "Strange" },
    { season: 2026, firstName: "Cy", lastName: "Dee", position: "WR", origin: "Indiana", eligibility: "Withdrawn" },
  ], 2026, ids, all);
  assertEquals(rows.map((row) => row.id), ["2026:texas:albee:qb", "2026:indiana:cydee:wr", "2026:indiana:cydee:wr:2"]);
  assertEquals([rows[0].origin_team_id, rows[0].destination_team_id, rows[0].rating, rows[0].transfer_date], [251, 194, 0.9712, "2025-12-10T05:00:00.000Z"]);
  assertEquals([rows[1].destination_team_id, rows[1].transfer_date, rows[1].eligibility, rows[2].eligibility], [null, null, null, "Withdrawn"]);
});

Deno.test("unmatched names are counted and month counts are sorted", () => {
  assertEquals(unmatchedNames(["Texas", "Idaho State", null, "Idaho State", "Adams"], ids), ["Idaho State (2)", "Adams (1)"]);
  assertEquals(countByMonth(["2025-12-10T05:00:00.000Z", "2025-12-11T05:00:00.000Z", null, "2025-09-25T16:36:00.000Z"]), { "2025-09": 1, "2025-12": 2 });
});

Deno.test("the weekly update refreshes the next portal season from November on", () => {
  assertEquals(portalSeasonsToRefresh(new Date("2026-10-26T10:00:00Z")), [2026]);
  assertEquals(portalSeasonsToRefresh(new Date("2026-11-02T10:00:00Z")), [2026, 2027]);
  assertEquals(portalSeasonsToRefresh(new Date("2026-12-14T10:00:00Z")), [2026, 2027]);
  assertEquals(portalSeasonsToRefresh(new Date("2027-01-11T10:00:00Z")), [2027]);
});
