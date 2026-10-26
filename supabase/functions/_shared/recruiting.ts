// Maps CFBD recruiting and transfer portal data to the rows of recruiting_teams,
// recruits and portal_entries (see the migration 20261026130000_recruiting.sql).
import {
  asObject,
  identifier,
  integerValue,
  type JsonObject,
  normalizeName,
  numberValue,
  optionalString,
  teamIdFor,
} from "./cfbd.ts";

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// The class year that is being recruited right now: the class of 2027 is
// recruited from August 2026 until the summer of 2027.
export const currentClassYear = (now = new Date()) => now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);

export const PORTAL_ELIGIBILITY = ["Immediate", "SittingOne", "PendingAppeal", "TBD", "Withdrawn"] as const;

// /recruiting/players: one row per recruit of a class. CFBD gives only the national
// rank; the rank within the position and within the state is worked out here.
export function mapRecruits(data: unknown[], classYear: number, idByName: Map<string, number>, allIds: Set<number>) {
  const rows: JsonObject[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    const recruit = asObject(entry, "recruit");
    const id = identifier(recruit.id);
    const name = optionalString(recruit.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const ranking = integerValue(recruit.ranking);
    const rating = numberValue(recruit.rating);
    const stars = integerValue(recruit.stars);
    const committedTeam = teamIdFor(recruit.committedTo, idByName);
    rows.push({
      class_year: classYear,
      id,
      athlete_id: identifier(recruit.athleteId),
      name,
      position: optionalString(recruit.position),
      stars: stars !== null && stars >= 0 && stars <= 5 ? stars : null,
      rating: rating === null ? null : round(rating, 4),
      national_rank: ranking !== null && ranking >= 1 ? ranking : null,
      position_rank: null,
      state_rank: null,
      high_school: optionalString(recruit.school),
      city: optionalString(recruit.city),
      state_province: optionalString(recruit.stateProvince),
      country: optionalString(recruit.country),
      height: numberValue(recruit.height),
      weight: integerValue(recruit.weight),
      committed_team_id: committedTeam !== null && allIds.has(committedTeam) ? committedTeam : null,
      committed_to: optionalString(recruit.committedTo),
    });
  }
  const rankWithin = (key: "position" | "state_province", target: "position_rank" | "state_rank") => {
    const groups = new Map<string, JsonObject[]>();
    for (const row of rows) {
      const group = row[key];
      if (typeof group !== "string" || row.national_rank === null) continue;
      groups.set(group, [...(groups.get(group) ?? []), row]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => Number(a.national_rank) - Number(b.national_rank));
      group.forEach((row, index) => (row[target] = index + 1));
    }
  };
  rankWithin("position", "position_rank");
  rankWithin("state_province", "state_rank");
  return rows.sort((a, b) => (Number(a.national_rank ?? 1e9) - Number(b.national_rank ?? 1e9)) || String(a.id).localeCompare(String(b.id)));
}

// /recruiting/teams (rank and points) plus the commits of that class. Only FBS teams.
export function mapRecruitingTeams(
  data: unknown[],
  recruits: JsonObject[],
  classYear: number,
  idByName: Map<string, number>,
  fbsIds: Set<number>,
) {
  const byTeam = new Map<number, JsonObject>();
  for (const entry of data) {
    const row = asObject(entry, "team recruiting ranking");
    const teamId = teamIdFor(row.team, idByName);
    if (teamId === null || !fbsIds.has(teamId) || byTeam.has(teamId)) continue;
    const rank = integerValue(row.rank);
    const points = numberValue(row.points);
    byTeam.set(teamId, {
      class_year: classYear,
      team_id: teamId,
      rank: rank !== null && rank >= 1 ? rank : null,
      points: points === null ? null : round(points, 2),
    });
  }
  const commitsByTeam = new Map<number, JsonObject[]>();
  for (const recruit of recruits) {
    const teamId = recruit.committed_team_id;
    if (typeof teamId !== "number" || !fbsIds.has(teamId)) continue;
    commitsByTeam.set(teamId, [...(commitsByTeam.get(teamId) ?? []), recruit]);
  }
  for (const [teamId, row] of byTeam) {
    const commits = commitsByTeam.get(teamId) ?? [];
    const ratings = commits.map((commit) => commit.rating).filter((value): value is number => typeof value === "number");
    row.commits = commits.length;
    row.average_rating = ratings.length ? round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length, 4) : null;
    row.five_stars = commits.filter((commit) => commit.stars === 5).length;
    row.four_stars = commits.filter((commit) => commit.stars === 4).length;
    row.three_stars = commits.filter((commit) => commit.stars === 3).length;
  }
  return [...byTeam.values()].sort((a, b) => (Number(a.rank ?? 1e9) - Number(b.rank ?? 1e9)) || Number(a.team_id) - Number(b.team_id));
}

// /player/portal: CFBD gives no id, so the id is built from season, origin, name and position.
export function mapPortal(data: unknown[], season: number, idByName: Map<string, number>, allIds: Set<number>) {
  const rows: JsonObject[] = [];
  const used = new Map<string, number>();
  for (const entry of data) {
    const item = asObject(entry, "portal entry");
    const firstName = optionalString(item.firstName);
    const lastName = optionalString(item.lastName);
    const name = [firstName, lastName].filter(Boolean).join(" ");
    if (!name) continue;
    const position = optionalString(item.position);
    const origin = optionalString(item.origin);
    const destination = optionalString(item.destination);
    const base = `${season}:${normalizeName(origin ?? "")}:${normalizeName(name)}:${normalizeName(position ?? "")}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const originTeam = origin ? teamIdFor(origin, idByName) : null;
    const destinationTeam = destination ? teamIdFor(destination, idByName) : null;
    const date = optionalString(item.transferDate);
    const parsed = date ? Date.parse(date) : NaN;
    const rating = numberValue(item.rating);
    const stars = integerValue(item.stars);
    const eligibility = optionalString(item.eligibility);
    rows.push({
      season,
      id: count === 1 ? base : `${base}:${count}`,
      name,
      first_name: firstName,
      last_name: lastName,
      position,
      origin,
      origin_team_id: originTeam !== null && allIds.has(originTeam) ? originTeam : null,
      destination,
      destination_team_id: destinationTeam !== null && allIds.has(destinationTeam) ? destinationTeam : null,
      transfer_date: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
      stars: stars !== null && stars >= 0 && stars <= 5 ? stars : null,
      rating: rating === null ? null : round(rating, 4),
      eligibility: eligibility && (PORTAL_ELIGIBILITY as readonly string[]).includes(eligibility) ? eligibility : null,
    });
  }
  return rows;
}

// Names CFBD uses that are not in the teams table (mostly junior colleges and FCS schools), the most
// frequent first. A misspelled FBS team shows up here with many entries.
export function unmatchedNames(names: (string | null)[], idByName: Map<string, number>, limit = 40) {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name && !idByName.has(normalizeName(name))) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count})`);
}

// Number of entries per month of the transfer date, to see which time window a CFBD season covers.
export function countByMonth(dates: (string | null)[]) {
  const counts: Record<string, number> = {};
  for (const date of dates) {
    if (date) counts[date.slice(0, 7)] = (counts[date.slice(0, 7)] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
