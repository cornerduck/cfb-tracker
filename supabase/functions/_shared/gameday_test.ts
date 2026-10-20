// Run with: deno test supabase/functions/_shared/gameday_test.ts
import { linkStops, parseGamedayStops, teamMatcher } from "./gameday.ts";

const assertEquals = (actual: unknown, expected: unknown, message = "") => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\nexpected ${e}\nreceived ${a}`);
};


const HTML = `
<div class="mw-heading mw-heading2"><h2 id="1990s">1990s</h2></div>
<table class="wikitable"><tbody>
<tr><th>Date</th><th colspan="2">Visitor</th><th colspan="2">Host</th><th>City</th><th>Location</th><th>Notes</th><th>Lee Corso pick</th></tr>
<tr><td>November 13</td><td><span>No. 1</span>&nbsp;Florida State</td><td>24</td><td>2&nbsp;Notre Dame</td><td><b>31</b></td><td>South Bend, Indiana</td><td>Joyce Center</td><td>Game of the Century<sup class="reference"><a>[1]</a></sup></td><td>Florida State</td></tr>
</tbody></table>
<table class="wikitable"><tbody>
<tr><th>Date</th><th colspan="2">Visitor</th><th colspan="2">Host</th><th>City</th><th>Location</th><th>Notes</th><th>Lee Corso pick</th></tr>
<tr><td>September 10</td><td>6 Michigan</td><td>26</td><td>3 Notre Dame</td><td>24</td><td>South Bend, Indiana</td><td></td><td rowspan="2">Rivalry</td><td></td></tr>
<tr><td>September 17</td><td>Texas A&amp;M</td><td>10</td><td>Miami (FL)</td><td>3</td><td>Coral Gables, Florida</td><td>Campus</td><td>Miami (FL)</td></tr>
</tbody></table>
<table class="wikitable sortable"><tbody>
<tr><th>Date</th><th>Visitor</th><th></th><th>Host</th><th></th><th>City</th><th>Location</th><th>Notes</th><th>Guest picker</th><th>Lee Corso headgear pick</th></tr>
<tr><td>August 30</td><td>1 Texas</td><td>7</td><td>3 Ohio State</td><td>14</td><td>Columbus, Ohio</td><td>Outside St. John Arena</td><td></td><td>None</td><td>Ohio State</td></tr>
<tr><td>September 13</td><td>6 Georgia</td><td>44<sup>OT</sup></td><td>15 Tennessee</td><td>41</td><td>Knoxville, Tennessee</td><td>Ayres Hall</td><td>Rivalry</td><td>Candace Parker</td><td></td></tr>
<tr><td>January 19, 2026</td><td>10 Miami (FL)</td><td>21</td><td>1 Indiana</td><td>27</td><td>Miami Gardens, Florida</td><td>Inside Hard Rock Stadium</td><td>CFP National Championship</td><td>Marcus Freeman</td><td></td></tr>
<tr><td>April 23–25, 2026</td><td colspan="4">2026 NFL draft</td><td>Pittsburgh, Pennsylvania</td><td>Outside Acrisure Stadium</td><td></td><td></td><td></td></tr>
</tbody></table>
<table class="wikitable"><tr><th>Team</th><th>Appearances</th></tr><tr><td>Ohio State</td><td>40</td></tr></table>`;

Deno.test("parses GameDay tables with seasons, ranks, scores and spans", () => {
  const stops = parseGamedayStops(HTML);
  assertEquals(stops.map((stop) => stop.season), [1993, 1994, 1994, 2025, 2025, 2025]);
  const first = stops[0];
  assertEquals([first.visitor, first.visitor_rank, first.visitor_points], ["Florida State", 1, 24]);
  assertEquals([first.host, first.host_rank, first.host_points], ["Notre Dame", 2, 31]);
  assertEquals([first.city, first.state, first.notes, first.corso_pick], ["South Bend", "Indiana", "Game of the Century", "Florida State"]);
  assertEquals(stops[2].notes, "Rivalry"); // carried by rowspan
  assertEquals(stops[2].visitor, "Texas A&M");
  assertEquals(stops[2].site, "Campus");
  assertEquals(stops[3].guest_picker, null);
  assertEquals(stops[4].visitor_points, 44);
  assertEquals(stops[4].show_date, "2025-09-13");
  assertEquals(stops[5].show_date, "2026-01-19");
  assertEquals(stops[5].guest_picker, "Marcus Freeman");
});

Deno.test("matches Wikipedia names to teams and links tracked games", () => {
  const match = teamMatcher([
    { id: 1, school: "Miami", is_fbs: true },
    { id: 2, school: "Indiana", is_fbs: true },
    { id: 3, school: "Pittsburgh", is_fbs: true },
    { id: 4, school: "Hawai'i", is_fbs: true },
  ]);
  assertEquals([match("Miami (FL)"), match("Pitt"), match("Hawaii"), match("Indiana"), match("Villanova")], [1, 3, 4, 2, null]);
  const stops = parseGamedayStops(HTML).filter((stop) => stop.season === 2025)
    .map((stop) => ({ ...stop, host_team_id: match(stop.host), visitor_team_id: match(stop.visitor) }));
  const { weekly } = linkStops(stops, new Map([[2025, [
    { id: 99, week: 1, season_type: "postseason", home_team_id: 2, away_team_id: 1, start_time: "2026-01-20T00:30:00Z" },
    { id: 50, week: 15, season_type: "regular", home_team_id: 9, away_team_id: 8, start_time: "2025-12-06T20:00:00Z" },
  ]]]));
  assertEquals(weekly.map((row) => [row.week, row.game_id, row.team_id]), [[16, 99, 2]]);
});
