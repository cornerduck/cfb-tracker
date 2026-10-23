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

// One NFL team of CFBD's /draft/teams (the id is the one used by nflTeamId).
export type DraftTeam = { id: number | null; displayName: string; abbr: string | null };

export function parseDraftTeams(data: unknown[]): DraftTeam[] {
  const teams: DraftTeam[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const team = entry as JsonObject;
    const location = optionalString(team.location);
    const nickname = optionalString(team.nickname);
    const displayName = optionalString(team.displayName) ?? [location, nickname].filter(Boolean).join(" ");
    if (!displayName) continue;
    teams.push({ id: integerValue(team.id), displayName, abbr: nflAbbreviation(displayName) ?? nflAbbreviation(nickname) });
  }
  return teams;
}

// CFBD often names the team of a pick only by its city ("Tennessee",
// "New York"). The team id decides when it is given; else the name works when
// only one team starts with it. "New York" and "Los Angeles" are not unique.
export function resolveDraftTeam(nflTeam: string, nflTeamId: number | null, teams: readonly DraftTeam[]) {
  const byId = nflTeamId === null ? undefined : teams.find((team) => team.id === nflTeamId);
  if (byId?.abbr) return { name: byId.displayName, abbr: byId.abbr };
  const direct = nflAbbreviation(nflTeam);
  if (direct) return { name: nflTeam, abbr: direct };
  const wanted = nflTeam.trim().toLowerCase();
  const matches = teams.filter((team) => team.abbr && team.displayName.toLowerCase().startsWith(`${wanted} `));
  if (matches.length === 1) return { name: matches[0].displayName, abbr: matches[0].abbr };
  return { name: nflTeam, abbr: null };
}

// Keeps the picks of the requested rounds (round 1 only by default).
export function mapDraftPicks(data: unknown[], draftYear: number, rounds: number[] = [1], teams: readonly DraftTeam[] = []) {
  const rows: JsonObject[] = [];
  for (const entry of data) {
    const pick = asObject(entry, "draft pick");
    const overall = integerValue(pick.overall);
    const round = integerValue(pick.round);
    const name = optionalString(pick.name);
    const nflTeam = optionalString(pick.nflTeam);
    if (overall === null || round === null || !name || !nflTeam || !rounds.includes(round)) continue;
    const team = resolveDraftTeam(nflTeam, integerValue(pick.nflTeamId), teams);
    const collegeId = integerValue(pick.collegeId);
    const athlete = pick.collegeAthleteId === null || pick.collegeAthleteId === undefined ? null : String(pick.collegeAthleteId);
    rows.push({
      draft_year: draftYear,
      overall,
      round,
      pick: integerValue(pick.pick),
      nfl_team: team.name,
      nfl_abbr: team.abbr,
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
