// Reads the unofficial ESPN NFL endpoints. ESPN has no documented contract, so
// the parsers look for the data by its meaning (a team id plus wins and losses)
// and not by one fixed path, and the caller checks that all 32 teams came back.

export type NflTeamInfo = { espnId: number; abbr: string; name: string; color: string };
export type NflRecord = { wins: number; losses: number; ties: number };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const numberOf = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const hexColor = (value: unknown) => typeof value === "string" && /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;

// Teams endpoint: sports[0].leagues[0].teams[].team
export function parseTeams(json: unknown): NflTeamInfo[] {
  const root = isObject(json) ? json : {};
  const sports = Array.isArray(root.sports) ? root.sports : [];
  const leagues = isObject(sports[0]) && Array.isArray((sports[0] as Json).leagues) ? (sports[0] as Json).leagues as unknown[] : [];
  const listed = isObject(leagues[0]) && Array.isArray((leagues[0] as Json).teams)
    ? (leagues[0] as Json).teams as unknown[]
    : Array.isArray(root.teams)
    ? root.teams as unknown[]
    : [];
  const teams: NflTeamInfo[] = [];
  for (const entry of listed) {
    const team = isObject(entry) && isObject(entry.team) ? entry.team : isObject(entry) ? entry : null;
    if (!team) continue;
    const espnId = numberOf(team.id);
    const abbr = typeof team.abbreviation === "string" ? team.abbreviation.trim().toUpperCase() : "";
    const name = typeof team.displayName === "string" ? team.displayName.trim() : "";
    if (espnId === null || !abbr || !name) continue;
    teams.push({ espnId, abbr, name, color: hexColor(team.color) ?? hexColor(team.alternateColor) ?? "3A3F46" });
  }
  return teams;
}

// Teams named inside the standings (id, abbreviation, name; no color), used
// when the teams endpoint cannot be reached.
export function parseStandingsTeams(json: unknown): NflTeamInfo[] {
  const found = new Map<number, NflTeamInfo>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const entry = node as Json;
    if (isObject(entry.team) && (Array.isArray(entry.stats) || Array.isArray(entry.records))) {
      const team = entry.team;
      const espnId = numberOf(team.id);
      const abbr = typeof team.abbreviation === "string" ? team.abbreviation.trim().toUpperCase() : "";
      const name = typeof team.displayName === "string" ? team.displayName.trim() : "";
      if (espnId !== null && abbr && name) found.set(espnId, { espnId, abbr, name, color: hexColor(team.color) ?? "3A3F46" });
    }
    for (const value of Object.values(entry)) walk(value, depth + 1);
  };
  walk(json, 0);
  return [...found.values()];
}

const teamIdOf = (team: unknown) => {
  if (!isObject(team)) return null;
  const direct = numberOf(team.id);
  if (direct !== null) return direct;
  const match = typeof team.$ref === "string" ? /\/teams\/(\d+)/.exec(team.$ref) : null;
  return match ? Number(match[1]) : null;
};

const fromSummary = (text: unknown): NflRecord | null => {
  const match = typeof text === "string" ? /^\s*(\d+)-(\d+)(?:-(\d+))?\s*$/.exec(text) : null;
  return match ? { wins: Number(match[1]), losses: Number(match[2]), ties: match[3] ? Number(match[3]) : 0 } : null;
};

const fromStats = (stats: unknown): NflRecord | null => {
  if (!Array.isArray(stats)) return null;
  const byName = new Map<string, Json>();
  for (const stat of stats) if (isObject(stat) && typeof stat.name === "string") byName.set(stat.name, stat);
  const wins = numberOf(byName.get("wins")?.value);
  const losses = numberOf(byName.get("losses")?.value);
  if (wins !== null && losses !== null) return { wins, losses, ties: numberOf(byName.get("ties")?.value) ?? 0 };
  for (const name of ["overall", "record", "overallRecord"]) {
    const stat = byName.get(name);
    const parsed = fromSummary(stat?.summary) ?? fromSummary(stat?.displayValue);
    if (parsed) return parsed;
  }
  return null;
};

const recordOf = (entry: Json): NflRecord | null => {
  if (Array.isArray(entry.records)) {
    const records = entry.records.filter(isObject);
    const overall = records.find((record) => record.name === "overall" || record.type === "total") ?? records[0];
    if (overall) {
      const parsed = fromSummary(overall.summary) ?? fromSummary(overall.displayValue) ?? fromStats(overall.stats);
      if (parsed) return parsed;
    }
  }
  return fromStats(entry.stats);
};

// Standings of either endpoint: every object that holds a team and a record.
export function parseRecords(json: unknown): Map<number, NflRecord> {
  const found = new Map<number, NflRecord>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const entry = node as Json;
    if (entry.team && (Array.isArray(entry.stats) || Array.isArray(entry.records))) {
      const id = teamIdOf(entry.team);
      const record = recordOf(entry);
      if (id !== null && record) found.set(id, record);
    }
    for (const value of Object.values(entry)) walk(value, depth + 1);
  };
  walk(json, 0);
  return found;
}

// The NFL season whose record decides the next draft: from August on the new
// season counts, before that the one that just ended.
export const nflSeasonFor = (date: Date) => date.getUTCMonth() >= 7 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
