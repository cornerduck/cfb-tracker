// Maps the CFBD draft picks (/draft/picks) to rows of nfl_draft_picks.
import { asObject, integerValue, type JsonObject, optionalString } from "./cfbd.ts";

// Team nickname (lower case, no spaces) to the ESPN abbreviation used for the
// logos. CFBD may write "Washington Commanders" or only the nickname, and older
// drafts use the names of that time.
const NICKNAMES: [string, string][] = [
  ["cardinals", "ARI"], ["falcons", "ATL"], ["ravens", "BAL"], ["bills", "BUF"], ["panthers", "CAR"],
  ["bears", "CHI"], ["bengals", "CIN"], ["browns", "CLE"], ["cowboys", "DAL"], ["broncos", "DEN"],
  ["lions", "DET"], ["packers", "GB"], ["texans", "HOU"], ["colts", "IND"], ["jaguars", "JAX"],
  ["chiefs", "KC"], ["raiders", "LV"], ["chargers", "LAC"], ["rams", "LAR"], ["dolphins", "MIA"],
  ["vikings", "MIN"], ["patriots", "NE"], ["saints", "NO"], ["giants", "NYG"], ["jets", "NYJ"],
  ["eagles", "PHI"], ["steelers", "PIT"], ["49ers", "SF"], ["seahawks", "SEA"], ["buccaneers", "TB"],
  ["titans", "TEN"], ["commanders", "WSH"], ["redskins", "WSH"], ["footballteam", "WSH"],
];

export const nflAbbreviation = (teamName: string | null) => {
  if (!teamName) return null;
  const compact = teamName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return NICKNAMES.find(([nickname]) => compact.endsWith(nickname))?.[1] ?? null;
};

// Keeps the picks of the requested rounds (round 1 only by default).
export function mapDraftPicks(data: unknown[], draftYear: number, rounds: number[] = [1]) {
  const rows: JsonObject[] = [];
  for (const entry of data) {
    const pick = asObject(entry, "draft pick");
    const overall = integerValue(pick.overall);
    const round = integerValue(pick.round);
    const name = optionalString(pick.name);
    const nflTeam = optionalString(pick.nflTeam);
    if (overall === null || round === null || !name || !nflTeam || !rounds.includes(round)) continue;
    const collegeId = integerValue(pick.collegeId);
    const athlete = pick.collegeAthleteId === null || pick.collegeAthleteId === undefined ? null : String(pick.collegeAthleteId);
    rows.push({
      draft_year: draftYear,
      overall,
      round,
      pick: integerValue(pick.pick),
      nfl_team: nflTeam,
      nfl_abbr: nflAbbreviation(nflTeam),
      name,
      position: optionalString(pick.position),
      height: integerValue(pick.height),
      weight: integerValue(pick.weight),
      college_team: optionalString(pick.collegeTeam),
      college_id: collegeId,
      college_athlete_id: athlete && athlete !== "" ? athlete : null,
      college_conference: optionalString(pick.collegeConference),
    });
  }
  return rows.sort((a, b) => Number(a.overall) - Number(b.overall));
}
